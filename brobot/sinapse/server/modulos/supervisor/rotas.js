'use strict';
const { validar } = require('../../nucleo/erros');
const painel = require('../painel/servico');
const s = require('./servico');

module.exports = [
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
