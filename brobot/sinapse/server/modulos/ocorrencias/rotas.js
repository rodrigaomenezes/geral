'use strict';
const { validar, ErroNegocio } = require('../../nucleo/erros');
const { auditar } = require('../../nucleo/registro');
const { com } = require('../../http/servidor');
const maquina = require('./maquina');
const s = require('./servico');
const tarefas = require('./tarefas');

const TIPOS = { nao_classificada: 'Não classificada', duvida: 'Dúvida', erro_consulta: 'Erro de consulta', credencial: 'Credencial',
  pre_rodada: 'Pré-rodada', pos_rodada: 'Pós-rodada', onboarding: 'Onboarding', tecnica: 'Técnica (Desenvolvimento)', incidente: 'Incidente',
  solicitacao: 'Solicitação' };
const PRIORIDADES = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };

/** AT-014: id que não existe nesta organização responde 404 e a tentativa fica auditada. */
async function comAuditoriaDeAcesso(db, ctx, entidade, id, fn) {
  try {
    return await db.comoTenant(ctx.tenantId, fn);
  } catch (e) {
    if (e instanceof ErroNegocio && e.status === 404) {
      await db.comoTenant(ctx.tenantId, (c) => auditar(c, ctx, { acao: 'acesso.negado_ou_inexistente', entidade, entidadeId: id })).catch(() => {});
    }
    throw e;
  }
}

module.exports = [
  { metodo: 'GET', caminho: '/api/catalogos', permissao: 'ocorrencia.ver',
    handler: async () => ({ estados: maquina.ESTADOS, tipos: TIPOS, prioridades: PRIORIDADES, desfechosResolvida: maquina.DESFECHOS_RESOLVIDA,
      desfechosSemResolucao: maquina.DESFECHOS_SEM_RESOLUCAO, tiposTarefa: tarefas.TIPOS }) },
  { metodo: 'GET', caminho: '/api/ocorrencias', permissao: 'ocorrencia.ver',
    handler: ({ db, ctx, usuario, query }) => db.comoTenant(ctx.tenantId, (c) => s.listar(c, usuario, { ...query, minhas: query.minhas === '1' })) },
  { metodo: 'POST', caminho: '/api/ocorrencias', permissao: 'ocorrencia.atender', descricao: 'abrir ocorrências',
    handler: async ({ db, ctx, corpo }) => {
      const d = validar(corpo, {
        contaId: { obrigatorio: true, tipo: 'uuid' }, tipo: { obrigatorio: true, tipo: 'texto', em: Object.keys(TIPOS).filter((t) => t !== 'nao_classificada') },
        prioridade: { obrigatorio: true, tipo: 'texto', em: Object.keys(PRIORIDADES) }, titulo: { obrigatorio: true, tipo: 'texto', min: 5, max: 200 },
        descricao: { tipo: 'texto', max: 4000 },
      });
      return com(201, await db.comoTenant(ctx.tenantId, (c) => s.criar(c, ctx, { ...d, origem: 'interna' })));
    } },
  { metodo: 'GET', caminho: '/api/ocorrencias/quadro', permissao: 'ocorrencia.ver',
    handler: ({ db, ctx, usuario, query }) => {
      const d = validar(query, { equipe: { tipo: 'texto', max: 30 }, responsavel: { tipo: 'texto', max: 40 }, q: { tipo: 'texto', max: 100 },
        vip: { tipo: 'texto', em: ['1'] }, vencidas: { tipo: 'texto', em: ['1'] } });
      if (d.responsavel && !['eu', 'ninguem'].includes(d.responsavel) && !/^[0-9a-f-]{36}$/i.test(d.responsavel)) throw new ErroNegocio(400, 'entrada_invalida', 'Responsável inválido.');
      return db.comoTenant(ctx.tenantId, (c) => s.quadro(c, usuario, { ...d, vip: d.vip === '1', vencidas: d.vencidas === '1' }));
    } },
  { metodo: 'GET', caminho: '/api/ocorrencias/:id', permissao: 'ocorrencia.ver',
    handler: ({ db, ctx, usuario, params }) => comAuditoriaDeAcesso(db, ctx, 'ocorrencia', params.id, (c) => s.detalhe(c, usuario, params.id)) },
  { metodo: 'POST', caminho: '/api/ocorrencias/:id/transicoes', permissao: 'ocorrencia.ver',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { acao: { obrigatorio: true, tipo: 'texto', em: Object.keys(maquina.TRANSICOES) }, versao: { tipo: 'inteiro' } });
      const dados = corpo.dados && typeof corpo.dados === 'object' ? corpo.dados : {};
      const limpos = validar(dados, {
        contaId: { tipo: 'uuid' }, tipo: { tipo: 'texto', em: Object.keys(TIPOS) }, prioridade: { tipo: 'texto', em: Object.keys(PRIORIDADES) },
        motivo: { tipo: 'texto', max: 500 }, revisaoEm: { tipo: 'data' }, paraEquipe: { tipo: 'texto', max: 30 },
        evidencia: { tipo: 'texto', max: 2000 }, codigoDesfecho: { tipo: 'texto', max: 40 },
      });
      return comAuditoriaDeAcesso(db, ctx, 'ocorrencia', params.id, (c) => s.transicionar(c, ctx, params.id, d.acao, limpos, d.versao));
    } },
  { metodo: 'POST', caminho: '/api/ocorrencias/:id/respostas', permissao: 'ocorrencia.atender', descricao: 'responder clientes',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { texto: { obrigatorio: true, tipo: 'texto', min: 2, max: 3000 } });
      return comAuditoriaDeAcesso(db, ctx, 'ocorrencia', params.id, (c) => s.responder(c, ctx, params.id, d.texto));
    } },
  { metodo: 'POST', caminho: '/api/ocorrencias/:id/notas', permissao: 'ocorrencia.ver',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { texto: { obrigatorio: true, tipo: 'texto', min: 2, max: 3000 } });
      return comAuditoriaDeAcesso(db, ctx, 'ocorrencia', params.id, (c) => s.anotar(c, ctx, params.id, d.texto));
    } },
  { metodo: 'POST', caminho: '/api/ocorrencias/:id/reatribuir', permissao: 'ocorrencia.intervir', descricao: 'reatribuir ocorrências',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { equipeCodigo: { tipo: 'texto', max: 30 }, responsavelId: { tipo: 'uuid' }, motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 500 }, versao: { tipo: 'inteiro' } });
      return comAuditoriaDeAcesso(db, ctx, 'ocorrencia', params.id, (c) => s.reatribuir(c, ctx, params.id, d));
    } },
  { metodo: 'GET', caminho: '/api/tarefas', permissao: 'ocorrencia.ver',
    handler: ({ db, ctx, usuario, query }) => db.comoTenant(ctx.tenantId, (c) => tarefas.listar(c, usuario, { minhas: query.minhas === '1', pagina: Number(query.pagina) || 1 })) },
  { metodo: 'POST', caminho: '/api/tarefas/:id/concluir', permissao: 'ocorrencia.atender', descricao: 'concluir tarefas',
    handler: async ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { resultado: { obrigatorio: true, tipo: 'texto', min: 3, max: 1000 },
        resultadoCodigo: { tipo: 'texto', em: ['atendeu', 'nao_atendeu', 'feito', 'nao_feito'] } });
      return db.comoTenant(ctx.tenantId, (c) => tarefas.concluir(c, ctx, params.id, d.resultado, d.resultadoCodigo));
    } },
];

module.exports.comAuditoriaDeAcesso = comAuditoriaDeAcesso;
module.exports.TIPOS = TIPOS;
