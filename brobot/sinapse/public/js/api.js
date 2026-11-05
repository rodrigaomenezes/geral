// Cliente da API: JSON, cookie de sessão e erro padronizado { error: { code, message, details } }.

export class ErroApi extends Error {
  constructor(status, corpo) {
    super(corpo?.error?.message || 'Não foi possível concluir. Tente de novo.');
    this.status = status;
    this.code = corpo?.error?.code;
    this.details = corpo?.error?.details;
  }
}

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(`/api${caminho}`, {
    method: metodo,
    headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    credentials: 'same-origin',
  });
  const dados = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    const e = new ErroApi(r.status, dados);
    if (r.status === 401) window.dispatchEvent(new CustomEvent('sessao-expirada'));
    throw e;
  }
  return dados;
}

export const api = {
  get: (c) => chamar('GET', c),
  post: (c, corpo = {}) => chamar('POST', c, corpo),
};

/** Mensagem de erro com os campos que faltam, para mostrar à pessoa. */
export function textoErro(e) {
  if (!(e instanceof ErroApi)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  const det = Array.isArray(e.details) ? e.details.map((d) => `${d.campo}: ${d.problema}`).join('; ') : '';
  return det ? `${e.message} (${det})` : e.message;
}
