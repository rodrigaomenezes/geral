'use strict';
// LGPD (SUP-008, RNF-006): pedido do titular (pessoa de contato de um cliente ou lead). Localizar por telefone ou
// e-mail, exportar o que o Sinapse guarda sobre ela e anonimizar quando o pedido for de eliminação. A anonimização
// troca nome, telefone e e-mail por marcadores e encerra o papel de contato; o registro operacional (que a mensagem
// existiu, quando, para qual conta) fica, sem o dado pessoal. A auditoria guarda só o resumo (hash) do identificador.

const crypto = require('node:crypto');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { normalizarTelefone } = require('../../nucleo/telefone');

const ANON = 'Titular anonimizado';
const resumo = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

function identificador({ telefone, email }) {
  const tel = telefone ? normalizarTelefone(telefone) : null;
  if (telefone && !tel) throw erro.entrada('Telefone inválido. Use DDD + número.');
  const mail = email ? String(email).trim().toLowerCase() : null;
  if (!tel && !mail) throw erro.entrada('Informe o telefone ou o e-mail do titular.');
  return { tel, mail };
}

async function localizar(c, filtro) {
  const { tel, mail } = identificador(filtro);
  const p = [tel, mail];
  const pontosFocais = (await c.query(`SELECT pf.id, pf.nome, pf.telefone, pf.email, pf.papel, pf.vigente, pf.consentimento_whatsapp, pf.opt_out, pf.criado_em, ct.nome AS conta
    FROM pontos_focais pf JOIN contas ct ON ct.id = pf.conta_id WHERE ($1::text IS NOT NULL AND pf.telefone = $1) OR ($2::text IS NOT NULL AND lower(pf.email) = $2)`, p)).rows;
  const pessoas = (await c.query(`SELECT id, nome, cargo, telefone, email, criado_em FROM contatos_comerciais
    WHERE ($1::text IS NOT NULL AND telefone = $1) OR ($2::text IS NOT NULL AND lower(email) = $2)`, p)).rows;
  const oportunidades = (await c.query(`SELECT id, codigo, empresa, contato_nome, contato_telefone, contato_email, etapa, criado_em FROM oportunidades
    WHERE ($1::text IS NOT NULL AND contato_telefone = $1) OR ($2::text IS NOT NULL AND lower(contato_email) = $2)`, p)).rows;
  const mensagens = (await c.query(`SELECT i.criado_em, i.canal, i.direcao, i.texto, ct.nome AS conta FROM interacoes i LEFT JOIN contas ct ON ct.id = i.conta_id
    WHERE (i.destinatario = $1 OR lower(i.destinatario) = $2) ORDER BY i.criado_em LIMIT 2000`, [tel || '', mail || ''])).rows;
  return { tel, mail, pontosFocais, pessoas, oportunidades, mensagens };
}

/** Exportação para o titular (direito de acesso). */
async function exportar(c, ctx, filtro, motivo) {
  const r = await localizar(c, filtro);
  await auditar(c, ctx, { acao: 'lgpd.exportacao', entidade: 'titular', entidadeId: resumo(r.tel || r.mail), motivo,
    depois: { pontosFocais: r.pontosFocais.length, pessoas: r.pessoas.length, oportunidades: r.oportunidades.length, mensagens: r.mensagens.length } });
  const { tel, mail, ...dados } = r;
  return { geradoEm: new Date().toISOString(), titular: { telefone: tel, email: mail }, ...dados };
}

/** Eliminação a pedido do titular: anonimiza em todas as tabelas de contato. */
async function anonimizar(c, ctx, filtro, motivo) {
  const { tel, mail } = identificador(filtro);
  const p = [tel, mail];
  const marcador = (id) => `anon-${String(id).slice(0, 8)}@anonimizado.invalid`;
  const pfs = (await c.query(`SELECT id FROM pontos_focais WHERE ($1::text IS NOT NULL AND telefone = $1) OR ($2::text IS NOT NULL AND lower(email) = $2) FOR UPDATE`, p)).rows;
  for (const x of pfs) {
    await c.query(`UPDATE pontos_focais SET nome = $2, telefone = NULL, email = $3, vigente = false, opt_out = true, consentimento_whatsapp = false,
      encerrado_em = coalesce(encerrado_em, now()) WHERE id = $1`, [x.id, ANON, marcador(x.id)]);
  }
  const pessoas = (await c.query(`SELECT id FROM contatos_comerciais WHERE ($1::text IS NOT NULL AND telefone = $1) OR ($2::text IS NOT NULL AND lower(email) = $2) FOR UPDATE`, p)).rows;
  for (const x of pessoas) {
    await c.query('UPDATE contatos_comerciais SET nome = $2, cargo = NULL, telefone = NULL, email = $3, atualizado_em = now() WHERE id = $1', [x.id, ANON, marcador(x.id)]);
  }
  const ops = await c.query(`UPDATE oportunidades SET contato_nome = $3, contato_telefone = NULL, contato_email = NULL, atualizado_em = now()
    WHERE ($1::text IS NOT NULL AND contato_telefone = $1) OR ($2::text IS NOT NULL AND lower(contato_email) = $2)`, [...p, ANON]);
  const msgs = await c.query("UPDATE interacoes SET destinatario = '[anonimizado]' WHERE destinatario = $1 OR lower(destinatario) = $2", [tel || '', mail || '']);
  const total = { pontosFocais: pfs.length, pessoas: pessoas.length, oportunidades: ops.rowCount, mensagens: msgs.rowCount };
  if (!Object.values(total).some(Boolean)) throw erro.naoEncontrado('Titular com esse telefone ou e-mail');
  await auditar(c, ctx, { acao: 'lgpd.anonimizacao', entidade: 'titular', entidadeId: resumo(tel || mail), motivo, depois: total });
  await publicar(c, ctx, { tipo: 'lgpd.anonimizado', agregado: 'tenant', agregadoId: ctx.tenantId, payload: total });
  return total;
}

module.exports = { localizar, exportar, anonimizar, ANON };
