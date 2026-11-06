'use strict';
// VIP (GOV-002): conceder, renovar e retirar passam por pedido (quem cuida da conta) e aprovação por OUTRA pessoa da
// gestão (`governanca.gerir`). O VIP tem critério e validade: 15 dias antes o CS recebe a tarefa de renovar ou retirar;
// vencida a validade, o VIP sai sozinho (registrado como pedido automático). Mudar o VIP muda o roteamento das
// ocorrências NOVAS (VIP → CS, demais → Suporte, exceção justificada continua valendo); as abertas não se movem.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio, DIA } = require('../../nucleo/relogio');

const AVISO_DIAS = 15;
const VALIDADE_MAX_DIAS = 2 * 366;
/** Hoje em São Paulo (AAAA-MM-DD). */
const hoje = (agora = relogio.agora()) => new Date(agora.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const somarDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);

async function conta(c, id) {
  const ct = uma(await c.query('SELECT * FROM contas WHERE id = $1 AND arquivada_em IS NULL FOR UPDATE', [id]));
  if (!ct) throw erro.naoEncontrado('Conta');
  return ct;
}

function validarValidade(validade) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(validade || ''))) throw erro.entrada('Informe a validade do VIP (data).');
  const d = hoje();
  if (validade <= d) throw erro.entrada('A validade precisa ser depois de hoje.');
  if (validade > somarDias(d, VALIDADE_MAX_DIAS)) throw erro.entrada('A validade do VIP vai até 2 anos. Renove quando chegar perto.');
}

async function pedir(c, ctx, contaId, d) {
  const ct = await conta(c, contaId);
  if (d.tipo === 'conceder' && ct.vip) throw erro.conflito('A conta já é VIP. Para mudar a validade, peça a renovação.');
  if (d.tipo !== 'conceder' && !ct.vip) throw erro.conflito('A conta não é VIP.');
  if (d.tipo !== 'retirar') {
    if (!d.criterio || d.criterio.length < 5) throw erro.entrada('Informe o critério do VIP (por que esta conta é VIP).');
    validarValidade(d.validade);
  }
  const p = uma(await c.query(`INSERT INTO vip_pedidos (tenant_id, conta_id, tipo, criterio, validade, motivo, pedido_por)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *`,
  [ctx.tenantId, ct.id, d.tipo, d.tipo === 'retirar' ? null : d.criterio, d.tipo === 'retirar' ? null : d.validade, d.motivo, ctx.usuario.id]));
  if (!p) throw erro.conflito('Já existe um pedido de VIP esperando decisão para esta conta.');
  await auditar(c, ctx, { acao: 'conta.vip_pedido', entidade: 'conta', entidadeId: ct.id, motivo: d.motivo, depois: { tipo: d.tipo, criterio: p.criterio, validade: p.validade } });
  await publicar(c, ctx, { tipo: 'conta.vip_pedido', agregado: 'conta', agregadoId: ct.id, payload: { pedidoId: p.id, tipo: d.tipo } });
  return p;
}

async function aplicar(c, ctx, ct, p, aprovadorNome) {
  const antes = { vip: ct.vip, criterio: ct.vip_criterio, validade: ct.vip_validade };
  if (p.tipo === 'retirar') {
    await c.query('UPDATE contas SET vip = false, vip_criterio = NULL, vip_validade = NULL, vip_aprovador = NULL, vip_aprovado_por = NULL, vip_aviso_validade_em = NULL, atualizado_em = now() WHERE id = $1', [ct.id]);
  } else {
    await c.query(`UPDATE contas SET vip = true, vip_criterio = $2, vip_validade = $3, vip_aprovador = $4, vip_aprovado_por = $5, vip_aviso_validade_em = NULL, atualizado_em = now()
      WHERE id = $1`, [ct.id, p.criterio, p.validade, aprovadorNome, p.decidido_por || null]);
  }
  const depois = p.tipo === 'retirar' ? { vip: false } : { vip: true, criterio: p.criterio, validade: p.validade };
  await auditar(c, ctx, { acao: 'conta.vip_alterado', entidade: 'conta', entidadeId: ct.id, motivo: p.decisao_motivo || p.motivo, antes, depois });
  await publicar(c, ctx, { tipo: 'conta.vip_alterado', agregado: 'conta', agregadoId: ct.id, payload: { ...depois, pedidoId: p.id } });
}

async function decidir(c, ctx, pedidoId, aprovar, motivo) {
  const p0 = uma(await c.query('SELECT * FROM vip_pedidos WHERE id = $1 FOR UPDATE', [pedidoId]));
  if (!p0) throw erro.naoEncontrado('Pedido de VIP');
  if (p0.estado !== 'pendente') throw erro.conflito('Este pedido já foi decidido.');
  if (p0.pedido_por === ctx.usuario.id) throw erro.regra('mesma_pessoa', 'Quem pediu não aprova. Outra pessoa da gestão decide.');
  if (!aprovar && (!motivo || motivo.length < 5)) throw erro.entrada('Diga por que o pedido foi recusado.');
  const ct = await conta(c, p0.conta_id);
  if (aprovar && p0.tipo !== 'retirar' && p0.validade <= hoje()) throw erro.regra('validade_passou', 'A validade pedida já passou. Recuse e peça de novo.');
  const p = uma(await c.query(`UPDATE vip_pedidos SET estado = $2, decidido_por = $3, decidido_em = $4, decisao_motivo = $5 WHERE id = $1 RETURNING *`,
    [p0.id, aprovar ? 'aprovado' : 'recusado', ctx.usuario.id, relogio.agora(), motivo || null]));
  if (aprovar) await aplicar(c, ctx, ct, p, ctx.usuario.nome);
  else await auditar(c, ctx, { acao: 'conta.vip_recusado', entidade: 'conta', entidadeId: ct.id, motivo });
  return p;
}

async function historico(c, contaId) {
  return (await c.query(`SELECT p.id, p.tipo, p.criterio, p.validade, p.motivo, p.estado, p.decisao_motivo, p.criado_em, p.decidido_em,
      pu.nome AS pedido_por_nome, du.nome AS decidido_por_nome, p.pedido_por
    FROM vip_pedidos p LEFT JOIN usuarios pu ON pu.id = p.pedido_por LEFT JOIN usuarios du ON du.id = p.decidido_por
    WHERE p.conta_id = $1 ORDER BY p.criado_em DESC LIMIT 50`, [contaId])).rows;
}

async function pendentes(c) {
  return (await c.query(`SELECT p.id, p.tipo, p.criterio, p.validade, p.motivo, p.criado_em, p.pedido_por, pu.nome AS pedido_por_nome, ct.id AS conta_id, ct.nome AS conta_nome
    FROM vip_pedidos p JOIN contas ct ON ct.id = p.conta_id LEFT JOIN usuarios pu ON pu.id = p.pedido_por
    WHERE p.estado = 'pendente' ORDER BY p.criado_em LIMIT 100`)).rows;
}

/**
 * Supervisor: 15 dias antes da validade, tarefa para o CS renovar ou retirar (uma vez por validade); vencida, o VIP
 * sai (pedido automático, auditado). Idempotente.
 */
async function verificarValidades(c, ctx, { criarTarefa }) {
  const d = hoje();
  let avisos = 0; let expirados = 0;
  for (const ct of (await c.query(`SELECT * FROM contas WHERE vip AND vip_validade IS NOT NULL AND arquivada_em IS NULL
      AND vip_validade <= $1::date AND vip_aviso_validade_em IS NULL LIMIT 100`, [somarDias(d, AVISO_DIAS)])).rows) {
    if (ct.vip_validade < d) continue; // vencidos vão abaixo
    await criarTarefa({ tipo: 'geral', equipeCodigo: 'cs', chave: `vip-validade:${ct.id}:${ct.vip_validade}`,
      titulo: `${ct.nome}: VIP vence em ${ct.vip_validade.split('-').reverse().join('/')} — renovar ou retirar`, prazoEm: new Date(`${ct.vip_validade}T21:00:00Z`) });
    await c.query('UPDATE contas SET vip_aviso_validade_em = $2 WHERE id = $1', [ct.id, d]);
    avisos++;
  }
  for (const ct of (await c.query('SELECT * FROM contas WHERE vip AND vip_validade < $1::date AND arquivada_em IS NULL FOR UPDATE LIMIT 100', [d])).rows) {
    // Pedido pendente de renovação ainda pode ser aprovado; o automático registra a saída.
    const p = uma(await c.query(`INSERT INTO vip_pedidos (tenant_id, conta_id, tipo, motivo, pedido_por, estado)
      VALUES ($1, $2, 'retirar', 'Validade do VIP terminou sem renovação', coalesce($3, (SELECT id FROM usuarios WHERE papel = 'admin' AND ativo ORDER BY criado_em LIMIT 1)), 'automatico') RETURNING *`,
    [ctx.tenantId, ct.id, ct.vip_aprovado_por]));
    await aplicar(c, ctx, ct, p, null);
    await criarTarefa({ tipo: 'geral', equipeCodigo: 'cs', chave: `vip-expirou:${ct.id}:${ct.vip_validade}`,
      titulo: `${ct.nome}: VIP venceu e saiu (novas ocorrências vão ao Suporte)`, prazoEm: new Date(relogio.agora().getTime() + DIA) });
    expirados++;
  }
  return { avisos, expirados };
}

module.exports = { pedir, decidir, historico, pendentes, verificarValidades, hoje, somarDias, AVISO_DIAS };
