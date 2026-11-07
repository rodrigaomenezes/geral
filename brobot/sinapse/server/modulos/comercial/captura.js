'use strict';
// Captura de leads de fora do sistema (CRM-002): site, formulário de evento ou parceiro enviam o lead por webhook
// (mesmo token da entrada de mensagens). Vira oportunidade "Novo lead" no funil de aquisição, com dono definido:
//   - o mesmo idLead reenviado devolve a oportunidade que já existe (repetição do webhook não duplica);
//   - o mesmo telefone ou e-mail com oportunidade em andamento não abre outra: o lead fica registrado nela;
//   - o dono é a pessoa do Comercial disponível com menos oportunidades em andamento (empate: ordem alfabética);
//     sem ninguém disponível, fica sem dono e aparece para a gestão do Comercial.

const { uma } = require('../../db');
const { ErroNegocio } = require('../../nucleo/erros');
const { auditar, ctxSistema } = require('../../nucleo/registro');
const { normalizarTelefone } = require('../../nucleo/telefone');
const { ABERTAS, ORIGENS } = require('./funil');
const servico = require('./servico');

async function distribuir(c) {
  return uma(await c.query(`SELECT u.id, u.nome FROM usuarios u WHERE u.papel = 'comercial' AND u.ativo AND u.disponivel
    ORDER BY (SELECT count(*) FROM oportunidades o WHERE o.responsavel_id = u.id AND o.etapa = ANY($1)), u.nome LIMIT 1`, [ABERTAS]));
}

async function capturar(c, tenantId, d) {
  const ctx = ctxSistema(tenantId, `captura de lead (${ORIGENS[d.origem] || d.origem})`);
  // Mesmo lead chegando duas vezes ao mesmo tempo: a segunda espera a primeira terminar e cai na repetição.
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lead:${tenantId}:${d.idLead}`]);
  const ja = uma(await c.query('SELECT id, codigo FROM oportunidades WHERE id_externo = $1', [d.idLead]));
  if (ja) return { duplicada: true, oportunidadeId: ja.id, codigo: ja.codigo };

  const telefone = d.contatoTelefone ? normalizarTelefone(d.contatoTelefone) : null;
  if (d.contatoTelefone && !telefone) throw new ErroNegocio(400, 'entrada_invalida', 'Telefone inválido. Use DDD + número.', [{ campo: 'contatoTelefone', problema: 'inválido' }]);
  const email = d.contatoEmail ? String(d.contatoEmail).trim().toLowerCase() : null;
  const aberta = uma(await c.query(`SELECT id, codigo FROM oportunidades WHERE etapa = ANY($1)
    AND ((contato_telefone IS NOT NULL AND contato_telefone = $2) OR (contato_email IS NOT NULL AND lower(contato_email) = $3))
    ORDER BY criado_em LIMIT 1`, [ABERTAS, telefone, email]));
  if (aberta) {
    await auditar(c, ctx, { acao: 'oportunidade.lead_repetido', entidade: 'oportunidade', entidadeId: aberta.id,
      depois: { idLead: d.idLead, origem: d.origem, empresa: d.empresa }, motivo: d.mensagem || 'O mesmo contato pediu contato de novo' });
    return { duplicada: true, oportunidadeId: aberta.id, codigo: aberta.codigo, motivo: 'contato com oportunidade em andamento' };
  }

  const dono = await distribuir(c);
  const op = await servico.criar(c, ctx, { empresa: d.empresa, contatoNome: d.contatoNome, contatoTelefone: d.contatoTelefone, contatoEmail: email,
    origem: d.origem, produtos: d.produtos, frota: d.frota, responsavelId: dono?.id, observacao: d.mensagem });
  await c.query('UPDATE oportunidades SET id_externo = $2 WHERE id = $1', [op.id, d.idLead]);
  return { duplicada: false, oportunidadeId: op.id, codigo: op.codigo, responsavel: dono?.nome || null };
}

module.exports = { capturar, distribuir };
