-- 026 · Envio em duas fases (R-20, idempotência de efeito externo): antes de chamar o provedor, a interação passa a
-- "enviando" numa transação já confirmada. Se o processo cair entre o envio e a confirmação, ela não volta para a fila
-- (o que reenviaria ao cliente): o supervisor a marca "incerta" e pede a uma pessoa que confira no canal.
ALTER TABLE interacoes ADD COLUMN IF NOT EXISTS envio_iniciado_em timestamptz;
ALTER TABLE interacoes DROP CONSTRAINT IF EXISTS interacoes_status_entrega_check;
ALTER TABLE interacoes ADD CONSTRAINT interacoes_status_entrega_check
  CHECK (status_entrega IN ('registrada', 'enfileirada', 'enviando', 'incerta', 'enviada', 'entregue', 'lida', 'falhou', 'bloqueada'));
CREATE INDEX IF NOT EXISTS interacoes_enviando ON interacoes (envio_iniciado_em) WHERE status_entrega = 'enviando';
