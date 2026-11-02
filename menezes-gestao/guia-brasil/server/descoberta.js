// Descoberta: um destino para QUALQUER lugar, montado na hora (decisão G-017).
//  - buscarLugares("Ouro Preto")  → OpenStreetMap (Nominatim): nome e coordenadas;
//  - nomeDoLugar(lat, lng)         → OpenStreetMap (Nominatim reverso): "Vitória, Espírito Santo";
//  - gerarPacote({ lat, lng })     → Wikipédia em português: artigos com coordenadas num raio de até 10 km,
//                                     com o resumo de cada um, no mesmo formato dos pacotes curados (validarPacote).
// Texto da Wikipédia (CC BY-SA): cada ponto leva `fonte` com o link do artigo, mostrado no app.
// Cache em memória (lugares iguais não batem de novo nos serviços) e chamadas ao Nominatim espaçadas (≤ 1/s).
import { validarPacote, VERSAO_PACOTE, distanciaM } from '../public/js/nucleo.js';

const AGENTE = 'GuIA-Brasil/0.1 (+https://github.com/rodrigaomenezes/geral)';
const WIKI = 'https://pt.wikipedia.org/w/api.php';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const RAIO_M = 10000; // máximo da busca por coordenadas da Wikipédia
const MAX_PONTOS = 30;
const CACHE_MS = 24 * 3600000;
const TEMPO_MAX_MS = 15000;

export class ErroDescoberta extends Error {}

function criarCache() {
  const m = new Map();
  return {
    obter(k) { const v = m.get(k); if (!v) return undefined; if (Date.now() - v.em > CACHE_MS) { m.delete(k); return undefined; } return v.valor; },
    guardar(k, valor) { if (m.size > 500) m.delete(m.keys().next().value); m.set(k, { valor, em: Date.now() }); },
  };
}

/** Frases de um texto em português (para cortar o resumo em níveis). */
export function frases(texto) {
  return String(texto || '').replace(/\s+/g, ' ').trim()
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ"“(0-9])/)
    .map((f) => f.trim()).filter(Boolean);
}

function juntarAte(lista, maxChars) {
  let out = '';
  for (const f of lista) { if ((out + ' ' + f).trim().length > maxChars && out) break; out = (out + ' ' + f).trim(); }
  return out;
}

/** Artigo da Wikipédia → ponto do pacote (ou null se o texto for curto demais para narrar). */
export function pontoDeArtigo(a) {
  const fs = frases(a.extract);
  const longo = juntarAte(fs, 900);
  if (longo.length < 60) return null;
  const curto = fs[0].length >= 20 ? fs[0] : juntarAte(fs, 200);
  const medio = juntarAte(fs, 420);
  return {
    id: `w${a.pageid}`,
    nome: a.title,
    categoria: 'lugar',
    lat: +a.lat.toFixed(6), lng: +a.lon.toFixed(6),
    raioM: 60,
    ...(fs[1] && fs[1].length >= 20 && fs[1].length <= 220 ? { teaser: fs[1] } : {}),
    narrativa: { curto, medio, longo },
    curiosidades: [],
    perguntas: [],
    fonte: { nome: 'Wikipédia', url: `https://pt.wikipedia.org/?curid=${a.pageid}` },
  };
}

export function criarDescoberta({ fetchImpl = fetch } = {}) {
  const cache = criarCache();
  let ultimoNominatim = 0;

  async function obterJson(url, nominatim = false) {
    if (nominatim) { // política de uso do Nominatim: no máximo 1 pedido por segundo
      const espera = ultimoNominatim + 1100 - Date.now();
      if (espera > 0) await new Promise((r) => setTimeout(r, espera));
      ultimoNominatim = Date.now();
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TEMPO_MAX_MS);
    try {
      const r = await fetchImpl(url, { headers: { 'user-agent': AGENTE, 'accept-language': 'pt-BR,pt' }, signal: ctl.signal });
      if (!r.ok) throw new ErroDescoberta(`Serviço de mapas respondeu ${r.status}.`);
      return await r.json();
    } catch (e) {
      if (e instanceof ErroDescoberta) throw e;
      throw new ErroDescoberta('Não consegui consultar os mapas agora. Tente de novo em instantes.');
    } finally { clearTimeout(t); }
  }

  /** Busca de lugares pelo nome. Devolve até 6 { nome, detalhe, lat, lng }. */
  async function buscarLugares(q) {
    const chave = `b:${q.toLowerCase()}`;
    const c = cache.obter(chave); if (c) return c;
    const u = `${NOMINATIM}/search?${new URLSearchParams({ q, format: 'jsonv2', limit: '6', addressdetails: '1' })}`;
    const lista = (await obterJson(u, true)).map((l) => ({
      nome: l.name || String(l.display_name || '').split(',')[0],
      detalhe: String(l.display_name || '').split(',').slice(1, 4).map((x) => x.trim()).filter(Boolean).join(', '),
      lat: +(+l.lat).toFixed(6), lng: +(+l.lon).toFixed(6),
    })).filter((l) => l.nome && Number.isFinite(l.lat) && Number.isFinite(l.lng));
    cache.guardar(chave, lista);
    return lista;
  }

  /** Nome curto do lugar: "Vitória, Espírito Santo". */
  async function nomeDoLugar(lat, lng) {
    const chave = `r:${lat.toFixed(2)},${lng.toFixed(2)}`;
    const c = cache.obter(chave); if (c) return c;
    let nome = 'Perto de você', cidade = 'Perto de você', pais = '';
    try {
      const r = await obterJson(`${NOMINATIM}/reverse?${new URLSearchParams({ lat, lon: lng, format: 'jsonv2', zoom: '12', addressdetails: '1' })}`, true);
      const a = r.address || {};
      cidade = a.city || a.town || a.village || a.municipality || a.suburb || r.name || cidade;
      nome = [cidade, a.state].filter(Boolean).join(', ');
      pais = a.country || '';
    } catch { /* sem nome: segue com "Perto de você" */ }
    const v = { nome, cidade, pais };
    cache.guardar(chave, v);
    return v;
  }

  /** Pacote de pontos ao redor de (lat, lng). `nome` opcional (vem da busca). */
  async function gerarPacote({ lat, lng, nome }) {
    const chave = `p:${lat.toFixed(3)},${lng.toFixed(3)}`;
    const c = cache.obter(chave); if (c) return c;
    const geo = await obterJson(`${WIKI}?${new URLSearchParams({
      action: 'query', list: 'geosearch', gscoord: `${lat}|${lng}`, gsradius: String(RAIO_M), gslimit: '50', format: 'json', formatversion: '2', origin: '*' })}`);
    const achados = (geo.query && geo.query.geosearch) || [];
    if (!achados.length) throw new ErroDescoberta('Não encontrei pontos com história registrada perto daqui. Tente outro lugar ou uma cidade próxima.');
    const textos = new Map();
    for (let i = 0; i < achados.length; i += 20) { // a API devolve no máximo 20 resumos por pedido
      const ids = achados.slice(i, i + 20).map((a) => a.pageid).join('|');
      const r = await obterJson(`${WIKI}?${new URLSearchParams({
        action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '20', pageids: ids, format: 'json', formatversion: '2', origin: '*' })}`);
      for (const pg of (r.query && r.query.pages) || []) textos.set(pg.pageid, pg.extract || '');
    }
    const pois = achados
      .map((a) => pontoDeArtigo({ ...a, extract: textos.get(a.pageid) }))
      .filter(Boolean)
      .slice(0, MAX_PONTOS);
    if (pois.length < 2) throw new ErroDescoberta('Achei pouca coisa com história registrada perto daqui. Tente uma cidade próxima.');
    const lugar = await nomeDoLugar(lat, lng);
    const centro = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    // Roteiro de demonstração: do mais perto do centro, sempre para o vizinho mais próximo ainda não visitado.
    const rota = []; const resto = [...pois]; let atual = centro;
    while (resto.length && rota.length < 12) {
      resto.sort((x, y) => distanciaM(atual, x) - distanciaM(atual, y));
      const prox = resto.shift(); rota.push(prox.id); atual = prox;
    }
    const pacote = {
      versao: VERSAO_PACOTE,
      id: `lugar-${centro.lat.toFixed(3)}-${centro.lng.toFixed(3)}`.replace(/\./g, '-').replace(/--/g, '-m').toLowerCase(),
      nome: nome ? `${nome} · arredores` : `${lugar.nome} · arredores`,
      cidade: nome || lugar.cidade,
      pais: lugar.pais,
      idioma: 'pt-BR',
      atualizadoEm: new Date().toISOString().slice(0, 10),
      gerado: true,
      fonte: 'Wikipédia (CC BY-SA) e OpenStreetMap',
      observacao: 'Destino montado automaticamente a partir de artigos da Wikipédia com localização. Sem curadoria: confira o que for importante.',
      centro,
      rotaDemonstracao: rota,
      pois,
      perguntasGerais: [],
      avisos: [],
    };
    const erros = validarPacote(pacote);
    if (erros.length) throw new ErroDescoberta(`Destino gerado inválido: ${erros[0]}`);
    cache.guardar(chave, pacote);
    return pacote;
  }

  return { buscarLugares, nomeDoLugar, gerarPacote };
}
