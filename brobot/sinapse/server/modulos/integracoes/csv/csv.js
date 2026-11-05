'use strict';
// CSV (RFC 4180) sem dependência: separador detectado (";" do Excel brasileiro ou ","), aspas, quebra de linha
// dentro de aspas, BOM. Cabeçalhos normalizados (minúsculas, sem acento, espaços → "_").
// Exportação protegida contra injeção de fórmula (célula começando com = + - @ ganha apóstrofo).

const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizarCabecalho = (s) => semAcento(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function detectarSeparador(texto) {
  const linha = texto.split(/\r?\n/, 1)[0] || '';
  return (linha.match(/;/g) || []).length >= (linha.match(/,/g) || []).length ? ';' : ',';
}

function ler(textoBruto, { maxLinhas = 50000 } = {}) {
  const texto = String(textoBruto || '').replace(/^﻿/, '');
  if (!texto.trim()) return { cabecalhos: [], linhas: [] };
  const sep = detectarSeparador(texto);
  const registros = [];
  let campo = ''; let reg = []; let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch;
      continue;
    }
    if (ch === '"' && campo === '') { aspas = true; continue; }
    if (ch === sep) { reg.push(campo); campo = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      reg.push(campo); campo = '';
      if (reg.some((x) => x.trim() !== '')) registros.push(reg);
      reg = [];
      if (registros.length > maxLinhas + 1) throw new Error(`Arquivo com mais de ${maxLinhas} linhas. Divida em partes.`);
      continue;
    }
    campo += ch;
  }
  reg.push(campo);
  if (reg.some((x) => x.trim() !== '')) registros.push(reg);
  const [cab = [], ...resto] = registros;
  const cabecalhos = cab.map(normalizarCabecalho);
  const linhas = resto.map((r, i) => ({ numero: i + 2, valores: Object.fromEntries(cabecalhos.map((h, j) => [h, (r[j] ?? '').trim()])) }));
  return { cabecalhos, linhas, separador: sep };
}

const celula = (v) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(', ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Gera CSV com ";" (abre direto no Excel em português) e BOM UTF-8. */
function escrever(colunas, linhas) {
  const cab = colunas.map((c) => celula(c.titulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => celula(typeof c.valor === 'function' ? c.valor(l) : l[c.campo])).join(';'));
  return `﻿${[cab, ...corpo].join('\r\n')}\r\n`;
}

/** Datas aceitas: 31/12/2026, 31/12/2026 10:30, 2026-12-31, ISO completo. Hora sem fuso = Brasília. */
function data(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], (m[4] ? +m[4] : 12) + 3, m[5] ? +m[5] : 0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 15));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const cnpj = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 14 ? d : null; };

module.exports = { ler, escrever, data, cnpj, normalizarCabecalho };
