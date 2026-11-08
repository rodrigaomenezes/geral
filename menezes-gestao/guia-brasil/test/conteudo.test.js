// G-019: mais conteúdo nos destinos gerados, respostas para o que o roteiro não tem e perguntas em destino gerado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secoesDoArtigo, enriquecerComArtigo, trechoQueResponde, criarDescoberta, pontoValido } from '../server/descoberta.js';
import { conversar, textoEFontes } from '../server/guia.js';
import { traduzirPedido, traduzirResposta } from '../server/openrouter.js';
import { criarServidor, centroDoIdGerado } from '../server/server.js';
import { responderLocal, validarPacote, palavras } from '../public/js/nucleo.js';

// Texto completo como a API devolve com exsectionformat=wiki
const MERCADO_COMPLETO = `O Mercado Municipal de Feira de Santana é uma edificação inaugurada em 1915, na região central da cidade. Hoje abriga o Mercado de Arte Popular.


== História ==
O mercado foi construído na gestão do intendente Bernardino Bahia, para organizar o comércio da feira livre que deu nome à cidade. Durante décadas foi o principal ponto de venda de carne, farinha e cereais.

== Arquitetura ==
O prédio tem estilo eclético, com arcos e frontões decorados. A estrutura de ferro do interior foi trazida da Europa.

== Mercado de Arte Popular ==
Desde 1984 o edifício funciona como Mercado de Arte Popular, com artesanato em couro, palha e cerâmica do sertão baiano.

== Referências ==
Lista de fontes aqui com texto suficiente para passar do mínimo de quarenta letras.`;

const POI = { id: 'q1001', nome: 'Mercado Municipal de Feira de Santana', categoria: 'mercado', lat: -12.2548, lng: -38.9661, raioM: 60,
  narrativa: { curto: 'O Mercado Municipal de Feira de Santana é uma edificação inaugurada em 1915.', medio: 'O Mercado Municipal de Feira de Santana é uma edificação inaugurada em 1915, na região central da cidade.', longo: 'O Mercado Municipal de Feira de Santana é uma edificação inaugurada em 1915, na região central da cidade. Hoje abriga o Mercado de Arte Popular.' },
  curiosidades: [], perguntas: [], fonte: { nome: 'Wikipédia', url: 'https://pt.wikipedia.org/wiki/Mercado' } };

test('seções do artigo: separa a introdução e ignora Referências', () => {
  const { intro, secoes } = secoesDoArtigo(MERCADO_COMPLETO);
  assert.match(intro, /^O Mercado Municipal/);
  assert.deepEqual(secoes.map((s) => s.titulo), ['História', 'Arquitetura', 'Mercado de Arte Popular']);
});

test('artigo completo vira narração maior, curiosidades e perguntas prontas que a busca local acha', () => {
  const p = enriquecerComArtigo(POI, MERCADO_COMPLETO);
  assert.ok(pontoValido(p));
  assert.ok(p.narrativa.longo.length > POI.narrativa.longo.length);
  assert.match(p.narrativa.longo, /Bernardino Bahia/);
  assert.equal(p.curiosidades.length, 3);
  assert.deepEqual(p.perguntas.map((f) => f.p), [
    'Qual a história de Mercado Municipal de Feira de Santana?',
    'Como é a arquitetura de Mercado Municipal de Feira de Santana?',
    'Mercado de Arte Popular · Mercado Municipal de Feira de Santana',
  ]);
  const pacote = { pois: [p], perguntasGerais: [] };
  // Perguntas do jeito que a pessoa fala
  assert.match(responderLocal(pacote, 'quem construiu o mercado?').texto, /intendente Bernardino Bahia/);
  assert.match(responderLocal(pacote, 'qual o estilo do prédio do mercado?').texto, /eclético/);
  assert.equal(responderLocal(pacote, 'quem construiu o mercado?').origem, 'pergunta');
});

test('trecho que responde: compara o começo das palavras e exige o mínimo de acertos', () => {
  const t = trechoQueResponde(MERCADO_COMPLETO, palavras('quem construiu o mercado'), 2);
  assert.match(t.texto, /foi construído na gestão/);
  assert.equal(trechoQueResponde(MERCADO_COMPLETO, palavras('qual o time de futebol'), 2), null);
});

// Wikipédia simulada: busca e texto completo
function wikiFalsa(registro = []) {
  return async (url) => {
    registro.push(url);
    const u = new URL(url);
    let corpo = {};
    if (u.searchParams.get('list') === 'search') corpo = { query: { search: [{ title: 'Mercado Municipal de São Paulo' }, { title: 'Mercado Municipal de Feira de Santana' }, { title: 'Feira de Santana' }] } };
    else if (u.searchParams.get('titles') === 'Mercado Municipal de São Paulo') corpo = { query: { pages: [{ title: 'Mercado Municipal de São Paulo', extract: 'O Mercado Municipal de São Paulo foi construído entre 1928 e 1933 pelo escritório de Ramos de Azevedo. Fica no centro da capital paulista.' }] } };
    else if (u.searchParams.get('titles') === 'Mercado Municipal de Feira de Santana') corpo = { query: { pages: [{ title: 'Mercado Municipal de Feira de Santana', extract: MERCADO_COMPLETO }] } };
    else if (u.searchParams.get('titles')) corpo = { query: { pages: [{ title: u.searchParams.get('titles'), extract: 'Feira de Santana é um município da Bahia. É a segunda maior cidade do estado.' }] } };
    return { ok: true, status: 200, json: async () => corpo };
  };
}

test('pesquisa na Wikipédia: acha o trecho, devolve o link e guarda em cache', async () => {
  const reg = [];
  const d = criarDescoberta({ fetchImpl: wikiFalsa(reg) });
  const r = await d.pesquisar('Em que ano foi construído o mercado?', { cidade: 'Feira de Santana' });
  assert.equal(r.titulo, 'Mercado Municipal de Feira de Santana');
  assert.match(r.texto, /construído na gestão/);
  assert.equal(r.url, 'https://pt.wikipedia.org/wiki/Mercado_Municipal_de_Feira_de_Santana');
  const busca = new URL(reg.find((x) => x.includes('list=search'))).searchParams.get('srsearch');
  assert.match(busca, /"Feira de Santana"$/);
  const antes = reg.length;
  await d.pesquisar('Em que ano foi construído o mercado?', { cidade: 'Feira de Santana' });
  assert.equal(reg.length, antes);
  assert.equal(await d.pesquisar('qual o placar do jogo?', { cidade: 'Feira de Santana' }), null);
  // O mercado de outra cidade casa as palavras, mas não cita a cidade: fica de fora.
  assert.doesNotMatch(r.texto, /São Paulo|Ramos de Azevedo/);
  // Sinônimos: "comida típica" acha "culinária tradicional" no artigo da cidade.
  const d2 = criarDescoberta({ fetchImpl: async (url) => {
    const u = new URL(url);
    const corpo = u.searchParams.get('titles') === 'Feira de Santana'
      ? { query: { pages: [{ title: 'Feira de Santana', extract: 'Feira de Santana é um município da Bahia.\n\n== Culinária ==\nA culinária tradicional da cidade tem a maniçoba, o godó de banana e a carne do sol.' }] } }
      : { query: { search: [], pages: [] } };
    return { ok: true, status: 200, json: async () => corpo };
  } });
  const r2 = await d2.pesquisar('qual a comida típica daqui?', { cidade: 'Feira de Santana' });
  assert.match(r2.texto, /maniçoba/);
  assert.equal(r2.titulo, 'Feira de Santana');
});

const PACOTE = { id: 'lugar-m12-255-m38-966', nome: 'Feira', cidade: 'Feira de Santana', pois: [POI], perguntasGerais: [], avisos: [] };

test('conversa sem IA: pergunta fora do roteiro vai para a pesquisa; pergunta pronta do roteiro não', async () => {
  const pesquisar = async () => ({ texto: 'O mercado foi construído na gestão do intendente Bernardino Bahia.', titulo: 'Mercado Municipal', url: 'https://pt.wikipedia.org/wiki/Mercado' });
  const r = await conversar({ pacote: PACOTE, mensagem: 'quem construiu o mercado?' }, null, { pesquisar });
  assert.equal(r.motor, 'pesquisa');
  assert.match(r.texto, /^Pesquisei na Wikipédia \(artigo "Mercado Municipal"\): O mercado foi construído/);
  assert.equal(r.fontes[0].url, 'https://pt.wikipedia.org/wiki/Mercado');
  const rico = { ...PACOTE, pois: [enriquecerComArtigo(POI, MERCADO_COMPLETO)] };
  let chamou = false;
  const r2 = await conversar({ pacote: rico, mensagem: 'quem construiu o mercado?' }, null, { pesquisar: async () => { chamou = true; return null; } });
  assert.equal(r2.motor, 'local');
  assert.equal(chamou, false);
  // pesquisa fora do ar: cai na resposta de sempre
  const r3 = await conversar({ pacote: PACOTE, mensagem: 'onde comer acarajé?' }, null, { pesquisar: async () => { throw new Error('rede'); } });
  assert.equal(r3.semResposta, true);
});

test('IA do servidor com busca na web: ferramenta localizada, texto depois da busca e fontes sem repetir', async () => {
  let pedido;
  const cliente = { beta: { messages: { create: async (req) => { pedido = req; return {
    model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [
      { type: 'text', text: 'Vou pesquisar.' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'acarajé Feira de Santana' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
      { type: 'text', text: 'Perto do mercado há baianas de acarajé ', citations: [{ type: 'web_search_result_location', url: 'https://exemplo.com.br/a', title: 'Guia A' }] },
      { type: 'text', text: 'na praça.', citations: [{ type: 'web_search_result_location', url: 'https://exemplo.com.br/a', title: 'Guia A' }, { url: 'http://inseguro.com', title: 'X' }] },
    ] }; } } } };
  const r = await conversar({ pacote: PACOTE, mensagem: 'onde comer acarajé?' }, cliente);
  assert.deepEqual(pedido.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', city: 'Feira de Santana', country: 'BR', timezone: 'America/Sao_Paulo' } }]);
  assert.equal(r.texto, 'Perto do mercado há baianas de acarajé na praça.');
  assert.deepEqual(r.fontes, [{ titulo: 'Guia A', url: 'https://exemplo.com.br/a' }]);
  assert.deepEqual(textoEFontes({ content: [{ type: 'text', text: 'Só texto.' }] }), { texto: 'Só texto.', fontes: [] });
});

test('IA da pessoa (OpenRouter): busca vira o plugin web e as citações viram fontes', () => {
  const corpo = traduzirPedido({ max_tokens: 10, messages: [{ role: 'user', content: 'oi' }], tools: [{ type: 'web_search_20250305', name: 'web_search' }] }, 'openrouter/auto');
  assert.deepEqual(corpo.plugins, [{ id: 'web', max_results: 4 }]);
  assert.equal(traduzirPedido({ max_tokens: 10, messages: [{ role: 'user', content: 'oi' }] }, 'x').plugins, undefined);
  const r = traduzirResposta({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: 'Resposta.', annotations: [{ type: 'url_citation', url_citation: { url: 'https://site.com.br/x', title: 'Site' } }] } }] });
  assert.deepEqual(textoEFontes(r), { texto: 'Resposta.', fontes: [{ titulo: 'Site', url: 'https://site.com.br/x' }] });
});

test('id do destino gerado guarda o centro', () => {
  assert.deepEqual(centroDoIdGerado('lugar-m12-255-m38-966'), { lat: -12.255, lng: -38.966 });
  assert.deepEqual(centroDoIdGerado('lugar-48-857-2-352'), { lat: 48.857, lng: 2.352 });
  assert.equal(centroDoIdGerado('salvador-centro-historico'), null);
  assert.equal(centroDoIdGerado('lugar-m99-000-m38-966'), null);
});

test('conversa e avaliação num destino gerado: o servidor monta o destino pelo id (antes: 404)', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'guia-'));
  const pedidos = [];
  const descoberta = {
    gerarPacote: async (c) => { pedidos.push(c); return { ...PACOTE, pois: [enriquecerComArtigo(POI, MERCADO_COMPLETO)] }; },
    pesquisar: async () => null,
  };
  const { servidor } = await criarServidor({ pastaDados: dados, log: { info() {}, error() {} }, cliente: null, descoberta });
  await new Promise((r) => servidor.listen(0, r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const post = async (c, b) => { const r = await fetch(base + c, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, corpo: r.status === 204 ? null : await r.json() }; };
  try {
    const r = await post('/api/conversa', { pacoteId: 'lugar-m12-255-m38-966', mensagem: 'quem construiu o mercado?', poiId: 'q1001' });
    assert.equal(r.status, 200);
    assert.match(r.corpo.texto, /Bernardino Bahia/);
    assert.deepEqual(pedidos[0], { lat: -12.255, lng: -38.966 });
    assert.equal((await post('/api/feedback', { id: 'feedback-0001', pacoteId: 'lugar-m12-255-m38-966', tipo: 'util' })).status, 204);
    assert.equal((await post('/api/conversa', { pacoteId: 'nao-existe', mensagem: 'oi' })).status, 404);
  } finally { servidor.close(); rmSync(dados, { recursive: true, force: true }); }
});

test('destino gerado completo continua válido e cabe no aparelho', () => {
  const pois = Array.from({ length: 50 }, (_, i) => ({ ...enriquecerComArtigo(POI, MERCADO_COMPLETO), id: `q${i}`, lat: -12.25 + i / 1000 }));
  const pac = { versao: 1, id: 'lugar-m12-255-m38-966', nome: 'Feira', cidade: 'Feira de Santana', pais: 'Brasil', idioma: 'pt-BR', atualizadoEm: '2026-11-08', centro: { lat: -12.25, lng: -38.96 }, rotaDemonstracao: ['q0'], pois, perguntasGerais: [], avisos: [] };
  assert.deepEqual(validarPacote(pac), []);
  assert.ok(JSON.stringify(pac).length < 300000, `tamanho ${JSON.stringify(pac).length}`);
});

test('casos reais da pesquisa: "fundou" ≠ "fundamental", "comer" ≠ "comércio", "cidade" não conta, outra cidade não vale', async () => {
  const { gruposDaPergunta } = await import('../server/descoberta.js');
  const texto = 'A cidade tem importância fundamental no comércio do Nordeste. A cidade foi fundada no século XVIII pelo casal Domingos Barbosa de Araújo e Ana Brandão. O comércio é forte.';
  assert.match(trechoQueResponde(texto, palavras('quem fundou a cidade?'), 1).texto, /fundada no século XVIII/);
  assert.doesNotMatch(trechoQueResponde(texto, palavras('quem fundou a cidade?'), 1).texto, /fundamental/);
  assert.equal(trechoQueResponde(texto, palavras('qual a comida típica?'), 2), null);
  assert.equal(trechoQueResponde('A Constituição de 1988 mudou tudo.', palavras('quem construiu?'), 1), null);
  assert.deepEqual(gruposDaPergunta(palavras('o que tem na cidade?')), []);
  // Artigo da busca que só cita a cidade de passagem (Olinda num texto que compara com Ouro Preto) fica de fora
  const d = criarDescoberta({ fetchImpl: async (url) => {
    const u = new URL(url);
    const corpo = u.searchParams.get('list') === 'search' ? { query: { search: [{ title: 'Olinda' }] } }
      : u.searchParams.get('titles') === 'Olinda' ? { query: { pages: [{ title: 'Olinda', extract: 'Olinda é tombada como Ouro Preto. Também são símbolos culturais da cidade a tapioca, comida típica, e o farol.' }] } }
      : { query: { pages: [] } };
    return { ok: true, status: 200, json: async () => corpo };
  } });
  assert.equal(await d.pesquisar('qual a comida típica?', { cidade: 'Ouro Preto' }), null);
});
