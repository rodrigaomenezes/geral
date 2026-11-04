'use strict';
// Registro automático: toda mudança de estado grava, na MESMA transação, um evento no outbox (contrato canônico)
// e uma linha na trilha de auditoria. Nada de dado sensível no payload (CRE-007, RN-013).

const crypto = require('node:crypto');
const { relogio } = require('./relogio');

/**
 * Publica um evento no outbox. `idempotencyKey` repetida não duplica (RN-014): devolve null.
 * Contrato: event_id, event_type, schema_version, source, tenant_id, aggregate_type, aggregate_id,
 * occurred_at, payload, correlation_id, causation_id, idempotency_key.
 */
async function publicar(c, ctx, { tipo, agregado, agregadoId, payload = {}, chave, causacao = null, versao = 1 }) {
  const r = await c.query(
    `INSERT INTO eventos (tenant_id, event_type, schema_version, aggregate_type, aggregate_id, occurred_at, payload,
       correlation_id, causation_id, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING event_id`,
    [ctx.tenantId, tipo, versao, agregado, agregadoId, relogio.agora(), JSON.stringify(payload),
      ctx.correlacao || null, causacao, chave || crypto.randomUUID()],
  );
  return r.rows[0]?.event_id || null;
}

/** Anexa à trilha de auditoria (a tabela recusa UPDATE/DELETE). */
async function auditar(c, ctx, { acao, entidade, entidadeId, antes = null, depois = null, motivo = null }) {
  await c.query(
    `INSERT INTO auditoria (tenant_id, ator_id, ator_nome, acao, entidade, entidade_id, antes, depois, motivo, correlacao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [ctx.tenantId, ctx.usuario?.id || null, ctx.usuario?.nome || ctx.ator || 'sistema', acao, entidade,
      entidadeId ? String(entidadeId) : null, antes && JSON.stringify(antes), depois && JSON.stringify(depois),
      motivo, ctx.correlacao || null],
  );
}

/** Contexto de execução de rotinas automáticas (sem usuário). */
const ctxSistema = (tenantId, ator = 'sistema', correlacao = crypto.randomUUID()) => ({ tenantId, usuario: null, ator, correlacao });

module.exports = { publicar, auditar, ctxSistema };
