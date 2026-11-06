'use strict';
// Cadastro de pessoas e equipes pela Administração (GOV-001) e troca da própria senha. Ninguém é apagado: sair da
// empresa = desativar (as sessões caem e o que estava com a pessoa volta à fila pelo supervisor). A organização nunca
// fica sem uma Administração ativa. Senha temporária: gerada aqui, mostrada uma vez a quem cadastrou, troca obrigatória.

const crypto = require('node:crypto');
const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { PAPEIS } = require('./permissoes');
const { hashSenha, conferirSenha } = require('./servico');

const POR_PAGINA = 50;
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 16 caracteres sem os que confundem (0/O, 1/l/I). */
const senhaTemporaria = () => Array.from(crypto.randomBytes(16), (b) => ALFABETO[b % ALFABETO.length]).join('');
const emailValido = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

function validarSenhaNova(nova, email) {
  if (typeof nova !== 'string' || nova.length < 12) throw erro.entrada('A senha precisa ter pelo menos 12 caracteres.');
  if (nova.length > 200) throw erro.entrada('A senha pode ter no máximo 200 caracteres.');
  const usuario = email ? String(email).split('@')[0].toLowerCase() : '';
  if (usuario.length >= 3 && nova.toLowerCase().includes(usuario)) throw erro.entrada('A senha não pode conter o seu e-mail.');
  if (/^(.)\1+$/.test(nova)) throw erro.entrada('Escolha uma senha menos previsível.');
}

async function listar(c, { pagina = 1, q = '', inativos = false } = {}) {
  const p = Math.max(1, Number(pagina) || 1);
  const filtro = `%${String(q).trim().toLowerCase()}%`;
  const r = await c.query(`SELECT u.id, u.nome, u.email, u.papel, u.equipe_id, e.nome AS equipe_nome, u.disponivel, u.ativo, u.substituto_id,
      s.nome AS substituto_nome, u.mfa_ativo, u.senha_trocar, count(*) OVER () AS total
    FROM usuarios u JOIN equipes e ON e.id = u.equipe_id LEFT JOIN usuarios s ON s.id = u.substituto_id
    WHERE ($1 OR u.ativo) AND (lower(u.nome) LIKE $2 OR lower(u.email) LIKE $2)
    ORDER BY u.ativo DESC, u.nome LIMIT ${POR_PAGINA} OFFSET $3`, [!!inativos, filtro, (p - 1) * POR_PAGINA]);
  const total = r.rows[0] ? Number(r.rows[0].total) : 0;
  return { itens: r.rows.map(({ total: _t, ...x }) => x), pagina: p, paginas: Math.max(1, Math.ceil(total / POR_PAGINA)), total };
}

async function equipeExiste(c, id) {
  const e = uma(await c.query('SELECT id, nome FROM equipes WHERE id = $1', [id]));
  if (!e) throw erro.naoEncontrado('Equipe');
  return e;
}

async function criar(c, ctx, d) {
  const email = d.email.trim().toLowerCase();
  if (!emailValido(email)) throw erro.entrada('E-mail inválido.');
  if (!PAPEIS[d.papel]) throw erro.entrada('Perfil desconhecido.');
  await equipeExiste(c, d.equipeId);
  if (uma(await c.query('SELECT 1 FROM usuarios WHERE lower(email) = $1', [email]))) {
    throw erro.conflito('Já existe uma pessoa com esse e-mail. Reative-a em vez de cadastrar de novo.');
  }
  const senha = senhaTemporaria();
  const u = uma(await c.query(`INSERT INTO usuarios (tenant_id, nome, email, senha_hash, papel, equipe_id, senha_trocar)
    VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id, nome, email, papel, equipe_id`, [ctx.tenantId, d.nome, email, hashSenha(senha), d.papel, d.equipeId]));
  await auditar(c, ctx, { acao: 'usuario.criado', entidade: 'usuario', entidadeId: u.id, depois: { nome: u.nome, papel: u.papel, equipeId: u.equipe_id } });
  await publicar(c, ctx, { tipo: 'usuario.criado', agregado: 'usuario', agregadoId: u.id, payload: { papel: u.papel } });
  return { usuario: u, senhaTemporaria: senha };
}

async function pessoa(c, id) {
  const u = uma(await c.query('SELECT * FROM usuarios WHERE id = $1 FOR UPDATE', [id]));
  if (!u) throw erro.naoEncontrado('Pessoa');
  return u;
}

/** Guarda: depois da mudança ainda há ao menos uma Administração ativa. */
async function garantirAdministracao(c, excetoId) {
  const n = uma(await c.query("SELECT count(*)::int AS n FROM usuarios WHERE papel = 'admin' AND ativo AND id <> $1", [excetoId])).n;
  if (!n) throw erro.regra('ultima_administracao', 'A organização ficaria sem Administração. Dê o perfil a outra pessoa antes.');
}

async function alterar(c, ctx, id, d) {
  const u = await pessoa(c, id);
  const muda = {};
  if (d.nome !== undefined && d.nome !== u.nome) muda.nome = d.nome;
  if (d.papel !== undefined && d.papel !== u.papel) {
    if (!PAPEIS[d.papel]) throw erro.entrada('Perfil desconhecido.');
    if (u.papel === 'admin') await garantirAdministracao(c, u.id);
    muda.papel = d.papel;
  }
  if (d.equipeId !== undefined && d.equipeId !== u.equipe_id) { await equipeExiste(c, d.equipeId); muda.equipe_id = d.equipeId; }
  if (d.substitutoId !== undefined && (d.substitutoId || null) !== u.substituto_id) {
    if (d.substitutoId === u.id) throw erro.entrada('A pessoa não pode ser a própria substituta.');
    if (d.substitutoId && !uma(await c.query('SELECT 1 FROM usuarios WHERE id = $1 AND ativo', [d.substitutoId]))) throw erro.naoEncontrado('Substituto');
    muda.substituto_id = d.substitutoId || null;
  }
  if (d.disponivel !== undefined && d.disponivel !== u.disponivel) muda.disponivel = d.disponivel;
  if (!Object.keys(muda).length) return { alterado: false, campos: [] };
  const cols = Object.keys(muda);
  await c.query(`UPDATE usuarios SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((k) => muda[k])]);
  await auditar(c, ctx, { acao: 'usuario.alterado', entidade: 'usuario', entidadeId: id, motivo: d.motivo,
    antes: Object.fromEntries(cols.map((k) => [k, u[k]])), depois: muda });
  await publicar(c, ctx, { tipo: 'usuario.alterado', agregado: 'usuario', agregadoId: id, payload: { campos: cols } });
  return { alterado: true, campos: cols };
}

async function definirAtivo(c, ctx, id, ativo, motivo) {
  const u = await pessoa(c, id);
  if (u.id === ctx.usuario.id && !ativo) throw erro.regra('desativar_propria', 'Peça a outra pessoa da Administração para desativar a sua conta.');
  if (u.ativo === ativo) throw erro.conflito(ativo ? 'Essa pessoa já está ativa.' : 'Essa pessoa já está desativada.');
  if (!ativo && u.papel === 'admin') await garantirAdministracao(c, u.id);
  // Desativar também marca indisponível: o supervisor devolve à fila (ou ao substituto) o que estava com ela.
  await c.query('UPDATE usuarios SET ativo = $2, disponivel = $2 WHERE id = $1', [id, ativo]);
  if (!ativo) await c.query('UPDATE usuarios SET substituto_id = NULL WHERE substituto_id = $1', [id]);
  await auditar(c, ctx, { acao: ativo ? 'usuario.reativado' : 'usuario.desativado', entidade: 'usuario', entidadeId: id, motivo });
  await publicar(c, ctx, { tipo: ativo ? 'usuario.reativado' : 'usuario.desativado', agregado: 'usuario', agregadoId: id, payload: {} });
  return { ativo };
}

async function redefinirSenha(c, ctx, id, motivo) {
  const u = await pessoa(c, id);
  if (u.id === ctx.usuario.id) throw erro.regra('redefinicao_propria', 'Para a sua senha, use "Trocar senha" no seu nome, no topo.');
  if (!u.ativo) throw erro.regra('pessoa_inativa', 'Reative a pessoa antes de redefinir a senha.');
  const senha = senhaTemporaria();
  await c.query('UPDATE usuarios SET senha_hash = $2, senha_trocar = true WHERE id = $1', [id, hashSenha(senha)]);
  await auditar(c, ctx, { acao: 'usuario.senha_redefinida', entidade: 'usuario', entidadeId: id, motivo });
  return { senhaTemporaria: senha };
}

/** A própria pessoa troca a senha (obrigatório depois de uma temporária). */
async function trocarPropria(c, ctx, { atual, nova }) {
  const u = await pessoa(c, ctx.usuario.id);
  if (!conferirSenha(atual, u.senha_hash)) throw erro.regra('senha_atual_invalida', 'A senha atual não confere.');
  validarSenhaNova(nova, u.email);
  if (conferirSenha(nova, u.senha_hash)) throw erro.entrada('A nova senha precisa ser diferente da atual.');
  await c.query('UPDATE usuarios SET senha_hash = $2, senha_trocar = false, senha_alterada_em = now() WHERE id = $1', [u.id, hashSenha(nova)]);
  await auditar(c, ctx, { acao: 'usuario.senha_trocada', entidade: 'usuario', entidadeId: u.id });
  return { ok: true };
}

async function minhaDisponibilidade(c, ctx, disponivel) {
  await c.query('UPDATE usuarios SET disponivel = $2 WHERE id = $1', [ctx.usuario.id, disponivel]);
  await auditar(c, ctx, { acao: disponivel ? 'usuario.disponivel' : 'usuario.ausente', entidade: 'usuario', entidadeId: ctx.usuario.id });
  await publicar(c, ctx, { tipo: 'usuario.disponibilidade', agregado: 'usuario', agregadoId: ctx.usuario.id, payload: { disponivel } });
  return { disponivel };
}

async function criarEquipe(c, ctx, { codigo, nome }) {
  if (!/^[a-z_]{2,30}$/.test(codigo)) throw erro.entrada('Código da equipe: só letras minúsculas e "_", de 2 a 30.');
  const e = uma(await c.query('INSERT INTO equipes (tenant_id, codigo, nome) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *', [ctx.tenantId, codigo, nome]));
  if (!e) throw erro.conflito('Já existe uma equipe com esse código.');
  await auditar(c, ctx, { acao: 'equipe.criada', entidade: 'equipe', entidadeId: e.id, depois: { codigo, nome } });
  return e;
}

async function renomearEquipe(c, ctx, id, nome) {
  const antes = uma(await c.query('SELECT nome FROM equipes WHERE id = $1', [id]));
  if (!antes) throw erro.naoEncontrado('Equipe');
  const e = uma(await c.query('UPDATE equipes SET nome = $2 WHERE id = $1 RETURNING *', [id, nome]));
  await auditar(c, ctx, { acao: 'equipe.renomeada', entidade: 'equipe', entidadeId: id, antes, depois: { nome } });
  return e;
}

module.exports = {
  listar, criar, alterar, definirAtivo, redefinirSenha, trocarPropria, minhaDisponibilidade, criarEquipe, renomearEquipe,
  senhaTemporaria, validarSenhaNova,
};
