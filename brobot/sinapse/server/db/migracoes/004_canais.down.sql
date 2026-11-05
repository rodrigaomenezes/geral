-- Volta da 004: remove telefonia e número de WhatsApp (histórico de chamadas é apagado: faça backup antes).
DELETE FROM jobs WHERE tipo = 'telefonia.manutencao';
DROP TABLE IF EXISTS whatsapp_numeros, chamada_eventos, chamadas, telefonia_ramais, telefonia_config CASCADE;
DROP INDEX IF EXISTS interacoes_id_externo;
ALTER TABLE interacoes DROP COLUMN IF EXISTS chamada_id, DROP COLUMN IF EXISTS erro_entrega;
UPDATE interacoes SET status_entrega = 'entregue' WHERE status_entrega = 'lida';
ALTER TABLE interacoes DROP CONSTRAINT IF EXISTS interacoes_status_entrega_check;
ALTER TABLE interacoes ADD CONSTRAINT interacoes_status_entrega_check
  CHECK (status_entrega IN ('registrada', 'enfileirada', 'enviada', 'entregue', 'falhou', 'bloqueada'));
