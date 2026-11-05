'use strict';
// Identidade: senha (scrypt), sessões (token aleatório; no banco só o hash), personas da demonstração e
// resolução de responsável com substituto (GOV-003, AT-003).

const crypto = require('node:crypto');
const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');

const SESSAO_HORAS = 12;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, sal, 32);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}

function conferirSenha(senha, guardado) {
  if (!guardado || !guardado.startsWith('scrypt$')) return false;
  const [, salHex, hHex] = guardado.split('$');
  const h = crypto.scryptSync(String(senha), Buffer.from(salHex, 'hex'), 32);
  return crypto.timingSafeEqual(h, Buffer.from(hHex, 'hex'));
}

const COLUNAS_USUARIO = `u.id, u.tenant_id, u.nome, u.email, u.papel, u.equipe_id, u.disponivel, u.substituto_id,
  e.codigo AS equipe_codigo, e.nome AS equipe_nome, t.slug AS tenant_slug, t.nome AS tenant_nome, t.demonstracao, t.config -> 'marca' AS marca`;

async function autenticar(db, email, senha) {
  const r = await db.sistema((c) => c.query(
    `SELECT ${COLUNAS_USUARIO}, u.senha_hash FROM usuarios u JOIN equipes e ON e.id = u.equipe_id
     JOIN tenants t ON t.id = u.tenant_id WHERE lower(u.email) = lower($1) AND u.ativo AND t.status = 'ativo'`,
    [email],
  ));
  const u = r.rows.find((x) => conferirSenha(senha, x.senha_hash));
  if (!u) throw erro.regra('credenciais_invalidas', 'E-mail ou senha não conferem. Confira e tente de novo.');
  delete u.senha_hash;
  return u;
}

async function usuarioDemo(db, usuarioId) {
  const r = await db.sistema((c) => c.query(
    `SELECT ${COLUNAS_USUARIO} FROM usuarios u JOIN equipes e ON e.id = u.equipe_id JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1 AND u.ativo AND t.demonstracao`, [usuarioId],
  ));
  if (!r.rows[0]) throw erro.naoEncontrado('Usuário de demonstração');
  return r.rows[0];
}

async function personas(db) {
  return (await db.sistema((c) => c.query(
    `SELECT u.id, u.nome, u.papel, e.nome AS equipe_nome, t.nome AS tenant_nome, t.slug AS tenant_slug
     FROM usuarios u JOIN equipes e ON e.id = u.equipe_id JOIN tenants t ON t.id = u.tenant_id
     WHERE t.demonstracao AND u.ativo
     ORDER BY t.criado_em, array_position(ARRAY['supervisor','suporte','cs','operacoes','dev','financeiro','admin'], u.papel), u.nome`,
  ))).rows;
}

async function criarSessao(db, usuario) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.sistema((c) => c.query(
    `INSERT INTO sessoes (token_hash, tenant_id, usuario_id, expira_em) VALUES ($1, $2, $3, now() + interval '${SESSAO_HORAS} hours')`,
    [sha256(token), usuario.tenant_id, usuario.id],
  ));
  return { token, maxAge: SESSAO_HORAS * 3600 };
}

async function sessaoPorToken(db, token) {
  if (!token || token.length > 100) return null;
  const r = await db.sistema((c) => c.query(
    `SELECT ${COLUNAS_USUARIO} FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id JOIN equipes e ON e.id = u.equipe_id
     JOIN tenants t ON t.id = u.tenant_id
     WHERE s.token_hash = $1 AND s.expira_em > now() AND u.ativo AND t.status = 'ativo'`, [sha256(token)],
  ));
  return r.rows[0] || null;
}

async function encerrarSessao(db, token) {
  if (token) await db.sistema((c) => c.query('DELETE FROM sessoes WHERE token_hash = $1', [sha256(token)]));
}

/**
 * Responsável efetivo (AT-003): se a pessoa está indisponível, vai para o substituto disponível;
 * sem substituto, devolve null e a ocorrência fica na fila da equipe (nunca sem dono).
 */
async function resolverResponsavel(c, usuarioId) {
  if (!usuarioId) return null;
  const u = uma(await c.query(
    `SELECT u.id, u.disponivel, s.id AS sub_id, s.disponivel AS sub_disponivel
     FROM usuarios u LEFT JOIN usuarios s ON s.id = u.substituto_id WHERE u.id = $1 AND u.ativo`, [usuarioId],
  ));
  if (!u) return null;
  if (u.disponivel) return u.id;
  return u.sub_id && u.sub_disponivel ? u.sub_id : null;
}

async function equipes(c) {
  return (await c.query('SELECT id, codigo, nome, contingencia FROM equipes ORDER BY nome')).rows;
}

async function equipePorCodigo(c, codigo) {
  return uma(await c.query('SELECT id, codigo, nome FROM equipes WHERE codigo = $1', [codigo]));
}

async function usuarios(c) {
  return (await c.query(
    `SELECT u.id, u.nome, u.papel, u.disponivel, u.equipe_id, e.nome AS equipe_nome, s.nome AS substituto_nome
     FROM usuarios u JOIN equipes e ON e.id = u.equipe_id LEFT JOIN usuarios s ON s.id = u.substituto_id
     WHERE u.ativo ORDER BY e.nome, u.nome`,
  )).rows;
}

module.exports = {
  hashSenha, conferirSenha, autenticar, usuarioDemo, personas, criarSessao, sessaoPorToken, encerrarSessao,
  resolverResponsavel, equipes, equipePorCodigo, usuarios,
};
