'use strict';
const { validar } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const { comAuditoriaDeAcesso } = require('../ocorrencias/rotas');
const s = require('./servico');

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
  { metodo: 'POST', caminho: '/api/contas/:id/bloqueio', permissao: 'financeiro.bloqueio', descricao: 'pedir bloqueio por inadimplência',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 500 } });
      const r = await comAuditoriaDeAcesso(db, ctx, 'conta', params.id, (c) => s.pedirBloqueio(c, ctx, params.id, d.motivo));
      if (r.recusado) throw r.erro;
      return r;
    } },
];
