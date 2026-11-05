'use strict';
const { erro } = require('../../nucleo/erros');
const { pode } = require('../identidade/permissoes');
const csv = require('../integracoes/csv/csv');
const d = require('./dashboards');

function exigir(usuario, nome) {
  const def = d.DASHBOARDS[nome];
  if (!def) throw erro.naoEncontrado('Dashboard');
  if (!pode(usuario, def.permissao)) throw erro.semPermissao(`ver o dashboard ${def.titulo}`);
}

module.exports = [
  { metodo: 'GET', caminho: '/api/dashboards', permissao: 'agenda.usar',
    handler: async ({ usuario }) => ({ itens: Object.entries(d.DASHBOARDS).filter(([, x]) => pode(usuario, x.permissao)).map(([k, x]) => ({ nome: k, titulo: x.titulo })) }) },
  { metodo: 'GET', caminho: '/api/dashboards/:nome', permissao: 'agenda.usar',
    handler: ({ db, ctx, usuario, params, query }) => { exigir(usuario, params.nome); return db.comoTenant(ctx.tenantId, (c) => d.montar(c, params.nome, query)); } },
  { metodo: 'GET', caminho: '/api/dashboards/:nome/csv', permissao: 'agenda.usar',
    handler: async ({ db, ctx, usuario, params, query, res }) => {
      exigir(usuario, params.nome);
      const r = await db.comoTenant(ctx.tenantId, (c) => d.montar(c, params.nome, query));
      const bloco = r.blocos.find((b) => b.id === query.bloco);
      if (!bloco) throw erro.naoEncontrado('Bloco do dashboard');
      const colunas = (bloco.colunas || [{ campo: 'rotulo', rotulo: 'Indicador' }, { campo: 'valor', rotulo: 'Valor' }, { campo: 'unidade', rotulo: 'Unidade' }])
        .map((col) => ({ titulo: col.rotulo, campo: col.campo }));
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="sinapse-${params.nome}-${bloco.id}-${r.filtros.dias}d.csv"` });
      res.end(csv.escrever(colunas, bloco.linhas));
      return { __bruto: true, status: 200 };
    } },
];
