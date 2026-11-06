'use strict';
// ONB-006: lote de placas do onboarding. O cliente manda a planilha (placa e Renavam); o Sinapse confere cada linha
// (formato da placa antiga ou Mercosul, dígito verificador do Renavam, repetida no arquivo ou já enviada) e guarda o
// resultado parcial: aceitas seguem para a Platform pela exportação `platform_placas_onboarding` (com confirmação),
// rejeitadas voltam ao cliente com o motivo. O item "placas" do checklist se marca sozinho quando o último lote não tem
// rejeição pendente e a exportação foi confirmada como aplicada na Platform.

const crypto = require('node:crypto');
const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');
const csv = require('../integracoes/csv/csv');

const MAX_LINHAS = 5000;

/** Placa sem traço/espaço, em maiúsculas; null se não for antiga (AAA9999) nem Mercosul (AAA9A99). */
function normalizarPlaca(v) {
  const p = String(v || '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p) ? p : null;
}

/** Renavam: 9 a 11 dígitos (completa com zeros à esquerda), dígito verificador conferido. */
function renavamValido(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length < 9 || d.length > 11) return null;
  const r = d.padStart(11, '0');
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = pesos.reduce((s, p, i) => s + p * Number(r[i]), 0);
  let dv = 11 - (soma % 11);
  if (dv >= 10) dv = 0;
  return dv === Number(r[10]) ? r : null;
}

const coluna = (valores, nomes) => { for (const n of nomes) if (valores[n] !== undefined) return valores[n]; return undefined; };

/** Regra pura: confere as linhas do arquivo. `jaEnviadas` = placas aceitas em lotes anteriores da conta. */
function conferir(linhas, jaEnviadas = new Set()) {
  const vistas = new Set();
  return linhas.map((l) => {
    const brutoPlaca = coluna(l.valores, ['placa', 'placa_veiculo', 'veiculo']);
    const brutoRenavam = coluna(l.valores, ['renavam', 'codigo_renavam']);
    const placa = normalizarPlaca(brutoPlaca);
    if (!placa) return { linha: l.numero, placa: brutoPlaca || null, renavam: brutoRenavam || null, aceita: false, motivo: brutoPlaca ? 'Placa fora do formato (AAA9999 ou AAA9A99)' : 'Placa em branco' };
    const renavam = brutoRenavam ? renavamValido(brutoRenavam) : null;
    if (!renavam) return { linha: l.numero, placa, renavam: brutoRenavam || null, aceita: false, motivo: brutoRenavam ? 'Renavam inválido (dígito verificador não confere)' : 'Renavam em branco' };
    if (vistas.has(placa)) return { linha: l.numero, placa, renavam, aceita: false, motivo: 'Placa repetida no arquivo' };
    vistas.add(placa);
    if (jaEnviadas.has(placa)) return { linha: l.numero, placa, renavam, aceita: false, motivo: 'Placa já enviada em lote anterior' };
    return { linha: l.numero, placa, renavam, aceita: true, motivo: null };
  });
}

async function importar(c, ctx, contaId, { texto, arquivo }) {
  const conta = uma(await c.query('SELECT id, nome, status FROM contas WHERE id = $1 AND arquivada_em IS NULL', [contaId]));
  if (!conta) throw erro.naoEncontrado('Conta');
  let lido;
  try { lido = csv.ler(texto, { maxLinhas: MAX_LINHAS }); } catch (e) { throw erro.entrada(e.message); }
  if (!lido.cabecalhos.includes('placa')) throw erro.entrada('O arquivo precisa da coluna "placa" (e "renavam"). A primeira linha é o cabeçalho.');
  if (!lido.linhas.length) throw erro.entrada('O arquivo não tem linhas de veículos.');
  const hash = crypto.createHash('sha256').update(texto).digest('hex');
  const anteriores = new Set((await c.query(`SELECT l.placa FROM lote_placas_linhas l JOIN lotes_placas p ON p.id = l.lote_id
    WHERE p.conta_id = $1 AND l.aceita`, [conta.id])).rows.map((r) => r.placa));
  const resultado = conferir(lido.linhas, anteriores);
  const aceitas = resultado.filter((r) => r.aceita).length;
  const lote = uma(await c.query(`INSERT INTO lotes_placas (tenant_id, conta_id, arquivo, hash, aceitas, rejeitadas, criado_por, criado_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, conta_id, hash) DO NOTHING RETURNING *`,
  [ctx.tenantId, conta.id, String(arquivo || 'placas.csv').slice(0, 160), hash, aceitas, resultado.length - aceitas, ctx.usuario?.id || null, relogio.agora()]));
  if (!lote) throw erro.conflito('Este mesmo arquivo já foi importado para esta conta.');
  for (const r of resultado) {
    await c.query(`INSERT INTO lote_placas_linhas (tenant_id, lote_id, linha, placa, renavam, aceita, motivo) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.tenantId, lote.id, r.linha, r.placa ? String(r.placa).slice(0, 20) : null, r.renavam ? String(r.renavam).slice(0, 20) : null, r.aceita, r.motivo]);
  }
  await auditar(c, ctx, { acao: 'onboarding.placas_conferidas', entidade: 'conta', entidadeId: conta.id, depois: { lote: lote.id, aceitas, rejeitadas: lote.rejeitadas } });
  await publicar(c, ctx, { tipo: 'onboarding.placas_conferidas', agregado: 'conta', agregadoId: conta.id, payload: { loteId: lote.id, aceitas, rejeitadas: lote.rejeitadas } });
  return { lote: lote.id, aceitas, rejeitadas: lote.rejeitadas, rejeicoes: resultado.filter((r) => !r.aceita) };
}

/** Rejeições tratadas sem novo arquivo (ex.: veículos vendidos ficam fora), com motivo. */
async function tratarRejeicoes(c, ctx, loteId, motivo) {
  const l = uma(await c.query('SELECT * FROM lotes_placas WHERE id = $1 FOR UPDATE', [loteId]));
  if (!l) throw erro.naoEncontrado('Lote de placas');
  if (!l.rejeitadas) throw erro.regra('sem_rejeicoes', 'Este lote não tem rejeições.');
  if (l.rejeicoes_tratadas_em) throw erro.conflito('As rejeições deste lote já foram tratadas.');
  await c.query('UPDATE lotes_placas SET rejeicoes_tratadas_em = $2, rejeicoes_tratadas_por = $3, rejeicoes_motivo = $4 WHERE id = $1', [l.id, relogio.agora(), ctx.usuario.id, motivo]);
  await auditar(c, ctx, { acao: 'onboarding.rejeicoes_tratadas', entidade: 'conta', entidadeId: l.conta_id, motivo, depois: { lote: l.id, rejeitadas: l.rejeitadas } });
  return { ok: true };
}

async function listar(c, contaId) {
  const lotes = (await c.query(`SELECT p.id, p.arquivo, p.aceitas, p.rejeitadas, p.criado_em, p.rejeicoes_tratadas_em, p.rejeicoes_motivo, u.nome AS criado_por_nome
    FROM lotes_placas p LEFT JOIN usuarios u ON u.id = p.criado_por WHERE p.conta_id = $1 ORDER BY p.criado_em DESC LIMIT 20`, [contaId])).rows;
  const ultimo = lotes[0];
  const rejeicoes = ultimo ? (await c.query('SELECT linha, placa, renavam, motivo FROM lote_placas_linhas WHERE lote_id = $1 AND NOT aceita ORDER BY linha LIMIT 500', [ultimo.id])).rows : [];
  return { lotes, rejeicoesDoUltimo: rejeicoes };
}

/** Verificação do checklist: último lote sem rejeição pendente e exportação para a Platform confirmada depois dele. */
async function verificarItem(c, contaId) {
  const l = uma(await c.query('SELECT * FROM lotes_placas WHERE conta_id = $1 ORDER BY criado_em DESC LIMIT 1', [contaId]));
  if (!l || !l.aceitas || (l.rejeitadas && !l.rejeicoes_tratadas_em)) return null;
  const e = uma(await c.query(`SELECT arquivo FROM exportacoes WHERE tipo = 'platform_placas_onboarding' AND estado = 'confirmado' AND resolvido_em >= $1
    ORDER BY resolvido_em DESC LIMIT 1`, [l.criado_em]));
  return e ? `Lote ${l.arquivo}: ${l.aceitas} placa(s) aceita(s)${l.rejeitadas ? `, ${l.rejeitadas} rejeição(ões) tratada(s)` : ''}; arquivo ${e.arquivo} confirmado na Platform` : null;
}

module.exports = { normalizarPlaca, renavamValido, conferir, importar, tratarRejeicoes, listar, verificarItem };
