'use strict';
const { validar } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const { comAuditoriaDeAcesso } = require('../ocorrencias/rotas');
const s = require('./servico');
const vip = require('./vip');

module.exports = [
  { metodo: 'GET', caminho: '/api/contas', permissao: 'conta.ver',
    handler: ({ db, ctx, usuario, query }) => db.comoTenant(ctx.tenantId, (c) => s.listar(c, usuario, { q: query.q, filtro: query.filtro, pagina: Number(query.pagina) || 1 })) },
  { metodo: 'GET', caminho: '/api/contas/:id', permissao: 'conta.ver',
    handler: ({ db, ctx, usuario, params }) => comAuditoriaDeAcesso(db, ctx, 'conta', params.id, (c) => s.detalhe(c, usuario, params.id)) },
  { metodo: 'POST', caminho: '/api/contas/:id/pontos-focais', permissao: 'conta.editar', descricao: 'alterar pontos focais',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, {
        papel: { obrigatorio: true, tipo: 'texto', em: ['principal', 'suplente'] }, nome: { obrigatorio: true, tipo: 'texto', min: 3, max: 120 },
        telefone: { tipo: 'texto', max: 30 }, email: { tipo: 'texto', max: 200 }, canalPreferido: { tipo: 'texto', em: ['whatsapp', 'email'] },
        consentimentoWhatsapp: { tipo: 'booleano' },
      });
      if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) d.email = undefined;
      return com(201, await comAuditoriaDeAcesso(db, ctx, 'conta', params.id, (c) => s.definirPontoFocal(c, ctx, params.id, d)));
    } },
  { metodo: 'POST', caminho: '/api/contas/:id/grupo', permissao: 'conta.editar', descricao: 'alterar o grupo do cliente',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { grupo: { tipo: 'texto', max: 120 } });
      return comAuditoriaDeAcesso(db, ctx, 'conta', params.id, (c) => s.definirGrupo(c, ctx, params.id, d.grupo));
    } },
  // GOV-002: VIP por pedido e aprovação de outra pessoa da gestão.
  { metodo: 'GET', caminho: '/api/contas/:id/vip', permissao: 'conta.ver',
    handler: ({ db, ctx, params }) => { validar(params, { id: { obrigatorio: true, tipo: 'uuid' } });
      return db.comoTenant(ctx.tenantId, async (c) => ({ pedidos: await vip.historico(c, params.id) })); } },
  { metodo: 'POST', caminho: '/api/contas/:id/vip', permissao: 'conta.editar', descricao: 'pedir mudança de VIP',
    handler: async ({ db, ctx, corpo, params }) => {
      validar(params, { id: { obrigatorio: true, tipo: 'uuid' } });
      const d = validar(corpo, { tipo: { obrigatorio: true, tipo: 'texto', em: ['conceder', 'renovar', 'retirar'] }, criterio: { tipo: 'texto', max: 300 },
        validade: { tipo: 'texto', max: 10 }, motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 500 } });
      return com(201, await comAuditoriaDeAcesso(db, ctx, 'conta', params.id, (c) => vip.pedir(c, ctx, params.id, d)));
    } },
  { metodo: 'GET', caminho: '/api/vip/pedidos', permissao: 'governanca.gerir', descricao: 'ver pedidos de VIP',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, async (c) => ({ pedidos: await vip.pendentes(c) })) },
  { metodo: 'POST', caminho: '/api/vip/pedidos/:id/:decisao', permissao: 'governanca.gerir', descricao: 'decidir pedidos de VIP',
    handler: ({ db, ctx, corpo, params }) => {
      validar(params, { id: { obrigatorio: true, tipo: 'uuid' }, decisao: { obrigatorio: true, tipo: 'texto', em: ['aprovar', 'recusar'] } });
      const d = validar(corpo, { motivo: { tipo: 'texto', max: 500 } });
      return db.comoTenant(ctx.tenantId, (c) => vip.decidir(c, ctx, params.id, params.decisao === 'aprovar', d.motivo));
    } },
  { metodo: 'POST', caminho: '/api/contas/:id/bloqueio', permissao: 'financeiro.bloqueio', descricao: 'pedir bloqueio por inadimplência',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 500 } });
      const r = await comAuditoriaDeAcesso(db, ctx, 'conta', params.id, (c) => s.pedirBloqueio(c, ctx, params.id, d.motivo));
      if (r.recusado) throw r.erro;
      return r;
    } },
];
