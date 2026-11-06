'use strict';
// Rotas de governança. Ver a matriz e as delegações: quem vê ocorrências. Delegar o que é seu: quem usa o Meu dia.
// Delegar por outra pessoa, editar a RACI, os plantões e o SLA de contrato: `governanca.gerir` (gestão).
const { validar } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const { pode } = require('../identidade/permissoes');
const { validarSlaContrato } = require('../ocorrencias/sla');
const { erro } = require('../../nucleo/erros');
const s = require('./servico');

const ID = { obrigatorio: true, tipo: 'uuid' };
const uuid = (v) => validar({ v }, { v: ID }).v;

module.exports = [
  { metodo: 'GET', caminho: '/api/governanca', permissao: 'ocorrencia.ver',
    handler: ({ db, ctx, usuario }) => db.comoTenant(ctx.tenantId, async (c) => {
      const gestor = pode(usuario, 'governanca.gerir');
      return { ...(await s.matriz(c)), delegacoes: await s.listarDelegacoes(c, { usuarioId: gestor ? null : usuario.id }),
        plantoes: await s.listarPlantoes(c), processosNomes: s.PROCESSOS, podeGerir: gestor };
    }) },
  { metodo: 'POST', caminho: '/api/delegacoes', permissao: 'agenda.usar', descricao: 'delegar suas tarefas',
    handler: ({ db, ctx, corpo, usuario }) => {
      const d = validar(corpo, { deId: { tipo: 'uuid' }, paraId: ID, inicio: { tipo: 'data' }, fim: { obrigatorio: true, tipo: 'data' },
        motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 } });
      return db.comoTenant(ctx.tenantId, async (c) => com(201, await s.delegar(c, ctx, d, pode(usuario, 'governanca.gerir'))));
    } },
  { metodo: 'POST', caminho: '/api/delegacoes/:id/revogar', permissao: 'agenda.usar', descricao: 'revogar delegações',
    handler: ({ db, ctx, params, corpo, usuario }) => {
      const id = uuid(params.id);
      const d = validar(corpo, { motivo: { tipo: 'texto', max: 300 } });
      return db.comoTenant(ctx.tenantId, (c) => s.revogar(c, ctx, id, d.motivo || 'Revogada antes do fim', pode(usuario, 'governanca.gerir')));
    } },
  { metodo: 'POST', caminho: '/api/raci', permissao: 'governanca.gerir', descricao: 'editar a matriz de responsáveis',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { processo: { obrigatorio: true, tipo: 'texto', em: Object.keys(s.PROCESSOS) },
        papel: { obrigatorio: true, tipo: 'texto', em: Object.keys(s.PAPEIS_RACI) }, usuarioId: { tipo: 'uuid' }, equipeId: { tipo: 'uuid' } });
      return db.comoTenant(ctx.tenantId, async (c) => com(201, await s.definirRaci(c, ctx, d)));
    } },
  { metodo: 'POST', caminho: '/api/raci/sugestao', permissao: 'governanca.gerir', descricao: 'editar a matriz de responsáveis',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, (c) => s.aplicarSugestao(c, ctx)) },
  { metodo: 'POST', caminho: '/api/raci/:id/remover', permissao: 'governanca.gerir', descricao: 'editar a matriz de responsáveis',
    handler: ({ db, ctx, params }) => { const id = uuid(params.id); return db.comoTenant(ctx.tenantId, (c) => s.removerRaci(c, ctx, id)); } },
  { metodo: 'POST', caminho: '/api/plantoes', permissao: 'governanca.gerir', descricao: 'montar a escala de plantão',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { equipeId: ID, usuarioId: ID, inicio: { obrigatorio: true, tipo: 'data' }, fim: { obrigatorio: true, tipo: 'data' } });
      return db.comoTenant(ctx.tenantId, async (c) => com(201, await s.criarPlantao(c, ctx, d)));
    } },
  { metodo: 'POST', caminho: '/api/plantoes/:id/cancelar', permissao: 'governanca.gerir', descricao: 'montar a escala de plantão',
    handler: ({ db, ctx, params, corpo }) => {
      const id = uuid(params.id);
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 } });
      return db.comoTenant(ctx.tenantId, (c) => s.cancelarPlantao(c, ctx, id, d.motivo));
    } },
  { metodo: 'POST', caminho: '/api/contas/:id/sla', permissao: 'governanca.gerir', descricao: 'definir o SLA de contrato',
    handler: ({ db, ctx, params, corpo }) => {
      const id = uuid(params.id);
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 } });
      const sla = validarSlaContrato(corpo?.sla === undefined ? null : corpo.sla);
      if (sla && sla.erro) throw erro.entrada(sla.erro);
      return db.comoTenant(ctx.tenantId, (c) => s.definirSlaContrato(c, ctx, id, sla, d.motivo));
    } },
];
