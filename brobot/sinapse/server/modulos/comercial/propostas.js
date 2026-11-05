'use strict';
// Propostas versionadas (CRM-007) com alçada de desconto (CRM-008).
//   rascunho → enviada → aceita | recusada            (nova versão substitui a vigente)
//   rascunho → aguardando_aprovacao → aprovada → enviada   (desconto acima da alçada: outra pessoa, da gestão, aprova)
// Proposta enviada não muda mais (o banco recusa): o histórico prova o que foi oferecido ao cliente.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');
const catalogo = require('./catalogo');

const ALCADA_PADRAO = 10; // % de desconto que o vendedor concede sem aprovação (tenants.config.comercial.descontoMaximo)
const ESTADOS = { rascunho: 'Rascunho', aguardando_aprovacao: 'Aguardando aprovação', aprovada: 'Aprovada', enviada: 'Enviada ao cliente',
  aceita: 'Aceita', recusada: 'Recusada', substituida: 'Substituída' };
const VIGENTES = ['rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada', 'aceita'];

const centavos = (v) => Math.round(v * 100) / 100;

/** Regra pura: total cheio, total com desconto e se o desconto passa da alçada. */
function calcular(itens, descontoPct, alcada = ALCADA_PADRAO) {
  if (!Array.isArray(itens) || !itens.length) throw erro.entrada('A proposta precisa de pelo menos um item.');
  if (itens.length > 20) throw erro.entrada('No máximo 20 itens por proposta.');
  const linhas = itens.map((i, n) => {
    const quantidade = Number(i.quantidade); const valorUnitario = Number(i.valorUnitario);
    if (!i.produto) throw erro.entrada(`Item ${n + 1}: escolha o produto.`);
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 1e6) throw erro.entrada(`Item ${n + 1}: quantidade inválida.`);
    if (!(valorUnitario >= 0) || valorUnitario > 1e6) throw erro.entrada(`Item ${n + 1}: valor unitário inválido.`);
    return { produto: String(i.produto), quantidade, valorUnitario: centavos(valorUnitario), subtotal: centavos(quantidade * valorUnitario) };
  });
  const d = Number(descontoPct || 0);
  if (!(d >= 0 && d <= 100)) throw erro.entrada('Desconto entre 0 e 100%.');
  const cheio = centavos(linhas.reduce((s, l) => s + l.subtotal, 0));
  return { itens: linhas, valorCheio: cheio, descontoPct: d, valorMensal: centavos(cheio * (1 - d / 100)), exigeAprovacao: d > alcada };
}

async function alcadaDe(c) {
  const t = uma(await c.query("SELECT config -> 'comercial' ->> 'descontoMaximo' AS v FROM tenants WHERE id = nullif(current_setting('app.tenant_id', true), '')::uuid"));
  const v = Number(t?.v);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : ALCADA_PADRAO;
}

async function buscar(c, id) {
  const p = uma(await c.query('SELECT * FROM propostas WHERE id = $1 FOR UPDATE', [id]));
  if (!p) throw erro.naoEncontrado('Proposta');
  return p;
}

async function criar(c, ctx, oportunidade, d) {
  if (!['demonstracao', 'proposta', 'teste', 'negociacao'].includes(oportunidade.etapa)) {
    throw erro.regra('etapa_sem_proposta', 'Proposta só a partir da Demonstração, com a oportunidade em andamento.');
  }
  const calc = calcular(d.itens, d.descontoPct, await alcadaDe(c));
  await catalogo.validarProdutos(c, ctx, [...new Set(calc.itens.map((i) => i.produto))]);
  const validade = String(d.validade || '');
  const hoje = new Date(relogio.agora().getTime() - 3 * 3600e3).toISOString().slice(0, 10); // data de Brasília
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validade) || validade < hoje) throw erro.entrada('Validade precisa ser uma data a partir de hoje.', [{ campo: 'validade', problema: 'inválida' }]);
  const anterior = uma(await c.query(`SELECT id, versao, estado FROM propostas WHERE oportunidade_id = $1 AND estado = ANY($2) FOR UPDATE`, [oportunidade.id, VIGENTES]));
  if (anterior?.estado === 'aceita') throw erro.regra('proposta_aceita', 'Já há uma proposta aceita: feche a venda ou registre a recusa antes de uma nova versão.');
  if (anterior) await c.query("UPDATE propostas SET estado = 'substituida', atualizado_em = now() WHERE id = $1", [anterior.id]);
  const versao = (uma(await c.query('SELECT coalesce(max(versao), 0) + 1 AS v FROM propostas WHERE oportunidade_id = $1', [oportunidade.id]))).v;
  const p = uma(await c.query(`INSERT INTO propostas (tenant_id, oportunidade_id, versao, itens, valor_cheio, desconto_pct, valor_mensal, validade, condicoes, exige_aprovacao, criado_por)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
  [ctx.tenantId, oportunidade.id, versao, JSON.stringify(calc.itens), calc.valorCheio, calc.descontoPct, calc.valorMensal, validade, d.condicoes || null, calc.exigeAprovacao, ctx.usuario.id]));
  await auditar(c, ctx, { acao: 'proposta.criada', entidade: 'oportunidade', entidadeId: oportunidade.id,
    depois: { versao, valorMensal: calc.valorMensal, descontoPct: calc.descontoPct, exigeAprovacao: calc.exigeAprovacao, substituiu: anterior?.versao || null } });
  return p;
}

/** Ações do ciclo da proposta. `pode` = função de permissão do usuário (alçada de aprovação). */
async function agir(c, ctx, id, acao, { parecer } = {}, pode) {
  const p = await buscar(c, id);
  const muda = async (estado, extra = {}) => {
    const sets = ['estado = $2', 'atualizado_em = now()']; const vals = [id, estado];
    for (const [k, v] of Object.entries(extra)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
    return uma(await c.query(`UPDATE propostas SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals));
  };
  let r;
  switch (acao) {
    case 'enviar': {
      if (p.estado === 'rascunho' && p.exige_aprovacao) { r = await muda('aguardando_aprovacao'); break; }
      if (!['rascunho', 'aprovada'].includes(p.estado)) throw erro.conflito(`Proposta "${ESTADOS[p.estado]}" não pode ser enviada.`);
      r = await muda('enviada');
      // O valor e os produtos da oportunidade passam a ser os da proposta enviada (fonte única para indicadores).
      const produtos = [...new Set(p.itens.map((i) => i.produto))];
      await c.query('UPDATE oportunidades SET valor_mensal = $2, produtos = $3, version = version + 1, atualizado_em = now() WHERE id = $1', [p.oportunidade_id, p.valor_mensal, produtos]);
      break;
    }
    case 'aprovar': case 'devolver': {
      if (p.estado !== 'aguardando_aprovacao') throw erro.conflito('Esta proposta não está aguardando aprovação.');
      if (!pode('comercial.gerir')) throw erro.semPermissao('aprovar desconto acima da alçada');
      if (p.criado_por === ctx.usuario.id) throw erro.regra('aprovacao_propria', 'Quem fez a proposta não aprova o próprio desconto. Peça a outra pessoa da gestão.');
      if (acao === 'devolver' && !(parecer && parecer.length >= 5)) throw erro.entrada('Diga o que precisa mudar (parecer).');
      r = acao === 'aprovar' ? await muda('aprovada', { aprovada_por: ctx.usuario.id, aprovada_em: relogio.agora(), parecer: parecer || null })
        : await muda('rascunho', { parecer });
      break;
    }
    case 'aceitar': case 'recusar': {
      if (p.estado !== 'enviada') throw erro.conflito('Só a proposta enviada ao cliente é aceita ou recusada.');
      const vencida = (uma(await c.query("SELECT validade < ($2::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AS v FROM propostas WHERE id = $1", [id, relogio.agora()]))).v;
      if (acao === 'aceitar' && vencida) {
        throw erro.regra('proposta_vencida', 'A validade desta proposta passou. Crie uma nova versão com nova validade.');
      }
      r = await muda(acao === 'aceitar' ? 'aceita' : 'recusada', { parecer: parecer || null });
      break;
    }
    default: throw erro.entrada('Ação de proposta desconhecida.');
  }
  await auditar(c, ctx, { acao: `proposta.${r.estado}`, entidade: 'oportunidade', entidadeId: p.oportunidade_id, antes: { versao: p.versao, estado: p.estado }, depois: { versao: p.versao, estado: r.estado }, motivo: parecer || null });
  await publicar(c, ctx, { tipo: 'proposta.estado', agregado: 'oportunidade', agregadoId: p.oportunidade_id, chave: `proposta:${id}:${r.estado}`, payload: { propostaId: id, versao: p.versao, estado: r.estado } });
  return r;
}

const listar = async (c, oportunidadeId) => (await c.query(`SELECT p.*, u.nome AS autor, a.nome AS aprovador FROM propostas p LEFT JOIN usuarios u ON u.id = p.criado_por
  LEFT JOIN usuarios a ON a.id = p.aprovada_por WHERE p.oportunidade_id = $1 ORDER BY p.versao DESC`, [oportunidadeId])).rows;

module.exports = { calcular, criar, agir, listar, ESTADOS, ALCADA_PADRAO };
