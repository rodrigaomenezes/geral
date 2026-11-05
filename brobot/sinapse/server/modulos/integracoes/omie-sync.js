'use strict';
// Sincronização financeira com o OMIE (FIN-002, FIN-003, FIN-007, FIN-008, AT-006). Job recorrente.
// OMIE fora do ar → o job falha e é repetido com backoff; a situação guardada NÃO muda (o ERP não inventa status)
// e a tela mostra a data da última sincronização. Cliente com id OMIE não encontrado vira divergência.

const { relogio } = require('../../nucleo/relogio');
const { publicar } = require('../../nucleo/registro');
const omie = require('./omie-demo');

const INTERVALO_MS = 10 * 60e3;

async function jobSincronizar(c, ctx) {
  const contas = (await c.query('SELECT id, nome, id_omie FROM contas WHERE id_omie IS NOT NULL AND arquivada_em IS NULL')).rows;
  const situacoes = await omie.consultarSituacoes(c, contas.map((x) => x.id_omie));
  let alteradas = 0;
  for (const conta of contas) {
    const s = situacoes.get(conta.id_omie);
    if (!s) {
      await c.query(
        `INSERT INTO divergencias (tenant_id, tipo, descricao, entidade_id, chave) VALUES ($1, 'omie_cliente_nao_encontrado', $2, $3, $4)
         ON CONFLICT (tenant_id, chave) DO NOTHING`,
        [ctx.tenantId, `Conta ${conta.nome} aponta para o cliente OMIE ${conta.id_omie}, que não foi encontrado.`, conta.id, `omie:${conta.id_omie}`]);
      continue;
    }
    const r = await c.query(
      `INSERT INTO status_financeiro (tenant_id, conta_id, situacao, sincronizado_em) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, conta_id) DO UPDATE SET situacao = EXCLUDED.situacao, sincronizado_em = EXCLUDED.sincronizado_em
       RETURNING (xmax = 0) AS nova`, [ctx.tenantId, conta.id, s, relogio.agora()]);
    if (r.rowCount) alteradas++;
  }
  await publicar(c, ctx, { tipo: 'financeiro.sincronizado', agregado: 'tenant', agregadoId: ctx.tenantId, payload: { contas: alteradas } });
  return { proximaEm: new Date(relogio.agora().getTime() + INTERVALO_MS) };
}

module.exports = { jobSincronizar, INTERVALO_MS };
