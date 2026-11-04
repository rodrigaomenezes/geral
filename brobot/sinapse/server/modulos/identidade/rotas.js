'use strict';
const { com, cookieSessao, cookieApagado } = require('../../http/servidor');
const { validar, erro } = require('../../nucleo/erros');
const { permissoesDe, NOMES_PAPEIS } = require('./permissoes');
const supervisor = require('../supervisor/servico');
const s = require('./servico');

const publicoUsuario = (u, cfg) => u && ({
  id: u.id, nome: u.nome, papel: u.papel, papelNome: NOMES_PAPEIS[u.papel], equipe: u.equipe_nome, equipeCodigo: u.equipe_codigo,
  organizacao: u.tenant_nome, permissoes: permissoesDe(u.papel), demo: cfg.demo && u.demonstracao,
});

module.exports = [
  { metodo: 'GET', caminho: '/api/health', publica: true,
    handler: async ({ db }) => { await db.query('SELECT 1'); return { ok: true, banco: db.motor }; } },
  { metodo: 'GET', caminho: '/api/health/supervisor', publica: true,
    handler: async ({ db }) => { const h = await supervisor.saudeSupervisor(db); return h.ok ? h : com(503, h); } },
  { metodo: 'GET', caminho: '/api/sessao', publica: true,
    handler: async ({ usuario, cfg }) => ({ usuario: publicoUsuario(usuario, cfg), demo: cfg.demo }) },
  { metodo: 'POST', caminho: '/api/sessao/entrar', publica: true,
    handler: async ({ corpo, db, cfg }) => {
      const d = validar(corpo, { email: { obrigatorio: true, tipo: 'texto', max: 200 }, senha: { obrigatorio: true, tipo: 'texto', max: 200 } });
      const u = await s.autenticar(db, d.email, d.senha);
      const { token, maxAge } = await s.criarSessao(db, u);
      return com(200, { usuario: publicoUsuario(u, cfg) }, { 'Set-Cookie': cookieSessao(token, maxAge, cfg.producao) });
    } },
  { metodo: 'POST', caminho: '/api/sessao/demo', publica: true,
    handler: async ({ corpo, db, cfg }) => {
      if (!cfg.demo) throw erro.semPermissao('entrar sem senha neste ambiente');
      const d = validar(corpo, { usuarioId: { obrigatorio: true, tipo: 'uuid' } });
      const u = await s.usuarioDemo(db, d.usuarioId);
      const { token, maxAge } = await s.criarSessao(db, u);
      return com(200, { usuario: publicoUsuario(u, cfg) }, { 'Set-Cookie': cookieSessao(token, maxAge, cfg.producao) });
    } },
  { metodo: 'POST', caminho: '/api/sessao/sair', publica: true,
    handler: async ({ db, token }) => { await s.encerrarSessao(db, token); return com(200, { ok: true }, { 'Set-Cookie': cookieApagado() }); } },
  { metodo: 'GET', caminho: '/api/demo/personas', publica: true,
    handler: async ({ db, cfg }) => (cfg.demo ? { personas: (await s.personas(db)).map((p) => ({ ...p, papelNome: NOMES_PAPEIS[p.papel] })) } : { personas: [] }) },
  { metodo: 'GET', caminho: '/api/equipes', permissao: 'ocorrencia.ver',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, async (c) => ({ equipes: await s.equipes(c), usuarios: await s.usuarios(c) })) },
];
