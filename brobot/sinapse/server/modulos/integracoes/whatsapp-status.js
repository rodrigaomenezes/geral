'use strict';
// Status de entrega de mensagem enviada (oficial ou QR). Evento fora de ordem não volta o status.
const { uma } = require('../../db');

const ORDEM = { enfileirada: 0, enviada: 1, entregue: 2, lida: 3 };

async function aplicarStatus(c, idExterno, novo, erro = null) {
  if (!novo) return;
  const it = uma(await c.query("SELECT id, status_entrega FROM interacoes WHERE id_externo = $1 AND direcao = 'saida' FOR UPDATE", [idExterno]));
  if (!it) return;
  if (novo !== 'falhou' && (ORDEM[novo] ?? 0) <= (ORDEM[it.status_entrega] ?? -1)) return;
  await c.query('UPDATE interacoes SET status_entrega = $2, erro_entrega = $3 WHERE id = $1', [it.id, novo, erro]);
}

module.exports = { aplicarStatus };
