'use strict';
const { validar } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const s = require('./servico');

module.exports = [
  { metodo: 'GET', caminho: '/api/meu-dia', permissao: 'agenda.usar',
    handler: ({ db, ctx, usuario }) => db.comoTenant(ctx.tenantId, (c) => s.meuDia(c, usuario)) },
  { metodo: 'POST', caminho: '/api/lembretes', permissao: 'agenda.usar',
    handler: async ({ db, ctx, corpo }) => {
      const d = validar(corpo, { titulo: { obrigatorio: true, tipo: 'texto', min: 2, max: 200 }, detalhe: { tipo: 'texto', max: 1000 },
        quando: { obrigatorio: true, tipo: 'data' }, recorrencia: { tipo: 'texto', em: Object.keys(s.RECORRENCIAS) }, equipeCodigo: { tipo: 'texto', max: 30 },
        ocorrenciaId: { tipo: 'uuid' }, contaId: { tipo: 'uuid' }, oportunidadeId: { tipo: 'uuid' } });
      return com(201, await db.comoTenant(ctx.tenantId, (c) => s.criarLembrete(c, ctx, d)));
    } },
  { metodo: 'POST', caminho: '/api/lembretes/:id/concluir', permissao: 'agenda.usar',
    handler: ({ db, ctx, params }) => db.comoTenant(ctx.tenantId, (c) => s.concluirLembrete(c, ctx, params.id)) },
  { metodo: 'POST', caminho: '/api/lembretes/:id/adiar', permissao: 'agenda.usar',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { horas: { obrigatorio: true, tipo: 'inteiro' } });
      return db.comoTenant(ctx.tenantId, (c) => s.adiarLembrete(c, ctx, params.id, d.horas));
    } },
  { metodo: 'POST', caminho: '/api/lembretes/:id/cancelar', permissao: 'agenda.usar',
    handler: ({ db, ctx, params }) => db.comoTenant(ctx.tenantId, (c) => s.cancelarLembrete(c, ctx, params.id)) },
  { metodo: 'GET', caminho: '/api/notificacoes', permissao: 'agenda.usar',
    handler: ({ db, ctx, usuario }) => db.comoTenant(ctx.tenantId, (c) => s.notificacoes(c, usuario)) },
  { metodo: 'POST', caminho: '/api/notificacoes/lidas', permissao: 'agenda.usar',
    handler: ({ db, ctx, usuario, corpo }) => db.comoTenant(ctx.tenantId, (c) => s.marcarLidas(c, usuario,
      corpo?.todas === true ? 'todas' : (Array.isArray(corpo?.ids) ? corpo.ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : []))) },
];
