-- Volta da 026: quem estava "enviando" ou "incerta" vira "falhou" (com o motivo), para caber na regra anterior.
UPDATE interacoes SET status_entrega = 'falhou', erro_entrega = coalesce(erro_entrega, 'Envio sem confirmação (estado removido na volta da 026)')
  WHERE status_entrega IN ('enviando', 'incerta');
DROP INDEX IF EXISTS interacoes_enviando;
ALTER TABLE interacoes DROP CONSTRAINT IF EXISTS interacoes_status_entrega_check;
ALTER TABLE interacoes ADD CONSTRAINT interacoes_status_entrega_check
  CHECK (status_entrega IN ('registrada', 'enfileirada', 'enviada', 'entregue', 'lida', 'falhou', 'bloqueada'));
ALTER TABLE interacoes DROP COLUMN IF EXISTS envio_iniciado_em;
