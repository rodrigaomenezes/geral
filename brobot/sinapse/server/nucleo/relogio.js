'use strict';
// Relógio único do sistema. Em demonstração, o simulador pode adiantá-lo (D-4 → D-3 → D0 → D+3) sem esperar dias.
// O deslocamento fica na tabela `sistema` e é recarregado no boot; uma réplica (ver DECISIONS.md, T-004).

let deslocamentoMs = 0;

const relogio = {
  agora: () => new Date(Date.now() + deslocamentoMs),
  deslocamento: () => deslocamentoMs,
  definirDeslocamento(ms) { deslocamentoMs = Number(ms) || 0; },
  async carregar(db) {
    const r = await db.query("SELECT valor FROM sistema WHERE chave = 'relogio'");
    deslocamentoMs = Number(r.rows[0]?.valor?.deslocamentoMs || 0);
  },
  async salvar(db, ms) {
    deslocamentoMs = Number(ms) || 0;
    await db.query(
      `INSERT INTO sistema (chave, valor, atualizado_em) VALUES ('relogio', $1, now())
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      [JSON.stringify({ deslocamentoMs })],
    );
  },
};

const HORA = 3600e3;
const DIA = 24 * HORA;

module.exports = { relogio, HORA, DIA };
