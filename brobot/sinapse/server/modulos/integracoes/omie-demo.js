'use strict';
// Adaptador de DEMONSTRAÇÃO do OMIE: só lê a situação financeira mínima por cliente (FIN-003).
// O ERP Sinapse nunca emite NFS-e, boleto ou baixa (FIN-005) e não infere saldo (RN-011).

const { exigirDisponivel, registrarSucesso } = require('./estado');

async function consultarSituacoes(c, idsOmie) {
  await exigirDisponivel(c, 'omie');
  const r = await c.query('SELECT id_omie, situacao FROM demo_omie WHERE id_omie = ANY($1)', [idsOmie]);
  await registrarSucesso(c, 'omie', { ultimaLeitura: new Date().toISOString(), clientes: r.rowCount });
  return new Map(r.rows.map((x) => [x.id_omie, x.situacao]));
}

module.exports = { consultarSituacoes };
