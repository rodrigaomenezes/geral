'use strict';
// Rotas do Desenvolvimento: incidentes, melhorias e releases. Ver: quem vê ocorrências. Registrar incidente e release:
// `dev.gerir`. Propor melhoria: qualquer um que atende. Aprovar: gestão (`ocorrencia.intervir`), nunca quem propôs.
// Validar na operação: quem cuida de contas e não é do Desenvolvimento.
const { validar, ErroNegocio } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const { pode } = require('../identidade/permissoes');
const tarefas = require('../ocorrencias/tarefas');
const s = require('./servico');

const uuid = (v) => { if (!/^[0-9a-f-]{36}$/i.test(v)) throw new ErroNegocio(400, 'entrada_invalida', 'Identificador inválido.'); };
const listaUuid = (v) => (Array.isArray(v) ? v.map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : []);

module.exports = [
  { metodo: 'GET', caminho: '/api/desenvolvimento', permissao: 'ocorrencia.ver',
    handler: ({ db, ctx, query }) => db.comoTenant(ctx.tenantId, async (c) => ({
      incidentes: await s.listarIncidentes(c, { pagina: query.pagina }), melhorias: await s.listarMelhorias(c, { estado: query.estado }),
      fila: await s.filaTecnica(c, { pagina: query.paginaFila }),
      releases: await s.listarReleases(c), severidades: s.SEVERIDADE, estadosIncidente: s.ESTADO_INCIDENTE, estadosMelhoria: s.ESTADO_MELHORIA })) },
  { metodo: 'POST', caminho: '/api/incidentes', permissao: 'dev.gerir', descricao: 'registrar incidentes',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { titulo: { obrigatorio: true, tipo: 'texto', min: 5, max: 200 }, severidade: { obrigatorio: true, tipo: 'texto', em: Object.keys(s.SEVERIDADE) },
        impacto: { obrigatorio: true, tipo: 'texto', min: 5, max: 2000 }, produto: { tipo: 'texto', max: 80 }, inicioEm: { tipo: 'data' },
        primeiraAtualizacao: { tipo: 'texto', max: 2000 }, comunicar: { tipo: 'booleano' } });
      return db.comoTenant(ctx.tenantId, async (c) => com(201, await s.abrirIncidente(c, ctx, { ...d, contaIds: listaUuid(corpo?.contaIds) })));
    } },
  { metodo: 'GET', caminho: '/api/incidentes/:id', permissao: 'ocorrencia.ver',
    handler: ({ db, ctx, params }) => { uuid(params.id); return db.comoTenant(ctx.tenantId, (c) => s.detalheIncidente(c, params.id)); } },
  { metodo: 'POST', caminho: '/api/incidentes/:id/atualizacoes', permissao: 'dev.gerir', descricao: 'atualizar incidentes',
    handler: ({ db, ctx, params, corpo }) => {
      uuid(params.id);
      const d = validar(corpo, { texto: { obrigatorio: true, tipo: 'texto', min: 3, max: 2000 }, estado: { tipo: 'texto', em: ['mitigado', 'resolvido'] },
        comunicar: { tipo: 'booleano' }, versao: { tipo: 'inteiro' } });
      return db.comoTenant(ctx.tenantId, async (c) => com(201, await s.atualizarIncidente(c, ctx, params.id, d)));
    } },
  { metodo: 'POST', caminho: '/api/incidentes/:id/encerrar', permissao: 'dev.gerir', descricao: 'fazer o post-mortem',
    handler: ({ db, ctx, params, corpo }) => {
      uuid(params.id);
      const d = validar(corpo, { causaRaiz: { obrigatorio: true, tipo: 'texto', min: 10, max: 4000 }, licoes: { obrigatorio: true, tipo: 'texto', min: 10, max: 4000 } });
      const acoes = Array.isArray(corpo?.acoes) ? corpo.acoes.map((a) => String(a).trim()).filter((a) => a.length >= 5 && a.length <= 200) : [];
      return db.comoTenant(ctx.tenantId, (c) => s.encerrarIncidente(c, ctx, params.id, { ...d, acoes }));
    } },
  { metodo: 'POST', caminho: '/api/melhorias', permissao: 'ocorrencia.atender', descricao: 'propor melhorias',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { titulo: { obrigatorio: true, tipo: 'texto', min: 5, max: 200 }, descricao: { obrigatorio: true, tipo: 'texto', min: 10, max: 4000 },
        tipo: { tipo: 'texto', em: ['correcao', 'melhoria', 'preventiva'] }, origem: { tipo: 'texto', em: ['ocorrencia', 'reincidencia', 'cliente', 'interna'] },
        prioridade: { tipo: 'texto', em: ['baixa', 'media', 'alta', 'critica'] } });
      return db.comoTenant(ctx.tenantId, async (c) => com(201, await s.proporMelhoria(c, ctx, { ...d, ocorrenciaIds: listaUuid(corpo?.ocorrenciaIds) })));
    } },
  { metodo: 'POST', caminho: '/api/melhorias/:id/:acao', permissao: 'ocorrencia.ver', descricao: 'decidir melhorias',
    handler: ({ db, ctx, params, corpo, usuario }) => {
      uuid(params.id);
      if (!['aprovar', 'recusar', 'iniciar', 'validar'].includes(params.acao)) throw new ErroNegocio(404, 'rota_inexistente', 'Ação desconhecida.');
      const d = validar(corpo, { motivo: { tipo: 'texto', max: 500 }, evidencia: { tipo: 'texto', max: 2000 }, prioridade: { tipo: 'texto', em: ['baixa', 'media', 'alta', 'critica'] },
        linkExterno: { tipo: 'texto', max: 300 } });
      if (d.linkExterno && !/^https:\/\/\S{4,}$/.test(d.linkExterno)) throw new ErroNegocio(400, 'entrada_invalida', 'Link externo começa com https://.');
      return db.comoTenant(ctx.tenantId, (c) => s.agirMelhoria(c, ctx, params.id, params.acao, d, (p) => pode(usuario, p)));
    } },
  { metodo: 'POST', caminho: '/api/releases', permissao: 'dev.gerir', descricao: 'planejar releases',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { versao: { obrigatorio: true, tipo: 'texto', max: 40 }, previstoPara: { tipo: 'texto', max: 10 }, notas: { tipo: 'texto', max: 4000 } });
      if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/.test(d.versao)) throw new ErroNegocio(400, 'entrada_invalida', 'Versão: letras, números, ponto, traço (ex.: 2026.11.1).');
      if (d.previstoPara && !/^\d{4}-\d{2}-\d{2}$/.test(d.previstoPara)) throw new ErroNegocio(400, 'entrada_invalida', 'Data prevista inválida.');
      return db.comoTenant(ctx.tenantId, async (c) => com(201, await s.criarRelease(c, ctx, d)));
    } },
  { metodo: 'POST', caminho: '/api/releases/:id/melhorias', permissao: 'dev.gerir', descricao: 'planejar releases',
    handler: ({ db, ctx, params, corpo }) => {
      uuid(params.id); uuid(String(corpo?.melhoriaId || ''));
      return db.comoTenant(ctx.tenantId, (c) => s.incluirNaRelease(c, ctx, params.id, corpo.melhoriaId));
    } },
  { metodo: 'POST', caminho: '/api/releases/:id/publicar', permissao: 'dev.gerir', descricao: 'publicar releases',
    handler: ({ db, ctx, params }) => { uuid(params.id); return db.comoTenant(ctx.tenantId, (c) => s.publicarRelease(c, ctx, params.id, (t) => tarefas.criar(c, ctx, t))); } },
];
