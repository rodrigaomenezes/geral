import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { traduzirPedido, traduzirResposta, clienteOpenRouter, chaveValida, ErroIaUsuario } from '../server/openrouter.js';
import { criarServidor } from '../server/server.js';
import { desafioS256, urlDeLogin, concluirLogin, conexao, cabecalhos, desconectar, definirModelo, ehRetornoDeLogin } from '../public/js/minhaia.js';

const CHAVE = 'sk-or-v1-0123456789abcdef0123456789abcdef';

test('PKCE: desafio S256 bate com o exemplo da RFC 7636', async () => {
  assert.equal(await desafioS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('login: monta a URL, troca o código e guarda a chave só no aparelho', async () => {
  const url = new URL(await urlDeLogin('https://exemplo.app/'));
  assert.equal(url.origin + url.pathname, 'https://openrouter.ai/auth');
  assert.equal(url.searchParams.get('callback_url'), 'https://exemplo.app/');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const estado = url.searchParams.get('state');
  assert.ok(ehRetornoDeLogin(new URLSearchParams({ code: 'abc', state: estado })));

  let pedido;
  const fetchFalso = async (u, op) => { pedido = { u, corpo: JSON.parse(op.body) }; return { ok: true, json: async () => ({ key: CHAVE }) }; };
  const c = await concluirLogin(new URLSearchParams({ code: 'abc', state: estado }), fetchFalso);
  assert.equal(pedido.u, 'https://openrouter.ai/api/v1/auth/keys');
  assert.equal(pedido.corpo.code, 'abc');
  assert.equal(await desafioS256(pedido.corpo.code_verifier), url.searchParams.get('code_challenge'));
  assert.equal(c.chave, CHAVE);
  assert.deepEqual(cabecalhos(), { 'x-guia-ia-chave': CHAVE, 'x-guia-ia-modelo': 'openrouter/auto' });
  assert.equal(definirModelo('nao pode ter espaço'), false);
  assert.equal(definirModelo('google/gemini-x'), true);
  assert.equal(conexao().modelo, 'google/gemini-x');
  // o login é de uso único
  await assert.rejects(concluirLogin(new URLSearchParams({ code: 'abc', state: estado }), fetchFalso), /login em andamento/);
  desconectar();
  assert.equal(conexao(), null);
  assert.deepEqual(cabecalhos(), {});
});

test('login: estado diferente, expirado ou recusado pela OpenRouter não conecta', async () => {
  const fetchOk = async () => ({ ok: true, json: async () => ({ key: CHAVE }) });
  await urlDeLogin('https://exemplo.app/');
  await assert.rejects(concluirLogin(new URLSearchParams({ code: 'x', state: 'outro' }), fetchOk), /não confere/);
  const u = new URL(await urlDeLogin('https://exemplo.app/'));
  await assert.rejects(concluirLogin(new URLSearchParams({ code: 'x', state: u.searchParams.get('state') }), fetchOk, Date.now() + 16 * 60000), /expirou/);
  const u2 = new URL(await urlDeLogin('https://exemplo.app/'));
  await assert.rejects(concluirLogin(new URLSearchParams({ code: 'x', state: u2.searchParams.get('state') }), async () => ({ ok: false, json: async () => ({}) })), /não confirmou/);
  assert.equal(conexao(), null);
});

test('tradução Anthropic → OpenRouter: sistema, imagem e JSON estruturado', () => {
  const corpo = traduzirPedido({
    max_tokens: 900, system: 'Você é o guia.',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } },
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } }, { type: 'text', text: 'o que é?' }] }],
  }, 'openrouter/auto');
  assert.equal(corpo.model, 'openrouter/auto');
  assert.deepEqual(corpo.messages[0], { role: 'system', content: 'Você é o guia.' });
  assert.deepEqual(corpo.messages[1].content[0], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } });
  assert.equal(corpo.response_format.json_schema.strict, true);
  assert.equal(traduzirResposta({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: '```json\n{"a":1}\n```' } }] }).content[0].text, '{"a":1}');
  assert.equal(traduzirResposta({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }).stop_reason, 'refusal');
  assert.ok(chaveValida(CHAVE));
  assert.ok(!chaveValida('sk-ant-123'));
});

test('cliente OpenRouter: manda a chave da pessoa e transforma 402 em erro com status', async () => {
  let enviado;
  const ok = clienteOpenRouter(CHAVE, 'openrouter/auto', { fetchImpl: async (u, op) => { enviado = op; return { ok: true, json: async () => ({ model: 'x/y', choices: [{ finish_reason: 'stop', message: { content: 'Oi!' } }] }) }; } });
  const r = await ok.beta.messages.create({ max_tokens: 10, messages: [{ role: 'user', content: 'oi' }] });
  assert.equal(enviado.headers.authorization, `Bearer ${CHAVE}`);
  assert.equal(r.content[0].text, 'Oi!');
  const semCredito = clienteOpenRouter(CHAVE, 'openrouter/auto', { fetchImpl: async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'Insufficient credits' } }) }) });
  await assert.rejects(semCredito.beta.messages.create({ max_tokens: 10, messages: [{ role: 'user', content: 'oi' }] }), (e) => e instanceof ErroIaUsuario && e.status === 402);
});

test('servidor: usa a IA da pessoa quando o app manda a conexão, sem registrar a chave', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'guia-'));
  const linhas = [];
  const log = { info: (l) => linhas.push(l), error: (l) => linhas.push(l) };
  let status = 200;
  const fetchIA = async (u, op) => {
    const corpo = JSON.parse(op.body);
    if (status !== 200) return { ok: false, status, json: async () => ({ error: { message: 'erro' } }) };
    return { ok: true, json: async () => ({ model: corpo.model, choices: [{ finish_reason: 'stop', message: { content: 'Resposta da IA da pessoa.' } }] }) };
  };
  const { servidor } = await criarServidor({ pastaDados: dados, log, cliente: null, fetchIA });
  await new Promise((r) => servidor.listen(0, r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const perguntar = (headers) => fetch(`${base}/api/conversa`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ pacoteId: 'salvador-centro-historico', mensagem: 'qual o melhor bar da cidade?' }) }).then(async (r) => ({ status: r.status, corpo: await r.json() }));
  try {
    const sem = await perguntar({});
    assert.equal(sem.corpo.motor, 'local'); // servidor sem IA própria
    const com = await perguntar({ 'x-guia-ia-chave': CHAVE, 'x-guia-ia-modelo': 'google/gemini-x' });
    assert.deepEqual([com.corpo.motor, com.corpo.provedor, com.corpo.modelo, com.corpo.texto], ['ia', 'openrouter', 'google/gemini-x', 'Resposta da IA da pessoa.']);
    assert.equal((await perguntar({ 'x-guia-ia-chave': 'roubada' })).status, 400);
    status = 402;
    const semCredito = await perguntar({ 'x-guia-ia-chave': CHAVE });
    assert.deepEqual([semCredito.corpo.motor, semCredito.corpo.iaUsuario], ['local', 'sem-creditos']);
    status = 401;
    assert.equal((await perguntar({ 'x-guia-ia-chave': CHAVE })).corpo.iaUsuario, 'invalida');
    assert.ok(linhas.length > 0 && linhas.every((l) => !l.includes('sk-or-')), 'a chave não pode aparecer no log');
  } finally { servidor.close(); rmSync(dados, { recursive: true, force: true }); }
});
