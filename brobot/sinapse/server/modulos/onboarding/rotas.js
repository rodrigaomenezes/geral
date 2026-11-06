'use strict';
// Rotas do onboarding/offboarding por checklist. A permissão fina (equipe dona do item, gestão aprova dispensa)
// é conferida no serviço.
const { validar, ErroNegocio } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const { comAuditoriaDeAcesso } = require('../ocorrencias/rotas');
const s = require('./servico');

const uuid = (v, o) => { if (!/^[0-9a-f-]{36}$/i.test(v)) throw new ErroNegocio(400, 'entrada_invalida', `${o} inválido.`); };
const TIPOS = ['onboarding', 'offboarding'];

module.exports = [
  { metodo: 'GET', caminho: '/api/contas/:id/checklists', permissao: 'conta.ver',
    handler: ({ db, ctx, params }) => comAuditoriaDeAcesso(db, ctx, 'conta', params.id, (c) => s.daConta(c, ctx, params.id)) },
  { metodo: 'POST', caminho: '/api/contas/:id/checklists', permissao: 'conta.editar', descricao: 'abrir onboarding ou offboarding',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { tipo: { obrigatorio: true, tipo: 'texto', em: TIPOS }, motivo: { tipo: 'texto', max: 1000 } });
      return comAuditoriaDeAcesso(db, ctx, 'conta', params.id, async (c) => com(201, await s.abrir(c, ctx, { contaId: params.id, tipo: d.tipo, motivo: d.motivo })));
    } },
  { metodo: 'GET', caminho: '/api/checklists/modelos/:tipo', permissao: 'conta.ver',
    handler: ({ db, ctx, params }) => {
      if (!TIPOS.includes(params.tipo)) throw new ErroNegocio(404, 'rota_inexistente', 'Modelo desconhecido.');
      return db.comoTenant(ctx.tenantId, (c) => s.modeloAtivo(c, ctx, params.tipo));
    } },
  { metodo: 'POST', caminho: '/api/checklists/modelos/:tipo', permissao: 'processo.editar', descricao: 'editar o modelo de checklist',
    handler: ({ db, ctx, corpo, params }) => {
      if (!TIPOS.includes(params.tipo)) throw new ErroNegocio(404, 'rota_inexistente', 'Modelo desconhecido.');
      if (!Array.isArray(corpo?.itens)) throw new ErroNegocio(400, 'entrada_invalida', 'Envie os itens do modelo.');
      const itens = corpo.itens.slice(0, 41).map((i) => ({ codigo: String(i?.codigo || ''), titulo: String(i?.titulo || '').trim(), grupo: String(i?.grupo || ''),
        equipe: String(i?.equipe || ''), dias: Number(i?.dias), obrigatorio: i?.obrigatorio !== false, ...(i?.verificacao ? { verificacao: String(i.verificacao) } : {}) }));
      if (itens.some((i) => i.verificacao && !s.VERIFICACOES[i.verificacao])) throw new ErroNegocio(400, 'entrada_invalida', `Verificação automática desconhecida (use: ${Object.keys(s.VERIFICACOES).join(', ')}).`);
      return db.comoTenant(ctx.tenantId, (c) => s.salvarModelo(c, ctx, params.tipo, itens));
    } },
  { metodo: 'POST', caminho: '/api/checklists/itens/:id/:acao', permissao: 'conta.ver', descricao: 'trabalhar no checklist',
    handler: ({ db, ctx, corpo, params, usuario }) => {
      uuid(params.id, 'Item');
      if (!['feito', 'pedir_dispensa', 'aprovar_dispensa', 'negar_dispensa'].includes(params.acao)) throw new ErroNegocio(404, 'rota_inexistente', 'Ação desconhecida.');
      const d = validar(corpo, { evidencia: { tipo: 'texto', max: 1000 }, motivo: { tipo: 'texto', max: 500 } });
      return db.comoTenant(ctx.tenantId, (c) => s.agirItem(c, ctx, usuario, params.id, params.acao, d));
    } },
  { metodo: 'POST', caminho: '/api/checklists/:id/concluir', permissao: 'conta.editar', descricao: 'concluir onboarding ou offboarding',
    handler: ({ db, ctx, params }) => { uuid(params.id, 'Checklist'); return db.comoTenant(ctx.tenantId, (c) => s.concluir(c, ctx, params.id)); } },
];
