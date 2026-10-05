'use strict';
// Amélia — interpretação de texto livre (digitado ou transcrito de áudio) em dados estruturados.
// Esta versão é determinística: só extrai o que está escrito na mensagem (RN-03) e devolve
// o trecho de origem de cada dado. Em produção, o time DEV avalia trocar por uma API de IA
// mantendo o mesmo contrato de entrada e saída.

const IMPLEMENTOS = ['bitrem', 'rodotrem', 'vanderleia', 'sider', 'baú', 'bau', 'graneleiro', 'graneleira', 'caçamba', 'cacamba', 'basculante',
  'tanque', 'frigorífico', 'frigorifico', 'porta-contêiner', 'porta contêiner', 'porta container', 'prancha', 'cegonha', 'carreta', 'truck', 'toco'];
const MERCADORIAS = ['açúcar', 'acucar', 'soja', 'milho', 'trigo', 'café', 'cafe', 'fertilizante', 'adubo', 'cimento', 'bebidas', 'bebida',
  'cerveja', 'refrigerante', 'eletrônicos', 'eletronicos', 'alimentos', 'grãos', 'graos', 'carne', 'frango', 'papel', 'celulose', 'madeira',
  'combustível', 'combustivel', 'etanol', 'calcário', 'calcario', 'minério', 'minerio', 'algodão', 'algodao', 'arroz', 'feijão', 'feijao',
  'leite', 'ração', 'racao', 'aço', 'aco', 'bobinas', 'pallets', 'paletes'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));

function interpretar(textoOriginal) {
  const texto = String(textoOriginal || '').slice(0, 2000);
  const entidades = [];
  const add = (campo, label, valor, trecho) => { if (!entidades.some((e) => e.campo === campo)) entidades.push({ campo, label, valor, trecho: trecho.trim() }); };
  let m;

  // Placa (Mercosul ABC1D23 ou antiga ABC1234), inclusive soletrada por voz ("R T B 4 F 27").
  if ((m = /\b([A-Z]{3})[\s-]?(\d[A-Z0-9]\d{2})\b/i.exec(texto)) || (m = /\b([A-Z])\s+([A-Z])\s+([A-Z])\s*[-\s]?\s*(\d)\s*([A-Z0-9])\s*(\d)\s*(\d)\b/i.exec(texto))) {
    const placa = m.slice(1).join('').toUpperCase();
    if (/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) add('placa', 'Placa', placa, m[0]);
  }
  // Código da operação
  if ((m = /\bOP[\s-]*(\d{4})[\s-]*(\d{4})\b/i.exec(texto))) add('codigo', 'Operação', `OP-${m[1]}-${m[2]}`, m[0]);
  // Tipo de operação
  if ((m = /\b(descarga|descarregar|descarregamento|entrega)\b/i.exec(texto))) add('tipo', 'Tipo de operação', 'DESCARGA', m[0]);
  else if ((m = /\b(carregar|carregamento|coleta|operação de carga|para carga|vou carregar)\b/i.exec(texto))) add('tipo', 'Tipo de operação', 'CARGA', m[0]);
  // Documentos
  if ((m = /\bmdf-?e\b\s*(?:n[º°o.]?\s*)?[:#]?\s*([\d][\d.\-/]{2,})/i.exec(texto))) add('mdfe', 'MDF-e', m[1].replace(/[.\-/]+$/, ''), m[0]);
  if ((m = /\bct-?e\b\s*(?:n[º°o.]?\s*)?[:#]?\s*([\d][\d.\-/]{2,})/i.exec(texto))) add('cte', 'CT-e', m[1].replace(/[.\-/]+$/, ''), m[0]);
  if ((m = /\b(?:nf-?e|nota fiscal|nota|nf)\b\s*(?:n[º°o.]?\s*)?[:#]?\s*([\d][\d.\-/]{2,})/i.exec(texto))) add('nfe', 'NF-e', m[1].replace(/[.\-/]+$/, ''), m[0]);
  // Peso
  if ((m = /(\d+(?:[.,]\d+)?)\s*(toneladas|tonelada|ton|t)\b/i.exec(texto))) add('pesoToneladas', 'Peso (t)', num(m[1]), m[0]);
  else if ((m = /(\d{1,3}(?:\.\d{3})+|\d+)\s*(kg|quilos)\b/i.exec(texto))) add('pesoToneladas', 'Peso (t)', Math.round(num(m[1]) / 10) / 100, m[0]);
  // Capacidade do veículo
  if ((m = /capacidade\s*(?:de|do veículo|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:toneladas|tonelada|ton|t)?\b/i.exec(texto))) add('capacidadeToneladas', 'Capacidade (t)', num(m[1]), m[0]);
  // Volume
  if ((m = /(\d+(?:[.,]\d+)?)\s*(m3|m³|metros cúbicos|pallets?|paletes?|volumes?|caixas?|sacas?)\b/i.exec(texto))) add('volume', 'Volume', `${m[1]} ${m[2]}`, m[0]);
  // Implemento
  const imp = IMPLEMENTOS.map(escapeRe).join('|');
  if ((m = new RegExp(`\\b(${imp})\\b`, 'i').exec(texto))) add('implemento', 'Implemento', m[1].toLowerCase(), m[0]);
  // Carga / mercadoria
  const merc = MERCADORIAS.map(escapeRe).join('|');
  if ((m = /tipo de carga\s*[:é]?\s*([A-Za-zÀ-ú ]{3,30}?)(?=[,.;]|$)/i.exec(texto))) add('mercadoria', 'Carga', m[1].trim().toLowerCase(), m[0]);
  else if ((m = new RegExp(`\\b(${merc})\\b`, 'i').exec(texto))) add('mercadoria', 'Carga', m[1].toLowerCase(), m[0]);
  // Local
  if ((m = /\b((?:CD|centro de distribuição|armazém|armazem|porto|fábrica|fabrica|usina|terminal|depósito|deposito|pátio|patio)\s+[A-Za-zÀ-ú0-9 ]{2,30}?)(?=\s*(?:[,.;]|$|\bdoca\b|\bcom\b|\bplaca\b|\bnota\b|\bnf))/i.exec(texto))) add('localNome', 'Local', m[1].trim(), m[0]);

  return { texto, entidades, compreendido: entidades.length > 0 };
}

/** Compara o que foi informado com o cadastro da operação (sem alterar o cadastro). */
function comparar(entidades, op) {
  const norm = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9à-ú]/gi, '');
  return entidades.map((e) => {
    const cadastrado = op[e.campo];
    if (cadastrado == null || cadastrado === '') return { ...e, cadastrado: null, confere: null };
    const confere = typeof e.valor === 'number' ? Math.abs(Number(cadastrado) - e.valor) < 0.01
      : norm(cadastrado).includes(norm(e.valor)) || norm(e.valor).includes(norm(cadastrado));
    return { ...e, cadastrado, confere };
  });
}

module.exports = { interpretar, comparar };
