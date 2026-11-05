'use strict';
const { validar } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const { comAuditoriaDeAcesso } = require('../ocorrencias/rotas');
const { ETAPAS, PRODUTOS, ORIGENS, MOTIVOS_PERDA } = require('./funil');
const s = require('./servico');

const CAMPOS = {
  empresa: { tipo: 'texto', max: 160 }, cnpj: { tipo: 'texto', max: 20 }, contatoNome: { tipo: 'texto', max: 120 }, contatoTelefone: { tipo: 'texto', max: 30 },
  contatoEmail: { tipo: 'texto', max: 200 }, origem: { tipo: 'texto', em: Object.keys(ORIGENS) }, frota: { tipo: 'inteiro' }, valorMensal: { tipo: 'texto', max: 20 },
  responsavelId: { tipo: 'uuid' }, proximaAcao: { tipo: 'texto', max: 200 }, proximaAcaoEm: { tipo: 'data' }, testeInicio: { tipo: 'texto', max: 10 },
  testeFim: { tipo: 'texto', max: 10 }, testeCriterio: { tipo: 'texto', max: 500 }, versao: { tipo: 'inteiro' },
};
const dados = (corpo) => {
  const d = validar(corpo, CAMPOS);
  if (Array.isArray(corpo?.produtos)) d.produtos = corpo.produtos.map(String);
  if (d.valorMensal !== undefined) d.valorMensal = Number(String(d.valorMensal).replace(/\./g, '').replace(',', '.'));
  return d;
};

module.exports = [
  { metodo: 'GET', caminho: '/api/comercial/catalogo', permissao: 'comercial.ver',
    handler: async () => ({ etapas: ETAPAS, produtos: PRODUTOS, origens: ORIGENS, motivosPerda: MOTIVOS_PERDA }) },
  { metodo: 'GET', caminho: '/api/comercial/oportunidades', permissao: 'comercial.ver',
    handler: ({ db, ctx, usuario, query }) => db.comoTenant(ctx.tenantId, (c) => s.listar(c, { q: query.q, minhas: query.minhas === '1', usuario })) },
  { metodo: 'GET', caminho: '/api/comercial/indicadores', permissao: 'comercial.ver',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, (c) => s.indicadores(c)) },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades', permissao: 'comercial.editar', descricao: 'cadastrar oportunidades',
    handler: async ({ db, ctx, corpo }) => com(201, await db.comoTenant(ctx.tenantId, (c) => s.criar(c, ctx, dados(corpo)))) },
  { metodo: 'GET', caminho: '/api/comercial/oportunidades/:id', permissao: 'comercial.ver',
    handler: ({ db, ctx, params }) => comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, (c) => s.detalhe(c, params.id)) },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades/:id', permissao: 'comercial.editar', descricao: 'editar oportunidades',
    handler: ({ db, ctx, corpo, params }) => { const d = dados(corpo); return comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, (c) => s.atualizar(c, ctx, params.id, d, d.versao)); } },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades/:id/etapa', permissao: 'comercial.editar', descricao: 'mover oportunidades',
    handler: ({ db, ctx, corpo, params }) => {
      const d = dados(corpo);
      const e = validar(corpo, { para: { obrigatorio: true, tipo: 'texto', em: Object.keys(ETAPAS) }, motivoPerda: { tipo: 'texto', em: Object.keys(MOTIVOS_PERDA) },
        detalhePerda: { tipo: 'texto', max: 500 } });
      return comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, (c) => s.mover(c, ctx, params.id, e.para, { ...d, ...e }, d.versao));
    } },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades/:id/teste', permissao: 'comercial.editar', descricao: 'registrar o resultado do teste',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { resultado: { obrigatorio: true, tipo: 'texto', em: ['aprovado', 'reprovado'] }, parecer: { obrigatorio: true, tipo: 'texto', min: 5, max: 1000 }, versao: { tipo: 'inteiro' } });
      return comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, (c) => s.registrarTeste(c, ctx, params.id, d, d.versao));
    } },
];
