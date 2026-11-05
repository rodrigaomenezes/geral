'use strict';
// Pessoas do Comercial (CRM-001): a mesma pessoa (pelo telefone ou e-mail) não é cadastrada duas vezes na organização;
// cada oportunidade liga as pessoas com o papel que elas têm na decisão. Dado já cadastrado não é sobrescrito em
// silêncio: só se completa o que estava vazio (a troca fica para a edição explícita).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar } = require('../../nucleo/registro');
const { normalizarTelefone } = require('../../nucleo/telefone');

const PAPEIS = { decisor: 'Decisor', influenciador: 'Influenciador', usuario: 'Usuário', financeiro: 'Financeiro', tecnico: 'Técnico', outro: 'Outro' };

function normalizarPessoa(d) {
  const telefone = d.telefone ? normalizarTelefone(d.telefone) : null;
  if (d.telefone && !telefone) throw erro.entrada('Telefone inválido. Use DDD + número.', [{ campo: 'telefone', problema: 'inválido' }]);
  const email = d.email ? String(d.email).trim().toLowerCase() : null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro.entrada('E-mail inválido.', [{ campo: 'email', problema: 'inválido' }]);
  if (!telefone && !email) throw erro.entrada('Informe telefone ou e-mail da pessoa.', [{ campo: 'telefone', problema: 'obrigatório' }]);
  return { nome: String(d.nome || '').trim(), cargo: d.cargo ? String(d.cargo).trim() : null, telefone, email };
}

/** Acha a pessoa pelo telefone ou e-mail; senão cria. Devolve { pessoa, nova }. */
async function garantirPessoa(c, ctx, d) {
  const p = normalizarPessoa(d);
  if (p.nome.length < 2) throw erro.entrada('Informe o nome da pessoa.', [{ campo: 'nome', problema: 'obrigatório' }]);
  const achadas = (await c.query('SELECT * FROM contatos_comerciais WHERE ($1::text IS NOT NULL AND telefone = $1) OR ($2::text IS NOT NULL AND lower(email) = $2)',
    [p.telefone, p.email])).rows;
  if (achadas.length > 1) throw erro.conflito('Telefone e e-mail informados pertencem a pessoas diferentes já cadastradas. Confira os dados.');
  if (achadas.length) {
    const a = achadas[0];
    const r = uma(await c.query(`UPDATE contatos_comerciais SET cargo = coalesce(cargo, $2), telefone = coalesce(telefone, $3), email = coalesce(email, $4),
      atualizado_em = now() WHERE id = $1 RETURNING *`, [a.id, p.cargo, p.telefone, p.email]));
    return { pessoa: r, nova: false };
  }
  const r = uma(await c.query('INSERT INTO contatos_comerciais (tenant_id, nome, cargo, telefone, email) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [ctx.tenantId, p.nome, p.cargo, p.telefone, p.email]));
  return { pessoa: r, nova: true };
}

async function vincular(c, ctx, oportunidadeId, d) {
  if (!PAPEIS[d.papel]) throw erro.entrada('Papel desconhecido.');
  const { pessoa, nova } = await garantirPessoa(c, ctx, d);
  await c.query(`INSERT INTO oportunidade_contatos (tenant_id, oportunidade_id, contato_id, papel) VALUES ($1,$2,$3,$4)
    ON CONFLICT (tenant_id, oportunidade_id, contato_id) DO UPDATE SET papel = EXCLUDED.papel`, [ctx.tenantId, oportunidadeId, pessoa.id, d.papel]);
  await auditar(c, ctx, { acao: 'oportunidade.pessoa_vinculada', entidade: 'oportunidade', entidadeId: oportunidadeId, depois: { pessoa: pessoa.nome, papel: d.papel, nova } });
  return { ...pessoa, papel: d.papel, nova };
}

async function desvincular(c, ctx, oportunidadeId, contatoId) {
  const r = await c.query('DELETE FROM oportunidade_contatos WHERE oportunidade_id = $1 AND contato_id = $2', [oportunidadeId, contatoId]);
  if (!r.rowCount) throw erro.naoEncontrado('Vínculo');
  await auditar(c, ctx, { acao: 'oportunidade.pessoa_desvinculada', entidade: 'oportunidade', entidadeId: oportunidadeId, depois: { contatoId } });
  return { ok: true };
}

const listar = async (c, oportunidadeId) => (await c.query(`SELECT p.id, p.nome, p.cargo, p.telefone, p.email, v.papel,
    (SELECT count(*)::int FROM oportunidade_contatos x WHERE x.contato_id = p.id) AS oportunidades
  FROM oportunidade_contatos v JOIN contatos_comerciais p ON p.id = v.contato_id WHERE v.oportunidade_id = $1 ORDER BY v.papel, p.nome`, [oportunidadeId])).rows;

module.exports = { vincular, desvincular, listar, garantirPessoa, PAPEIS };
