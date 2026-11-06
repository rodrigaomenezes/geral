'use strict';
// Sobe o servidor real com PostgreSQL embutido em memória, relógio fixo numa quarta-feira 10h (Brasília)
// e os dados de demonstração. O worker não roda sozinho: o teste chama `processar()` quando quer.

const { carregarConfig } = require('../server/config');
const { criarApp } = require('../server/app');
const { relogio, HORA } = require('../server/nucleo/relogio');
const seed = require('../server/modulos/demo/seed');

const INICIO = new Date('2026-11-04T13:00:00Z');
const TOKEN = 'token-de-teste-com-mais-de-24-caracteres';

// TESTE_DATABASE_URL (opcional): roda contra um PostgreSQL de verdade. O esquema `public` desse banco é APAGADO.
async function limparBancoExterno(url) {
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
}

async function subir() {
  const url = process.env.TESTE_DATABASE_URL;
  if (url) await limparBancoExterno(url);
  const cfg = carregarConfig({ SINAPSE_DATA: ':memoria:', SINAPSE_DEMO: '0', SINAPSE_WORKER: '0', SINAPSE_TOKEN_ENTRADA: TOKEN,
    ...(url ? { DATABASE_URL: url } : {}) });
  const app = await criarApp(cfg, { log: process.env.TESTE_LOG ? console.error : () => {} });
  await relogio.salvar(app.db, INICIO.getTime() - Date.now());
  cfg.demo = true;
  await seed.semearSeVazio(app.db, cfg);
  const porta = await app.iniciar(0);
  const base = `http://127.0.0.1:${porta}`;
  const personas = (await (await fetch(`${base}/api/demo/personas`)).json()).personas;

  async function entrarComo(nome) {
    const p = personas.find((x) => x.nome === nome);
    if (!p) throw new Error(`persona ${nome} não existe`);
    const r = await fetch(`${base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: p.id }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const chamar = async (metodo, caminho, corpo) => {
      const resp = await fetch(`${base}/api${caminho}`, { method: metodo, headers: { cookie, ...(corpo ? { 'content-type': 'application/json' } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined });
      return { status: resp.status, corpo: await resp.json().catch(() => null) };
    };
    return { get: (c) => chamar('GET', c), post: (c, b = {}) => chamar('POST', c, b) };
  }

  const tenant = async (slug = 'brobot') => (await app.db.query('SELECT id FROM tenants WHERE slug = $1', [slug])).rows[0].id;
  const sql = async (texto, params) => (await app.db.query(texto, params)).rows;
  const processar = () => app.worker.executarPendentes(50);
  const avancar = async (horas) => { await relogio.salvar(app.db, relogio.deslocamento() + horas * HORA); return processar(); };

  return { app, cfg, base, entrarComo, tenant, sql, processar, avancar, TOKEN, parar: () => app.parar() };
}

module.exports = { subir, INICIO, TOKEN };
