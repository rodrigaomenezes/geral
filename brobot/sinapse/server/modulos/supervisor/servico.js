'use strict';
// Supervisor independente (SUP-001 a SUP-005, WFL-007, WFL-008, AT-003, AT-010, AT-013).
// Varredura recorrente por organização (job `supervisor.varrer`, a cada minuto):
//   · transferência sem aceite no prazo → fila de contingência + escalonamento (AT-010)
//   · responsável indisponível → substituto ou fila da equipe (AT-003)
//   · próxima ação vencida → sobe o nível de escalonamento e cria tarefa para a Supervisão (sem repetir a cada minuto)
// Varredura global: heartbeat e jobs presos em execução. O heartbeat é lido por um monitor externo em
// GET /api/health/supervisor, que responde 503 se o supervisor parar (AT-013).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio, HORA } = require('../../nucleo/relogio');
const ocorrencias = require('../ocorrencias/servico');
const tarefas = require('../ocorrencias/tarefas');
const identidade = require('../identidade/servico');
const lotesCsv = require('../integracoes/csv/lotes');
const onboarding = require('../onboarding/servico');
const monitoramento = require('../monitoramento/servico');
const treinamentos = require('../treinamentos/servico');
const governanca = require('../governanca/servico');
const vip = require('../clientes/vip');
const saudeCanais = require('./saude-canais');

const INTERVALO_MS = 60e3;
const HEARTBEAT_MAX_MS = 3 * 60e3;
const NIVEL_MAX = 3;

async function jobVarrer(c, ctx) {
  const agora = relogio.agora();
  const resumo = { handoffsExpirados: 0, reatribuidas: 0, escalonadas: 0 };

  const contingencia = uma(await c.query('SELECT id FROM equipes WHERE contingencia LIMIT 1'));
  for (const h of (await c.query(
    `SELECT h.*, o.estado FROM handoffs h JOIN ocorrencias o ON o.id = h.ocorrencia_id
     WHERE h.estado = 'pendente' AND h.prazo_aceite_em < $1 LIMIT 100`, [agora])).rows) {
    await c.query("UPDATE handoffs SET estado = 'expirado', resolvido_em = now() WHERE id = $1", [h.id]);
    await ocorrencias.alterarComMotivo(c, ctx, h.ocorrencia_id, 'aberta', {
      equipe_id: contingencia.id, responsavel_id: null, proxima_acao: 'Transferência não aceita: assumir pela contingência',
      proxima_acao_em: new Date(agora.getTime() + HORA),
    }, 'ocorrencia.handoff_expirado', 'Transferência sem aceite no prazo: enviada à fila de contingência (RN-007)');
    await tarefas.criar(c, ctx, { tipo: 'escalonamento', equipeCodigo: 'supervisao', ocorrenciaId: h.ocorrencia_id, chave: `handoff:${h.id}`,
      titulo: 'Transferência não aceita no prazo', prazoEm: new Date(agora.getTime() + HORA) });
    resumo.handoffsExpirados++;
  }

  // Responsável indisponível ou com delegação vigente (GOV-009): repassa ao delegado, ao substituto ou volta à fila.
  for (const o of (await c.query(
    `SELECT o.id, o.responsavel_id, d.id IS NOT NULL AS delegou FROM ocorrencias o JOIN usuarios u ON u.id = o.responsavel_id
     LEFT JOIN LATERAL (SELECT dl.id FROM delegacoes dl JOIN usuarios p ON p.id = dl.para_id AND p.ativo AND p.disponivel
       WHERE dl.de_id = u.id AND dl.revogada_em IS NULL AND dl.inicio <= $1 AND dl.fim > $1 LIMIT 1) d ON true
     WHERE (NOT u.disponivel OR d.id IS NOT NULL) AND o.estado NOT IN ('resolvida','encerrada_sem_resolucao') LIMIT 100`, [agora])).rows) {
    const novo = await identidade.resolverResponsavel(c, o.responsavel_id);
    if (novo === o.responsavel_id) continue;
    const quem = o.delegou ? 'ao delegado' : 'ao substituto';
    await ocorrencias.alterarComMotivo(c, ctx, o.id, novo ? 'em_atendimento' : 'aberta', { responsavel_id: novo,
      proxima_acao: novo ? `Dar andamento (assumida pelo ${o.delegou ? 'delegado' : 'substituto'})` : 'Assumir (responsável indisponível)',
      proxima_acao_em: new Date(agora.getTime() + 2 * HORA) },
    'ocorrencia.reatribuida', novo ? `Responsável ${o.delegou ? 'com delegação vigente' : 'indisponível'}: repassada ${quem}` : 'Responsável indisponível e sem substituto: volta à fila');
    resumo.reatribuidas++;
  }

  for (const o of (await c.query(
    `SELECT id, protocolo, nivel_escalonamento, escalonamento_ciente_nivel, proxima_acao FROM ocorrencias
     WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao') AND proxima_acao_em < $1 LIMIT 100`, [agora])).rows) {
    const nivel = Math.min(o.nivel_escalonamento + 1, NIVEL_MAX);
    // COM-009: o alerta não se repete a cada minuto — a próxima verificação fica 1 hora (nível 1) a 4 horas depois.
    await ocorrencias.alterarComMotivo(c, ctx, o.id, null, { nivel_escalonamento: nivel,
      proxima_acao_em: new Date(agora.getTime() + nivel * HORA) },
    'ocorrencia.escalonada', `Próxima ação vencida ("${o.proxima_acao}"): escalonamento nível ${nivel}`);
    await tarefas.criar(c, ctx, { tipo: 'escalonamento', equipeCodigo: 'supervisao', ocorrenciaId: o.id, chave: `esc:${o.id}:${nivel}`,
      // WFL-007: sem ciência da gestão no nível anterior, o título diz isso (a gestão precisa registrar a ação).
      titulo: `${o.protocolo}: próxima ação vencida (nível ${nivel})${o.nivel_escalonamento > 0 && o.escalonamento_ciente_nivel < o.nivel_escalonamento ? ' · sem ciência da gestão' : ''}`,
      prazoEm: new Date(agora.getTime() + HORA) });
    resumo.escalonadas++;
  }
  // Adendo CSV: arquivo exportado sem confirmação de aplicação no destino dentro do prazo.
  resumo.lotesSemConfirmacao = await lotesCsv.verificarLotesAtrasados(c, ctx, { criarTarefa: (t) => tarefas.criar(c, ctx, t) });
  // ONB-003/010: item obrigatório de onboarding/offboarding vencido vira tarefa para a equipe dele.
  resumo.checklistAtrasados = await onboarding.verificarAtrasados(c, ctx, { criarTarefa: (t) => tarefas.criar(c, ctx, t) });
  // CRE-004 e POS-009: credencial perto de vencer e reincidência viram ocorrência (uma por alerta).
  resumo.credenciaisVencendo = await monitoramento.verificarExpiracoes(c, ctx);
  resumo.reincidencias = await monitoramento.verificarReincidencia(c, ctx);
  // CS-004: conta sem uso vira alerta para o CS oferecer treinamento.
  resumo.contasSemUso = await treinamentos.verificarInatividade(c, ctx);
  // GOV-009: delegação que venceu fica registrada na auditoria (uma vez).
  resumo.delegacoesExpiradas = await governanca.registrarExpiracoes(c, ctx);
  // GOV-002: VIP perto de vencer vira tarefa do CS; vencido sai (com auditoria).
  const vipVal = await vip.verificarValidades(c, ctx, { criarTarefa: (t) => tarefas.criar(c, ctx, t) });
  resumo.vipAvisos = vipVal.avisos; resumo.vipExpirados = vipVal.expirados;
  // SUP-002: canal em silêncio, entrada parada e rotina parada.
  Object.assign(resumo, await saudeCanais.verificarCanais(c, ctx, { carregarCalendario: ocorrencias.carregarCalendario, criarTarefa: (t) => tarefas.criar(c, ctx, t) }));
  if (resumo.handoffsExpirados || resumo.reatribuidas || resumo.escalonadas || resumo.lotesSemConfirmacao || resumo.checklistAtrasados || resumo.credenciaisVencendo || resumo.reincidencias || resumo.contasSemUso || resumo.delegacoesExpiradas || resumo.vipAvisos || resumo.vipExpirados || resumo.canaisEmSilencio || resumo.entradasParadas || resumo.rotinasParadas) {
    await publicar(c, ctx, { tipo: 'supervisor.varredura', agregado: 'tenant', agregadoId: ctx.tenantId, payload: resumo });
  }
  return { proximaEm: new Date(relogio.agora().getTime() + INTERVALO_MS) };
}

/** Varredura global (sem organização): heartbeat e jobs presos. */
async function varreduraGlobal(db) {
  await db.sistema(async (c) => {
    await c.query(`UPDATE jobs SET estado = 'pendente', ultimo_erro = 'Execução interrompida (reinício ou travamento); devolvido à fila'
      WHERE estado = 'executando' AND bloqueado_em < now() - interval '5 minutes'`);
    await c.query(`INSERT INTO sistema (chave, valor, atualizado_em) VALUES ('heartbeat', $1, now())
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`, [JSON.stringify({ em: new Date().toISOString() })]);
  });
}

async function saudeSupervisor(db) {
  const r = (await db.query("SELECT atualizado_em FROM sistema WHERE chave = 'heartbeat'")).rows[0];
  const idadeMs = r ? Date.now() - new Date(r.atualizado_em).getTime() : null;
  return { ok: idadeMs !== null && idadeMs < HEARTBEAT_MAX_MS, ultimoHeartbeat: r?.atualizado_em || null, idadeSegundos: idadeMs === null ? null : Math.round(idadeMs / 1000) };
}

/** Painel do supervisor: invariantes (meta 0), fila de jobs, fila de falhas, integrações e divergências. */
async function painel(c) {
  const agora = relogio.agora();
  const inv = uma(await c.query(
    `SELECT
       count(*) FILTER (WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao') AND equipe_id IS NULL)::int AS orfas,
       count(*) FILTER (WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao') AND proxima_acao_em IS NULL)::int AS sem_proxima_acao,
       count(*) FILTER (WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao') AND proxima_acao_em < $1)::int AS proxima_acao_vencida,
       count(*) FILTER (WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao','aguardando_cliente','aguardando_terceiro') AND prazo_em < $1)::int AS prazo_vencido,
       count(*) FILTER (WHERE estado = 'triagem')::int AS em_triagem,
       count(*) FILTER (WHERE nivel_escalonamento > 0 AND estado NOT IN ('resolvida','encerrada_sem_resolucao'))::int AS escalonadas
     FROM ocorrencias`, [agora]));
  const handoffs = uma(await c.query("SELECT count(*)::int AS pendentes, count(*) FILTER (WHERE prazo_aceite_em < $1)::int AS vencidos FROM handoffs WHERE estado = 'pendente'", [agora]));
  const jobs = (await c.query("SELECT estado, count(*)::int AS n FROM jobs GROUP BY estado")).rows;
  const falhas = (await c.query(
    "SELECT id, tipo, tentativas, ultimo_erro, concluido_em FROM jobs WHERE estado = 'morto' ORDER BY concluido_em DESC LIMIT 50")).rows;
  const proximos = (await c.query(
    "SELECT id, tipo, executar_em, tentativas, ultimo_erro FROM jobs WHERE estado = 'pendente' AND tipo NOT IN ('supervisor.varrer') ORDER BY executar_em LIMIT 15")).rows;
  const integracoes = (await c.query('SELECT nome, disponivel, ultima_sincronizacao, ultimo_erro, falhas_consecutivas, checkpoint FROM integracoes ORDER BY nome')).rows;
  const divergencias = (await c.query("SELECT id, tipo, descricao, criado_em FROM divergencias WHERE estado = 'aberta' ORDER BY criado_em DESC LIMIT 30")).rows;
  const entradas = uma(await c.query("SELECT count(*) FILTER (WHERE estado = 'recebida')::int AS aguardando, coalesce(sum(duplicatas),0)::int AS duplicatas_ignoradas FROM entradas"));
  return { invariantes: { ...inv, handoffs_pendentes: handoffs.pendentes, handoffs_vencidos: handoffs.vencidos }, jobs, falhas, proximos,
    integracoes, divergencias, entradas };
}

/** SUP-005: reprocessar item da fila de falhas, com autorização e auditoria. */
async function reprocessar(c, ctx, jobId, motivo) {
  if (!motivo) throw erro.entrada('Informe o motivo do reprocessamento.');
  const j = uma(await c.query("UPDATE jobs SET estado = 'pendente', tentativas = 0, executar_em = $2 WHERE id = $1 AND estado = 'morto' RETURNING id, tipo",
    [jobId, relogio.agora()]));
  if (!j) throw erro.naoEncontrado('Item da fila de falhas');
  await auditar(c, ctx, { acao: 'job.reprocessado', entidade: 'job', entidadeId: jobId, motivo, depois: { tipo: j.tipo } });
  return j;
}

module.exports = { jobVarrer, varreduraGlobal, saudeSupervisor, painel, reprocessar, INTERVALO_MS };
