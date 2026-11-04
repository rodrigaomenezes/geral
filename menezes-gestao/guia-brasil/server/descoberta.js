// Descoberta: um destino para QUALQUER lugar, montado na hora (decisão G-017).
//  - buscarLugares("Ouro Preto")  → OpenStreetMap (Nominatim): nome e coordenadas;
//  - nomeDoLugar(lat, lng)         → OpenStreetMap (Nominatim reverso): "Vitória, Espírito Santo";
//  - ondeEstou(lat, lng)           → OpenStreetMap (Nominatim reverso, nível de prédio): "Mercado de Arte Popular · Centro".
//  - gerarPacote({ lat, lng })     → pontos turísticos ao redor (decisão G-018), no formato dos pacotes curados:
//      1) Wikidata: itens com coordenada num raio de 3 km (10 km se houver poucos), só os de tipo turístico
//         (igreja, museu, mercado, praça, monumento, patrimônio...); emissoras, empresas, escolas ficam de fora;
//      2) Wikipédia: artigos com coordenada, como complemento, com o mesmo filtro.
//      O texto vem do artigo da Wikipédia quando existe; senão, da descrição do Wikidata.
// Texto da Wikipédia (CC BY-SA) e do Wikidata (CC0): cada ponto leva `fonte` com o link, mostrado no app.
// Cache em memória (lugares iguais não batem de novo nos serviços) e chamadas ao Nominatim espaçadas (≤ 1/s).
import { validarPacote, VERSAO_PACOTE, distanciaM } from '../public/js/nucleo.js';

const AGENTE = 'GuIA-Brasil/0.1 (+https://github.com/rodrigaomenezes/geral)';
const WIKI = 'https://pt.wikipedia.org/w/api.php';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const WIKIDATA = 'https://query.wikidata.org/sparql';
const RAIO_M = 10000; // máximo da busca por coordenadas da Wikipédia
const RAIOS_WIKIDATA_KM = [3, 10]; // primeiro o bairro e o centro; amplia se achar pouco
const MIN_PONTOS_PERTO = 8;
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

// Tipo turístico → categoria do ponto. Vale o primeiro que casar com os tipos (P31) e a descrição do item.
const TIPOS = [
  [/igreja|catedral|capela|basílica|santuário|convento|mosteiro|templo|mesquita|sinagoga|terreiro/i, 'igreja'],
  [/museu|pinacoteca|galeria de arte/i, 'museu'],
  [/\bmercado\b|\bfeira livre\b|\bfeira\b(?! de santana)/i, 'mercado'],
  [/\bpraça|\blargo\b|\bparque\b|\bjardim\b|passeio público/i, 'praca'],
  [/monumento|estátua|escultura|memorial|obelisco|painéis|painel|mural|obra de arte|coreto|chafariz|relógio/i, 'monumento'],
  [/teatro|centro cultural|casa de cultura|biblioteca|arquivo|filarmônica|cinema histórico/i, 'cultura'],
  [/forte\b|fortaleza|farol|palácio|\bpaço\b|casarão|solar\b|sobrado|estação ferroviária|aqueduto|sítio arqueológico|ruínas?\b|patrim|tombad|interesse histórico|bem histórico|centro histórico/i, 'historico'],
  [/mirante|praia|cachoeira|lagoa|\blago\b|\bilha\b|\bmorro\b|\bserra\b|gruta|caverna|\bpico\b|parque nacional|parque estadual|reserva|área de proteção/i, 'natureza'],
];
// O que nunca é ponto de passeio, mesmo que o texto cite uma praça ou um patrimônio de passagem.
const FORA = /emissora|estação de rádio|\brádio\b|televis|jornal\b|clube de futebol|time de futebol|supermercado|shopping|hotel\b|aeroporto|torre de transmiss|estação meteorológica|ser humano|rodovia/i;

// Nome que já diz o que o lugar é ("Paço Municipal", "Igreja de...", "Coreto da Praça...").
const NOME_TURISTICO = /^(igreja|catedral|capela|basílica|santuário|convento|mosteiro|museu|monumento|memorial|estátua|chafariz|coreto|praça|largo|parque|mercado|teatro|palácio|paço|casarão|solar|forte|fortaleza|farol|mirante|cachoeira)\b/i;

/** Categoria turística de um item pelos tipos, pela descrição e pelo nome, ou null se não for ponto de passeio. */
export function categoriaTuristica(tipos = [], descricao = '', nome = '') {
  // Cada tipo é julgado sozinho: "empresa | patrimônio histórico" (uma filarmônica tombada) entra pelo segundo;
  // "emissora de televisão" não entra nem se a descrição citar a praça onde fica.
  const partes = [...tipos, descricao].filter(Boolean);
  if (partes.some((t) => FORA.test(t)) && !partes.some((t) => /patrim|tombad/i.test(t))) return null;
  for (const [re, cat] of TIPOS) if (partes.some((t) => re.test(t))) return cat;
  const m = NOME_TURISTICO.exec(nome);
  if (m) for (const [re, cat] of TIPOS) if (re.test(m[1])) return cat;
  return null;
}

/** Item do Wikidata (já agrupado) → ponto do pacote, com o texto do artigo quando existir. */
export function pontoDeItem(item, extract) {
  const qid = item.qid;
  const doArtigo = extract ? pontoDeArtigo({ pageid: 0, title: item.nome, lat: item.lat, lon: item.lng, extract }) : null;
  const desc = String(item.descricao || '').trim();
  const frase = desc ? `${item.nome}: ${desc}.`.replace(/\.\.$/, '.') : `${item.nome}.`;
  const base = doArtigo || {
    nome: item.nome, lat: +item.lat.toFixed(6), lng: +item.lng.toFixed(6), raioM: 60,
    narrativa: { curto: frase, medio: frase, longo: frase }, curiosidades: [], perguntas: [],
  };
  return {
    ...base,
    id: `q${qid.replace(/^Q/i, '')}`,
    nome: item.nome,
    categoria: item.categoria,
    fonte: item.artigo
      ? { nome: 'Wikipédia', url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(item.artigo.replace(/ /g, '_'))}` }
      : { nome: 'Wikidata', url: `https://www.wikidata.org/wiki/${qid}` },
  };
}

function consultaWikidata(lat, lng, km) {
  return `SELECT ?item ?nome (SAMPLE(?coord) AS ?c) (GROUP_CONCAT(DISTINCT ?tipoL; separator="|") AS ?tipos)
  (SAMPLE(?desc) AS ?d) (MIN(?dist) AS ?km) (SAMPLE(?art) AS ?a) WHERE {
  SERVICE wikibase:around { ?item wdt:P625 ?coord . bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${km}" . bd:serviceParam wikibase:distance ?dist . }
  ?item rdfs:label ?nome FILTER(lang(?nome) = "pt")
  OPTIONAL { ?item wdt:P31 ?tipo . ?tipo rdfs:label ?tipoL FILTER(lang(?tipoL) = "pt") }
  OPTIONAL { ?item schema:description ?desc FILTER(lang(?desc) = "pt") }
  OPTIONAL { ?art schema:about ?item ; schema:isPartOf <https://pt.wikipedia.org/> }
} GROUP BY ?item ?nome ORDER BY ?km LIMIT 200`;
}

/** Linhas do SPARQL → itens turísticos { qid, nome, lat, lng, km, categoria, descricao, artigo }. */
export function itensDoWikidata(json) {
  const vistos = new Set();
  const out = [];
  for (const b of (json && json.results && json.results.bindings) || []) {
    const qid = String(b.item?.value || '').split('/').pop();
    const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.c?.value || '');
    if (!/^Q\d+$/.test(qid) || !m || vistos.has(qid)) continue;
    const tipos = (b.tipos?.value || '').split('|').filter(Boolean);
    const descricao = b.d?.value || '';
    const categoria = categoriaTuristica(tipos, descricao, b.nome.value);
    if (!categoria) continue;
    vistos.add(qid);
    const artigo = b.a?.value ? decodeURIComponent(b.a.value.split('/wiki/').pop()).replace(/_/g, ' ') : null;
    out.push({ qid, nome: b.nome.value, lat: +m[2], lng: +m[1], km: +b.km?.value || 0, categoria, descricao, artigo });
  }
  return out;
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

  /** Onde a pessoa está, no nível do prédio: { lugar?, rua?, bairro?, cidade, estado?, texto }. */
  async function ondeEstou(lat, lng) {
    const chave = `o:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const c = cache.obter(chave); if (c) return c;
    const r = await obterJson(`${NOMINATIM}/reverse?${new URLSearchParams({ lat, lon: lng, format: 'jsonv2', zoom: '18', addressdetails: '1' })}`, true);
    const a = r.address || {};
    const cidade = a.city || a.town || a.village || a.municipality || '';
    const rua = a.road || a.pedestrian || a.square || '';
    // Nome próprio só quando o ponto é um lugar (mercado, igreja, praça), não quando é o número de uma rua.
    const lugar = r.name && r.name !== rua && !/^\d/.test(r.name) ? r.name : '';
    const bairro = a.suburb || a.neighbourhood || a.quarter || '';
    const v = {
      ...(lugar ? { lugar } : {}), ...(rua ? { rua } : {}), ...(bairro ? { bairro } : {}),
      cidade, ...(a.state ? { estado: a.state } : {}),
      texto: [lugar || rua, bairro, cidade].filter(Boolean).filter((x, i, l) => l.indexOf(x) === i).join(' · ') || 'Local sem nome no mapa',
    };
    cache.guardar(chave, v);
    return v;
  }

  /** Itens turísticos do Wikidata ao redor; amplia o raio se achar pouco. Só falha se nenhuma consulta respondeu. */
  async function pontosDoWikidata(lat, lng) {
    let itens = null;
    for (const km of RAIOS_WIKIDATA_KM) {
      let achados;
      try {
        achados = itensDoWikidata(await obterJson(`${WIKIDATA}?${new URLSearchParams({ format: 'json', query: consultaWikidata(lat, lng, km) })}`));
      } catch (e) { if (itens) break; throw e; }
      if (!itens || achados.length > itens.length) itens = achados; // o raio maior inclui o menor
      if (itens.length >= MIN_PONTOS_PERTO) break;
    }
    return itens;
  }

  /** Resumos da Wikipédia por título (até 20 por pedido). */
  async function resumosPorTitulo(titulos) {
    const out = new Map();
    for (let i = 0; i < titulos.length; i += 20) {
      const r = await obterJson(`${WIKI}?${new URLSearchParams({
        action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '20', redirects: '1',
        titles: titulos.slice(i, i + 20).join('|'), format: 'json', formatversion: '2', origin: '*' })}`);
      const q = r.query || {};
      const volta = new Map([...(q.normalized || []), ...(q.redirects || [])].map((x) => [x.to, x.from]));
      for (const pg of q.pages || []) {
        const t = pg.title; out.set(t, pg.extract || '');
        let orig = volta.get(t); while (orig) { out.set(orig, pg.extract || ''); orig = volta.get(orig); }
      }
    }
    return out;
  }

  /** Artigos da Wikipédia com coordenada (complemento), já filtrados como ponto de passeio. */
  async function pontosDaWikipedia(lat, lng) {
    const geo = await obterJson(`${WIKI}?${new URLSearchParams({
      action: 'query', list: 'geosearch', gscoord: `${lat}|${lng}`, gsradius: String(RAIO_M), gslimit: '50', format: 'json', formatversion: '2', origin: '*' })}`);
    const achados = (geo.query && geo.query.geosearch) || [];
    const textos = new Map();
    for (let i = 0; i < achados.length; i += 20) { // a API devolve no máximo 20 resumos por pedido
      const ids = achados.slice(i, i + 20).map((a) => a.pageid).join('|');
      const r = await obterJson(`${WIKI}?${new URLSearchParams({
        action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '20', pageids: ids, format: 'json', formatversion: '2', origin: '*' })}`);
      for (const pg of (r.query && r.query.pages) || []) textos.set(pg.pageid, pg.extract || '');
    }
    return achados.map((a) => {
      const extract = textos.get(a.pageid) || '';
      const categoria = categoriaTuristica([frases(extract)[0] || ''], '', a.title);
      if (!categoria) return null;
      const p = pontoDeArtigo({ ...a, extract });
      return p && { ...p, categoria };
    }).filter(Boolean);
  }

  /** Pacote de pontos ao redor de (lat, lng). `nome` opcional (vem da busca). */
  async function gerarPacote({ lat, lng, nome }) {
    const chave = `p2:${lat.toFixed(3)},${lng.toFixed(3)}`;
    const c = cache.obter(chave); if (c) return c;
    const centro = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    // As duas fontes em paralelo; uma pode falhar sem derrubar a outra.
    const [wd, wp] = await Promise.allSettled([pontosDoWikidata(lat, lng), pontosDaWikipedia(lat, lng)]);
    if (wd.status === 'rejected' && wp.status === 'rejected') throw wp.reason instanceof ErroDescoberta ? wp.reason : new ErroDescoberta('Não consegui consultar os mapas agora. Tente de novo em instantes.');
    const itens = wd.status === 'fulfilled' ? wd.value : [];
    let textos = new Map();
    const comArtigo = itens.filter((i) => i.artigo).map((i) => i.artigo);
    if (comArtigo.length) { try { textos = await resumosPorTitulo(comArtigo.slice(0, 60)); } catch { /* fica com a descrição do Wikidata */ } }
    const doWikidata = itens.map((i) => pontoDeItem(i, i.artigo ? textos.get(i.artigo) : null));
    const titulos = new Set(itens.flatMap((i) => [i.nome, i.artigo].filter(Boolean).map((t) => t.toLowerCase())));
    const daWikipedia = (wp.status === 'fulfilled' ? wp.value : []).filter((p) => !titulos.has(p.nome.toLowerCase()));
    // Mesmo lugar nas duas fontes (ou dois itens no mesmo prédio, a menos de 15 m e com o mesmo nome): fica um.
    const pois = [];
    for (const p of [...doWikidata, ...daWikipedia].sort((x, y) => distanciaM(centro, x) - distanciaM(centro, y))) {
      if (pois.some((q) => q.id === p.id || (q.nome === p.nome && distanciaM(q, p) < 15))) continue;
      pois.push(p);
      if (pois.length >= MAX_PONTOS) break;
    }
    if (pois.length < 2) throw new ErroDescoberta('Não encontrei pontos turísticos registrados perto daqui. Tente uma cidade próxima ou busque pelo nome.');
    const lugar = await nomeDoLugar(lat, lng);
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
      fonte: 'Wikidata (CC0), Wikipédia (CC BY-SA) e OpenStreetMap',
      observacao: 'Destino montado automaticamente com os pontos turísticos registrados no Wikidata e na Wikipédia. Sem curadoria: confira o que for importante.',
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

  return { buscarLugares, nomeDoLugar, ondeEstou, gerarPacote };
}
