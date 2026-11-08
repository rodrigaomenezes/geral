'use strict';
const { validar, ErroNegocio } = require('../../nucleo/erros');
const { pode } = require('../identidade/permissoes');
const catalogo = require('./catalogo');
const propostas = require('./propostas');
const atividades = require('./atividades');
const contatos = require('./contatos');
const { com } = require('../../http/servidor');
const { comAuditoriaDeAcesso } = require('../ocorrencias/rotas');
const { ETAPAS, ORIGENS, MOTIVOS_PERDA, FUNIS } = require('./funil');
const s = require('./servico');
const captura = require('./captura');
const { conferirToken } = require('../../nucleo/token-entrada');
const { tenantPorSlug } = require('../entrada/servico');

const CAMPOS = {
  empresa: { tipo: 'texto', max: 160 }, cnpj: { tipo: 'texto', max: 20 }, contatoNome: { tipo: 'texto', max: 120 }, contatoTelefone: { tipo: 'texto', max: 30 },
  contatoEmail: { tipo: 'texto', max: 200 }, origem: { tipo: 'texto', em: Object.keys(ORIGENS) }, frota: { tipo: 'inteiro' }, valorMensal: { tipo: 'texto', max: 20 },
  responsavelId: { tipo: 'uuid' }, proximaAcao: { tipo: 'texto', max: 200 }, proximaAcaoEm: { tipo: 'data' }, testeInicio: { tipo: 'texto', max: 10 },
  testeFim: { tipo: 'texto', max: 10 }, testeCriterio: { tipo: 'texto', max: 500 }, versao: { tipo: 'inteiro' }, fechamentoPrevisto: { tipo: 'texto', max: 10 },
  funil: { tipo: 'texto', em: Object.keys(FUNIS) }, contaOrigemId: { tipo: 'uuid' },
};
const dados = (corpo) => {
  const d = validar(corpo, CAMPOS);
  if (Array.isArray(corpo?.produtos)) d.produtos = corpo.produtos.map(String);
  if (d.valorMensal !== undefined) d.valorMensal = Number(String(d.valorMensal).replace(/\./g, '').replace(',', '.'));
  return d;
};

module.exports = [
  { metodo: 'GET', caminho: '/api/comercial/catalogo', permissao: 'comercial.ver',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, async (c) => {
      const lista = await catalogo.listar(c, ctx);
      return { etapas: ETAPAS, produtos: Object.fromEntries(lista.filter((x) => x.ativo).map((x) => [x.codigo, x.nome])), catalogo: lista,
        origens: ORIGENS, motivosPerda: MOTIVOS_PERDA, tiposAtividade: atividades.TIPOS, estadosProposta: propostas.ESTADOS,
        funis: FUNIS, funisConfig: await s.funisDaOrganizacao(c), probabilidade: await s.probabilidadesDaOrganizacao(c), papeisPessoa: contatos.PAPEIS };
    }) },
  { metodo: 'POST', caminho: '/api/comercial/produtos', permissao: 'comercial.gerir', descricao: 'gerir o catálogo de produtos',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { codigo: { obrigatorio: true, tipo: 'texto', max: 40 }, nome: { obrigatorio: true, tipo: 'texto', min: 2, max: 80 },
        exigeTeste: { tipo: 'booleano' }, precoReferencia: { tipo: 'texto', max: 20 }, unidade: { tipo: 'texto', min: 2, max: 30 }, ativo: { tipo: 'booleano' } });
      if (!/^[a-z0-9_]{2,40}$/.test(d.codigo)) throw new ErroNegocio(400, 'entrada_invalida', 'Código do produto: letras minúsculas, números e _ (ex.: multas).');
      if (d.precoReferencia !== undefined) { d.precoReferencia = Number(String(d.precoReferencia).replace(/\./g, '').replace(',', '.')); if (!(d.precoReferencia >= 0)) throw new ErroNegocio(400, 'entrada_invalida', 'Preço de referência inválido.'); }
      return db.comoTenant(ctx.tenantId, (c) => catalogo.salvar(c, ctx, d));
    } },
  // CRM-002: lead de fora (site, formulário, parceiro) por webhook com o token de entrada. 201 = criado; 200 = já existia.
  { metodo: 'POST', caminho: '/api/leads/:tenant', publica: true,
    handler: async ({ req, db, cfg, params, corpo }) => {
      conferirToken(req.headers['x-sinapse-token'], cfg.tokenEntrada);
      const d = validar(corpo, { idLead: { obrigatorio: true, tipo: 'texto', min: 1, max: 120 }, empresa: { obrigatorio: true, tipo: 'texto', min: 2, max: 160 },
        contatoNome: { obrigatorio: true, tipo: 'texto', min: 2, max: 120 }, contatoTelefone: { tipo: 'texto', max: 30 }, contatoEmail: { tipo: 'texto', max: 160 },
        origem: { tipo: 'texto', em: Object.keys(ORIGENS).filter((o) => o !== 'base') }, frota: { tipo: 'inteiro' }, mensagem: { tipo: 'texto', max: 1000 } });
      if (!d.contatoTelefone && !d.contatoEmail) throw new ErroNegocio(400, 'entrada_invalida', 'Informe o telefone ou o e-mail do contato.', [{ campo: 'contatoTelefone', problema: 'obrigatório' }]);
      if (d.contatoEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.contatoEmail)) throw new ErroNegocio(400, 'entrada_invalida', 'E-mail inválido.', [{ campo: 'contatoEmail', problema: 'inválido' }]);
      if (d.frota !== undefined && (d.frota < 0 || d.frota > 1000000)) throw new ErroNegocio(400, 'entrada_invalida', 'Frota inválida.');
      const produtos = Array.isArray(corpo?.produtos) ? corpo.produtos.map(String).slice(0, 10) : undefined;
      const t = await tenantPorSlug(db, params.tenant);
      if (!t) throw new ErroNegocio(404, 'organizacao_inexistente', 'Organização não encontrada.');
      const r = await db.comoTenant(t.id, (c) => captura.capturar(c, t.id, { ...d, origem: d.origem || 'site', produtos }));
      return com(r.duplicada ? 200 : 201, r);
    } },
  { metodo: 'GET', caminho: '/api/comercial/oportunidades', permissao: 'comercial.ver',
    handler: ({ db, ctx, usuario, query }) => db.comoTenant(ctx.tenantId, (c) => s.listar(c, { q: query.q, minhas: query.minhas === '1', usuario, funil: query.funil })) },
  { metodo: 'GET', caminho: '/api/comercial/indicadores', permissao: 'comercial.ver',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, (c) => s.indicadores(c)) },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades', permissao: 'comercial.editar', descricao: 'cadastrar oportunidades',
    handler: async ({ db, ctx, corpo }) => com(201, await db.comoTenant(ctx.tenantId, (c) => s.criar(c, ctx, dados(corpo)))) },
  { metodo: 'GET', caminho: '/api/comercial/oportunidades/:id', permissao: 'comercial.ver',
    handler: ({ db, ctx, params }) => comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, (c) => s.detalhe(c, ctx, params.id)) },
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
  { metodo: 'POST', caminho: '/api/comercial/oportunidades/:id/suspender', permissao: 'comercial.editar', descricao: 'suspender oportunidades',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 }, retomarEm: { obrigatorio: true, tipo: 'data' }, versao: { tipo: 'inteiro' } });
      return comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, (c) => s.suspender(c, ctx, params.id, d, d.versao));
    } },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades/:id/retomar', permissao: 'comercial.editar', descricao: 'retomar ou reabrir oportunidades',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { motivo: { tipo: 'texto', max: 500 }, versao: { tipo: 'inteiro' } });
      return comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, (c) => s.retomar(c, ctx, params.id, d, d.versao));
    } },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades/:id/propostas', permissao: 'comercial.editar', descricao: 'fazer propostas',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { descontoPct: { tipo: 'texto', max: 10 }, validade: { obrigatorio: true, tipo: 'texto', max: 10 }, condicoes: { tipo: 'texto', max: 2000 } });
      if (!Array.isArray(corpo?.itens)) throw new ErroNegocio(400, 'entrada_invalida', 'Informe os itens da proposta.');
      d.itens = corpo.itens.slice(0, 21).map((i) => ({ produto: String(i?.produto || ''), quantidade: Number(i?.quantidade), valorUnitario: Number(String(i?.valorUnitario ?? '').replace(',', '.')) }));
      if (d.descontoPct !== undefined) d.descontoPct = Number(String(d.descontoPct).replace(',', '.'));
      return comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, async (c) => com(201, await propostas.criar(c, ctx, await s.buscar(c, params.id, true), d)));
    } },
  { metodo: 'POST', caminho: '/api/comercial/propostas/:id/:acao', permissao: 'comercial.editar', descricao: 'enviar e registrar propostas',
    handler: ({ db, ctx, corpo, params, usuario }) => {
      if (!['enviar', 'aprovar', 'devolver', 'aceitar', 'recusar'].includes(params.acao)) throw new ErroNegocio(404, 'rota_inexistente', 'Ação de proposta desconhecida.');
      if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new ErroNegocio(400, 'entrada_invalida', 'Proposta inválida.');
      const d = validar(corpo, { parecer: { tipo: 'texto', max: 1000 } });
      return db.comoTenant(ctx.tenantId, (c) => propostas.agir(c, ctx, params.id, params.acao, d, (perm) => pode(usuario, perm)));
    } },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades/:id/atividades', permissao: 'comercial.editar', descricao: 'registrar atividades',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { tipo: { obrigatorio: true, tipo: 'texto', em: Object.keys(atividades.TIPOS) }, assunto: { obrigatorio: true, tipo: 'texto', min: 2, max: 200 },
        quando: { tipo: 'data' }, feita: { tipo: 'booleano' }, resultado: { tipo: 'texto', max: 2000 } });
      return comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, async (c) => com(201, await atividades.registrar(c, ctx, await s.buscar(c, params.id, true), d)));
    } },
  { metodo: 'POST', caminho: '/api/comercial/atividades/:id/concluir', permissao: 'comercial.editar', descricao: 'concluir atividades',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { resultado: { obrigatorio: true, tipo: 'texto', min: 2, max: 2000 } });
      if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new ErroNegocio(400, 'entrada_invalida', 'Atividade inválida.');
      return db.comoTenant(ctx.tenantId, (c) => atividades.concluir(c, ctx, params.id, d));
    } },
  { metodo: 'GET', caminho: '/api/comercial/oportunidades/:id/atividades', permissao: 'comercial.ver',
    handler: ({ db, ctx, params, query }) => comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, (c) => atividades.listar(c, params.id, query.pagina)) },
  { metodo: 'POST', caminho: '/api/comercial/encaminhar', permissao: 'conta.editar', descricao: 'encaminhar clientes ao Comercial',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { contaId: { obrigatorio: true, tipo: 'uuid' }, funil: { obrigatorio: true, tipo: 'texto', em: ['expansao', 'renovacao'] },
        observacao: { obrigatorio: true, tipo: 'texto', min: 5, max: 500 } });
      return comAuditoriaDeAcesso(db, ctx, 'conta', d.contaId, async (c) => com(201, await s.encaminhar(c, ctx, d)));
    } },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades/:id/pessoas', permissao: 'comercial.editar', descricao: 'cadastrar pessoas da negociação',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { nome: { obrigatorio: true, tipo: 'texto', min: 2, max: 120 }, cargo: { tipo: 'texto', max: 80 }, telefone: { tipo: 'texto', max: 30 },
        email: { tipo: 'texto', max: 200 }, papel: { obrigatorio: true, tipo: 'texto', em: Object.keys(contatos.PAPEIS) } });
      return comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, async (c) => { await s.buscar(c, params.id); return com(201, await contatos.vincular(c, ctx, params.id, d)); });
    } },
  { metodo: 'POST', caminho: '/api/comercial/oportunidades/:id/pessoas/:pessoa/desvincular', permissao: 'comercial.editar', descricao: 'cadastrar pessoas da negociação',
    handler: ({ db, ctx, params }) => {
      if (!/^[0-9a-f-]{36}$/i.test(params.pessoa)) throw new ErroNegocio(400, 'entrada_invalida', 'Pessoa inválida.');
      return comAuditoriaDeAcesso(db, ctx, 'oportunidade', params.id, (c) => contatos.desvincular(c, ctx, params.id, params.pessoa));
    } },
];
