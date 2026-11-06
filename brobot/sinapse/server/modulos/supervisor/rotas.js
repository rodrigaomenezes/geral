'use strict';
const { validar } = require('../../nucleo/erros');
const painel = require('../painel/servico');
const s = require('./servico');
const crypto = require('node:crypto');
const { ErroNegocio } = require('../../nucleo/erros');

/** Confere o Bearer do coletor sem vazar o tamanho por tempo de resposta. */
function tokenConfere(recebido, esperado) {
  const a = crypto.createHash('sha256').update(String(recebido || '')).digest();
  const b = crypto.createHash('sha256').update(String(esperado)).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * SUP-009 / RNF-011: métricas para Prometheus/Grafana (ou qualquer coletor do formato). Somente com
 * SINAPSE_TOKEN_METRICAS e o cabeçalho `Authorization: Bearer <token>`; sem a variável, a rota não existe (404).
 * Os números do banco são totais de todas as organizações, sem nome de cliente, pessoa ou organização.
 */
async function metricasDoBanco(db) {
  return db.sistema(async (c) => {
    const jobs = (await c.query('SELECT estado, count(*)::int AS n FROM jobs GROUP BY estado')).rows;
    const hb = (await c.query("SELECT extract(epoch FROM now() - atualizado_em)::int AS idade FROM sistema WHERE chave = 'heartbeat'")).rows[0];
    const ent = (await c.query(`SELECT count(*) FILTER (WHERE estado = 'recebida')::int AS aguardando,
        coalesce(extract(epoch FROM now() - min(recebida_em) FILTER (WHERE estado = 'recebida')), 0)::int AS mais_antiga,
        count(*) FILTER (WHERE estado = 'falhou')::int AS falhas FROM entradas`)).rows[0];
    const div = (await c.query("SELECT tipo, count(*)::int AS n FROM divergencias WHERE estado = 'aberta' GROUP BY tipo")).rows;
    const oc = (await c.query(`SELECT count(*) FILTER (WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao'))::int AS ativas,
        count(*) FILTER (WHERE estado = 'triagem')::int AS triagem,
        count(*) FILTER (WHERE nivel_escalonamento > 0 AND estado NOT IN ('resolvida','encerrada_sem_resolucao'))::int AS escalonadas FROM ocorrencias`)).rows[0];
    return [
      { nome: 'sinapse_jobs', ajuda: 'Itens da fila de jobs por estado (morto = fila de falhas).', valores: jobs.map((j) => ({ rotulos: { estado: j.estado }, valor: j.n })) },
      { nome: 'sinapse_supervisor_heartbeat_segundos', ajuda: 'Idade do último sinal de vida do supervisor.', valores: [{ valor: hb ? hb.idade : -1 }] },
      { nome: 'sinapse_entradas_aguardando', ajuda: 'Mensagens recebidas ainda não processadas.', valores: [{ valor: ent.aguardando }] },
      { nome: 'sinapse_entrada_mais_antiga_segundos', ajuda: 'Há quanto tempo a mensagem não processada mais antiga espera (RNF-004: meta 60 s).', valores: [{ valor: ent.mais_antiga }] },
      { nome: 'sinapse_entradas_com_falha', ajuda: 'Mensagens que falharam no processamento.', valores: [{ valor: ent.falhas }] },
      { nome: 'sinapse_divergencias_abertas', ajuda: 'Divergências abertas por tipo.', valores: div.map((d) => ({ rotulos: { tipo: d.tipo }, valor: d.n })) },
      { nome: 'sinapse_ocorrencias', ajuda: 'Ocorrências ativas, em triagem e escalonadas.', valores: [
        { rotulos: { situacao: 'ativas' }, valor: oc.ativas }, { rotulos: { situacao: 'triagem' }, valor: oc.triagem }, { rotulos: { situacao: 'escalonadas' }, valor: oc.escalonadas }] },
    ];
  });
}

module.exports = [
  { metodo: 'GET', caminho: '/api/metricas', publica: true,
    handler: async ({ db, cfg, req, res, deps }) => {
      if (!cfg.tokenMetricas || !deps.metricas) throw new ErroNegocio(404, 'rota_inexistente', 'Endereço da API não encontrado.');
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!tokenConfere(token, cfg.tokenMetricas)) throw new ErroNegocio(401, 'nao_autenticado', 'Token do coletor de métricas inválido.');
      const texto = deps.metricas.exportar(await metricasDoBanco(db));
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(texto);
      return { __bruto: true, status: 200 };
    } },
  { metodo: 'GET', caminho: '/api/painel', permissao: 'ocorrencia.ver',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, (c) => painel.indicadores(c)) },
  { metodo: 'GET', caminho: '/api/supervisor', permissao: 'supervisor.ver', descricao: 'ver o supervisor',
    handler: async ({ db, ctx }) => ({ ...(await db.comoTenant(ctx.tenantId, (c) => s.painel(c))), heartbeat: await s.saudeSupervisor(db) }) },
  { metodo: 'POST', caminho: '/api/supervisor/jobs/:id/reprocessar', permissao: 'supervisor.reprocessar', descricao: 'reprocessar falhas',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 500 } });
      return db.comoTenant(ctx.tenantId, (c) => s.reprocessar(c, ctx, params.id, d.motivo));
    } },
  { metodo: 'GET', caminho: '/api/auditoria', permissao: 'auditoria.ver', descricao: 'ver a auditoria',
    handler: ({ db, ctx, query }) => db.comoTenant(ctx.tenantId, async (c) => {
      const antesDe = Number(query.antesDe) || null;
      const r = await c.query(
        `SELECT id, ator_nome, acao, entidade, entidade_id, motivo, antes, depois, criado_em FROM auditoria
         WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT 50`, [antesDe]);
      return { itens: r.rows, proximo: r.rows.length === 50 ? r.rows[49].id : null };
    }) },
];
