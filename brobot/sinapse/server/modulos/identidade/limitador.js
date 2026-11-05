'use strict';
// Limite de tentativas de login (R-04). Regra pura com relógio injetável: falhas por chave numa janela;
// passou do limite, a chave fica bloqueada até a janela vencer. Acerto zera a chave.
// Memória do processo (uma réplica hoje); a limpeza é feita na própria chamada, sem setInterval.

function criarLimitador({ limite, janelaMs, maxChaves = 10000, agora = () => Date.now() }) {
  const falhas = new Map(); // chave → { n, desde }
  const vigente = (x, t) => x && t - x.desde < janelaMs;
  function limpar(t) {
    if (falhas.size < maxChaves) return;
    for (const [k, x] of falhas) if (!vigente(x, t)) falhas.delete(k);
    while (falhas.size >= maxChaves) falhas.delete(falhas.keys().next().value); // mais antigas primeiro
  }
  return {
    /** null se pode tentar; senão, segundos até poder de novo. */
    bloqueado(chave) {
      const t = agora(); const x = falhas.get(chave);
      if (!vigente(x, t)) { falhas.delete(chave); return null; }
      return x.n >= limite ? Math.ceil((x.desde + janelaMs - t) / 1000) : null;
    },
    falhou(chave) {
      const t = agora(); limpar(t);
      const x = falhas.get(chave);
      if (vigente(x, t)) x.n += 1; else falhas.set(chave, { n: 1, desde: t });
    },
    acertou(chave) { falhas.delete(chave); },
  };
}

module.exports = { criarLimitador };
