'use strict';
// DEV-001 e RNF-006: texto que vai para incidente, melhoria ou evidência não pode carregar segredo. Mascara o que
// parece senha/token informado ("senha: xxx", "token=xxx", "Bearer xxx") e sequências longas que parecem chave.
// Não substitui o cuidado da equipe; evita o vazamento mais comum (colar o erro com a credencial junto).

const REGRAS = [
  [/\b(senha|password|passwd|pwd|token|secret|segredo|api[_-]?key|chave)(\s*[:=]\s*)(\S+)/gi, (_, k, sep) => `${k}${sep}[removido]`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, (_, k) => `${k} [removido]`],
  // Sequência longa parecida com chave; UUID (identificador de registro) fica, porque é referência e não segredo.
  [/\b[A-Za-z0-9_-]{32,}\b/g, (m) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m) ? m : '[removido]')],
];

function sanitizar(texto) {
  if (texto === null || texto === undefined) return texto;
  let s = String(texto);
  for (const [re, troca] of REGRAS) s = s.replace(re, troca);
  return s;
}

module.exports = { sanitizar };
