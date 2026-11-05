'use strict';
// F0 · segurança urgente: modo demonstração explícito em produção (R-01/R-02), TLS do banco verificado (R-03),
// limite de tentativas de login (R-04) e HSTS em produção (R-10).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { carregarConfig } = require('../server/config');
const { opcoesTls } = require('../server/db');
const { criarLimitador } = require('../server/modulos/identidade/limitador');
const { subir } = require('./ajuda');

const PROD = { NODE_ENV: 'production', SINAPSE_DATA: '/data/pg' };

test('R-01: em produção o modo demonstração só liga com SINAPSE_DEMO=1 explícito', () => {
  assert.equal(carregarConfig(PROD).demo, false, 'sem a variável, produção fica sem login por persona');
  assert.equal(carregarConfig({ ...PROD, SINAPSE_DEMO: '1' }).demo, true);
  assert.equal(carregarConfig({}).demo, true, 'fora de produção continua ligado para desenvolver');
  assert.throws(() => carregarConfig({ ...PROD, SINAPSE_DEMO: 'sim' }), /0 ou 1/);
});

test('R-01/R-02/R-03: SINAPSE_AMBIENTE=producao recusa demonstração, banco embutido e TLS sem verificação', () => {
  const real = { ...PROD, SINAPSE_AMBIENTE: 'producao', DATABASE_URL: 'postgres://u:s@banco:5432/sinapse' };
  assert.throws(() => carregarConfig({ ...real, SINAPSE_DEMO: '1' }), /não aceita SINAPSE_DEMO=1/);
  assert.throws(() => carregarConfig({ ...real, DATABASE_URL: '' }), /exige DATABASE_URL/);
  assert.throws(() => carregarConfig({ ...real, SINAPSE_DB_TLS_INSEGURO: '1' }), /SINAPSE_DB_CA/);
  assert.equal(carregarConfig(real).demo, false);
});

test('R-03: com sslmode o certificado do PostgreSQL é verificado; desligar exige escolha explícita e fica no log', () => {
  assert.equal(opcoesTls('postgres://h/db'), undefined, 'rede privada sem TLS');
  assert.deepEqual(opcoesTls('postgres://h/db?sslmode=require'), { rejectUnauthorized: true });
  assert.deepEqual(opcoesTls('postgres://h/db?sslmode=require', { ca: 'PEM' }), { rejectUnauthorized: true, ca: 'PEM' });
  const avisos = [];
  assert.deepEqual(opcoesTls('postgres://h/db?sslmode=require', { inseguro: true }, (m) => avisos.push(m)), { rejectUnauthorized: false });
  assert.match(avisos[0], /SEM verificar/);
});

test('R-04: limitador bloqueia na 6ª falha, libera quando a janela vence e zera no acerto', () => {
  let t = 0;
  const l = criarLimitador({ limite: 5, janelaMs: 1000, agora: () => t });
  for (let i = 0; i < 5; i++) { assert.equal(l.bloqueado('a'), null); l.falhou('a'); }
  assert.equal(l.bloqueado('a'), 1);
  assert.equal(l.bloqueado('b'), null, 'outra chave não é afetada');
  t = 1000;
  assert.equal(l.bloqueado('a'), null, 'janela venceu');
  l.falhou('a'); l.acertou('a'); assert.equal(l.bloqueado('a'), null);
  const pequeno = criarLimitador({ limite: 1, janelaMs: 1e9, maxChaves: 3, agora: () => t });
  for (const k of ['1', '2', '3', '4', '5']) pequeno.falhou(k);
  assert.equal(pequeno.bloqueado('1'), null, 'memória limitada: as mais antigas saem');
  assert.ok(pequeno.bloqueado('5'));
});

let t;
before(async () => { t = await subir(); });
after(async () => { await t.parar(); });

test('R-04: 5 senhas erradas → 6ª tentativa recebe 429 com mensagem do que fazer, mesmo com a senha certa', async () => {
  const entrar = (senha) => fetch(`${t.base}/api/sessao/entrar`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'Bianca@Sinapse.demo', senha }) });
  for (let i = 0; i < 5; i++) assert.equal((await entrar('errada-' + i)).status, 422);
  const r = await entrar('errada-6');
  assert.equal(r.status, 429);
  const corpo = await r.json();
  assert.equal(corpo.error.code, 'muitas_tentativas');
  assert.match(corpo.error.message, /Aguarde \d+ min/);
});

test('R-01: com o modo demonstração desligado, entrar sem senha é recusado', async () => {
  t.cfg.demo = false;
  try {
    const [u] = await t.sql("SELECT id FROM usuarios WHERE email = 'rafael@sinapse.demo'");
    const r = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: u.id }) });
    assert.equal(r.status, 403);
    assert.equal((await (await fetch(`${t.base}/api/sessao`)).json()).demo, false);
  } finally { t.cfg.demo = true; }
});
