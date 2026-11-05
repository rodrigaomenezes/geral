'use strict';
// Verificação dos lotes exportados sem confirmação (chamada pelo supervisor). Arquivo separado para o supervisor não
// depender do módulo CSV inteiro (importadores, rodadas) só por esta consulta.
const { relogio, HORA } = require('../../../nucleo/relogio');

/** Supervisor: lote sem confirmação no prazo vira divergência e tarefa (uma vez por lote). */
async function verificarLotesAtrasados(c, ctx, { criarTarefa }) {
  const agora = relogio.agora();
  const atrasados = (await c.query(`SELECT id, tipo, destino, arquivo FROM exportacoes WHERE estado = 'aguardando_confirmacao' AND prazo_confirmacao_em < $1
    AND NOT EXISTS (SELECT 1 FROM divergencias d WHERE d.chave = 'exportacao:' || exportacoes.id) LIMIT 50`, [agora])).rows;
  for (const l of atrasados) {
    const destino = l.destino === 'omie' ? 'OMIE' : 'Platform';
    await c.query('INSERT INTO divergencias (tenant_id, tipo, descricao, entidade_id, chave) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, chave) DO NOTHING',
      [ctx.tenantId, 'exportacao_sem_confirmacao', `Arquivo ${l.arquivo} exportado para ${destino} sem confirmação de aplicação no prazo.`, l.id, `exportacao:${l.id}`]);
    await criarTarefa({ tipo: 'geral', equipeCodigo: 'supervisao', chave: `exportacao:${l.id}`, prazoEm: new Date(agora.getTime() + 4 * HORA),
      titulo: `Confirmar se o arquivo para ${destino} foi aplicado (${l.arquivo})` });
  }
  return atrasados.length;
}

module.exports = { verificarLotesAtrasados };
