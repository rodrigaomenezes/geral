import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarDescoberta, frases, pontoDeArtigo } from '../server/descoberta.js';
import { validarPacote, proximoAlerta } from '../public/js/nucleo.js';
import { criarServidor } from '../server/server.js';

// Vitória-ES, com artigos fictícios no formato da API da Wikipédia
const ARTIGOS = [
  { pageid: 101, title: 'Convento da Penha', lat: -20.3297, lon: -40.2869, extract: 'O Convento de Nossa Senhora da Penha é um dos santuários mais antigos do Brasil. Fica no alto de um morro em Vila Velha. Foi fundado no século XVI por frei Pedro Palácios.' },
  { pageid: 102, title: 'Palácio Anchieta', lat: -20.3205, lon: -40.3385, extract: 'O Palácio Anchieta é a sede do governo do Espírito Santo. O prédio tem origem num colégio jesuíta do século XVI.' },
  { pageid: 103, title: 'Rua Curta', lat: -20.3150, lon: -40.3120, extract: 'Rua em Vitória.' }, // curto demais: fica de fora
  { pageid: 104, title: 'Catedral de Vitória', lat: -20.3196, lon: -40.3394, extract: 'A Catedral Metropolitana de Vitória é um templo neogótico. Sua construção começou em 1920.' },
];

function fetchFalso(registro = []) {
  return async (url, op) => {
    registro.push({ url, agente: op.headers['user-agent'] });
    const u = new URL(url);
    let corpo;
    if (u.hostname === 'pt.wikipedia.org' && u.searchParams.get('list') === 'geosearch') corpo = { query: { geosearch: ARTIGOS.map(({ pageid, title, lat, lon }) => ({ pageid, title, lat, lon })) } };
    else if (u.hostname === 'pt.wikipedia.org') {
      const ids = u.searchParams.get('pageids').split('|').map(Number);
      corpo = { query: { pages: ARTIGOS.filter((a) => ids.includes(a.pageid)).map(({ pageid, title, extract }) => ({ pageid, title, extract })) } };
    } else if (u.pathname === '/reverse') corpo = { name: 'Vitória', address: { city: 'Vitória', state: 'Espírito Santo', country: 'Brasil' } };
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
  } finally { servidor.close(); rmSync(dados, { recursive: true, force: true }); }
});
