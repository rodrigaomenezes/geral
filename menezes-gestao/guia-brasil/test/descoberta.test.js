import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarDescoberta, frases, pontoDeArtigo, categoriaTuristica, itensDoWikidata, pontoDeItem, pontoValido } from '../server/descoberta.js';
import { validarPacote, proximoAlerta } from '../public/js/nucleo.js';
import { criarServidor } from '../server/server.js';

// Vitória-ES, com artigos fictícios no formato da API da Wikipédia
const ARTIGOS = [
  { pageid: 101, title: 'Convento da Penha', lat: -20.3297, lon: -40.2869, extract: 'O Convento de Nossa Senhora da Penha é um dos santuários mais antigos do Brasil. Fica no alto de um morro em Vila Velha. Foi fundado no século XVI por frei Pedro Palácios.' },
  { pageid: 102, title: 'Palácio Anchieta', lat: -20.3205, lon: -40.3385, extract: 'O Palácio Anchieta é a sede do governo do Espírito Santo. O prédio tem origem num colégio jesuíta do século XVI.' },
  { pageid: 103, title: 'Rua Curta', lat: -20.3150, lon: -40.3120, extract: 'Rua em Vitória.' }, // curto demais: fica de fora
  { pageid: 104, title: 'Catedral de Vitória', lat: -20.3196, lon: -40.3394, extract: 'A Catedral Metropolitana de Vitória é um templo neogótico. Sua construção começou em 1920.' },
];

// Linhas do SPARQL do Wikidata como a API devolve (Feira de Santana, raio de 3 km).
const linha = (qid, nome, lng, lat, km, tipos, d, artigo) => ({
  item: { value: `http://www.wikidata.org/entity/${qid}` }, nome: { value: nome }, c: { value: `Point(${lng} ${lat})` },
  km: { value: String(km) }, tipos: { value: tipos }, ...(d ? { d: { value: d } } : {}),
  ...(artigo ? { a: { value: `https://pt.wikipedia.org/wiki/${encodeURIComponent(artigo.replace(/ /g, '_'))}` } } : {}),
});
const WIKIDATA = {
  3: { results: { bindings: [
    linha('Q1001', 'Prédio Mercado Municipal (Feira de Santana)', -38.9661, -12.2548, 0.03, 'edifício|feira livre|património histórico', 'mercado municipal e bem tombado', 'Prédio Mercado Municipal (Feira de Santana)'),
    linha('Q1002', 'Painéis do MAP', -38.9660, -12.2547, 0.02, 'património cultural|monumento', 'patrimônio artístico de Feira de Santana, Bahia, Brasil'),
    linha('Q1003', 'TV Subaé', -38.9555, -12.2605, 1.2, 'estação de televisão', 'emissora de televisão brasileira'),
    linha('Q1004', 'Boulevard Shopping', -38.95, -12.25, 1.5, 'centro comercial', 'shopping de Feira de Santana'),
    linha('Q1005', 'Paço Municipal de Feira de Santana', -38.9670, -12.2550, 0.1, 'câmara municipal|edifício de administração pública', '', 'Paço Municipal de Feira de Santana'),
    linha('Q1006', 'Igreja Senhor dos Passos', -38.9672, -12.2553, 0.11, 'igreja|património histórico', 'igreja em Feira de Santana, Bahia', 'Igreja Senhor dos Passos (Feira de Santana)'),
  ] } },
};
const ARTIGOS_TITULO = {
  'Prédio Mercado Municipal (Feira de Santana)': 'O Prédio do Mercado Municipal de Feira de Santana foi inaugurado em 1914. Hoje abriga o Mercado de Arte Popular, com artesanato do sertão baiano.',
  'Igreja Senhor dos Passos (Feira de Santana)': 'A Igreja Senhor dos Passos é um templo católico do centro de Feira de Santana. É tombada pelo patrimônio estadual.',
};

function fetchFalso(registro = []) {
  return async (url, op) => {
    registro.push({ url, agente: op.headers['user-agent'] });
    const u = new URL(url);
    let corpo;
    if (u.hostname === 'pt.wikipedia.org' && u.searchParams.get('list') === 'geosearch') corpo = { query: { geosearch: ARTIGOS.map(({ pageid, title, lat, lon }) => ({ pageid, title, lat, lon })) } };
    else if (u.hostname === 'query.wikidata.org') { // só responde ao redor de Feira de Santana
      const q = u.searchParams.get('query');
      corpo = (q.includes('Point(-38.96') && WIKIDATA[q.match(/radius "(\d+)"/)[1]]) || { results: { bindings: [] } };
    }
    else if (u.hostname === 'pt.wikipedia.org' && u.searchParams.get('titles')) {
      const ts = u.searchParams.get('titles').split('|');
      corpo = { query: { pages: ts.filter((t) => ARTIGOS_TITULO[t]).map((t) => ({ title: t, extract: ARTIGOS_TITULO[t] })) } };
    } else if (u.hostname === 'pt.wikipedia.org') {
      const ids = u.searchParams.get('pageids').split('|').map(Number);
      corpo = { query: { pages: ARTIGOS.filter((a) => ids.includes(a.pageid)).map(({ pageid, title, extract }) => ({ pageid, title, extract })) } };
    } else if (u.pathname === '/reverse' && u.searchParams.get('zoom') === '18') corpo = { name: 'Mercado de Arte Popular', address: { road: 'Avenida Getúlio Vargas', suburb: 'Centro', city: 'Feira de Santana', state: 'Bahia' } };
    else if (u.pathname === '/reverse') corpo = { name: 'Vitória', address: { city: 'Vitória', state: 'Espírito Santo', country: 'Brasil' } };
    else if (u.pathname === '/search') corpo = [{ name: 'Ouro Preto', display_name: 'Ouro Preto, Região Imediata de Ouro Preto, Minas Gerais, Brasil', lat: '-20.3856', lon: '-43.5035' }];
    return { ok: true, status: 200, json: async () => corpo };
  };
}

test('frases e ponto de artigo: corta em níveis, usa a 2ª frase como chamada e descarta texto curto', () => {
  assert.deepEqual(frases('Primeira frase aqui. Segunda frase? 1920 foi o ano. fim'), ['Primeira frase aqui.', 'Segunda frase?', '1920 foi o ano. fim']);
  const p = pontoDeArtigo(ARTIGOS[0]);
  assert.equal(p.id, 'w101');
  assert.match(p.narrativa.curto, /^O Convento/);
  assert.match(p.teaser, /alto de um morro/);
  assert.equal(p.fonte.url, 'https://pt.wikipedia.org/?curid=101');
  assert.equal(pontoDeArtigo(ARTIGOS[2]), null);
});

test('gera um destino válido ao redor de uma coordenada, com nome, rota e fonte', async () => {
  const chamadas = [];
  const d = criarDescoberta({ fetchImpl: fetchFalso(chamadas) });
  const pac = await d.gerarPacote({ lat: -20.3155, lng: -40.3128 });
  assert.deepEqual(validarPacote(pac), []);
  assert.equal(pac.id, 'lugar-m20-316-m40-313');
  assert.equal(pac.nome, 'Vitória, Espírito Santo · arredores');
  assert.equal(pac.cidade, 'Vitória');
  assert.equal(pac.pois.length, 3); // o artigo curto ficou de fora
  assert.ok(pac.pois.every((p) => p.fonte && p.fonte.nome === 'Wikipédia'));
  assert.equal(pac.rotaDemonstracao.length, 3);
  assert.ok(chamadas.every((c) => /GuIA-Brasil/.test(c.agente)), 'identifica o app nos serviços');
  // o companheiro funciona com o destino gerado
  const pos = { lat: -20.3205, lng: -40.3384 };
  assert.equal(proximoAlerta({ pacote: pac, pos, agora: 1 }).id, 'w102');
  // cache: mesma região não consulta de novo
  const antes = chamadas.length;
  await d.gerarPacote({ lat: -20.3155, lng: -40.3128 });
  assert.equal(chamadas.length, antes);
});

test('busca de lugares e erros claros quando não há o que mostrar', async () => {
  const d = criarDescoberta({ fetchImpl: fetchFalso() });
  const [op] = await d.buscarLugares('ouro preto');
  assert.deepEqual([op.nome, op.lat, op.lng], ['Ouro Preto', -20.3856, -43.5035]);
  assert.match(op.detalhe, /Minas Gerais/);
  const vazio = criarDescoberta({ fetchImpl: async () => ({ ok: true, json: async () => ({ query: { geosearch: [] } }) }) });
  await assert.rejects(vazio.gerarPacote({ lat: 0, lng: 0 }), /Não encontrei pontos/);
  const fora = criarDescoberta({ fetchImpl: async () => { throw new Error('rede'); } });
  await assert.rejects(fora.gerarPacote({ lat: 1, lng: 1 }), /Não consegui consultar os mapas/);
});

test('rotas /api/lugares e /api/perto', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'guia-'));
  const { servidor } = await criarServidor({ pastaDados: dados, log: { info() {}, error() {} }, cliente: null, descoberta: criarDescoberta({ fetchImpl: fetchFalso() }) });
  await new Promise((r) => servidor.listen(0, r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const get = async (c) => { const r = await fetch(base + c); return { status: r.status, corpo: await r.json() }; };
  try {
    assert.equal((await get('/api/lugares?q=ouro%20preto')).corpo[0].nome, 'Ouro Preto');
    assert.equal((await get('/api/lugares?q=a')).status, 400);
    const perto = await get('/api/perto?lat=-20.3155&lng=-40.3128&nome=Vit%C3%B3ria');
    assert.equal(perto.status, 200);
    assert.equal(perto.corpo.nome, 'Vitória · arredores');
    assert.equal((await get('/api/perto?lat=abc&lng=1')).status, 400);
    const onde = await get('/api/onde?lat=-12.2548&lng=-38.9661');
    assert.equal(onde.status, 200);
    assert.equal(onde.corpo.lugar, 'Mercado de Arte Popular');
  } finally { servidor.close(); rmSync(dados, { recursive: true, force: true }); }
});

test('filtro turístico: entra patrimônio, igreja, mercado; ficam de fora TV, rádio, shopping, estádio', () => {
  assert.equal(categoriaTuristica(['edifício', 'feira livre', 'património histórico']), 'mercado');
  assert.equal(categoriaTuristica(['empresa', 'património histórico'], '', 'Filarmônica 25 de Março'), 'historico');
  assert.equal(categoriaTuristica(['edifício'], 'bem de interesse histórico em Feira de Santana'), 'historico');
  assert.equal(categoriaTuristica(['câmara municipal'], '', 'Paço Municipal de Feira de Santana'), 'historico');
  assert.equal(categoriaTuristica(['praça'], ''), 'praca'); // "ç" no fim: \b não funcionaria
  assert.equal(categoriaTuristica(['estação de televisão'], 'emissora com sede na praça central', 'TV Subaé'), null);
  assert.equal(categoriaTuristica(['A Rádio Cultura é uma emissora de rádio.'], '', 'Rádio Cultura'), null);
  assert.equal(categoriaTuristica(['centro comercial'], 'shopping'), null);
  assert.equal(categoriaTuristica(['supermercado']), null);
  assert.equal(categoriaTuristica(['município do Brasil'], 'município da Bahia', 'Feira de Santana'), null);
  assert.equal(itensDoWikidata(WIKIDATA[3]).length, 4);
});

test('Feira de Santana: o mercado e o patrimônio do centro entram, as emissoras não; texto do artigo quando há', async () => {
  const d = criarDescoberta({ fetchImpl: fetchFalso() });
  const pac = await d.gerarPacote({ lat: -12.2548, lng: -38.9661 });
  assert.deepEqual(validarPacote(pac), []);
  const nomes = pac.pois.map((p) => p.nome);
  assert.equal(nomes[0], 'Prédio Mercado Municipal (Feira de Santana)'); // o mais perto primeiro
  assert.ok(nomes.includes('Prédio Mercado Municipal (Feira de Santana)'));
  assert.ok(!nomes.some((n) => /TV|Shopping/.test(n)));
  const mercado = pac.pois.find((p) => p.id === 'q1001');
  assert.equal(mercado.categoria, 'mercado');
  assert.match(mercado.narrativa.medio, /Mercado de Arte Popular/);
  assert.match(mercado.fonte.url, /^https:\/\/pt\.wikipedia\.org\/wiki\/Pr%C3%A9dio_Mercado/);
  const paineis = pac.pois.find((p) => p.id === 'q1002');
  assert.equal(paineis.fonte.nome, 'Wikidata');
  assert.match(paineis.narrativa.curto, /^Painéis do MAP: patrimônio artístico/);
  // chegar no mercado narra o mercado
  const a = proximoAlerta({ pacote: pac, pos: { lat: -12.25482, lng: -38.96612 }, agora: 1 });
  assert.ok(['q1001', 'q1002'].includes(a.id));
});

test('Wikidata fora do ar: segue com a Wikipédia; artigo que está nas duas fontes aparece uma vez', async () => {
  const base = fetchFalso();
  const semWd = criarDescoberta({ fetchImpl: async (url, op) => { if (url.includes('wikidata')) throw new Error('fora'); return base(url, op); } });
  const pac = await semWd.gerarPacote({ lat: -20.3155, lng: -40.3128 });
  assert.equal(pac.pois.length, 3);
  // Mesmo título nas duas fontes
  const duplo = criarDescoberta({ fetchImpl: async (url, op) => {
    if (url.includes('wikidata')) return { ok: true, status: 200, json: async () => ({ results: { bindings: [linha('Q9', 'Palácio Anchieta', -40.3385, -20.3205, 0.5, 'palácio', 'sede do governo', 'Palácio Anchieta')] } }) };
    return base(url, op);
  } });
  const p2 = await duplo.gerarPacote({ lat: -20.3155, lng: -40.3128 });
  assert.equal(p2.pois.filter((p) => p.nome === 'Palácio Anchieta').length, 1);
});

test('onde estou: nome do lugar no nível do prédio', async () => {
  const d = criarDescoberta({ fetchImpl: fetchFalso() });
  const o = await d.ondeEstou(-12.2548, -38.9661);
  assert.equal(o.lugar, 'Mercado de Arte Popular');
  assert.equal(o.cidade, 'Feira de Santana');
  assert.equal(o.texto, 'Mercado de Arte Popular · Centro · Feira de Santana');
});

test('item sem descrição nem artigo ainda vira texto válido; ponto ruim sai sozinho sem derrubar o destino', () => {
  // Caso real em Ouro Preto: "Escola de Minas" (Q115617236) só com nome e tipo.
  const p = pontoDeItem({ qid: 'Q115617236', nome: 'Escola de Minas', lat: -20.38, lng: -43.50, categoria: 'historico', descricao: '', tipos: ['património histórico'] });
  assert.equal(p.narrativa.curto, 'Escola de Minas: património histórico.');
  assert.ok(pontoValido(p));
  const curto = pontoDeItem({ qid: 'Q1', nome: 'Sé', lat: 0, lng: 0, categoria: 'igreja', descricao: '', tipos: [] });
  assert.ok(curto.narrativa.curto.length >= 20 && pontoValido(curto));
  assert.equal(pontoValido({ ...p, narrativa: { curto: 'x', medio: 'x', longo: 'x' } }), false);
});
