'use strict';
// Pedidos de titulares (LGPD): localizar, exportar (acesso) e anonimizar (eliminação). Só a gestão (`lgpd.gerir`),
// sempre com o motivo/protocolo do pedido, auditado.
const { validar } = require('../../nucleo/erros');
const s = require('./servico');

const FILTRO = { telefone: { tipo: 'texto', max: 30 }, email: { tipo: 'texto', max: 200 } };

module.exports = [
  { metodo: 'GET', caminho: '/api/lgpd/titular', permissao: 'lgpd.gerir', descricao: 'atender pedidos de titulares (LGPD)',
    handler: ({ db, ctx, query }) => { const d = validar(query, FILTRO); return db.comoTenant(ctx.tenantId, async (c) => { const { tel, mail, ...r } = await s.localizar(c, d); return { ...r, mensagens: r.mensagens.length }; }); } },
  { metodo: 'POST', caminho: '/api/lgpd/exportar', permissao: 'lgpd.gerir', descricao: 'atender pedidos de titulares (LGPD)',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { ...FILTRO, motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 } });
      return db.comoTenant(ctx.tenantId, (c) => s.exportar(c, ctx, d, d.motivo));
    } },
  { metodo: 'POST', caminho: '/api/lgpd/anonimizar', permissao: 'lgpd.gerir', descricao: 'atender pedidos de titulares (LGPD)',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { ...FILTRO, motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 }, confirmacao: { obrigatorio: true, tipo: 'texto', em: ['ANONIMIZAR'] } });
      return db.comoTenant(ctx.tenantId, (c) => s.anonimizar(c, ctx, d, d.motivo));
    } },
];
