'use strict';
const { validar } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const s = require('./servico');

module.exports = [
  { metodo: 'GET', caminho: '/api/telefonia/config', permissao: 'telefonia.usar',
    handler: ({ db, ctx, usuario }) => db.comoTenant(ctx.tenantId, (c) => s.canais(c, usuario)) },
  { metodo: 'POST', caminho: '/api/telefonia/sessao', permissao: 'telefonia.usar',
    handler: ({ db, ctx, usuario }) => db.comoTenant(ctx.tenantId, (c) => s.sessaoWebRTC(c, usuario)) },
  { metodo: 'POST', caminho: '/api/telefonia/chamadas', permissao: 'telefonia.usar', descricao: 'ligar pelo sistema',
    handler: async ({ db, ctx, corpo }) => {
      const d = validar(corpo, { canal: { tipo: 'texto', em: ['computador', 'celular'] }, numero: { tipo: 'texto', max: 30 }, nome: { tipo: 'texto', max: 120 },
        tarefaId: { tipo: 'uuid' }, ocorrenciaId: { tipo: 'uuid' }, oportunidadeId: { tipo: 'uuid' }, contaId: { tipo: 'uuid' } });
      return com(201, await db.comoTenant(ctx.tenantId, (c) => s.criar(c, ctx, d)));
    } },
  { metodo: 'POST', caminho: '/api/telefonia/chamadas/:id/eventos', permissao: 'telefonia.usar',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { evento: { obrigatorio: true, tipo: 'texto', em: [...Object.keys(s.TRANSICOES), 'encerrada'] },
        resultado: { tipo: 'texto', em: ['atendida', 'nao_atendida', 'ocupado', 'falhou', 'cancelada'] }, motivo: { tipo: 'texto', max: 120 }, anotacao: { tipo: 'texto', max: 1000 } });
      return db.comoTenant(ctx.tenantId, (c) => s.evento(c, ctx, params.id, d.evento, d));
    } },
  { metodo: 'GET', caminho: '/api/telefonia/chamadas', permissao: 'telefonia.usar',
    handler: ({ db, ctx, usuario, query }) => db.comoTenant(ctx.tenantId, (c) => s.listar(c, usuario, { todas: query.todas === '1', pagina: Math.max(1, Number(query.pagina) || 1) })) },
  { metodo: 'GET', caminho: '/api/telefonia/painel', permissao: 'telefonia.gerir', descricao: 'ver o painel de ligações',
    handler: ({ db, ctx, query }) => db.comoTenant(ctx.tenantId, (c) => s.painel(c, { dias: Math.min(90, Math.max(1, Number(query.dias) || 7)) })) },
  { metodo: 'GET', caminho: '/api/telefonia/admin', permissao: 'telefonia.gerir', descricao: 'configurar a telefonia',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, (c) => s.admin(c)) },
  { metodo: 'POST', caminho: '/api/telefonia/admin/config', permissao: 'telefonia.gerir', descricao: 'configurar a telefonia',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { provedor: { obrigatorio: true, tipo: 'texto', em: ['desligado', 'treino', 'sip'] }, operadora: { tipo: 'texto', max: 60 },
        wsUrl: { tipo: 'texto', max: 300 }, dominio: { tipo: 'texto', max: 200 }, iceServers: { tipo: 'texto', max: 2000 },
        formatoNumero: { tipo: 'texto', em: ['e164', '55', '0ddd', 'ddd'] }, prefixo: { tipo: 'texto', max: 6 }, celular: { tipo: 'booleano' } });
      if (d.wsUrl && !/^wss:\/\//.test(d.wsUrl)) d.wsUrl = undefined;
      return db.comoTenant(ctx.tenantId, (c) => s.salvarConfig(c, ctx, d));
    } },
  { metodo: 'POST', caminho: '/api/telefonia/admin/ramais/:usuarioId', permissao: 'telefonia.gerir', descricao: 'configurar ramais',
    handler: ({ db, ctx, corpo, params }) => {
      const d = validar(corpo, { usuarioSip: { obrigatorio: true, tipo: 'texto', max: 80 }, senha: { tipo: 'texto', max: 200 }, nomeExibicao: { tipo: 'texto', max: 80 }, ativo: { tipo: 'booleano' } });
      return db.comoTenant(ctx.tenantId, (c) => s.salvarRamal(c, ctx, params.usuarioId, d));
    } },
];
