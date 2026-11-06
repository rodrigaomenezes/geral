'use strict';
const { com, cookieSessao, cookieApagado } = require('../../http/servidor');
const { validar, erro, ErroNegocio } = require('../../nucleo/erros');
const { permissoesDe, NOMES_PAPEIS } = require('./permissoes');
const supervisor = require('../supervisor/servico');
const s = require('./servico');

const publicoUsuario = (u, cfg) => u && ({
  id: u.id, nome: u.nome, papel: u.papel, papelNome: NOMES_PAPEIS[u.papel], equipe: u.equipe_nome, equipeCodigo: u.equipe_codigo,
  organizacao: u.tenant_nome, permissoes: permissoesDe(u.papel), demo: cfg.demo && u.demonstracao, marca: marcaSegura(u.marca),
  mfaAtivo: !!u.mfa_ativo, mfaObrigatorio: !!cfg.mfaObrigatorio && ['admin', 'supervisor'].includes(u.papel),
});

/** Marca da organização (white-label): só cores hex, nome curto e logo servido pelo próprio sistema. */
function marcaSegura(m) {
  if (!m || typeof m !== 'object') return null;
  const cor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
  return { nome: typeof m.nome === 'string' ? m.nome.slice(0, 40) : undefined, corPrimaria: cor(m.corPrimaria), corDestaque: cor(m.corDestaque),
    logo: typeof m.logo === 'string' && /^\/marca\/[\w.-]+$/.test(m.logo) ? m.logo : undefined };
}

const crypto = require('node:crypto');
const { criarLimitador } = require('./limitador');
// 5 erros por e-mail ou 30 por endereço em 15 min → espera o fim da janela.
const porEmail = criarLimitador({ limite: 5, janelaMs: 15 * 60e3 });
const porIp = criarLimitador({ limite: 30, janelaMs: 15 * 60e3 });
// Código do autenticador: 5 erros por sessão pendente em 10 min (a sessão pendente vale 10 min).
const porMfa = criarLimitador({ limite: 5, janelaMs: 10 * 60e3 });
const { auditar } = require('../../nucleo/registro');
const ipDe = (req) => req.socket.remoteAddress || 'desconhecido';
const resumo = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12); // log sem o e-mail

module.exports = [
  { metodo: 'GET', caminho: '/api/health', publica: true,
    handler: async ({ db }) => { await db.query('SELECT 1'); return { ok: true, banco: db.motor }; } },
  { metodo: 'GET', caminho: '/api/health/supervisor', publica: true,
    handler: async ({ db }) => { const h = await supervisor.saudeSupervisor(db); return h.ok ? h : com(503, h); } },
  { metodo: 'GET', caminho: '/api/sessao', publica: true,
    handler: async ({ usuario, cfg }) => ({ usuario: publicoUsuario(usuario, cfg), demo: cfg.demo }) },
  { metodo: 'POST', caminho: '/api/sessao/entrar', publica: true,
    handler: async ({ req, corpo, db, cfg, deps }) => {
      const d = validar(corpo, { email: { obrigatorio: true, tipo: 'texto', max: 200 }, senha: { obrigatorio: true, tipo: 'texto', max: 200 } });
      const kEmail = String(d.email).trim().toLowerCase(); const kIp = ipDe(req);
      const espera = porEmail.bloqueado(kEmail) || porIp.bloqueado(kIp);
      if (espera) throw new ErroNegocio(429, 'muitas_tentativas', `Muitas tentativas de entrar. Aguarde ${Math.ceil(espera / 60)} min e tente de novo, ou peça à Administração para redefinir a senha.`, { esperarSegundos: espera });
      let u;
      try { u = await s.autenticar(db, d.email, d.senha); } catch (e) {
        porEmail.falhou(kEmail); porIp.falhou(kIp);
        if (porEmail.bloqueado(kEmail)) (deps.log || console.log)(JSON.stringify({ t: new Date().toISOString(), aviso: 'login_bloqueado', email: resumo(kEmail) }));
        throw e;
      }
      porEmail.acertou(kEmail);
      // Com MFA ativo, a sessão nasce pendente: só vale depois do código do aplicativo (POST /api/sessao/mfa).
      const { token, maxAge } = await s.criarSessao(db, u, { mfaPendente: !!u.mfa_ativo });
      if (u.mfa_ativo) return com(200, { mfaNecessario: true }, { 'Set-Cookie': cookieSessao(token, maxAge, cfg.producao) });
      return com(200, { usuario: publicoUsuario(u, cfg) }, { 'Set-Cookie': cookieSessao(token, maxAge, cfg.producao) });
    } },
  { metodo: 'POST', caminho: '/api/sessao/mfa', publica: true,
    handler: async ({ corpo, db, cfg, token }) => {
      const d = validar(corpo, { codigo: { obrigatorio: true, tipo: 'texto', max: 10 } });
      const chave = resumo(String(token || 'sem-token'));
      const espera = porMfa.bloqueado(chave);
      if (espera) throw new ErroNegocio(429, 'muitas_tentativas', `Muitos códigos errados. Aguarde ${Math.ceil(espera / 60)} min e entre de novo com a senha.`);
      let u;
      try { u = await s.confirmarMfaDaSessao(db, token, d.codigo); } catch (e) { porMfa.falhou(chave); throw e; }
      porMfa.acertou(chave);
      return { usuario: publicoUsuario(u, cfg) };
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
  { metodo: 'POST', caminho: '/api/mfa/iniciar',
    handler: async ({ db, usuario }) => {
      const r = await s.iniciarMfa(db, usuario);
      const qr = await require('qrcode').toDataURL(r.uri, { margin: 1, width: 240 });
      return { qr, segredo: r.segredo };
    } },
  { metodo: 'POST', caminho: '/api/mfa/confirmar',
    handler: async ({ db, ctx, usuario, corpo }) => {
      const d = validar(corpo, { codigo: { obrigatorio: true, tipo: 'texto', max: 10 } });
      const r = await s.confirmarMfa(db, usuario, d.codigo);
      await db.comoTenant(ctx.tenantId, (c) => auditar(c, ctx, { acao: 'usuario.mfa_ativado', entidade: 'usuario', entidadeId: usuario.id }));
      return r;
    } },
  { metodo: 'POST', caminho: '/api/mfa/desativar',
    handler: async ({ db, ctx, usuario, corpo }) => {
      const d = validar(corpo, { codigo: { obrigatorio: true, tipo: 'texto', max: 10 } });
      const r = await s.desativarMfa(db, usuario.id, { codigo: d.codigo });
      await db.comoTenant(ctx.tenantId, (c) => auditar(c, ctx, { acao: 'usuario.mfa_desativado', entidade: 'usuario', entidadeId: usuario.id }));
      return r;
    } },
  { metodo: 'POST', caminho: '/api/usuarios/:id/mfa/redefinir', descricao: 'redefinir a verificação em duas etapas',
    handler: async ({ db, ctx, usuario, params, corpo }) => {
      // Aparelho perdido: só a Administração redefine, nunca a própria, sempre com motivo (auditado).
      if (usuario.papel !== 'admin') throw erro.semPermissao('redefinir a verificação em duas etapas de outra pessoa');
      if (params.id === usuario.id) throw erro.regra('redefinicao_propria', 'Peça a outra pessoa da Administração para redefinir a sua.');
      const d = validar(corpo, { motivo: { obrigatorio: true, tipo: 'texto', min: 5, max: 300 } });
      const alvo = await db.comoTenant(ctx.tenantId, async (c) => (await c.query('SELECT id FROM usuarios WHERE id = $1', [params.id])).rows[0]);
      if (!alvo) throw erro.naoEncontrado('Usuário');
      const r = await s.desativarMfa(db, params.id, { redefinicao: true });
      await db.comoTenant(ctx.tenantId, (c) => auditar(c, ctx, { acao: 'usuario.mfa_redefinido', entidade: 'usuario', entidadeId: params.id, motivo: d.motivo }));
      return r;
    } },
];
