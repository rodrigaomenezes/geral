'use strict';
// Acesso ao PostgreSQL. Dois motores com o mesmo contrato:
//  - DATABASE_URL definido → PostgreSQL gerenciado (pacote `pg`, pool de conexões);
//  - sem DATABASE_URL → PostgreSQL embutido (PGlite) gravando em SINAPSE_DATA (Volume /data no Railway).
// Toda consulta de negócio roda em `comoTenant`: transação + papel sem privilégio (`sinapse_app`) +
// `app.tenant_id`, e o Row Level Security do banco filtra o que não é da organização.
// `sistema` é reservado a rotinas sem usuário (login, fila de jobs, supervisor).

const PAPEL_APP = 'sinapse_app';

function criarAdaptadorPg(url) {
  const { Pool } = require('pg');
  const ssl = /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString: url, max: Number(process.env.SINAPSE_DB_POOL || 10), ssl });
  return {
    motor: 'postgresql',
    async query(sql, params) { return pool.query(sql, params); },
    async exec(sql) { await pool.query(sql); },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn({ query: (s, p) => c.query(s, p), exec: (s) => c.query(s) });
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async fechar() { await pool.end(); },
  };
}

async function criarAdaptadorPglite(dir) {
  const { PGlite } = require('@electric-sql/pglite');
  if (dir) require('node:fs').mkdirSync(dir, { recursive: true });
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  // PGlite tem uma conexão só: as transações são serializadas aqui para não se misturarem.
  let fila = Promise.resolve();
  const emFila = (fn) => {
    const r = fila.then(fn, fn);
    fila = r.catch(() => {});
    return r;
  };
  // O PGlite devolve `affectedRows`; o pg devolve `rowCount`. O resto do sistema usa `rowCount` nos dois.
  const comContagem = (r) => Object.assign(r, { rowCount: r.affectedRows ?? r.rows?.length ?? 0 });
  return {
    motor: dir ? 'pglite' : 'pglite-memoria',
    query: (sql, params) => emFila(async () => comContagem(await db.query(sql, params))),
    exec: (sql) => emFila(() => db.exec(sql)),
    tx: (fn) => emFila(() => db.transaction((t) => fn({ query: async (s, p) => comContagem(await t.query(s, p)), exec: (s) => t.exec(s) }))),
    fechar: () => db.close(),
  };
}

async function abrirBanco({ url, dir } = {}) {
  const base = url ? criarAdaptadorPg(url) : await criarAdaptadorPglite(dir);

  /** Executa `fn(c)` numa transação restrita à organização `tenantId` (RLS). */
  async function comoTenant(tenantId, fn) {
    if (!tenantId) throw new Error('comoTenant sem tenantId');
    return base.tx(async (c) => {
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await c.query(`SET LOCAL ROLE ${PAPEL_APP}`);
      return fn(c);
    });
  }

  /** Transação sem filtro de organização: só login, fila de jobs, supervisor e migração. */
  async function sistema(fn) {
    return base.tx(fn);
  }

  return { motor: base.motor, query: base.query, exec: base.exec, comoTenant, sistema, fechar: base.fechar };
}

/** Linha única ou null. */
const uma = (r) => (r.rows && r.rows[0]) || null;

module.exports = { abrirBanco, uma, PAPEL_APP };
