'use strict';
// Implantação real (GOV-001): sem demonstração, banco vazio → organização, equipes, processos, matriz sugerida,
// feriados nacionais e a primeira Administração (com SINAPSE_ADMIN_EMAIL + SINAPSE_SENHA_ADMIN). Sem as variáveis,
// nada é criado e o log diz o que fazer. Reiniciar não duplica.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { carregarConfig } = require('../server/config');
const { criarApp } = require('../server/app');

async function banco() {
  const url = process.env.TESTE_DATABASE_URL;
  if (!url) return {};
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  await c.connect(); await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c.end();
  return { DATABASE_URL: url };
}

test('sem as variáveis, não implanta e avisa; com elas, implanta uma vez e a Administração entra', async () => {
  const base = { SINAPSE_DATA: ':memoria:', SINAPSE_DEMO: '0', SINAPSE_WORKER: '0', ...(await banco()) };
  const logs = [];
  const vazio = await criarApp(carregarConfig(base), { log: (m) => logs.push(String(m)) });
  assert.equal((await vazio.db.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n, 0);
  assert.ok(logs.some((l) => /SINAPSE_ADMIN_EMAIL/.test(l)), 'log diz qual variável criar');
  await vazio.parar();

  assert.throws(() => carregarConfig({ ...base, SINAPSE_ADMIN_EMAIL: 'sem-arroba' }), /e-mail/);
  const cfg = carregarConfig({ ...base, SINAPSE_ADMIN_EMAIL: 'Diretoria@Brobot.com.br', SINAPSE_SENHA_ADMIN: 'senha-inicial-forte-2026', SINAPSE_ORGANIZACAO: 'Brobot Tecnologia' });
  const app = await criarApp(cfg, { log: (m) => logs.push(String(m)) });
  const um = async (q) => (await app.db.query(q)).rows[0];
  assert.equal((await um('SELECT count(*)::int AS n FROM tenants')).n, 1);
  const t = await um('SELECT nome, demonstracao FROM tenants');
  assert.deepEqual(t, { nome: 'Brobot Tecnologia', demonstracao: false });
  assert.equal((await um("SELECT count(*)::int AS n FROM usuarios WHERE papel = 'admin'")).n, 1);
  assert.equal((await um('SELECT count(*)::int AS n FROM contas')).n, 0, 'nenhum dado fictício');
  assert.ok((await um('SELECT count(*)::int AS n FROM equipes')).n >= 9);
  assert.ok((await um('SELECT count(*)::int AS n FROM raci')).n > 20, 'matriz sugerida');
  assert.ok((await um("SELECT count(*)::int AS n FROM feriados WHERE data = '2027-04-21'")).n === 1, 'feriados nacionais');
  assert.ok(!logs.join('\n').includes('senha-inicial-forte-2026'), 'senha fora do log');
  assert.ok(!logs.join('\n').includes('diretoria@brobot.com.br'), 'e-mail mascarado no log');

  const implantacao = require('../server/modulos/organizacao/implantacao');
  assert.equal((await implantacao.implantarSeVazio(app.db, cfg)).feito, false, 'reiniciar não duplica');

  const porta = await app.iniciar(0);
  const r = await fetch(`http://127.0.0.1:${porta}/api/sessao/entrar`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'diretoria@brobot.com.br', senha: 'senha-inicial-forte-2026' }) });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).usuario.papel, 'admin');
  await app.parar();
});
