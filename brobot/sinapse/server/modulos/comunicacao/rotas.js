'use strict';
const { validar } = require('../../nucleo/erros');
const s = require('./modelos-servico');

module.exports = [
  { metodo: 'GET', caminho: '/api/modelos', permissao: 'modelo.editar', descricao: 'ver as mensagens padrão',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, async (c) => ({ itens: await s.listar(c) })) },
  { metodo: 'GET', caminho: '/api/modelos/:codigo', permissao: 'modelo.editar', descricao: 'ver as mensagens padrão',
    handler: ({ db, ctx, params }) => db.comoTenant(ctx.tenantId, (c) => s.detalhe(c, params.codigo)) },
  { metodo: 'POST', caminho: '/api/modelos/:codigo/previa', permissao: 'modelo.editar',
    handler: async ({ corpo, params }) => s.previa(params.codigo, validar(corpo, { texto: { obrigatorio: true, tipo: 'texto', max: 3000 } }).texto) },
  { metodo: 'POST', caminho: '/api/modelos/:codigo/rascunho', permissao: 'modelo.editar', descricao: 'escrever mensagens padrão',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { texto: { obrigatorio: true, tipo: 'texto', max: 3000 }, nota: { tipo: 'texto', max: 300 } });
      return db.comoTenant(ctx.tenantId, (c) => s.salvarRascunho(c, ctx, params.codigo, d));
    } },
  { metodo: 'POST', caminho: '/api/modelos/:codigo/revisao', permissao: 'modelo.editar',
    handler: ({ db, ctx, params }) => db.comoTenant(ctx.tenantId, (c) => s.enviarRevisao(c, ctx, params.codigo)) },
  { metodo: 'POST', caminho: '/api/modelos/:codigo/aprovar', permissao: 'modelo.aprovar', descricao: 'aprovar mensagens padrão',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { parecer: { tipo: 'texto', max: 500 }, templateNome: { tipo: 'texto', max: 120 }, templateIdioma: { tipo: 'texto', max: 10 } });
      if (d.templateNome && !/^[a-z0-9_]+$/.test(d.templateNome)) d.templateNome = undefined;
      const vars = Array.isArray(corpo?.templateVariaveis) ? corpo.templateVariaveis : String(corpo?.templateVariaveis || '').split(',').map((x) => x.trim()).filter(Boolean);
      return db.comoTenant(ctx.tenantId, (c) => s.aprovar(c, ctx, params.codigo, { ...d, templateVariaveis: vars }));
    } },
  { metodo: 'POST', caminho: '/api/modelos/:codigo/reprovar', permissao: 'modelo.aprovar', descricao: 'reprovar mensagens padrão',
    handler: ({ db, ctx, corpo, params }) => db.comoTenant(ctx.tenantId, (c) => s.reprovar(c, ctx, params.codigo, validar(corpo, { parecer: { obrigatorio: true, tipo: 'texto', min: 5, max: 500 } }).parecer)) },
];
