'use strict';
const s = require('./servico');

module.exports = [
  { metodo: 'GET', caminho: '/api/monitoramento/consultas', permissao: 'rodada.ver', descricao: 'ver o monitoramento de consultas',
    handler: ({ db, ctx, query }) => db.comoTenant(ctx.tenantId, (c) => s.painelConsultas(c, { dias: Math.min(30, Math.max(1, Number(query.dias) || 7)), pagina: query.pagina })) },
];
