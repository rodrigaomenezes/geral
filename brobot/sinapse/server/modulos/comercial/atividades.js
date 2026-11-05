'use strict';
// Atividades da negociação (CRM-005, CRM-010): ligação, reunião, e-mail, WhatsApp, visita e nota, com data e
// resultado. Atividade agendada vira a próxima ação da oportunidade (a regra "aberta sempre tem próxima ação" vale);
// concluir exige o resultado. É a trilha que substitui o histórico de atividades do Pipedrive.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');

const TIPOS = { ligacao: 'Ligação', reuniao: 'Reunião', email: 'E-mail', whatsapp: 'WhatsApp', visita: 'Visita', nota: 'Nota' };
const POR_PAGINA = 30;

async function registrar(c, ctx, oportunidade, d) {
  if (!TIPOS[d.tipo]) throw erro.entrada('Tipo de atividade desconhecido.');
  const quando = d.quando ? new Date(d.quando) : relogio.agora();
  if (Number.isNaN(quando.getTime())) throw erro.entrada('Data da atividade inválida.');
  const feita = d.tipo === 'nota' || !!d.feita;
  if (feita && d.tipo !== 'nota' && !(d.resultado && d.resultado.trim().length >= 2)) throw erro.entrada('Atividade feita precisa do resultado (o que foi combinado).', [{ campo: 'resultado', problema: 'obrigatório' }]);
  const a = uma(await c.query(`INSERT INTO atividades_comerciais (tenant_id, oportunidade_id, tipo, assunto, quando, feita, resultado, autor_id, id_externo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [ctx.tenantId, oportunidade.id, d.tipo, d.assunto, quando, feita, d.resultado || null, ctx.usuario?.id || null, d.idExterno || null]));
  // Agendada e no futuro: passa a ser a próxima ação da oportunidade aberta.
  if (!feita && quando > relogio.agora() && !['ganha', 'perdida'].includes(oportunidade.etapa)) {
    await c.query('UPDATE oportunidades SET proxima_acao = $2, proxima_acao_em = $3, version = version + 1, atualizado_em = now() WHERE id = $1',
      [oportunidade.id, `${TIPOS[d.tipo]}: ${d.assunto}`.slice(0, 200), quando]);
  }
  await publicar(c, ctx, { tipo: 'oportunidade.atividade', agregado: 'oportunidade', agregadoId: oportunidade.id, payload: { atividadeId: a.id, tipo: a.tipo, feita } });
  return a;
}

async function concluir(c, ctx, id, { resultado }) {
  const a = uma(await c.query('SELECT * FROM atividades_comerciais WHERE id = $1 FOR UPDATE', [id]));
  if (!a) throw erro.naoEncontrado('Atividade');
  if (a.feita) throw erro.conflito('Esta atividade já foi concluída.');
  const r = uma(await c.query('UPDATE atividades_comerciais SET feita = true, resultado = $2 WHERE id = $1 RETURNING *', [id, resultado]));
  await auditar(c, ctx, { acao: 'oportunidade.atividade_concluida', entidade: 'oportunidade', entidadeId: a.oportunidade_id, depois: { tipo: a.tipo, assunto: a.assunto }, motivo: resultado });
  await publicar(c, ctx, { tipo: 'oportunidade.atividade', agregado: 'oportunidade', agregadoId: a.oportunidade_id, payload: { atividadeId: id, tipo: a.tipo, feita: true } });
  return r;
}

async function listar(c, oportunidadeId, pagina = 1) {
  const p = Math.max(1, Number(pagina) || 1);
  const r = await c.query(`SELECT a.id, a.tipo, a.assunto, a.quando, a.feita, a.resultado, a.criado_em, u.nome AS autor, count(*) OVER()::int AS total
    FROM atividades_comerciais a LEFT JOIN usuarios u ON u.id = a.autor_id WHERE a.oportunidade_id = $1
    ORDER BY a.feita, a.quando DESC LIMIT $2 OFFSET $3`, [oportunidadeId, POR_PAGINA, (p - 1) * POR_PAGINA]);
  return { itens: r.rows.map(({ total, ...x }) => x), total: r.rows[0]?.total || 0, pagina: p, porPagina: POR_PAGINA };
}

module.exports = { registrar, concluir, listar, TIPOS };
