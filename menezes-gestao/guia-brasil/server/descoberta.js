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
import { validarPacote, VERSAO_PACOTE, distanciaM, normalizar, palavras } from '../public/js/nucleo.js';

const AGENTE = 'GuIA-Brasil/0.1 (+https://github.com/rodrigaomenezes/geral)';
const WIKI = 'https://pt.wikipedia.org/w/api.php';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const WIKIDATA = 'https://query.wikidata.org/sparql';
const RAIO_M = 10000; // máximo da busca por coordenadas da Wikipédia
const RAIOS_WIKIDATA_KM = [3, 10]; // primeiro o bairro e o centro; amplia se achar pouco
const MIN_PONTOS_PERTO = 15;
const MAX_PONTOS = 50;
const MAX_ARTIGOS_COMPLETOS = 40; // textos completos baixados por destino (um pedido por artigo)
const PEDIDOS_SIMULTANEOS = 6;
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

/** "Igreja de São José (Ouro Preto)" → "Igreja de São José": o parêntese só desambigua títulos da Wikipédia. */
export const nomeDeExibicao = (t) => String(t || '').replace(/\s*\([^()]*\)\s*$/, '').trim() || String(t || '');

/** Artigo da Wikipédia → ponto do pacote (ou null se o texto for curto demais para narrar). */
export function pontoDeArtigo(a) {
  const fs = frases(a.extract);
  const longo = juntarAte(fs, 900);
  if (longo.length < 60) return null;
  const curto = fs[0].length >= 20 ? fs[0] : juntarAte(fs, 200);
  const medio = juntarAte(fs, 420);
  return {
    id: `w${a.pageid}`,
    nome: nomeDeExibicao(a.title),
    categoria: 'lugar',
    lat: +a.lat.toFixed(6), lng: +a.lon.toFixed(6),
    raioM: 60,
    ...(fs[1] && fs[1].length >= 20 && fs[1].length <= 220 ? { teaser: fs[1] } : {}),
    narrativa: { curto, medio, longo },
    curiosidades: [],
    perguntas: [],
    fonte: { nome: 'Wikipédia', url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(String(a.title).replace(/ /g, '_'))}` },
  };
}

// ---------- Texto completo do artigo: seções viram narração longa, curiosidades e perguntas prontas (G-019) ----------
const SECOES_FORA = /^(ver também|referências|referências bibliográficas|ligações externas|links externos|bibliografia|notas|notas e referências|galeria|galeria de imagens|leitura adicional|fontes)$/i;

/** Texto do artigo no formato de seções ("== História ==") → { intro, secoes: [{ titulo, texto }] }. */
export function secoesDoArtigo(texto) {
  const partes = String(texto || '').split(/\n(={2,4})\s*([^=\n]+?)\s*\1\n/);
  const secoes = [];
  for (let i = 1; i + 2 < partes.length + 1; i += 3) {
    const titulo = (partes[i + 1] || '').trim();
    const corpo = (partes[i + 2] || '').trim();
    if (titulo && corpo.length >= 40 && !SECOES_FORA.test(titulo)) secoes.push({ titulo, texto: corpo });
  }
  return { intro: (partes[0] || '').trim(), secoes };
}

// Palavras que as pessoas usam para perguntar sobre cada tipo de seção (a busca local compara palavra por palavra).
const ASSUNTOS = [
  [/hist|origem|fundaç|antecedent|cronolog|século|período/i, 'Qual a história de %s?', 'historia origem construido construida construiu construcao fundado fundada fundou fundacao inaugurado inaugurada inauguracao antigo antiga surgiu criado criada ano epoca'],
  [/arquitet|descriç|caracter|estrutura|edifíc|construç|estilo/i, 'Como é a arquitetura de %s?', 'arquitetura estilo fachada construcao predio edificio descricao parece interior torre'],
  [/acervo|coleç|exposiç|obras/i, 'O que tem no acervo de %s?', 'acervo colecao exposicao obras pecas ver expostas'],
  [/festa|evento|cultura|tradiç|celebra|religi|devoç/i, 'Que festas e tradições envolvem %s?', 'festa festas evento eventos tradicao tradicoes cultura celebracao religiosa devocao'],
  [/turis|visita|atraç|funcionamento|uso atual|atualidade/i, 'O que dá para fazer em %s hoje?', 'visitar visita turismo fazer hoje atualmente funciona'],
  [/restaur|reforma|preserv|tomba|conserva/i, '%s foi restaurado ou tombado?', 'restauracao restaurado reforma reformado tombado tombamento preservacao patrimonio iphan'],
];

function assuntoDaSecao(titulo, nome) {
  for (const [re, modelo, chaves] of ASSUNTOS) if (re.test(titulo)) return { p: modelo.replace('%s', nome), chaves: chaves.split(' ') };
  return { p: `${titulo} · ${nome}`, chaves: palavras(titulo) };
}

/** Ponto com o artigo inteiro: narração longa maior, até 4 curiosidades e uma pergunta pronta por seção. */
export function enriquecerComArtigo(poi, textoCompleto) {
  const { secoes } = secoesDoArtigo(textoCompleto);
  if (!secoes.length) return poi;
  const doCorpo = secoes.flatMap((s) => frases(s.texto));
  const longo = juntarAte([...frases(poi.narrativa.longo), ...doCorpo], 1600);
  const ja = new Set(frases(poi.narrativa.longo));
  const curiosidades = [...new Set(secoes.map((s) => frases(s.texto).find((f) => f.length >= 50 && f.length <= 260 && !ja.has(f))).filter(Boolean))].slice(0, 4);
  const vistas = new Set();
  const perguntas = [];
  for (const s of secoes) {
    const { p, chaves } = assuntoDaSecao(s.titulo, poi.nome);
    if (vistas.has(p)) { const f = perguntas.find((x) => x.p === p); if (f.r.length < 500) f.r = juntarAte([...frases(f.r), ...frases(s.texto)], 700); continue; }
    const r = juntarAte(frases(s.texto), 700);
    if (r.length < 40) continue;
    vistas.add(p);
    perguntas.push({ p, r, chaves });
    if (perguntas.length >= 6) break;
  }
  return {
    ...poi,
    narrativa: { ...poi.narrativa, longo: longo.length > poi.narrativa.longo.length ? longo : poi.narrativa.longo },
    curiosidades: [...(poi.curiosidades || []), ...curiosidades].slice(0, 4),
    perguntas: [...(poi.perguntas || []), ...perguntas],
  };
}

// Frases de um texto que mais respondem a uma pergunta (palavras em comum, comparando o começo das palavras:
// "construiu" casa com "construído").
// Começo da palavra que conta: "construiu" → "constr" casa com "construído" e não com "constituição".
const raiz = (w) => w.slice(0, Math.max(5, w.length - 3));
// Jeitos diferentes de falar do mesmo assunto de turismo: cada grupo conta como uma palavra da pergunta. Sinônimo
// casa por palavra inteira ou, se tiver 6 letras ou mais, pelo começo ("comer" não casa com "comércio").
const SINONIMOS = [
  'comida comer culinaria gastronomia prato pratos culinario culinarios',
  'tipica tipico tipicas tipicos tradicional tradicionais regional regionais',
  'festa festas festival festejo festejos micareta carnaval',
  'fundou fundada fundado fundacao fundador fundadores',
  'construiu construido construida construcao construcoes erguido erguida edificado',
  'igreja igrejas templo capela catedral',
].map((g) => g.split(' '));
// Palavras que não dizem o assunto da pergunta ("quem fundou a cidade?" é sobre fundação, não sobre "cidade").
const GENERICAS = new Set('cidade cidades lugar lugares local daqui coisa coisas hoje ver tem fica ficam existe existem bom boa melhor melhores gente pessoa'.split(' '));
/** Palavras da pergunta → grupos: { sinonimos } (casam por palavra) ou { raiz } (casa pelo começo). */
export function gruposDaPergunta(chaves) {
  return chaves.filter((c) => !GENERICAS.has(c)).map((c) => SINONIMOS.find((g) => g.includes(c)) || [`~${raiz(c)}`]);
}
const casa = (token, alvo) => (alvo.startsWith('~') ? token.startsWith(alvo.slice(1)) : token === alvo || (alvo.length >= 6 && token.startsWith(alvo)));
function notaDaFrase(frase, grupos) {
  const tokens = normalizar(frase).split(' ');
  return grupos.filter((g) => g.some((alvo) => tokens.some((t) => casa(t, alvo)))).length;
}

/** Trecho de um texto que responde à pergunta, ou null se nada casa o suficiente. Exportado para teste. */
export function trechoQueResponde(texto, chaves, minimo) {
  const grupos = Array.isArray(chaves[0]) ? chaves : gruposDaPergunta(chaves);
  if (!grupos.length) return null;
  const fs = frases(texto.replace(/\n={2,4}[^=\n]+={2,4}\n/g, '\n'));
  const notas = fs.map((f, i) => ({ f, i, n: notaDaFrase(f, grupos) })).filter((x) => x.n >= minimo && x.f.length >= 25);
  if (!notas.length) return null;
  const melhores = notas.sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i);
  return { texto: juntarAte(melhores.map((x) => x.f), 600), nota: melhores[0].n };
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

const ROTULOS = { igreja: 'igreja', museu: 'museu', mercado: 'mercado', praca: 'praça', monumento: 'monumento', cultura: 'cultura', historico: 'patrimônio histórico', natureza: 'natureza' };

/** Ponto sozinho passa nas regras do pacote? (um ponto ruim sai do roteiro em vez de derrubar o destino) */
export function pontoValido(p) {
  return validarPacote({
    versao: VERSAO_PACOTE, id: 'teste', nome: 'teste', cidade: 'teste', pais: 'Brasil', idioma: 'pt-BR', atualizadoEm: '2026-01-01',
    centro: { lat: p.lat, lng: p.lng }, rotaDemonstracao: [p.id], pois: [p], perguntasGerais: [], avisos: [],
  }).length === 0;
}

/** Item do Wikidata (já agrupado) → ponto do pacote, com o texto do artigo quando existir. */
export function pontoDeItem(item, extract) {
  const qid = item.qid;
  const doArtigo = extract ? pontoDeArtigo({ pageid: 0, title: item.nome, lat: item.lat, lon: item.lng, extract }) : null;
  const desc = String(item.descricao || '').trim();
  // Sem artigo: a descrição do Wikidata; sem descrição, os tipos ("Escola de Minas: instituição de ensino, patrimônio").
  const sobre = desc || (item.tipos || []).slice(0, 2).join(', ') || ROTULOS[item.categoria] || 'ponto turístico';
  let frase = `${item.nome}: ${sobre}.`.replace(/\.\.$/, '.');
  if (frase.length < 20) frase = `${frase} Ponto de ${ROTULOS[item.categoria] || 'interesse turístico'} registrado no Wikidata.`;
  const base = doArtigo || {
    nome: item.nome, lat: +item.lat.toFixed(6), lng: +item.lng.toFixed(6), raioM: 60,
    narrativa: { curto: frase, medio: frase, longo: frase }, curiosidades: [], perguntas: [],
  };
  return {
    ...base,
    id: `q${qid.replace(/^Q/i, '')}`,
    nome: nomeDeExibicao(item.nome),
    categoria: item.categoria,
    ...(item.artigo ? { _artigo: item.artigo } : {}),
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
    out.push({ qid, nome: b.nome.value, lat: +m[2], lng: +m[1], km: +b.km?.value || 0, categoria, descricao, tipos, artigo });
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
      return p && { ...p, categoria, _artigo: a.title };
    }).filter(Boolean);
  }

  /** Texto completo de um artigo (com seções). A API só devolve um texto completo por pedido. */
  async function textoCompleto(titulo) {
    const chave = `t:${titulo}`;
    const c = cache.obter(chave); if (c !== undefined) return c;
    const r = await obterJson(`${WIKI}?${new URLSearchParams({
      action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'wiki', redirects: '1',
      titles: titulo, format: 'json', formatversion: '2', origin: '*' })}`);
    const pg = ((r.query && r.query.pages) || [])[0];
    const texto = (pg && pg.extract) || '';
    cache.guardar(chave, texto);
    return texto;
  }

  /** Vários textos completos, no máximo PEDIDOS_SIMULTANEOS por vez; falha de um artigo não derruba os outros. */
  async function textosCompletos(titulos) {
    const out = new Map();
    let i = 0;
    const trabalhador = async () => {
      while (i < titulos.length) {
        const t = titulos[i++];
        try { out.set(t, await textoCompleto(t)); } catch { /* fica com o resumo */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PEDIDOS_SIMULTANEOS, titulos.length) }, trabalhador));
    return out;
  }

  /**
   * Pesquisa na Wikipédia uma pergunta que o roteiro não responde (sem IA). Procura, nesta ordem, no artigo do ponto
   * em foco, no artigo da cidade e nos 3 primeiros da busca (só os que citam a cidade, para não responder com o
   * mercado de outra cidade). Vence o trecho que casa mais palavras da pergunta. Devolve { texto, titulo, url } ou null.
   */
  async function pesquisar(pergunta, { cidade = '', artigo = '' } = {}) {
    const daCidade = new Set(palavras(cidade));
    const chaves = [...new Set(palavras(pergunta))].filter((w) => !daCidade.has(w) && !GENERICAS.has(w));
    if (!chaves.length) return null;
    const chave = `q:${normalizar(`${chaves.join(' ')}|${cidade}|${artigo}`)}`;
    const c = cache.obter(chave); if (c !== undefined) return c;
    const grupos = gruposDaPergunta(chaves);
    const minimo = Math.min(2, grupos.length);
    const candidatos = [...new Set([artigo, cidade].filter(Boolean))].map((titulo) => ({ titulo, exigeCidade: false }));
    try {
      const r = await obterJson(`${WIKI}?${new URLSearchParams({
        action: 'query', list: 'search', srsearch: `${chaves.slice(0, 6).join(' ')}${cidade ? ` "${cidade}"` : ''}`,
        srlimit: '3', srnamespace: '0', format: 'json', formatversion: '2', origin: '*' })}`);
      for (const a of (r.query && r.query.search) || []) if (!candidatos.some((x) => x.titulo === a.title)) candidatos.push({ titulo: a.title, exigeCidade: !!cidade });
    } catch { /* sem busca: fica com o ponto e a cidade */ }
    const nomeCidade = normalizar(cidade);
    let melhor = null;
    const textos = await textosCompletos(candidatos.map((x) => x.titulo));
    candidatos.forEach(({ titulo, exigeCidade }, ordem) => {
      const texto = textos.get(titulo) || '';
      if (!texto) return;
      const t = trechoQueResponde(texto, grupos, minimo);
      // Artigo achado pela busca vale só se é da cidade: no título ou no próprio trecho ("Olinda" citando Ouro Preto não).
      if (t && exigeCidade && !normalizar(titulo).includes(nomeCidade) && !normalizar(t.texto).includes(nomeCidade)) return;
      if (t && (!melhor || t.nota > melhor.nota || (t.nota === melhor.nota && ordem < melhor.ordem))) melhor = { ...t, titulo, ordem };
    });
    const v = melhor ? { texto: melhor.texto, titulo: melhor.titulo, url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(melhor.titulo.replace(/ /g, '_'))}` } : null;
    cache.guardar(chave, v);
    return v;
  }

  /** Pacote de pontos ao redor de (lat, lng). `nome` opcional (vem da busca). */
  async function gerarPacote({ lat, lng, nome }) {
    const chave = `p3:${lat.toFixed(3)},${lng.toFixed(3)}`;
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
    const titulos = new Set(itens.flatMap((i) => [i.nome, i.artigo].filter(Boolean).flatMap((t) => [t, nomeDeExibicao(t)]).map((t) => t.toLowerCase())));
    const daWikipedia = (wp.status === 'fulfilled' ? wp.value : []).filter((p) => !titulos.has(p.nome.toLowerCase()));
    // Mesmo lugar nas duas fontes (ou dois itens no mesmo prédio, a menos de 15 m e com o mesmo nome): fica um.
    const pois = [];
    for (const p of [...doWikidata, ...daWikipedia].sort((x, y) => distanciaM(centro, x) - distanciaM(centro, y))) {
      if (pois.some((q) => q.id === p.id || (q.nome === p.nome && distanciaM(q, p) < 15))) continue;
      if (!pontoValido(p)) continue;
      pois.push(p);
      if (pois.length >= MAX_PONTOS) break;
    }
    if (pois.length < 2) throw new ErroDescoberta('Não encontrei pontos turísticos registrados perto daqui. Tente uma cidade próxima ou busque pelo nome.');
    // Texto completo dos artigos dos pontos mais perto: seções viram narração, curiosidades e perguntas prontas.
    const comArtigoCompleto = pois.filter((p) => p._artigo).slice(0, MAX_ARTIGOS_COMPLETOS);
    const completos = await textosCompletos(comArtigoCompleto.map((p) => p._artigo));
    for (let i = 0; i < pois.length; i++) {
      const { _artigo, ...p } = pois[i];
      const rico = _artigo && completos.get(_artigo) ? enriquecerComArtigo(p, completos.get(_artigo)) : p;
      pois[i] = pontoValido(rico) ? rico : p;
    }
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

  return { buscarLugares, nomeDoLugar, ondeEstou, gerarPacote, pesquisar };
}
