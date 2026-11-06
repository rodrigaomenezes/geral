'use strict';
// Identidade: senha (scrypt), sessões (token aleatório; no banco só o hash), personas da demonstração e
// resolução de responsável com substituto (GOV-003, AT-003).

const crypto = require('node:crypto');
const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');

const SESSAO_HORAS = 12;
// R-19: sessão parada por mais que isto deixa de valer (o uso renova; a gravação do uso é no máximo a cada 5 min).
const INATIVIDADE_MIN = Number(process.env.SINAPSE_SESSAO_INATIVIDADE_MIN || 120);
const totp = require('../../nucleo/totp');
const { cifrar, decifrar } = require('../../nucleo/cifra');
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
  e.codigo AS equipe_codigo, e.nome AS equipe_nome, t.slug AS tenant_slug, t.nome AS tenant_nome, t.demonstracao, t.config -> 'marca' AS marca,
  u.mfa_ativo`;

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

async function criarSessao(db, usuario, { mfaPendente = false } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.sistema((c) => c.query(
    `INSERT INTO sessoes (token_hash, tenant_id, usuario_id, expira_em, mfa_pendente) VALUES ($1, $2, $3, now() + interval '${SESSAO_HORAS} hours', $4)`,
    [sha256(token), usuario.tenant_id, usuario.id, mfaPendente],
  ));
  return { token, maxAge: SESSAO_HORAS * 3600 };
}

async function sessaoPorToken(db, token) {
  if (!token || token.length > 100) return null;
  const r = await db.sistema((c) => c.query(
    `SELECT ${COLUNAS_USUARIO} FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id JOIN equipes e ON e.id = u.equipe_id
     JOIN tenants t ON t.id = u.tenant_id
     WHERE s.token_hash = $1 AND s.expira_em > now() AND NOT s.mfa_pendente AND s.ultimo_uso_em > now() - $2::int * interval '1 minute'
       AND u.ativo AND t.status = 'ativo'`, [sha256(token), INATIVIDADE_MIN],
  ));
  const u = r.rows[0] || null;
  if (u) await db.query("UPDATE sessoes SET ultimo_uso_em = now() WHERE token_hash = $1 AND ultimo_uso_em < now() - interval '5 minutes'", [sha256(token)]);
  return u;
}

// ---------- Verificação em duas etapas (MFA) ----------
const segredoDe = async (db, usuarioId) => (await db.sistema((c) => c.query('SELECT mfa_segredo_cifrado, mfa_ativo, mfa_ultimo_passo FROM usuarios WHERE id = $1', [usuarioId]))).rows[0];

/** Confere o código e grava o passo usado; código já usado (mesmo passo ou anterior) é recusado. */
async function usarCodigo(db, usuarioId, s, informado) {
  const passo = totp.passoAceito(decifrar(s.mfa_segredo_cifrado), informado);
  if (passo === false || (s.mfa_ultimo_passo !== null && s.mfa_ultimo_passo !== undefined && passo <= Number(s.mfa_ultimo_passo))) return false;
  const r = await db.query('UPDATE usuarios SET mfa_ultimo_passo = $2 WHERE id = $1 AND (mfa_ultimo_passo IS NULL OR mfa_ultimo_passo < $2)', [usuarioId, passo]);
  return r.rowCount === 1; // duas abas usando o mesmo código ao mesmo tempo: só uma vale
}

/** Sessão aberta com senha, esperando o código. Devolve o usuário ou null. */
async function sessaoPendente(db, token) {
  if (!token || token.length > 100) return null;
  const r = await db.sistema((c) => c.query(
    `SELECT ${COLUNAS_USUARIO} FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id JOIN equipes e ON e.id = u.equipe_id JOIN tenants t ON t.id = u.tenant_id
     WHERE s.token_hash = $1 AND s.mfa_pendente AND s.criada_em > now() - interval '10 minutes' AND u.ativo`, [sha256(token)]));
  return r.rows[0] || null;
}

/** Confere o código da sessão pendente; certo, a sessão passa a valer. */
async function confirmarMfaDaSessao(db, token, codigoInformado) {
  const u = await sessaoPendente(db, token);
  if (!u) throw erro.naoAutenticado();
  const s = await segredoDe(db, u.id);
  if (!s?.mfa_ativo || !(await usarCodigo(db, u.id, s, codigoInformado))) {
    throw erro.regra('codigo_invalido', 'Código inválido. Confira no aplicativo autenticador (ele muda a cada 30 segundos).');
  }
  await db.query('UPDATE sessoes SET mfa_pendente = false, ultimo_uso_em = now() WHERE token_hash = $1', [sha256(token)]);
  return u;
}

/** Começa a ativação: gera e guarda o segredo (cifrado), ainda inativo; devolve o endereço para o QR Code. */
async function iniciarMfa(db, usuario) {
  const atual = await segredoDe(db, usuario.id);
  if (atual?.mfa_ativo) throw erro.conflito('A verificação em duas etapas já está ativa. Para trocar o aparelho, desative primeiro.');
  const segredo = totp.gerarSegredo();
  await db.sistema((c) => c.query('UPDATE usuarios SET mfa_segredo_cifrado = $2 WHERE id = $1', [usuario.id, cifrar(segredo)]));
  return { segredo, uri: totp.uri('Sinapse Brobot', usuario.email, segredo) };
}

async function confirmarMfa(db, usuario, codigoInformado) {
  const s = await segredoDe(db, usuario.id);
  if (!s?.mfa_segredo_cifrado) throw erro.regra('mfa_nao_iniciado', 'Comece a ativação para gerar o QR Code.');
  if (s.mfa_ativo) throw erro.conflito('A verificação em duas etapas já está ativa.');
  if (!(await usarCodigo(db, usuario.id, s, codigoInformado))) throw erro.regra('codigo_invalido', 'Código inválido. Confira no aplicativo e tente de novo.');
  await db.sistema((c) => c.query('UPDATE usuarios SET mfa_ativo = true, mfa_ativado_em = now() WHERE id = $1', [usuario.id]));
  return { ativo: true };
}

/** Desativa com um código válido (a própria pessoa) ou por redefinição da Administração (aparelho perdido). */
async function desativarMfa(db, usuarioId, { codigo: codigoInformado, redefinicao = false } = {}) {
  const s = await segredoDe(db, usuarioId);
  if (!s?.mfa_ativo) throw erro.conflito('A verificação em duas etapas não está ativa.');
  if (!redefinicao && !(await usarCodigo(db, usuarioId, s, codigoInformado))) throw erro.regra('codigo_invalido', 'Código inválido.');
  await db.sistema(async (c) => {
    await c.query('UPDATE usuarios SET mfa_ativo = false, mfa_segredo_cifrado = NULL, mfa_ativado_em = NULL, mfa_ultimo_passo = NULL WHERE id = $1', [usuarioId]);
    await c.query('DELETE FROM sessoes WHERE usuario_id = $1', [usuarioId]); // quem estava logado entra de novo
  });
  return { ativo: false };
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
  sessaoPendente, confirmarMfaDaSessao, iniciarMfa, confirmarMfa, desativarMfa,
  resolverResponsavel, equipes, equipePorCodigo, usuarios,
};
