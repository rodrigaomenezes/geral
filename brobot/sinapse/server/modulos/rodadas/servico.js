'use strict';
// Pré-rodada e pós-rodada (PRE-001 a PRE-012, POS-001 a POS-010, RN-003 a RN-006, AT-008, AT-009).
// Este módulo faz a parte técnica e publica os fatos; a cadência de contatos é um PROCESSO editável
// (modulos/processos/padroes.js), não código fixo:
//   D-4 job `rodada.pre_rodada`: teste na Platform → pendências (sem duplicar) → ocorrência com itens
//       → evento `rodada.pendencias_detectadas` (dispara "Pré-rodada: cadência de credenciais")
//   D0  job `rodada.executada`: resultado oficial → compara com a pré-rodada → evento `rodada.executada`
//       (dispara "Pós-rodada: comunicado no grupo + follow-up D+3").
// Correção confirmada tecnicamente fecha a pendência e encerra na hora os processos que "param sozinhos quando as
// pendências forem corrigidas" — os contatos futuros não saem (RN-005).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { publicar, auditar } = require('../../nucleo/registro');
const { relogio, DIA } = require('../../nucleo/relogio');
const { enfileirar } = require('../../jobs/fila');
const motor = require('../processos/motor');
const { normalizarErro } = require('./erros');
const platform = require('../integracoes/platform-demo');
const clientes = require('../clientes/servico');
const ocorrencias = require('../ocorrencias/servico');
const tarefas = require('../ocorrencias/tarefas');

const ABERTAS = "estado IN ('aberta','persistente')";
const dataBr = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** PRE-001: agenda os jobs de uma rodada conhecida (D-4 e D0). Idempotente por chave. */
async function agendar(c, ctx, rodada) {
  const d0 = new Date(rodada.agendada_para);
  await enfileirar(c, ctx, { tipo: 'rodada.pre_rodada', chave: `pre:${rodada.id}`, payload: { rodadaId: rodada.id },
    executarEm: new Date(d0.getTime() - 4 * DIA) });
  await enfileirar(c, ctx, { tipo: 'rodada.executar', chave: `d0:${rodada.id}`, payload: { rodadaId: rodada.id }, executarEm: d0 });
}

async function buscarRodada(c, id, trava = false) {
  return uma(await c.query(`SELECT r.*, c.nome AS conta_nome, c.vip FROM rodadas r JOIN contas c ON c.id = r.conta_id
    WHERE r.id = $1 ${trava ? 'FOR UPDATE OF r' : ''}`, [id]));
}

/** Grava as falhas como pendências; a mesma placa+erro já aberta só soma recorrência (PRE-005). */
async function registrarFalhas(c, ctx, rodada, falhas, origem) {
  const lista = [];
  for (const f of falhas) {
    const n = normalizarErro(f.codigoPlatform);
    const p = uma(await c.query(
      `INSERT INTO pendencias (tenant_id, conta_id, rodada_id, placa, erro_codigo, erro_categoria, descricao, origem, detectada_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, conta_id, placa, erro_codigo) WHERE estado <> 'corrigida'
       DO UPDATE SET recorrencias = pendencias.recorrencias + 1, rodada_id = EXCLUDED.rodada_id,
         estado = CASE WHEN EXCLUDED.origem = 'pos_rodada' THEN 'persistente' ELSE pendencias.estado END
       RETURNING *, (xmax = 0) AS nova`,
      [ctx.tenantId, rodada.conta_id, rodada.id, f.placa, n.codigo, n.categoria, n.descricao, origem, relogio.agora()],
    ));
    lista.push({ ...p, normalizado: n });
  }
  return lista;
}

async function criarOcorrenciaDePendencias(c, ctx, rodada, pendencias, { tipo, titulo, equipeCodigo, prioridade }) {
  if (!pendencias.length) return null;
  const pfs = await clientes.pontosFocaisVigentes(c, rodada.conta_id);
  const oc = await ocorrencias.criar(c, ctx, {
    origem: 'platform', contaId: rodada.conta_id, tipo, prioridade, rodadaId: rodada.id, equipeCodigo,
    pontoFocalId: pfs[0]?.id, titulo,
    itens: pendencias.map((p) => ({ pendenciaId: p.id, placa: p.placa, descricao: p.normalizado.descricao })),
  });
  await c.query('UPDATE pendencias SET ocorrencia_id = $2 WHERE id = ANY($1) AND ocorrencia_id IS NULL', [pendencias.map((p) => p.id), oc.id]);
  return oc;
}

/** D-4 (PRE-002). Rodada alimentada por CSV não chama a Platform: espera o arquivo da pré-rodada. */
async function jobPreRodada(c, ctx, { rodadaId }) {
  const r = await buscarRodada(c, rodadaId, true);
  if (!r || r.estado !== 'agendada' || r.fonte === 'csv') return {};
  const resultado = await platform.testarRodada(c, r); // Platform fora do ar → erro → retentativa (AT-005)
  return processarPreRodada(c, ctx, r, resultado);
}

/** Resultado da pré-rodada por veículo [{ placa, ok, codigoPlatform }], venha da API ou de CSV. */
async function processarPreRodada(c, ctx, r, resultado) {
  const falhas = resultado.filter((v) => !v.ok);
  const pend = await registrarFalhas(c, ctx, r, falhas, 'pre_rodada');
  const doCliente = pend.filter((p) => p.normalizado.doCliente);
  const tecnicas = pend.filter((p) => !p.normalizado.doCliente);
  await c.query(`UPDATE rodadas SET estado = $2, pre_iniciada_em = $3, veiculos_total = $4, pendencias_detectadas = $5 WHERE id = $1`,
    [r.id, doCliente.length ? 'com_pendencias' : 'pronta', relogio.agora(), resultado.length, pend.length]);

  const prioridade = r.vip ? 'alta' : 'media';
  const oc = await criarOcorrenciaDePendencias(c, ctx, r, doCliente, { tipo: 'pre_rodada', prioridade,
    titulo: `Pré-rodada ${r.produto} ${dataBr(r.agendada_para)}: ${doCliente.length} pendência(s) do cliente` });
  // REC-004: erro de consulta/indisponibilidade vai para o Desenvolvimento, não para o cliente.
  await criarOcorrenciaDePendencias(c, ctx, r, tecnicas, { tipo: 'tecnica', prioridade: 'alta', equipeCodigo: 'dev',
    titulo: `Pré-rodada ${r.produto}: ${tecnicas.length} erro(s) técnico(s) de consulta` });

  if (doCliente.length) {
    const pfs = await clientes.pontosFocaisVigentes(c, r.conta_id);
    if (!pfs.some((p) => p.papel === 'principal')) {
      // GOV-007: sem ponto focal, o marco crítico fica bloqueado e vira tarefa com prazo antes do D-3.
      await tarefas.criar(c, ctx, { tipo: 'geral', equipeCodigo: clientes.equipeDaConta(r), chave: `pf:${r.id}`,
        titulo: `Cadastrar ponto focal de ${r.conta_nome} antes do aviso D-3`, prazoEm: new Date(new Date(r.agendada_para) - 3 * DIA) });
    }
    await publicar(c, ctx, { tipo: 'rodada.pendencias_detectadas', agregado: 'rodada', agregadoId: r.id, chave: `pendencias:${r.id}`,
      payload: { contaId: r.conta_id, ocorrenciaId: oc?.id || null, qtd: doCliente.length } });
  }
  await auditar(c, ctx, { acao: 'rodada.pre_rodada_executada', entidade: 'rodada', entidadeId: r.id,
    depois: { veiculos: resultado.length, pendenciasCliente: doCliente.length, pendenciasTecnicas: tecnicas.length } });
  await publicar(c, ctx, { tipo: 'rodada.pre_rodada_concluida', agregado: 'rodada', agregadoId: r.id, chave: `pre:${r.id}`,
    payload: { veiculos: resultado.length, pendencias: pend.length } });
  return {};
}

async function pendenciasAbertas(c, rodadaOuConta, porConta = false) {
  return (await c.query(`SELECT * FROM pendencias WHERE ${porConta ? 'conta_id' : 'rodada_id'} = $1 AND ${ABERTAS} ORDER BY placa`, [rodadaOuConta])).rows;
}

/**
 * CRE-006 / PRE-009: nova consulta na Platform para confirmar a correção. Confirmada → pendência corrigida com
 * evidência; sem pendência restante → contatos futuros cancelados e ocorrência resolvida com evidência (AT-008).
 */
async function revalidar(c, ctx, pendenciaId) {
  const p = uma(await c.query('SELECT * FROM pendencias WHERE id = $1 FOR UPDATE', [pendenciaId]));
  if (!p) throw erro.naoEncontrado('Pendência');
  if (p.estado === 'corrigida') return { corrigida: true, pendencia: p };
  let res;
  try {
    res = await platform.revalidarVeiculo(c, p.conta_id, p.placa);
  } catch (e) {
    if (e.integracao) throw erro.indisponivel('A Platform está indisponível agora. A pendência continua aberta; tente revalidar em alguns minutos.');
    throw e;
  }
  if (!res.ok) {
    await auditar(c, ctx, { acao: 'pendencia.revalidacao_sem_correcao', entidade: 'pendencia', entidadeId: p.id, depois: { placa: p.placa, codigo: res.codigoPlatform } });
    return { corrigida: false, pendencia: p, codigo: res.codigoPlatform };
  }
  const evidencia = `Consulta ${res.consultaId} sem erro na Platform em ${relogio.agora().toISOString()}`;
  return { corrigida: true, ...(await marcarCorrigida(c, ctx, p, evidencia)) };
}

async function marcarCorrigida(c, ctx, p, evidencia) {
  const atual = uma(await c.query(
    "UPDATE pendencias SET estado = 'corrigida', corrigida_em = $2, evidencia_correcao = $3 WHERE id = $1 RETURNING *", [p.id, relogio.agora(), evidencia]));
  await auditar(c, ctx, { acao: 'pendencia.corrigida', entidade: 'pendencia', entidadeId: p.id, depois: { placa: p.placa, evidencia } });
  await publicar(c, ctx, { tipo: 'pendencia.corrigida', agregado: 'pendencia', agregadoId: p.id, chave: `pendencia.corrigida:${p.id}`,
    payload: { placa: p.placa, erro: p.erro_codigo, contaId: p.conta_id } });
  let processosEncerrados = 0;
  const restantes = (await pendenciasAbertas(c, p.conta_id, true)).filter((x) => normalizarErro(x.erro_codigo).doCliente);
  if (!restantes.length) {
    await c.query("UPDATE rodadas SET estado = 'pronta' WHERE conta_id = $1 AND estado = 'com_pendencias'", [p.conta_id]);
    // RN-005: encerra na hora os processos da conta que param quando as pendências acabam (contatos futuros não saem).
    processosEncerrados = await motor.reavaliar(c, ctx, { conta_id: p.conta_id });
    if (processosEncerrados) {
      await auditar(c, ctx, { acao: 'rodada.contatos_cancelados', entidade: 'conta', entidadeId: p.conta_id,
        depois: { processosEncerrados }, motivo: 'Correção confirmada tecnicamente (RN-005)' });
    }
  }
  if (p.ocorrencia_id) {
    const oc = uma(await c.query('SELECT id, estado FROM ocorrencias WHERE id = $1', [p.ocorrencia_id]));
    const daOc = (await c.query(`SELECT count(*)::int AS n FROM pendencias WHERE ocorrencia_id = $1 AND ${ABERTAS}`, [p.ocorrencia_id])).rows[0].n;
    if (oc && !daOc && !['resolvida', 'encerrada_sem_resolucao'].includes(oc.estado)) {
      await ocorrencias.alterarComMotivo(c, ctx, oc.id, 'resolvida', {
        evidencia: `Todas as pendências confirmadas pela Platform. Última: ${evidencia}`, codigo_desfecho: 'corrigido_cliente', encerrada_em: relogio.agora(),
      }, 'ocorrencia.resolvida', 'Correção confirmada tecnicamente em todas as pendências');
    }
  }
  return { pendencia: atual, processosEncerrados };
}

/** D0 (POS-001 a POS-005, POS-010): resultado oficial e comparação com a pré-rodada. */
async function jobExecutar(c, ctx, { rodadaId }) {
  const r = await buscarRodada(c, rodadaId, true);
  if (!r || ['executada', 'concluida'].includes(r.estado) || r.fonte === 'csv') return {};
  const resultado = await platform.executarOficial(c, r);
  return processarOficial(c, ctx, r, resultado);
}

async function processarOficial(c, ctx, r, resultado) {
  const falhas = resultado.filter((v) => !v.ok);
  const okPlacas = new Set(resultado.filter((v) => v.ok).map((v) => v.placa));
  // POS-008: placa que passou na rodada oficial tem a pendência anterior encerrada, ligada ao histórico.
  for (const p of await pendenciasAbertas(c, r.conta_id, true)) {
    if (okPlacas.has(p.placa)) await marcarCorrigida(c, ctx, p, `Rodada oficial ${r.id_platform} consultou ${p.placa} com sucesso`);
  }
  const corrigidasAteD0 = (await c.query(
    "SELECT count(*)::int AS n FROM pendencias WHERE rodada_id = $1 AND origem = 'pre_rodada' AND estado = 'corrigida'", [r.id])).rows[0].n;
  const pend = await registrarFalhas(c, ctx, r, falhas, 'pos_rodada');
  await c.query(`UPDATE rodadas SET estado = 'executada', executada_em = $2, veiculos_total = $3, veiculos_sucesso = $4, veiculos_falha = $5,
      pendencias_corrigidas_ate_d0 = $6 WHERE id = $1`,
  [r.id, relogio.agora(), resultado.length, resultado.length - falhas.length, falhas.length, corrigidasAteD0]);

  const doCliente = pend.filter((p) => p.normalizado.doCliente);
  const novas = doCliente.filter((p) => p.nova);
  if (doCliente.length) {
    // Pendência que já está numa ocorrência ativa continua nela (com registro); só as demais abrem ocorrência de pós-rodada.
    const ativas = new Set((await c.query(
      "SELECT id FROM ocorrencias WHERE id = ANY($1) AND estado NOT IN ('resolvida','encerrada_sem_resolucao')",
      [doCliente.map((p) => p.ocorrencia_id).filter(Boolean)])).rows.map((x) => x.id));
    for (const ocId of ativas) {
      const placas = doCliente.filter((p) => p.ocorrencia_id === ocId).map((p) => p.placa).join(', ');
      await c.query(`INSERT INTO interacoes (tenant_id, ocorrencia_id, conta_id, canal, direcao, texto, remetente)
        VALUES ($1, $2, $3, 'interno', 'nota', $4, 'Sinapse (automático)')`,
      [ctx.tenantId, ocId, r.conta_id, `Rodada oficial ${r.id_platform} executada: a pendência continua em ${placas}.`]);
    }
    const semOcorrencia = doCliente.filter((p) => !ativas.has(p.ocorrencia_id));
    await criarOcorrenciaDePendencias(c, ctx, { ...r }, semOcorrencia, { tipo: 'pos_rodada', prioridade: r.vip ? 'alta' : 'media',
      titulo: `Pós-rodada ${r.produto} ${dataBr(r.agendada_para)}: ${semOcorrencia.length} veículo(s) sem consulta` });
  }
  const tecnicas = pend.filter((p) => !p.normalizado.doCliente && p.nova);
  await criarOcorrenciaDePendencias(c, ctx, r, tecnicas, { tipo: 'tecnica', prioridade: 'alta', equipeCodigo: 'dev',
    titulo: `Rodada ${r.produto}: ${tecnicas.length} erro(s) técnico(s) de consulta` });
  await publicar(c, ctx, { tipo: 'rodada.executada', agregado: 'rodada', agregadoId: r.id, chave: `d0:${r.id}`,
    payload: { contaId: r.conta_id, total: resultado.length, sucesso: resultado.length - falhas.length, falha: falhas.length, novas: novas.length,
      pendenciasCliente: doCliente.length, corrigidasAteD0 } });
  await auditar(c, ctx, { acao: 'rodada.executada', entidade: 'rodada', entidadeId: r.id,
    depois: { total: resultado.length, falha: falhas.length, persistentes: doCliente.length - novas.length, novas: novas.length } });
  return {};
}

async function listar(c, { pagina = 1 } = {}) {
  const r = await c.query(
    `SELECT r.id, r.id_platform, r.produto, r.agendada_para, r.estado, r.veiculos_total, r.veiculos_sucesso, r.veiculos_falha,
       r.pendencias_detectadas, r.pendencias_corrigidas_ate_d0, c.nome AS conta_nome, c.vip,
       (SELECT count(*)::int FROM pendencias p WHERE p.rodada_id = r.id AND p.${ABERTAS}) AS pendencias_abertas,
       count(*) OVER()::int AS total
     FROM rodadas r JOIN contas c ON c.id = r.conta_id ORDER BY r.agendada_para LIMIT 30 OFFSET $1`, [(Math.max(1, pagina) - 1) * 30]);
  return { itens: r.rows.map(({ total, ...x }) => x), total: r.rows[0]?.total || 0, pagina };
}

async function detalhe(c, id) {
  const r = await buscarRodada(c, id);
  if (!r) throw erro.naoEncontrado('Rodada');
  const pend = (await c.query('SELECT * FROM pendencias WHERE rodada_id = $1 OR (conta_id = $2 AND ' + ABERTAS + ') ORDER BY estado, placa', [id, r.conta_id])).rows;
  const ocs = (await c.query('SELECT id, protocolo, titulo, estado, tipo FROM ocorrencias WHERE rodada_id = $1 ORDER BY criado_em', [id])).rows;
  return { ...r, pendencias: pend.map((p) => ({ ...p, ...pick(normalizarErro(p.erro_codigo)) })), ocorrencias: ocs };
}
const pick = (n) => ({ instrucao: n.instrucao, doCliente: n.doCliente });

module.exports = { agendar, jobPreRodada, jobExecutar, processarPreRodada, processarOficial, buscarRodada, marcarCorrigida, revalidar, listar, detalhe };
