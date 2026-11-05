'use strict';
// Migrações versionadas: arquivos `NNN_nome.sql` (subida) e `NNN_nome.down.sql` (volta), aplicadas em ordem,
// cada uma na própria transação. Uma migração aplicada não é reaplicada; arquivo alterado depois de aplicado
// impede o boot (checksum diferente) — nunca editar migração publicada, criar uma nova.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(__dirname, 'migracoes');

function listar() {
  return fs.readdirSync(DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort()
    .map((f) => {
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      const down = path.join(DIR, f.replace(/\.sql$/, '.down.sql'));
      return {
        versao: f.slice(0, 3),
        nome: f,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
        down: fs.existsSync(down) ? fs.readFileSync(down, 'utf8') : null,
      };
    });
}

async function migrar(db, log = () => {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migracoes (
    versao text PRIMARY KEY, nome text NOT NULL, checksum text NOT NULL, aplicada_em timestamptz NOT NULL DEFAULT now())`);
  const feitas = new Map((await db.query('SELECT versao, checksum FROM schema_migracoes')).rows.map((r) => [r.versao, r.checksum]));
  const aplicadas = [];
  for (const m of listar()) {
    if (feitas.has(m.versao)) {
      if (feitas.get(m.versao) !== m.checksum) {
        throw new Error(`Migração ${m.nome} foi alterada depois de aplicada. Crie uma migração nova em vez de editar.`);
      }
      continue;
    }
    await db.sistema(async (c) => {
      await c.exec(m.sql); // vários comandos: exec, não instrução preparada
      await c.query('INSERT INTO schema_migracoes (versao, nome, checksum) VALUES ($1, $2, $3)', [m.versao, m.nome, m.checksum]);
    });
    aplicadas.push(m.nome);
    log(`migração aplicada: ${m.nome}`);
  }
  return aplicadas;
}

/** Desfaz a última migração aplicada (usa o arquivo .down.sql). */
async function voltar(db) {
  const ultima = (await db.query('SELECT versao FROM schema_migracoes ORDER BY versao DESC LIMIT 1')).rows[0];
  if (!ultima) return null;
  const m = listar().find((x) => x.versao === ultima.versao);
  if (!m || !m.down) throw new Error(`Migração ${ultima.versao} não tem arquivo de volta.`);
  await db.sistema(async (c) => {
    await c.exec(m.down);
    await c.query('DELETE FROM schema_migracoes WHERE versao = $1', [m.versao]);
  });
  return m.nome;
}

module.exports = { migrar, voltar, listar };
