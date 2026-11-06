'use strict';
// Ocorrências: criação com roteamento e SLA, transições pela máquina de estados com trava otimista
// (AT-011), handoff com aceite (RN-007), resposta no canal de origem (INT-007) e linha do tempo.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { publicar, auditar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');
const { calendario, prazos, somarHorasUteis } = require('./sla');
const maquina = require('./maquina');
const clientes = require('../clientes/servico');
const identidade = require('../identidade/servico');
const comunicacao = require('../comunicacao/servico');

const POR_PAGINA = 30;
const COLUNAS_GRAVAVEIS = new Set(['conta_id', 'tipo', 'prioridade', 'equipe_id', 'responsavel_id', 'prazo_em',
  'sla_resposta_em', 'proxima_acao', 'proxima_acao_em', 'evidencia', 'codigo_desfecho', 'motivo_encerramento',
  'encerrada_em', 'reaberturas', 'nivel_escalonamento']);

async function carregarCalendario(c) {
  const t = uma(await c.query('SELECT config FROM tenants'));
  const f = (await c.query("SELECT to_char(data, 'YYYY-MM-DD') AS d FROM feriados")).rows.map((x) => x.d);
  return calendario(t?.config?.sla ? t.config : {}, f);
}

async function proximoProtocolo(c, ctx) {
  const r = uma(await c.query(
    `INSERT INTO contadores (tenant_id, nome, valor) VALUES ($1, 'protocolo', 1)
     ON CONFLICT (tenant_id, nome) DO UPDATE SET valor = contadores.valor + 1 RETURNING valor`, [ctx.tenantId],
  ));
  return `SIN-${String(r.valor).padStart(6, '0')}`;
}

async function idEquipe(c, codigo) {
  const e = await identidade.equipePorCodigo(c, codigo);
  if (!e) throw erro.regra('equipe_inexistente', `A equipe "${codigo}" não está cadastrada nesta organização.`);
  return e.id;
}

/**
 * Cria uma ocorrência. Sem conta identificada (ou tipo não classificado) ela vai para a triagem com SLA próprio
 * (INT-005, AT-001); com conta, segue o roteamento RN-001 e o SLA da prioridade.
 */
async function criar(c, ctx, d) {
  const agora = relogio.agora();
  const cal = await carregarCalendario(c);
  const conta = d.contaId ? await clientes.buscar(c, d.contaId) : null;
  const triagem = !conta || d.tipo === 'nao_classificada';
  let colunas;
  if (triagem) {
    const prazo = somarHorasUteis(agora, cal.slaTriagemHoras, cal);
    colunas = { estado: 'triagem', equipe_id: await idEquipe(c, 'triagem'), tipo: 'nao_classificada', prioridade: d.prioridade || 'media',
      sla_resposta_em: prazo, prazo_em: prazo, proxima_acao: 'Classificar e identificar o cliente', proxima_acao_em: prazo };
  } else {
    const p = prazos(d.prioridade || 'media', { agora, vip: conta.vip, cal });
    const responsavel = await identidade.resolverResponsavel(c, d.responsavelId);
    colunas = { estado: 'aberta', equipe_id: await idEquipe(c, d.equipeCodigo || clientes.equipeDaConta(conta)), tipo: d.tipo,
      prioridade: d.prioridade || 'media', sla_resposta_em: p.respostaEm, prazo_em: p.resolucaoEm, responsavel_id: responsavel,
      proxima_acao: d.proximaAcao || 'Assumir e responder o cliente', proxima_acao_em: d.proximaAcaoEm || p.respostaEm };
    if (responsavel) colunas.estado = 'em_atendimento';
  }
  const protocolo = await proximoProtocolo(c, ctx);
  const oc = uma(await c.query(
    `INSERT INTO ocorrencias (tenant_id, protocolo, tipo, origem, conta_id, ponto_focal_id, rodada_id, titulo, descricao, estado,
       prioridade, equipe_id, responsavel_id, prazo_em, sla_resposta_em, proxima_acao, proxima_acao_em, conversa_chave, alerta_chave)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [ctx.tenantId, protocolo, colunas.tipo, d.origem, triagem ? null : conta.id, d.pontoFocalId || null, d.rodadaId || null,
      d.titulo.slice(0, 200), d.descricao || null, colunas.estado, colunas.prioridade, colunas.equipe_id, colunas.responsavel_id || null,
      colunas.prazo_em, colunas.sla_resposta_em, colunas.proxima_acao, colunas.proxima_acao_em, d.conversaChave || null, d.alertaChave || null],
  ));
  for (const item of d.itens || []) {
    await c.query(
      `INSERT INTO ocorrencia_itens (tenant_id, ocorrencia_id, pendencia_id, placa, descricao) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`, [ctx.tenantId, oc.id, item.pendenciaId || null, item.placa || null, item.descricao],
    );
  }
  await auditar(c, ctx, { acao: 'ocorrencia.criada', entidade: 'ocorrencia', entidadeId: oc.id,
    depois: { protocolo, estado: oc.estado, origem: d.origem, tipo: oc.tipo } });
  await publicar(c, ctx, { tipo: 'ocorrencia.criada', agregado: 'ocorrencia', agregadoId: oc.id, chave: `ocorrencia.criada:${oc.id}`,
    payload: { protocolo, estado: oc.estado, tipo: oc.tipo, origem: d.origem, contaId: oc.conta_id } });
  return oc;
}

/** Executa uma transição. `versao` (opcional) protege contra edição concorrente: diferente → 409. */
async function transicionar(c, ctx, id, acao, dados = {}, versao) {
  const oc = uma(await c.query('SELECT * FROM ocorrencias WHERE id = $1 FOR UPDATE', [id]));
  if (!oc) throw erro.naoEncontrado('Ocorrência');
  if (versao !== undefined && versao !== null && Number(versao) !== oc.version) {
    throw erro.conflito('Esta ocorrência foi alterada por outra pessoa. Atualize a tela e confira antes de continuar.',
      { versaoAtual: oc.version });
  }
  const agora = relogio.agora();
  const cal = await carregarCalendario(c);
  const extra = { usuario: ctx.usuario, agora, cal };
  if (acao === 'classificar' && dados.contaId) {
    const conta = await clientes.buscar(c, dados.contaId);
    if (!conta) throw erro.naoEncontrado('Conta');
    extra.equipeDestino = await idEquipe(c, clientes.equipeDaConta(conta));
    extra.prazos = prazos(dados.prioridade || 'media', { agora, vip: conta.vip, cal });
  }
  if (acao === 'solicitar_handoff' && dados.paraEquipe) extra.equipeDestino = await idEquipe(c, dados.paraEquipe);
  if (acao === 'aceitar_handoff') {
    extra.handoff = uma(await c.query("SELECT * FROM handoffs WHERE ocorrencia_id = $1 AND estado = 'pendente'", [id]));
  }
  const plano = maquina.planejar(oc, acao, dados, extra);
  const atual = await aplicar(c, oc, plano.para, plano.colunas);

  if (acao === 'solicitar_handoff') {
    await c.query(
      `INSERT INTO handoffs (tenant_id, ocorrencia_id, de_equipe_id, para_equipe_id, motivo, solicitado_por, prazo_aceite_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ctx.tenantId, id, oc.equipe_id, extra.equipeDestino, dados.motivo, ctx.usuario?.id, plano.prazoAceite],
    );
  }
  if (acao === 'aceitar_handoff') {
    await c.query("UPDATE handoffs SET estado = 'aceito', aceito_por = $2, resolvido_em = now() WHERE id = $1", [extra.handoff.id, ctx.usuario.id]);
  }
  if (maquina.FINAIS.includes(plano.para)) {
    await c.query("UPDATE tarefas SET estado = 'cancelada' WHERE ocorrencia_id = $1 AND estado = 'aberta' AND tipo IN ('revisar_espera', 'escalonamento')", [id]);
  }
  await registrarTransicao(c, ctx, oc, atual, plano.evento, plano.motivo || dados.motivo || null, { acao, ...resumo(dados) });
  return atual;
}

async function aplicar(c, oc, para, colunas) {
  const sets = ['estado = $3', 'version = version + 1', 'atualizado_em = now()'];
  const vals = [oc.id, oc.version, para];
  for (const [k, v] of Object.entries(colunas)) {
    if (!COLUNAS_GRAVAVEIS.has(k)) throw new Error(`Coluna não gravável: ${k}`);
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  const r = uma(await c.query(`UPDATE ocorrencias SET ${sets.join(', ')} WHERE id = $1 AND version = $2 RETURNING *`, vals));
  if (!r) throw erro.conflito('Esta ocorrência foi alterada ao mesmo tempo por outra ação. Atualize a tela.');
  return r;
}

const resumo = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => ['contaId', 'tipo', 'prioridade', 'paraEquipe', 'codigoDesfecho', 'revisaoEm'].includes(k)));

async function registrarTransicao(c, ctx, antes, depois, evento, motivo, extra = {}) {
  await auditar(c, ctx, { acao: evento, entidade: 'ocorrencia', entidadeId: depois.id, motivo,
    antes: { estado: antes.estado, equipe_id: antes.equipe_id, responsavel_id: antes.responsavel_id },
    depois: { estado: depois.estado, equipe_id: depois.equipe_id, responsavel_id: depois.responsavel_id, ...extra } });
  await publicar(c, ctx, { tipo: evento, agregado: 'ocorrencia', agregadoId: depois.id, chave: `${evento}:${depois.id}:v${depois.version}`,
    payload: { de: antes.estado, para: depois.estado, versao: depois.version, motivo } });
}

/**
 * Mudança feita por rotina ou por intervenção excepcional (WFL-014): grava as colunas, sem passar pela máquina,
 * sempre com motivo e auditoria. Usada pelo supervisor (escalonamento, contingência) e pelo gestor.
 */
async function alterarComMotivo(c, ctx, id, para, colunas, evento, motivo) {
  if (!motivo) throw erro.entrada('Informe a justificativa.');
  const oc = uma(await c.query('SELECT * FROM ocorrencias WHERE id = $1 FOR UPDATE', [id]));
  if (!oc) throw erro.naoEncontrado('Ocorrência');
  const atual = await aplicar(c, oc, para || oc.estado, colunas);
  await registrarTransicao(c, ctx, oc, atual, evento, motivo);
  return atual;
}

/** WFL-014: gestor reatribui equipe/responsável com justificativa. */
async function reatribuir(c, ctx, id, { equipeCodigo, responsavelId, motivo, versao }) {
  if (!['supervisor', 'admin'].includes(ctx.usuario?.papel)) throw erro.semPermissao('reatribuir');
  const oc = uma(await c.query('SELECT version, estado FROM ocorrencias WHERE id = $1', [id]));
  if (!oc) throw erro.naoEncontrado('Ocorrência');
  if (maquina.FINAIS.includes(oc.estado)) throw erro.regra('ocorrencia_encerrada', 'Reabra a ocorrência antes de reatribuir.');
  if (versao !== undefined && Number(versao) !== oc.version) throw erro.conflito('Ocorrência alterada por outra pessoa. Atualize a tela.');
  const colunas = {};
  if (equipeCodigo) colunas.equipe_id = await idEquipe(c, equipeCodigo);
  if (responsavelId !== undefined) colunas.responsavel_id = await identidade.resolverResponsavel(c, responsavelId);
  const para = oc.estado === 'triagem' ? 'triagem' : colunas.responsavel_id ? 'em_atendimento' : oc.estado === 'em_atendimento' ? 'aberta' : oc.estado;
  return alterarComMotivo(c, ctx, id, para, colunas, 'ocorrencia.intervencao', motivo);
}

/** INT-007 / COM-007: resposta humana no canal de origem, registrada na linha do tempo. */
async function responder(c, ctx, id, texto) {
  const oc = uma(await c.query('SELECT * FROM ocorrencias WHERE id = $1 FOR UPDATE', [id]));
  if (!oc) throw erro.naoEncontrado('Ocorrência');
  if (!oc.conta_id) throw erro.regra('sem_conta', 'Classifique a ocorrência (identifique o cliente) antes de responder.');
  if (maquina.FINAIS.includes(oc.estado)) throw erro.regra('ocorrencia_encerrada', 'Reabra a ocorrência para responder.');
  const pfs = await clientes.pontosFocaisVigentes(c, oc.conta_id);
  const pf = pfs.find((p) => p.id === oc.ponto_focal_id) || pfs[0];
  const canalOrigem = ['whatsapp', 'email'].includes(oc.origem) ? oc.origem : undefined;
  const it = await comunicacao.programarEnvio(c, ctx, { contaId: oc.conta_id, ocorrenciaId: id, pontoFocal: pf,
    modelo: 'resposta_atendimento', variaveis: { texto }, canalPreferido: canalOrigem });
  if (!oc.primeira_resposta_em && it.status_entrega !== 'bloqueada') {
    await c.query('UPDATE ocorrencias SET primeira_resposta_em = $2, version = version + 1, atualizado_em = now() WHERE id = $1', [id, relogio.agora()]);
  }
  await publicar(c, ctx, { tipo: 'ocorrencia.respondida', agregado: 'ocorrencia', agregadoId: id, payload: { interacaoId: it.id, canal: it.canal } });
  return it;
}

async function anotar(c, ctx, id, texto) {
  const oc = uma(await c.query('SELECT id, conta_id FROM ocorrencias WHERE id = $1', [id]));
  if (!oc) throw erro.naoEncontrado('Ocorrência');
  return uma(await c.query(
    `INSERT INTO interacoes (tenant_id, ocorrencia_id, conta_id, canal, direcao, texto, autor_id, remetente)
     VALUES ($1,$2,$3,'interno','nota',$4,$5,$6) RETURNING *`, [ctx.tenantId, id, oc.conta_id, texto, ctx.usuario?.id, ctx.usuario?.nome],
  ));
}

function situacaoSla(o, agora) {
  if (maquina.FINAIS.includes(o.estado)) return null;
  const prazo = new Date(o.prazo_em);
  if (prazo < agora) return 'vencido';
  if (prazo - agora < 2 * 3600e3) return 'em_risco';
  return 'no_prazo';
}

async function listar(c, usuario, f = {}) {
  const params = [];
  const onde = [];
  const add = (sql, v) => { params.push(v); onde.push(sql.replace('?', `$${params.length}`)); };
  if (f.estado === 'ativas' || !f.estado) onde.push("o.estado NOT IN ('resolvida','encerrada_sem_resolucao')");
  else if (f.estado === 'encerradas') onde.push("o.estado IN ('resolvida','encerrada_sem_resolucao')");
  else if (f.estado !== 'todas') add('o.estado = ?', f.estado);
  if (f.equipe) add('e.codigo = ?', f.equipe);
  if (f.conta) add('o.conta_id = ?', f.conta);
  if (f.minhas) add('o.responsavel_id = ?', usuario.id);
  if (f.q) {
    params.push(`%${f.q}%`);
    const n = `$${params.length}`;
    onde.push(`(o.protocolo ILIKE ${n} OR o.titulo ILIKE ${n} OR c.nome ILIKE ${n} OR c.cnpj LIKE ${n})`);
  }
  const pagina = Math.max(1, Number(f.pagina) || 1);
  params.push(POR_PAGINA, (pagina - 1) * POR_PAGINA);
  const r = await c.query(
    `SELECT o.id, o.protocolo, o.titulo, o.tipo, o.origem, o.estado, o.prioridade, o.prazo_em, o.proxima_acao, o.proxima_acao_em,
       o.nivel_escalonamento, o.criado_em, o.version, c.nome AS conta_nome, c.vip, e.nome AS equipe_nome, e.codigo AS equipe_codigo,
       u.nome AS responsavel_nome, count(*) OVER()::int AS total
     FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id LEFT JOIN contas c ON c.id = o.conta_id
     LEFT JOIN usuarios u ON u.id = o.responsavel_id
     ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''}
     ORDER BY (o.estado IN ('resolvida','encerrada_sem_resolucao')), o.prazo_em NULLS LAST, o.criado_em DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
  );
  const agora = relogio.agora();
  return { itens: r.rows.map(({ total, ...o }) => ({ ...o, sla: situacaoSla(o, agora) })), total: r.rows[0]?.total || 0, pagina, porPagina: POR_PAGINA };
}

// Quadro (Kanban) de ocorrências com tarefas e responsáveis (pedido de 05/11). Uma consulta só: cada coluna traz o
// total e os primeiros cartões (por prazo); as tarefas vêm agregadas só para os cartões exibidos (sem consulta por
// cartão). As colunas finais mostram só os últimos 7 dias. As ações possíveis de cada cartão vêm da máquina de estados,
// então a tela só oferece colunas para onde o cartão pode ir — e o servidor confere de novo na transição.
const COLUNAS_QUADRO = ['triagem', 'aberta', 'em_atendimento', 'aguardando_cliente', 'aguardando_terceiro', 'em_handoff', 'resolvida', 'encerrada_sem_resolucao'];
const POR_COLUNA = 25;

async function quadro(c, usuario, f = {}) {
  const params = [relogio.agora()];
  const onde = ["(o.estado NOT IN ('resolvida','encerrada_sem_resolucao') OR o.encerrada_em >= $1::timestamptz - interval '7 days')"];
  const add = (sql, v) => { params.push(v); onde.push(sql.replace('?', `$${params.length}`)); };
  if (f.equipe) add('e.codigo = ?', f.equipe);
  if (f.responsavel === 'eu') add('o.responsavel_id = ?', usuario.id);
  else if (f.responsavel === 'ninguem') onde.push('o.responsavel_id IS NULL');
  else if (f.responsavel) add('o.responsavel_id = ?', f.responsavel);
  if (f.vip) onde.push('c.vip');
  if (f.vencidas) onde.push("o.estado NOT IN ('resolvida','encerrada_sem_resolucao') AND o.prazo_em < $1::timestamptz");
  if (f.q) {
    params.push(`%${f.q}%`);
    const n = `$${params.length}`;
    onde.push(`(o.protocolo ILIKE ${n} OR o.titulo ILIKE ${n} OR c.nome ILIKE ${n} OR c.cnpj LIKE ${n})`);
  }
  params.push(POR_COLUNA);
  const r = await c.query(
    `WITH base AS (
       SELECT o.id, o.protocolo, o.titulo, o.tipo, o.estado, o.prioridade, o.prazo_em, o.proxima_acao, o.proxima_acao_em,
         o.nivel_escalonamento, o.version, o.equipe_id, o.responsavel_id, o.encerrada_em, c.nome AS conta_nome, c.vip,
         e.nome AS equipe_nome, e.codigo AS equipe_codigo, u.nome AS responsavel_nome,
         count(*) OVER (PARTITION BY o.estado)::int AS total_coluna,
         row_number() OVER (PARTITION BY o.estado ORDER BY
           CASE WHEN o.estado IN ('resolvida','encerrada_sem_resolucao') THEN NULL ELSE o.prazo_em END NULLS LAST,
           o.encerrada_em DESC NULLS LAST, o.criado_em) AS n
       FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id LEFT JOIN contas c ON c.id = o.conta_id
       LEFT JOIN usuarios u ON u.id = o.responsavel_id
       WHERE ${onde.join(' AND ')}
     ), vis AS (SELECT * FROM base WHERE n <= $${params.length})
     SELECT vis.*, coalesce(t.abertas, 0)::int AS tarefas_abertas, coalesce(t.total, 0)::int AS tarefas_total, t.proxima_tarefa_em,
       coalesce(t.responsaveis_tarefas, '{}') AS responsaveis_tarefas
     FROM vis LEFT JOIN (
       SELECT ta.ocorrencia_id, count(*) FILTER (WHERE ta.estado = 'aberta') AS abertas,
         count(*) FILTER (WHERE ta.estado <> 'cancelada') AS total,
         min(ta.prazo_em) FILTER (WHERE ta.estado = 'aberta') AS proxima_tarefa_em,
         array_agg(DISTINCT ut.nome) FILTER (WHERE ta.estado = 'aberta' AND ut.nome IS NOT NULL) AS responsaveis_tarefas
       FROM tarefas ta LEFT JOIN usuarios ut ON ut.id = ta.responsavel_id
       WHERE ta.ocorrencia_id IN (SELECT id FROM vis) GROUP BY ta.ocorrencia_id
     ) t ON t.ocorrencia_id = vis.id
     ORDER BY vis.n`, params,
  );
  const agora = relogio.agora();
  const colunas = Object.fromEntries(COLUNAS_QUADRO.map((e) => [e, { estado: e, nome: maquina.ESTADOS[e], total: 0, cartoes: [] }]));
  for (const { n, total_coluna: total, equipe_id: equipeId, ...o } of r.rows) {
    const col = colunas[o.estado];
    col.total = total;
    col.cartoes.push({ ...o, sla: situacaoSla(o, agora), acoes: maquina.acoesPermitidas({ ...o, equipe_id: equipeId }, usuario), daMinhaEquipe: equipeId === usuario.equipe_id });
  }
  return { colunas: COLUNAS_QUADRO.map((e) => colunas[e]), porColuna: POR_COLUNA };
}

async function detalhe(c, usuario, id) {
  const o = uma(await c.query(
    `SELECT o.*, c.nome AS conta_nome, c.vip, e.nome AS equipe_nome, e.codigo AS equipe_codigo, u.nome AS responsavel_nome,
       pf.nome AS ponto_focal_nome
     FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id LEFT JOIN contas c ON c.id = o.conta_id
     LEFT JOIN usuarios u ON u.id = o.responsavel_id LEFT JOIN pontos_focais pf ON pf.id = o.ponto_focal_id WHERE o.id = $1`, [id],
  ));
  if (!o) throw erro.naoEncontrado('Ocorrência');
  const itens = (await c.query(
    `SELECT i.*, p.estado AS pendencia_estado, p.erro_codigo FROM ocorrencia_itens i LEFT JOIN pendencias p ON p.id = i.pendencia_id
     WHERE i.ocorrencia_id = $1 ORDER BY i.placa`, [id])).rows;
  const interacoes = (await c.query(
    `SELECT i.id, i.canal, i.direcao, i.remetente, i.destinatario, i.texto, i.modelo, i.status_entrega, i.criado_em, u.nome AS autor_nome
     FROM interacoes i LEFT JOIN usuarios u ON u.id = i.autor_id WHERE i.ocorrencia_id = $1 ORDER BY i.criado_em LIMIT 200`, [id])).rows;
  const handoffs = (await c.query(
    `SELECT h.*, de.nome AS de_nome, para.nome AS para_nome FROM handoffs h JOIN equipes de ON de.id = h.de_equipe_id
     JOIN equipes para ON para.id = h.para_equipe_id WHERE h.ocorrencia_id = $1 ORDER BY h.criado_em`, [id])).rows;
  const tarefas = (await c.query(
    `SELECT t.id, t.tipo, t.titulo, t.estado, t.prazo_em, t.resultado, e.nome AS equipe_nome FROM tarefas t
     JOIN equipes e ON e.id = t.equipe_id WHERE t.ocorrencia_id = $1 ORDER BY t.criado_em`, [id])).rows;
  const linhaDoTempo = (await c.query(
    `SELECT a.acao, a.ator_nome, a.motivo, a.antes, a.depois, a.criado_em FROM auditoria a
     WHERE a.entidade = 'ocorrencia' AND a.entidade_id = $1 ORDER BY a.id LIMIT 200`, [id])).rows;
  const vinculos = (await c.query(
    `SELECT v.tipo, r.id, r.protocolo, r.estado FROM ocorrencia_vinculos v JOIN ocorrencias r ON r.id = v.relacionada_id
     WHERE v.ocorrencia_id = $1`, [id])).rows;
  return { ...o, sla: situacaoSla(o, relogio.agora()), itens, interacoes, handoffs, tarefas, linhaDoTempo, vinculos,
    acoes: maquina.acoesPermitidas(o, usuario) };
}

module.exports = { criar, transicionar, alterarComMotivo, reatribuir, responder, anotar, listar, quadro, detalhe, carregarCalendario,
  idEquipe, situacaoSla };
