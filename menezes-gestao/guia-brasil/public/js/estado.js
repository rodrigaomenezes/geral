// Estado guardado no aparelho (localStorage). Tudo com try/catch: em aba anônima ou com armazenamento cheio,
// o app continua funcionando só em memória. A rota do usuário nunca sai daqui (privacidade, RNF01).
const PREFIXO = 'guia.v1.';
const memoria = new Map();

export function ler(chave, padrao) {
  try {
    const v = localStorage.getItem(PREFIXO + chave);
    return v == null ? (memoria.has(chave) ? memoria.get(chave) : padrao) : JSON.parse(v);
  } catch { return memoria.has(chave) ? memoria.get(chave) : padrao; }
}

export function gravar(chave, valor) {
  memoria.set(chave, valor);
  try { localStorage.setItem(PREFIXO + chave, JSON.stringify(valor)); return true; } catch { return false; }
}

export function apagarTudo() {
  memoria.clear();
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIXO)).forEach((k) => localStorage.removeItem(k)); } catch { /* nada a fazer */ }
}

export const PREFS_PADRAO = { frequencia: 'normal', nivel: 'medio', voz: true, simulacao: false, auto: false, maxPorHora: null };

/** Fila do que só a internet resolve. Fotos ocupam espaço: guardamos no máximo MAX_FOTOS. */
export const MAX_FILA = 20;
export const MAX_FOTOS = 4;

export function filaAdicionar(item) {
  const fila = ler('fila', []);
  if (fila.some((f) => f.id === item.id)) return fila;
  if (item.tipo === 'foto' && fila.filter((f) => f.tipo === 'foto').length >= MAX_FOTOS) return null;
  if (fila.length >= MAX_FILA) return null;
  fila.push(item);
  gravar('fila', fila); // se o aparelho estiver sem espaço, a fila fica em memória até o app fechar
  return fila;
}

export function filaRemover(id) {
  gravar('fila', ler('fila', []).filter((f) => f.id !== id));
}

export const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
