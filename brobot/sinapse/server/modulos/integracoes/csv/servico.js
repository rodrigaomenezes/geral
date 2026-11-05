'use strict';
// Importar = pré-visualizar (valida tudo, não grava) → aplicar (grava as linhas válidas, numa transação).
// O mesmo arquivo (hash SHA-256) não é aplicado duas vezes. Exportar fica na auditoria.

const crypto = require('node:crypto');
const { uma } = require('../../../db');
const { erro } = require('../../../nucleo/erros');
const { auditar, publicar } = require('../../../nucleo/registro');
const csv = require('./csv');
const { TIPOS } = require('./importadores');
const { EXPORTS } = require('./exportadores');
const rodadas = require('../../rodadas/servico');

const MAX_ERROS = 200;

function analisar(tipo, texto) {
  const def = TIPOS[tipo];
  if (!def) throw erro.entrada('Tipo de importação desconhecido.');
  let tabela;
  try { tabela = csv.ler(texto); } catch (e) { throw erro.entrada(e.message); }
  const faltam = def.colunas.filter((col) => !tabela.cabecalhos.includes(col) && !['codigo_erro', 'expira_em', 'referencia', 'ultimo_login', 'usuarios_ativos', 'consultas_30d', 'modulos', 'produto'].includes(col));
  if (!tabela.linhas.length) throw erro.entrada('O arquivo não tem linhas além do cabeçalho.');
  if (faltam.length) throw erro.entrada(`Faltam colunas no cabeçalho: ${faltam.join(', ')}. Esperado: ${def.colunas.join(';')}.`);
  const validas = []; const erros = [];
  for (const l of tabela.linhas) {
    const e = def.validar(l.valores);
    if (e.length) erros.push({ linha: l.numero, erro: e.join('; ') }); else validas.push(l);
  }
  return { def, tabela, validas, erros, hash: crypto.createHash('sha256').update(texto).digest('hex') };
}

async function previa(c, tipo, texto) {
  const a = analisar(tipo, texto);
  const ja = uma(await c.query('SELECT criado_em FROM importacoes WHERE tipo = $1 AND hash = $2', [tipo, a.hash]));
  return { tipo, nome: a.def.nome, linhas: a.tabela.linhas.length, validas: a.validas.length, erros: a.erros.slice(0, MAX_ERROS),
    separador: a.tabela.separador, cabecalhos: a.tabela.cabecalhos, amostra: a.validas.slice(0, 5).map((l) => l.valores), jaImportadoEm: ja?.criado_em || null };
}

async function aplicar(c, ctx, tipo, nomeArquivo, texto) {
  const a = analisar(tipo, texto);
  const reg = uma(await c.query(
    `INSERT INTO importacoes (tenant_id, tipo, arquivo, hash, linhas, aplicadas, com_erro, criado_por) VALUES ($1,$2,$3,$4,$5,0,0,$6)
     ON CONFLICT (tenant_id, tipo, hash) DO NOTHING RETURNING id`, [ctx.tenantId, tipo, nomeArquivo, a.hash, a.tabela.linhas.length, ctx.usuario?.id || null]));
  if (!reg) throw erro.conflito('Este mesmo arquivo já foi importado. Nada foi alterado.');
  const r = a.validas.length ? await a.def.aplicar(c, ctx, a.validas, { rodadas }) : { resumo: [], erros: [] };
  const erros = [...a.erros, ...(r.erros || [])];
  const aplicadas = a.validas.length - (r.erros || []).length;
  await c.query('UPDATE importacoes SET aplicadas = $2, com_erro = $3, erros = $4, resumo = $5 WHERE id = $1',
    [reg.id, aplicadas, erros.length, JSON.stringify(erros.slice(0, MAX_ERROS)), JSON.stringify(r.resumo || [])]);
  await auditar(c, ctx, { acao: 'integracao.csv_importado', entidade: 'importacao', entidadeId: reg.id, depois: { tipo, arquivo: nomeArquivo, aplicadas, comErro: erros.length } });
  await publicar(c, ctx, { tipo: 'integracao.csv_importado', agregado: 'importacao', agregadoId: reg.id, payload: { tipo, aplicadas } });
  return { id: reg.id, linhas: a.tabela.linhas.length, aplicadas, erros: erros.slice(0, MAX_ERROS), resumo: r.resumo || [] };
}

async function exportar(c, ctx, tipo) {
  const def = EXPORTS[tipo];
  if (!def) throw erro.entrada('Tipo de exportação desconhecido.');
  const linhas = (await c.query(def.sql)).rows;
  await auditar(c, ctx, { acao: 'integracao.csv_exportado', entidade: 'exportacao', entidadeId: tipo, depois: { linhas: linhas.length } });
  return { conteudo: csv.escrever(def.colunas, linhas), linhas: linhas.length, arquivo: `sinapse-${tipo}-${new Date().toISOString().slice(0, 10)}.csv` };
}

async function painel(c) {
  const historico = (await c.query(`SELECT i.id, i.tipo, i.arquivo, i.linhas, i.aplicadas, i.com_erro, i.resumo, i.criado_em, u.nome AS por
    FROM importacoes i LEFT JOIN usuarios u ON u.id = i.criado_por ORDER BY i.criado_em DESC LIMIT 30`)).rows;
  return {
    importacoes: Object.fromEntries(Object.entries(TIPOS).map(([k, t]) => [k, { nome: t.nome, origem: t.origem, colunas: t.colunas, exemplo: t.exemplo }])),
    exportacoes: Object.fromEntries(Object.entries(EXPORTS).map(([k, e]) => [k, { nome: e.nome, destino: e.destino }])),
    historico,
  };
}

module.exports = { previa, aplicar, exportar, painel };
