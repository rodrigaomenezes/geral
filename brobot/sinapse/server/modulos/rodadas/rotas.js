'use strict';
const { comAuditoriaDeAcesso } = require('../ocorrencias/rotas');
const s = require('./servico');

module.exports = [
  { metodo: 'GET', caminho: '/api/rodadas', permissao: 'rodada.ver',
    handler: ({ db, ctx, query }) => db.comoTenant(ctx.tenantId, (c) => s.listar(c, { pagina: Number(query.pagina) || 1 })) },
  { metodo: 'GET', caminho: '/api/rodadas/:id', permissao: 'rodada.ver',
    handler: ({ db, ctx, params }) => comAuditoriaDeAcesso(db, ctx, 'rodada', params.id, (c) => s.detalhe(c, params.id)) },
  { metodo: 'POST', caminho: '/api/pendencias/:id/revalidar', permissao: 'rodada.operar', descricao: 'revalidar pendências',
    handler: ({ db, ctx, params }) => comAuditoriaDeAcesso(db, ctx, 'pendencia', params.id, (c) => s.revalidar(c, ctx, params.id)) },
];
