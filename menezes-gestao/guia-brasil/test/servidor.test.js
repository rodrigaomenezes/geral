import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarServidor, criarLimitador } from '../server/server.js';

const silencio = { info() {}, error() {} };
const FOTO = 'data:image/jpeg;base64,' + Buffer.from('falsa').toString('base64');
const TERREIRO = { lat: -12.97415, lng: -38.51045 };

async function subir(opcoes) {
  const dados = mkdtempSync(join(tmpdir(), 'guia-'));
  const { servidor } = await criarServidor({ pastaDados: dados, log: silencio, ...opcoes });
  await new Promise((r) => servidor.listen(0, r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (caminho, corpo, headers = {}) => {
    const r = await fetch(base + caminho, corpo ? { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) } : { headers });
    const txt = await r.text();
    return { status: r.status, headers: r.headers, corpo: txt ? (r.headers.get('content-type') || '').includes('json') ? JSON.parse(txt) : txt : null };
  };
  return { servidor, dados, chamar, fechar: () => { servidor.close(); rmSync(dados, { recursive: true, force: true }); } };
}

let s;
before(async () => { s = await subir({ cliente: null }); });
after(() => s.fechar());

test('health, lista e pacote com ETag', async () => {
  const h = await s.chamar('/api/health');
  assert.equal(h.status, 200);
  assert.deepEqual({ ok: h.corpo.ok, ia: h.corpo.ia }, { ok: true, ia: false });
  const l = await s.chamar('/api/pacotes');
  assert.equal(l.corpo[0].id, 'salvador-centro-historico');
  assert.equal(l.corpo[0].pontos, 11);
  const p = await s.chamar('/api/pacotes/salvador-centro-historico');
  assert.equal(p.status, 200);
  const etag = p.headers.get('etag');
  assert.ok(etag);
  assert.equal((await s.chamar('/api/pacotes/salvador-centro-historico', null, { 'if-none-match': etag })).status, 304);
  assert.equal((await s.chamar('/api/pacotes/nao-existe')).status, 404);
});

test('app estático é servido e caminhos fora da pasta são bloqueados', async () => {
  const r = await s.chamar('/');
  assert.equal(r.status, 200);
  assert.match(r.corpo, /GuIA Brasil/);
  assert.equal((await s.chamar('/js/nucleo.js')).status, 200);
  assert.equal((await s.chamar('/../server/server.js')).status, 404);
  assert.equal((await s.chamar('/%2e%2e/package.json')).status, 404);
});

test('conversa sem IA responde pelo conteúdo do pacote', async () => {
  const r = await s.chamar('/api/conversa', { pacoteId: 'salvador-centro-historico', mensagem: 'quem fundou Salvador?' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.motor, 'local');
  assert.match(r.corpo.texto, /Tomé de Sousa/);
  const nao = await s.chamar('/api/conversa', { pacoteId: 'salvador-centro-historico', mensagem: 'previsão do tempo amanhã' });
  assert.equal(nao.corpo.semResposta, true);
  // online e sem IA: não pode culpar a internet
  assert.doesNotMatch(nao.corpo.texto, /internet/i);
  assert.match(nao.corpo.texto, /conteúdo desta viagem/);
});

test('entradas inválidas são recusadas com mensagem clara', async () => {
  assert.equal((await s.chamar('/api/conversa', { pacoteId: 'salvador-centro-historico', mensagem: '' })).status, 400);
  assert.equal((await s.chamar('/api/conversa', { pacoteId: 'x', mensagem: 'oi' })).status, 404);
  assert.equal((await s.chamar('/api/conversa', '{quebrado')).status, 400);
  assert.equal((await s.chamar('/api/foto', { pacoteId: 'salvador-centro-historico', imagem: 'data:text/html;base64,AAAA' })).status, 400);
  assert.equal((await s.chamar('/api/feedback', { pacoteId: 'salvador-centro-historico', tipo: 'talvez', id: 'abcdefgh1' })).status, 400);
  assert.equal((await s.chamar('/api/nada')).status, 404);
});

test('foto sem IA identifica pelo GPS e pela bússola', async () => {
  const r = await s.chamar('/api/foto', { pacoteId: 'salvador-centro-historico', imagem: FOTO, pos: TERREIRO, direcao: 120 });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.motor, 'local');
  assert.equal(r.corpo.poiId, 'catedral-basilica');
  const longe = await s.chamar('/api/foto', { pacoteId: 'salvador-centro-historico', imagem: FOTO, pos: { lat: -13.2, lng: -38.7 } });
  assert.equal(longe.corpo.identificado, false);
});

test('feedback é gravado uma vez por id (reenvio da fila não duplica)', async () => {
  const f = { id: 'teste-feedback-1', pacoteId: 'salvador-centro-historico', tipo: 'errado', poiId: 'elevador-lacerda', resposta: 'x' };
  assert.equal((await s.chamar('/api/feedback', f)).status, 204);
  assert.equal((await s.chamar('/api/feedback', f)).status, 204);
  const linhas = readFileSync(join(s.dados, 'feedback.jsonl'), 'utf8').trim().split('\n');
  assert.equal(linhas.length, 1);
  assert.equal(JSON.parse(linhas[0]).tipo, 'errado');
});

test('com IA: usa o modelo, envia o contexto do pacote e cai para o local se a IA falhar', async () => {
  const pedidos = [];
  let falhar = false;
  const cliente = { beta: { messages: { create: async (req) => {
    pedidos.push(req);
    if (falhar) throw new Error('timeout simulado');
    const foto = req.output_config.format;
    const text = foto ? JSON.stringify({ identificado: true, poiId: 'catedral-basilica', titulo: 'Catedral Basílica', explicacao: 'Igreja dos jesuítas.', curiosidades: ['a', 'b', 'c', 'd'] }) : 'Resposta do guia.';
    return { model: 'modelo-teste', stop_reason: 'end_turn', content: [{ type: 'text', text }] };
  } } } };
  const ia = await subir({ cliente });
  try {
    const c = await ia.chamar('/api/conversa', { pacoteId: 'salvador-centro-historico', mensagem: 'me conta da catedral', pos: TERREIRO,
      historico: [{ papel: 'guia', texto: 'Olá!' }, { papel: 'usuario', texto: 'oi' }, { papel: 'guia', texto: 'Oi!' }] });
    assert.deepEqual({ motor: c.corpo.motor, texto: c.corpo.texto }, { motor: 'ia', texto: 'Resposta do guia.' });
    const ultimo = pedidos.at(-1).messages.at(-1).content;
    assert.match(ultimo, /Catedral Basílica/);
    assert.ok(pedidos.at(-1).messages[0].role === 'user', 'conversa começa pelo usuário');
    assert.ok(pedidos.at(-1).messages.every((m, i, a) => i === 0 || m.role !== a[i - 1].role), 'papéis alternados');

    const f = await ia.chamar('/api/foto', { pacoteId: 'salvador-centro-historico', imagem: FOTO, pos: TERREIRO });
    assert.equal(f.corpo.motor, 'ia');
    assert.equal(f.corpo.curiosidades.length, 3);
    assert.equal(pedidos.at(-1).messages[0].content[0].type, 'image');

    falhar = true;
    const queda = await ia.chamar('/api/conversa', { pacoteId: 'salvador-centro-historico', mensagem: 'quando o elevador foi inaugurado?' });
    assert.equal(queda.corpo.motor, 'local');
    assert.match(queda.corpo.texto, /1873/);
    assert.match(queda.corpo.erroIa, /timeout/);
    const quedaSem = await ia.chamar('/api/conversa', { pacoteId: 'salvador-centro-historico', mensagem: 'previsão do tempo amanhã' });
    assert.match(quedaSem.corpo.texto, /Não consegui consultar a IA/);
  } finally { ia.fechar(); }
});

test('limitador barra excesso por IP e libera depois da janela', async () => {
  const lim = criarLimitador({ maximo: 2, janelaMs: 1000 });
  assert.equal(lim('ip', 0), true);
  assert.equal(lim('ip', 10), true);
  assert.equal(lim('ip', 20), false);
  assert.equal(lim('outro', 20), true);
  assert.equal(lim('ip', 1500), true);
  const s2 = await subir({ cliente: null, limitador: criarLimitador({ maximo: 1 }) });
  try {
    const corpo = { pacoteId: 'salvador-centro-historico', mensagem: 'oi elevador' };
    assert.equal((await s2.chamar('/api/conversa', corpo)).status, 200);
    assert.equal((await s2.chamar('/api/conversa', corpo)).status, 429);
  } finally { s2.fechar(); }
});
