// O guia: responde perguntas e explica fotos. Dois motores com o mesmo contrato de saída:
//  - 'ia'    : Claude (texto e visão), ativo quando há ANTHROPIC_API_KEY e o pacote @anthropic-ai/sdk;
//  - 'local' : regras do núcleo sobre o pacote (o mesmo que o app usa offline). Nunca falha.
// Se a IA falhar ou demorar, a resposta cai para o motor local e informa o erro: o usuário nunca fica sem resposta.
import { proximos, candidatosFoto, responderLocal, posicaoValida } from '../public/js/nucleo.js';

export const MODELO = process.env.GUIA_IA_MODELO || 'claude-opus-5-5';

/** Quando a pessoa ainda não escolheu destino: sem pontos curados, a IA usa conhecimento geral e a posição. */
export const SEM_DESTINO = Object.freeze({ id: null, nome: 'nenhum destino escolhido', semDestino: true, pois: [], perguntasGerais: [], avisos: [] });

const SISTEMA = `Você é o GuIA Brasil, um guia turístico experiente, simpático e preciso, falando com um viajante pelo celular.
Regras:
- Responda no idioma do viajante, em tom de conversa de guia. Primeiro o essencial em 2 a 4 frases; aprofunde só se pedirem.
- Use primeiro o CONTEÚDO DO PACOTE fornecido (curado). Pode complementar com conhecimento geral consolidado.
- Separe fato de lenda ("conta-se que..."). Se não tiver certeza, diga que não tem certeza.
- Nunca invente horários, preços, telefones ou informações de segurança: diga para conferir em fonte oficial.
- Fale de coisas que o viajante pode ver ou fazer perto de onde está. Sem listas longas, sem markdown.`;

const ESQUEMA_FOTO = {
  type: 'object',
  additionalProperties: false,
  properties: {
    identificado: { type: 'boolean', description: 'true se reconheceu com segurança o que aparece na foto' },
    poiId: { type: ['string', 'null'], description: 'id de um ponto do pacote, se a foto mostra um deles; senão null' },
    titulo: { type: 'string', description: 'nome curto do que aparece (ex.: "Elevador Lacerda", "Acarajé", "Placa em inglês")' },
    explicacao: { type: 'string', description: 'explicação de guia em 2 a 5 frases' },
    curiosidades: { type: 'array', items: { type: 'string' }, description: 'de 0 a 3 curiosidades curtas e verdadeiras' },
  },
  required: ['identificado', 'poiId', 'titulo', 'explicacao', 'curiosidades'],
};

/** Cliente da API, se houver chave e o pacote estiver instalado. */
export async function criarCliente(env = process.env) {
  if (env.GUIA_IA === '0' || !(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)) return null;
  try {
    const mod = await import('@anthropic-ai/sdk');
    const Anthropic = mod.default || mod.Anthropic;
    return new Anthropic({ maxRetries: 1, timeout: 45000 });
  } catch {
    return null;
  }
}

/** Trecho do pacote relevante para a posição: o ponto em foco e os mais próximos (limita o custo por chamada). */
function contexto(pacote, pos, poiId) {
  const perto = posicaoValida(pos) ? proximos(pacote.pois, pos, 600).slice(0, 5) : [];
  const ids = new Set(perto.map((x) => x.poi.id));
  const foco = pacote.pois.find((p) => p.id === poiId);
  const lista = [...(foco && !ids.has(foco.id) ? [{ poi: foco, distancia: null }] : []), ...perto];
  const usados = lista.length ? lista : pacote.pois.slice(0, 4).map((poi) => ({ poi, distancia: null }));
  const linhas = usados.map(({ poi, distancia }) => [
    `## ${poi.nome} (id: ${poi.id}${distancia != null ? `, a ${Math.round(distancia)} m` : ''}${poi.id === poiId ? ', EM FOCO' : ''})`,
    poi.narrativa.longo,
    ...(poi.curiosidades || []).map((c) => `Curiosidade: ${c}`),
    ...(poi.perguntas || []).map((f) => `P: ${f.p} R: ${f.r}`),
  ].join('\n'));
  const onde = posicaoValida(pos) ? ` · posição do viajante: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : ' · posição desconhecida';
  if (pacote.semDestino) return `SEM DESTINO BAIXADO${onde}. Não há conteúdo curado: responda com conhecimento geral consolidado e deixe claro quando não tiver certeza.`;
  return `CONTEÚDO DO PACOTE "${pacote.nome}"${onde}\n\n${linhas.join('\n\n')}`;
}

/** Erro da IA para a resposta. Com a IA da pessoa, 401/402 viram um aviso que o app sabe mostrar. */
function erroDaIa(e, cliente) {
  const out = { erroIa: String(e?.message || e).slice(0, 160) };
  if (cliente && cliente.provedor === 'openrouter' && (e?.status === 401 || e?.status === 403)) out.iaUsuario = 'invalida';
  if (cliente && cliente.provedor === 'openrouter' && e?.status === 402) out.iaUsuario = 'sem-creditos';
  return out;
}

const NIVEL = { curto: 'Responda em no máximo 2 frases.', medio: 'Responda em 2 a 4 frases.', longo: 'Pode responder com até 2 parágrafos curtos.' };

const SEM_RESPOSTA = {
  semIa: 'Ainda não sei responder isso. Por enquanto respondo só sobre o conteúdo desta viagem: os pontos turísticos, a história e a comida típica. Experimente uma das sugestões abaixo.',
  iaFalhou: 'Não consegui consultar a IA agora e essa resposta não está no conteúdo desta viagem. Tente de novo em instantes.',
  semDestino: 'Para eu responder sem IA, escolha um destino em Viagem: aí falo dos pontos turísticos, da história e da comida típica. Para perguntas livres sobre qualquer lugar, conecte sua IA em Viagem.',
};

function respostaLocalConversa(pacote, mensagem, poiId, motivo = 'semIa') {
  const r = responderLocal(pacote, mensagem, poiId);
  if (r) return { texto: r.texto, poiId: r.poiId, motor: 'local', confianca: r.confianca };
  return { texto: SEM_RESPOSTA[pacote.semDestino && motivo === 'semIa' ? 'semDestino' : motivo], poiId: null, motor: 'local', confianca: 0, semResposta: true };
}

/** Conversa: { pacote, mensagem, pos, poiId, historico:[{papel:'usuario'|'guia', texto}], nivel } */
export async function conversar(entrada, cliente) {
  const { pacote, mensagem, pos, poiId, historico = [], nivel = 'medio' } = entrada;
  if (!cliente) return respostaLocalConversa(pacote, mensagem, poiId);
  try {
    const mensagens = [];
    for (const h of historico.slice(-8)) {
      const role = h.papel === 'guia' ? 'assistant' : 'user';
      if (mensagens.length && mensagens.at(-1).role === role) mensagens.at(-1).content += `\n${h.texto}`;
      else if (mensagens.length || role === 'user') mensagens.push({ role, content: h.texto });
    }
    const pedido = `${contexto(pacote, pos, poiId)}\n\n${NIVEL[nivel] || NIVEL.medio}\n\nPergunta do viajante: ${mensagem}`;
    if (mensagens.length && mensagens.at(-1).role === 'user') mensagens.push({ role: 'assistant', content: 'Certo.' });
    mensagens.push({ role: 'user', content: pedido });
    const resp = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 900,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SISTEMA,
      messages: mensagens,
    });
    if (resp.stop_reason === 'refusal') throw new Error('A IA não respondeu a esta pergunta.');
    const texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!texto) throw new Error('Resposta vazia da IA.');
    return { texto, poiId: poiId || null, motor: 'ia', modelo: resp.model, provedor: cliente.provedor || 'servidor' };
  } catch (e) {
    return { ...respostaLocalConversa(pacote, mensagem, poiId, 'iaFalhou'), ...erroDaIa(e, cliente) };
  }
}

function fotoLocal(pacote, pos, direcao) {
  const [melhor, ...outros] = posicaoValida(pos) ? candidatosFoto({ pois: pacote.pois, pos, direcao }) : [];
  if (!melhor || melhor.confianca < 0.45) {
    return { identificado: false, titulo: 'Não identifiquei com segurança', explicacao: 'Sem internet eu reconheço só os pontos turísticos desta viagem, usando a sua posição e a direção da câmera. Guardei a foto: quando a conexão voltar, eu explico com detalhes.', curiosidades: [], poiId: null, alternativas: outros.map((c) => ({ poiId: c.poi.id, nome: c.poi.nome })), motor: 'local', confianca: melhor ? melhor.confianca : 0 };
  }
  return { identificado: true, poiId: melhor.poi.id, titulo: melhor.poi.nome, explicacao: melhor.poi.narrativa.medio, curiosidades: melhor.poi.curiosidades || [], alternativas: outros.map((c) => ({ poiId: c.poi.id, nome: c.poi.nome })), motor: 'local', confianca: melhor.confianca };
}

/** Foto: { pacote, imagem:{mime, base64}, pos, direcao, pergunta } */
export async function explicarFoto(entrada, cliente) {
  const { pacote, imagem, pos, direcao, pergunta } = entrada;
  if (!cliente) return fotoLocal(pacote, pos, direcao);
  try {
    const candidatos = posicaoValida(pos) ? candidatosFoto({ pois: pacote.pois, pos, direcao }) : [];
    const dica = candidatos.length ? `Pontos do pacote prováveis pela posição e direção da câmera: ${candidatos.map((c) => `${c.poi.nome} (id ${c.poi.id}, ${c.distancia} m)`).join('; ')}.` : 'Sem pista de posição.';
    const resp = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 1200,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_FOTO } },
      system: SISTEMA,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: imagem.mime, data: imagem.base64 } },
        { type: 'text', text: `${contexto(pacote, pos, candidatos[0]?.poi.id)}\n\n${dica}\n\nO viajante tirou esta foto${pergunta ? ` e pergunta: "${pergunta}"` : ' e quer saber o que é'}. Pode ser um monumento, obra de arte, prato, placa, planta ou qualquer outra coisa. Se for texto em outro idioma, traduza e explique. Use poiId só se a foto mostrar claramente um ponto do pacote.` },
      ] }],
    });
    if (resp.stop_reason === 'refusal') throw new Error('A IA não analisou esta foto.');
    const bloco = resp.content.find((b) => b.type === 'text');
    const r = JSON.parse(bloco ? bloco.text : '{}');
    const poiValido = pacote.pois.some((p) => p.id === r.poiId) ? r.poiId : null;
    return { identificado: !!r.identificado, poiId: poiValido, titulo: String(r.titulo || '').slice(0, 120) || 'Foto analisada',
      explicacao: String(r.explicacao || '').slice(0, 1500), curiosidades: (r.curiosidades || []).slice(0, 3).map((c) => String(c).slice(0, 300)),
      alternativas: [], motor: 'ia', modelo: resp.model, provedor: cliente.provedor || 'servidor' };
  } catch (e) {
    return { ...fotoLocal(pacote, pos, direcao), ...erroDaIa(e, cliente) };
  }
}
