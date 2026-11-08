// "Sua IA": cliente da OpenRouter com a chave da própria pessoa (obtida por login OAuth no app, decisão G-015).
// Expõe a mesma interface que o guia.js já usa (`beta.messages.create`, formato da API da Anthropic) e traduz para a
// API de chat da OpenRouter. Assim o guia (contexto do lugar, foto, regras) não muda conforme o provedor.
// A chave chega por cabeçalho a cada pedido e só existe dentro deste objeto: não é gravada nem registrada em log.

export const URL_OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
export const MODELO_PADRAO_USUARIO = 'openrouter/auto';
const TEMPO_MAX_MS = 45000;
const MAX_RESULTADOS_WEB = 4;

/** Erro com status HTTP da OpenRouter: 401 = conexão inválida, 402 = sem créditos. */
export class ErroIaUsuario extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

export const chaveValida = (k) => typeof k === 'string' && /^sk-or-[A-Za-z0-9_-]{10,200}$/.test(k);
export const modeloValido = (m) => typeof m === 'string' && /^[A-Za-z0-9._:/-]{3,100}$/.test(m);

/** Converte um bloco de conteúdo do formato Anthropic para o formato de chat da OpenRouter. */
function converterConteudo(conteudo) {
  if (typeof conteudo === 'string') return conteudo;
  return conteudo.map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if (b.type === 'image') return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    throw new Error(`Bloco não suportado: ${b.type}`);
  });
}

/** Pedido no formato Anthropic → corpo da OpenRouter. Exportado para teste. */
export function traduzirPedido(req, modelo) {
  const corpo = {
    model: modelo,
    max_tokens: req.max_tokens,
    messages: [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: converterConteudo(m.content) })),
    ],
  };
  // Busca na web (G-019): a ferramenta da Anthropic vira o plugin "web" da OpenRouter, cobrado da conta da pessoa.
  const web = (req.tools || []).find((t) => t.name === 'web_search');
  if (web) corpo.plugins = [{ id: 'web', max_results: MAX_RESULTADOS_WEB }];
  const formato = req.output_config && req.output_config.format;
  if (formato && formato.type === 'json_schema') {
    corpo.response_format = { type: 'json_schema', json_schema: { name: 'resposta', strict: true, schema: formato.schema } };
  }
  return corpo;
}

/** Resposta da OpenRouter → formato que o guia.js lê (`model`, `stop_reason`, `content[].text`). Exportado para teste. */
export function traduzirResposta(r) {
  const escolha = (r.choices || [])[0];
  if (!escolha) throw new Error('A IA não devolveu resposta.');
  let texto = escolha.message && escolha.message.content;
  if (Array.isArray(texto)) texto = texto.map((p) => p.text || '').join('');
  // Alguns modelos embrulham o JSON em ```json ... ```: tiramos para o guia conseguir ler.
  texto = String(texto || '').trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
  // Fontes da busca na web: anotações url_citation (formato da OpenRouter) viram a lista `fontes` que o guia lê.
  const fontes = ((escolha.message && escolha.message.annotations) || [])
    .filter((a) => a && a.type === 'url_citation' && a.url_citation && a.url_citation.url)
    .map((a) => ({ titulo: a.url_citation.title || a.url_citation.url, url: a.url_citation.url }));
  return {
    model: r.model || '',
    stop_reason: escolha.finish_reason === 'content_filter' ? 'refusal' : 'end_turn',
    content: [{ type: 'text', text: texto }],
    ...(fontes.length ? { fontes } : {}),
  };
}

/** Cliente com a chave da pessoa. `fetchImpl` permite testar sem rede. */
export function clienteOpenRouter(chave, modelo = MODELO_PADRAO_USUARIO, { fetchImpl = fetch, origem = 'https://geral-production.up.railway.app' } = {}) {
  return {
    provedor: 'openrouter',
    beta: { messages: { create: async (req) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TEMPO_MAX_MS);
      try {
        const resp = await fetchImpl(URL_OPENROUTER, {
          method: 'POST',
          headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json', 'http-referer': origem, 'x-title': 'GuIA Brasil' },
          body: JSON.stringify(traduzirPedido(req, modelo)),
          signal: ctl.signal,
        });
        const dados = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          const msg = (dados.error && dados.error.message) || `OpenRouter respondeu ${resp.status}`;
          throw new ErroIaUsuario(resp.status, String(msg).slice(0, 160));
        }
        return traduzirResposta(dados);
      } finally { clearTimeout(t); }
    } } },
  };
}
