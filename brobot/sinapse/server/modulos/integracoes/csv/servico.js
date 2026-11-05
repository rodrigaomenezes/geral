'use strict';
// Importar = pré-visualizar (valida tudo, não grava) → aplicar (grava as linhas válidas, numa transação).
// O mesmo arquivo (hash SHA-256) não é aplicado duas vezes. Se o cabeçalho não bate, a prévia pede o mapeamento das
// colunas, que fica salvo (versionado) para os próximos arquivos do mesmo fluxo.
// Exportar gera um LOTE: baixar o arquivo não é aplicar no destino. O lote fica "aguardando confirmação" até alguém
// registrar a evidência (ou o motivo da falha); vencido o prazo, o supervisor abre divergência e tarefa.

const crypto = require('node:crypto');
const { uma } = require('../../../db');
const { erro } = require('../../../nucleo/erros');
const { auditar, publicar } = require('../../../nucleo/registro');
const { relogio, DIA } = require('../../../nucleo/relogio');
const csv = require('./csv');
const mapas = require('./mapa');
const { TIPOS } = require('./importadores');
const { EXPORTS } = require('./exportadores');
const rodadas = require('../../rodadas/servico');
const comercial = require('../../comercial/servico');

const MAX_ERROS = 200;
const PRAZO_CONFIRMACAO_MS = 2 * DIA;
// Colunas que o arquivo pode não trazer (o importador trata a ausência).
const OPCIONAIS = ['codigo_erro', 'expira_em', 'referencia', 'ultimo_login', 'usuarios_ativos', 'consultas_30d', 'modulos', 'produto'];
const hashDe = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

const defDe = (tipo) => { const d = TIPOS[tipo]; if (!d) throw erro.entrada('Tipo de importação desconhecido.'); return d; };
const opcionaisDe = (def) => def.opcionais || OPCIONAIS;
const mapaAtivo = async (c, tipo) => uma(await c.query('SELECT id, versao, mapa FROM mapas_csv WHERE tipo = $1 AND ativo', [tipo]));

/** Lê o arquivo e decide o mapa: o enviado na prévia/aplicação, senão o salvo, senão nenhum. */
async function analisar(c, tipo, texto, mapaEnviado) {
  const def = defDe(tipo);
  let tabela;
  try { tabela = csv.ler(texto); } catch (e) { throw erro.entrada(e.message); }
  if (!tabela.linhas.length) throw erro.entrada('O arquivo não tem linhas além do cabeçalho.');
  const salvo = mapaEnviado ? null : await mapaAtivo(c, tipo);
  const mapa = mapaEnviado || salvo?.mapa || null;
  if (mapaEnviado) {
    const p = mapas.validarMapa(mapaEnviado, def.colunas, tabela.cabecalhos);
    if (p.length) throw erro.entrada(`Mapeamento de colunas com problema: ${p.join('; ')}.`);
  }
  // Um mapa salvo que não serve para este arquivo (colunas mudaram) não é aplicado: a prévia pede outro.
  const serve = mapa && !mapas.validarMapa(mapa, def.colunas, tabela.cabecalhos).length;
  const t = serve ? mapas.aplicarMapa(tabela, mapa) : tabela;
  const faltam = def.colunas.filter((col) => !t.cabecalhos.includes(col) && !opcionaisDe(def).includes(col));
  const validas = []; const erros = [];
  if (!faltam.length) {
    for (const l of t.linhas) {
      const e = def.validar(l.valores);
      if (e.length) erros.push({ linha: l.numero, erro: e.join('; ') }); else validas.push(l);
    }
  }
  return { def, tabela: t, original: tabela, faltam, validas, erros, hash: hashDe(texto),
    mapa: serve ? mapa : null, origemMapa: !serve ? 'nenhum' : mapaEnviado ? 'enviado' : 'salvo', versaoMapa: serve && salvo ? salvo.versao : null };
}

/** O que a tela precisa para pedir o mapeamento. */
const pedidoDeMapa = (a) => ({
  precisaMapear: true, faltam: a.faltam, campos: a.def.colunas, opcionais: a.def.colunas.filter((x) => opcionaisDe(a.def).includes(x)),
  cabecalhos: a.original.cabecalhos, sugestao: mapas.sugerir(a.def.colunas, a.original.cabecalhos),
  amostra: a.original.linhas.slice(0, 3).map((l) => l.valores),
});

async function previa(c, tipo, texto, mapaEnviado) {
  const a = await analisar(c, tipo, texto, mapaEnviado);
  const base = { tipo, nome: a.def.nome, linhas: a.tabela.linhas.length, separador: a.tabela.separador };
  if (a.faltam.length) return { ...base, ...pedidoDeMapa(a), validas: 0, erros: [] };
  const ja = uma(await c.query('SELECT criado_em FROM importacoes WHERE tipo = $1 AND hash = $2', [tipo, a.hash]));
  return { ...base, validas: a.validas.length, erros: a.erros.slice(0, MAX_ERROS), cabecalhos: a.def.colunas.filter((x) => a.tabela.cabecalhos.includes(x)),
    amostra: a.validas.slice(0, 5).map((l) => l.valores), jaImportadoEm: ja?.criado_em || null,
    mapa: { origem: a.origemMapa, versao: a.versaoMapa, ligacoes: a.mapa } };
}

/** Guarda o mapa enviado como nova versão ativa, se for diferente do que já está salvo. */
async function salvarMapa(c, ctx, tipo, mapa) {
  const atual = await mapaAtivo(c, tipo);
  if (atual && mapas.mesmoMapa(atual.mapa, mapa)) return atual.id;
  const versao = (uma(await c.query('SELECT coalesce(max(versao), 0) + 1 AS v FROM mapas_csv WHERE tipo = $1', [tipo]))).v;
  await c.query('UPDATE mapas_csv SET ativo = false WHERE tipo = $1 AND ativo', [tipo]);
  const novo = uma(await c.query('INSERT INTO mapas_csv (tenant_id, tipo, versao, mapa, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [ctx.tenantId, tipo, versao, JSON.stringify(mapa), ctx.usuario?.id || null]));
  await auditar(c, ctx, { acao: 'integracao.mapa_salvo', entidade: 'mapa_csv', entidadeId: novo.id, antes: atual ? { versao: atual.versao, mapa: atual.mapa } : null, depois: { versao, mapa } });
  return novo.id;
}

async function aplicar(c, ctx, tipo, nomeArquivo, texto, mapaEnviado) {
  const a = await analisar(c, tipo, texto, mapaEnviado);
  if (a.faltam.length) throw erro.entrada(`Faltam colunas: ${a.faltam.join(', ')}. Faça a prévia e ligue as colunas do arquivo aos campos do Sinapse.`);
  const mapaId = a.origemMapa === 'enviado' ? await salvarMapa(c, ctx, tipo, a.mapa) : a.origemMapa === 'salvo' ? (await mapaAtivo(c, tipo)).id : null;
  const reg = uma(await c.query(
    `INSERT INTO importacoes (tenant_id, tipo, arquivo, hash, linhas, aplicadas, com_erro, criado_por, mapa_id) VALUES ($1,$2,$3,$4,$5,0,0,$6,$7)
     ON CONFLICT (tenant_id, tipo, hash) DO NOTHING RETURNING id`, [ctx.tenantId, tipo, nomeArquivo, a.hash, a.tabela.linhas.length, ctx.usuario?.id || null, mapaId]));
  if (!reg) throw erro.conflito('Este mesmo arquivo já foi importado. Nada foi alterado.');
  const r = a.validas.length ? await a.def.aplicar(c, ctx, a.validas, { rodadas, comercial }) : { resumo: [], erros: [] };
  const erros = [...a.erros, ...(r.erros || [])];
  const aplicadas = a.validas.length - (r.erros || []).length;
  const estado = erros.length ? 'parcial' : 'concluido';
  await c.query('UPDATE importacoes SET aplicadas = $2, com_erro = $3, erros = $4, resumo = $5, estado = $6 WHERE id = $1',
    [reg.id, aplicadas, erros.length, JSON.stringify(erros.slice(0, MAX_ERROS)), JSON.stringify(r.resumo || []), estado]);
  await auditar(c, ctx, { acao: 'integracao.csv_importado', entidade: 'importacao', entidadeId: reg.id, depois: { tipo, arquivo: nomeArquivo, aplicadas, comErro: erros.length, estado } });
  await publicar(c, ctx, { tipo: 'integracao.csv_importado', agregado: 'importacao', agregadoId: reg.id, payload: { tipo, aplicadas, estado } });
  return { id: reg.id, linhas: a.tabela.linhas.length, aplicadas, estado, erros: erros.slice(0, MAX_ERROS), resumo: r.resumo || [] };
}

async function exportar(c, ctx, tipo) {
  const def = EXPORTS[tipo];
  if (!def) throw erro.entrada('Tipo de exportação desconhecido.');
  const linhas = (await c.query(def.sql)).rows;
  const conteudo = csv.escrever(def.colunas, linhas);
  const agora = relogio.agora();
  const lote = uma(await c.query(`INSERT INTO exportacoes (tenant_id, tipo, destino, arquivo, hash, linhas, prazo_confirmacao_em, criado_por)
    VALUES ($1,$2,$3,'',$4,$5,$6,$7) RETURNING id`, [ctx.tenantId, tipo, def.destino, hashDe(conteudo), linhas.length, new Date(agora.getTime() + PRAZO_CONFIRMACAO_MS), ctx.usuario?.id || null]));
  // O código do lote vai no nome do arquivo: quem importar no destino consegue dizer qual lote confirmou.
  const arquivo = `sinapse-${tipo}-${agora.toISOString().slice(0, 10)}-lote-${lote.id.slice(0, 8)}.csv`;
  await c.query('UPDATE exportacoes SET arquivo = $2 WHERE id = $1', [lote.id, arquivo]);
  await auditar(c, ctx, { acao: 'integracao.csv_exportado', entidade: 'exportacao', entidadeId: lote.id, depois: { tipo, linhas: linhas.length, arquivo } });
  await publicar(c, ctx, { tipo: 'integracao.csv_exportado', agregado: 'exportacao', agregadoId: lote.id, payload: { tipo, destino: def.destino, linhas: linhas.length } });
  return { conteudo, linhas: linhas.length, arquivo, lote: lote.id };
}

/** Confirma (ou dá como falho) um lote exportado. Gerar o arquivo não prova nada: exige evidência ou motivo. */
async function resolverLote(c, ctx, id, { resultado, evidencia }) {
  const lote = uma(await c.query('SELECT * FROM exportacoes WHERE id = $1 FOR UPDATE', [id]));
  if (!lote) throw erro.naoEncontrado('Lote de exportação');
  if (lote.estado !== 'aguardando_confirmacao') throw erro.conflito('Este lote já foi resolvido. Atualize a tela.');
  const estado = resultado === 'confirmado' ? 'confirmado' : 'falhou';
  await c.query('UPDATE exportacoes SET estado = $2, evidencia = $3, resolvido_por = $4, resolvido_em = $5 WHERE id = $1',
    [id, estado, evidencia, ctx.usuario.id, relogio.agora()]);
  await c.query("UPDATE divergencias SET estado = 'tratada' WHERE chave = $1 AND estado = 'aberta'", [`exportacao:${id}`]);
  await auditar(c, ctx, { acao: `integracao.lote_${estado}`, entidade: 'exportacao', entidadeId: id, antes: { estado: lote.estado }, depois: { estado, evidencia } });
  await publicar(c, ctx, { tipo: `integracao.lote_${estado}`, agregado: 'exportacao', agregadoId: id, payload: { tipo: lote.tipo, destino: lote.destino } });
  return { id, estado };
}

async function painel(c) {
  const agora = relogio.agora();
  const historico = (await c.query(`SELECT i.id, i.tipo, i.arquivo, i.linhas, i.aplicadas, i.com_erro, i.estado, i.resumo, i.criado_em, u.nome AS por, m.versao AS mapa_versao
    FROM importacoes i LEFT JOIN usuarios u ON u.id = i.criado_por LEFT JOIN mapas_csv m ON m.id = i.mapa_id ORDER BY i.criado_em DESC LIMIT 30`)).rows;
  const ultimos = new Map((await c.query('SELECT tipo, max(criado_em) AS em FROM importacoes GROUP BY tipo')).rows.map((r) => [r.tipo, r.em]));
  const mapasAtivos = new Map((await c.query('SELECT tipo, versao FROM mapas_csv WHERE ativo')).rows.map((r) => [r.tipo, r.versao]));
  const lotes = (await c.query(`SELECT e.id, e.tipo, e.destino, e.arquivo, e.linhas, e.estado, e.prazo_confirmacao_em, e.evidencia, e.criado_em, e.resolvido_em,
      u.nome AS por, r.nome AS resolvido_por_nome, (e.estado = 'aguardando_confirmacao' AND e.prazo_confirmacao_em < $1) AS atrasado
    FROM exportacoes e LEFT JOIN usuarios u ON u.id = e.criado_por LEFT JOIN usuarios r ON r.id = e.resolvido_por
    ORDER BY (e.estado = 'aguardando_confirmacao') DESC, e.criado_em DESC LIMIT 30`, [agora])).rows;
  return {
    importacoes: Object.fromEntries(Object.entries(TIPOS).map(([k, t]) => [k, { nome: t.nome, origem: t.origem, colunas: t.colunas, exemplo: t.exemplo,
      permissao: t.permissao || null, ultimoArquivoEm: ultimos.get(k) || null, mapaVersao: mapasAtivos.get(k) || null, layout: 'proposto pelo Sinapse · pendente de validação com arquivo real' }])),
    exportacoes: Object.fromEntries(Object.entries(EXPORTS).map(([k, e]) => [k, { nome: e.nome, destino: e.destino }])),
    historico, lotes,
  };
}

module.exports = { previa, aplicar, exportar, resolverLote, painel, OPCIONAIS };
