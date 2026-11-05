'use strict';
const { validar } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const { comAuditoriaDeAcesso } = require('../ocorrencias/rotas');
const { GATILHOS, CAMPOS, OPERADORES, PASSOS, NOMES_MODELO } = require('./catalogo');
const motor = require('./motor');
const s = require('./servico');

const corpoProcesso = (corpo) => ({
  ...validar(corpo, { nome: { tipo: 'texto', min: 3, max: 120 }, descricao: { tipo: 'texto', max: 1000 }, nota: { tipo: 'texto', max: 300 } }),
  definicao: corpo?.definicao,
});

module.exports = [
  { metodo: 'GET', caminho: '/api/processos/catalogo', permissao: 'processo.ver',
    handler: async () => ({ gatilhos: GATILHOS, campos: CAMPOS, operadores: OPERADORES, passos: PASSOS, modelos: NOMES_MODELO }) },
  { metodo: 'GET', caminho: '/api/processos', permissao: 'processo.ver',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, async (c) => ({ itens: await s.listar(c) })) },
  { metodo: 'POST', caminho: '/api/processos', permissao: 'processo.editar', descricao: 'criar processos',
    handler: async ({ db, ctx, corpo }) => {
      const d = corpoProcesso(corpo);
      if (!d.nome) d.nome = undefined;
      return com(201, await db.comoTenant(ctx.tenantId, async (c) => s.detalhe(c, (await s.criar(c, ctx, { ...d, nome: d.nome || 'Novo processo' })).id)));
    } },
  { metodo: 'POST', caminho: '/api/processos/simular', permissao: 'processo.ver',
    handler: ({ db, ctx, corpo }) => db.comoTenant(ctx.tenantId, (c) => s.simular(c, { definicao: corpo?.definicao, alvoId: validar(corpo, { alvoId: { tipo: 'uuid' } }).alvoId })) },
  { metodo: 'GET', caminho: '/api/processos/:id', permissao: 'processo.ver',
    handler: ({ db, ctx, params }) => comAuditoriaDeAcesso(db, ctx, 'processo', params.id, (c) => s.detalhe(c, params.id)) },
  { metodo: 'POST', caminho: '/api/processos/:id/rascunho', permissao: 'processo.editar', descricao: 'editar processos',
    handler: ({ db, ctx, corpo, params }) => comAuditoriaDeAcesso(db, ctx, 'processo', params.id, (c) => s.salvarRascunho(c, ctx, params.id, corpoProcesso(corpo))) },
  { metodo: 'POST', caminho: '/api/processos/:id/ativar', permissao: 'processo.editar', descricao: 'ativar processos',
    handler: ({ db, ctx, corpo, params }) => comAuditoriaDeAcesso(db, ctx, 'processo', params.id, (c) => s.ativar(c, ctx, params.id, validar(corpo, { nota: { tipo: 'texto', max: 300 } }).nota)) },
  { metodo: 'POST', caminho: '/api/processos/:id/desativar', permissao: 'processo.editar', descricao: 'desligar processos',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 }, cancelarExecucoes: { tipo: 'booleano' } });
      return comAuditoriaDeAcesso(db, ctx, 'processo', params.id, (c) => s.desativar(c, ctx, params.id, d));
    } },
  { metodo: 'POST', caminho: '/api/processos/:id/restaurar', permissao: 'processo.editar', descricao: 'restaurar versões',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { versao: { obrigatorio: true, tipo: 'inteiro' }, motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 } });
      return comAuditoriaDeAcesso(db, ctx, 'processo', params.id, (c) => s.restaurar(c, ctx, params.id, d.versao, d.motivo));
    } },
  { metodo: 'POST', caminho: '/api/processos/:id/executar', permissao: 'processo.editar', descricao: 'executar processos',
    handler: ({ db, ctx, params }) => comAuditoriaDeAcesso(db, ctx, 'processo', params.id, (c) => motor.executarAgora(c, ctx, params.id)) },
  { metodo: 'GET', caminho: '/api/execucoes', permissao: 'processo.ver',
    handler: ({ db, ctx, query }) => db.comoTenant(ctx.tenantId, async (c) => ({
      itens: await s.listarExecucoes(c, { ocorrenciaId: query.ocorrencia, rodadaId: query.rodada, contaId: query.conta, limite: 20 }) })) },
  { metodo: 'POST', caminho: '/api/execucoes/:id/cancelar', permissao: 'processo.editar', descricao: 'cancelar execuções',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 } });
      return db.comoTenant(ctx.tenantId, (c) => s.cancelarExecucao(c, ctx, params.id, d.motivo));
    } },
];
