'use strict';
// Catálogo de produtos comerciais (CRM-009). Cada produto diz se exige teste antes do fechamento (DP-04: a decisão
// é por produto e configurável; o padrão é exigir, que era a regra fixa até a 008). A organização que ainda não tem
// catálogo recebe os quatro produtos de sempre na primeira leitura.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar } = require('../../nucleo/registro');

const PADRAO = [['multas', 'Multas e Notificações'], ['indicacao_condutores', 'Indicação de Condutores'], ['licenciamento', 'Licenciamento'], ['caca_condutores', 'CaçaCondutores']];

async function listar(c, ctx, { soAtivos = false } = {}) {
  let r = await c.query(`SELECT codigo, nome, exige_teste, preco_referencia, unidade, ativo FROM produtos_comerciais ${soAtivos ? 'WHERE ativo' : ''} ORDER BY nome`);
  if (!r.rows.length && !soAtivos) {
    for (const [codigo, nome] of PADRAO) {
      await c.query('INSERT INTO produtos_comerciais (tenant_id, codigo, nome) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, codigo) DO NOTHING', [ctx.tenantId, codigo, nome]);
    }
    r = await c.query('SELECT codigo, nome, exige_teste, preco_referencia, unidade, ativo FROM produtos_comerciais ORDER BY nome');
  }
  return r.rows;
}

/** Mapa código → produto (inclui inativos: oportunidade antiga continua legível). */
async function mapa(c, ctx) { return Object.fromEntries((await listar(c, ctx)).map((p) => [p.codigo, p])); }

/** Confere os códigos contra o catálogo ativo. */
async function validarProdutos(c, ctx, lista) {
  const cat = await mapa(c, ctx);
  const ruins = lista.filter((p) => !cat[p] || !cat[p].ativo);
  if (ruins.length) throw erro.entrada(`Produto fora do catálogo: ${ruins.join(', ')}.`, [{ campo: 'produtos', problema: `use: ${Object.values(cat).filter((p) => p.ativo).map((p) => p.codigo).join(', ')}` }]);
  return lista;
}

/** A oportunidade só dispensa o teste quando nenhum dos seus produtos o exige. */
async function exigeTeste(c, ctx, produtos) {
  const cat = await mapa(c, ctx);
  return !produtos.length || produtos.some((p) => cat[p]?.exige_teste !== false);
}

async function salvar(c, ctx, d) {
  const antes = uma(await c.query('SELECT * FROM produtos_comerciais WHERE codigo = $1', [d.codigo]));
  const p = uma(await c.query(`INSERT INTO produtos_comerciais (tenant_id, codigo, nome, exige_teste, preco_referencia, unidade, ativo)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, exige_teste = EXCLUDED.exige_teste,
      preco_referencia = EXCLUDED.preco_referencia, unidade = EXCLUDED.unidade, ativo = EXCLUDED.ativo, atualizado_em = now() RETURNING *`,
  [ctx.tenantId, d.codigo, d.nome, d.exigeTeste !== false, d.precoReferencia ?? null, d.unidade || 'veículo', d.ativo !== false]));
  await auditar(c, ctx, { acao: antes ? 'comercial.produto_alterado' : 'comercial.produto_criado', entidade: 'produto_comercial', entidadeId: p.id,
    antes: antes ? { nome: antes.nome, exigeTeste: antes.exige_teste, ativo: antes.ativo, precoReferencia: antes.preco_referencia } : null,
    depois: { nome: p.nome, exigeTeste: p.exige_teste, ativo: p.ativo, precoReferencia: p.preco_referencia } });
  return p;
}

module.exports = { listar, mapa, validarProdutos, exigeTeste, salvar, PADRAO };
