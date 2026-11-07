'use strict';
// Cores da marca (white-label) com contraste garantido (RNF-012): a cor primária e a de destaque recebem texto branco
// (botões, faixas, login), então só valem se o contraste com o branco for de pelo menos 4,5:1 (WCAG AA, texto comum).

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Devolve a cor (#rrggbb) se ela aguenta texto branco; senão undefined (a tela usa a cor padrão). */
const corComTextoBranco = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) && contraste(v, '#ffffff') >= 4.5 ? v : undefined);

module.exports = { contraste, corComTextoBranco };
