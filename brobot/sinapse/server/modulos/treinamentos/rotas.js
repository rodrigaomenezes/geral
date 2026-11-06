'use strict';
// Rotas dos treinamentos do CS. Ver: quem vê contas; organizar: `treinamento.gerir` (CS e gestão).
const { validar, ErroNegocio } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const tarefas = require('../ocorrencias/tarefas');
const s = require('./servico');

const uuid = (v) => { if (!/^[0-9a-f-]{36}$/i.test(v)) throw new ErroNegocio(400, 'entrada_invalida', 'Identificador inválido.'); };

module.exports = [
  { metodo: 'GET', caminho: '/api/treinamentos', permissao: 'conta.ver',
    handler: ({ db, ctx, query }) => db.comoTenant(ctx.tenantId, async (c) => ({ ...(await s.listarSessoes(c, { pagina: query.pagina })), roteiros: await s.roteiros(c, ctx) })) },
  { metodo: 'POST', caminho: '/api/treinamentos', permissao: 'treinamento.gerir', descricao: 'organizar treinamentos',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { titulo: { obrigatorio: true, tipo: 'texto', min: 3, max: 120 }, roteiro: { obrigatorio: true, tipo: 'texto', max: 40 },
        inicio: { obrigatorio: true, tipo: 'data' }, duracaoMin: { tipo: 'inteiro' }, link: { obrigatorio: true, tipo: 'texto', max: 310 },
        contaDemo: { obrigatorio: true, tipo: 'texto', min: 2, max: 120 }, vagas: { tipo: 'inteiro' }, instrutorId: { tipo: 'uuid' }, observacoes: { tipo: 'texto', max: 2000 } });
      if (d.duracaoMin !== undefined && (d.duracaoMin < 15 || d.duracaoMin > 480)) throw new ErroNegocio(400, 'entrada_invalida', 'Duração de 15 a 480 minutos.');
      if (d.vagas !== undefined && (d.vagas < 1 || d.vagas > 500)) throw new ErroNegocio(400, 'entrada_invalida', 'Vagas de 1 a 500.');
      return db.comoTenant(ctx.tenantId, async (c) => com(201, await s.criarSessao(c, ctx, d)));
    } },
  { metodo: 'POST', caminho: '/api/treinamentos/roteiros', permissao: 'treinamento.gerir', descricao: 'editar roteiros de treinamento',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { codigo: { obrigatorio: true, tipo: 'texto', max: 40 }, titulo: { obrigatorio: true, tipo: 'texto', min: 3, max: 120 }, produto: { tipo: 'texto', max: 80 } });
      return db.comoTenant(ctx.tenantId, (c) => s.salvarRoteiro(c, ctx, { ...d, passos: corpo?.passos }));
    } },
  { metodo: 'GET', caminho: '/api/treinamentos/:id', permissao: 'conta.ver',
    handler: ({ db, ctx, params }) => { uuid(params.id); return db.comoTenant(ctx.tenantId, (c) => s.detalhe(c, params.id)); } },
  { metodo: 'POST', caminho: '/api/treinamentos/:id/participantes', permissao: 'treinamento.gerir', descricao: 'organizar treinamentos',
    handler: ({ db, ctx, corpo, params }) => {
      uuid(params.id);
      const ids = Array.isArray(corpo?.contaIds) ? corpo.contaIds.map(String) : [];
      if (!ids.length || ids.some((x) => !/^[0-9a-f-]{36}$/i.test(x))) throw new ErroNegocio(400, 'entrada_invalida', 'Escolha as contas.');
      return db.comoTenant(ctx.tenantId, (c) => s.adicionarParticipantes(c, ctx, params.id, ids));
    } },
  { metodo: 'POST', caminho: '/api/treinamentos/:id/convidar', permissao: 'treinamento.gerir', descricao: 'organizar treinamentos',
    handler: ({ db, ctx, params }) => { uuid(params.id); return db.comoTenant(ctx.tenantId, (c) => s.convidar(c, ctx, params.id)); } },
  { metodo: 'POST', caminho: '/api/treinamentos/:id/concluir', permissao: 'treinamento.gerir', descricao: 'organizar treinamentos',
    handler: ({ db, ctx, params }) => { uuid(params.id); return db.comoTenant(ctx.tenantId, (c) => s.concluir(c, ctx, params.id, (t) => tarefas.criar(c, ctx, t))); } },
  { metodo: 'POST', caminho: '/api/treinamentos/:id/cancelar', permissao: 'treinamento.gerir', descricao: 'organizar treinamentos',
    handler: ({ db, ctx, params, corpo }) => {
      uuid(params.id);
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 500 } });
      return db.comoTenant(ctx.tenantId, (c) => s.cancelar(c, ctx, params.id, d.motivo));
    } },
  { metodo: 'POST', caminho: '/api/treinamentos/participantes/:id', permissao: 'treinamento.gerir', descricao: 'organizar treinamentos',
    handler: ({ db, ctx, params, corpo }) => {
      uuid(params.id);
      const d = validar(corpo, { presenca: { tipo: 'texto', em: ['presente', 'ausente'] }, avaliacao: { tipo: 'inteiro' }, duvidas: { tipo: 'texto', max: 2000 }, proximoPasso: { tipo: 'texto', max: 500 } });
      if (d.avaliacao !== undefined && (d.avaliacao < 1 || d.avaliacao > 5)) throw new ErroNegocio(400, 'entrada_invalida', 'Avaliação de 1 a 5.');
      return db.comoTenant(ctx.tenantId, (c) => s.registrar(c, ctx, params.id, d));
    } },
];
