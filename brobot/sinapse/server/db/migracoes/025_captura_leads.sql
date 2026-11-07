-- 025 · Captura de leads de fora do sistema (CRM-002): o identificador do lead no formulário/site de origem.
-- O mesmo lead reenviado (repetição do webhook) nunca vira duas oportunidades.
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS id_externo text;
CREATE UNIQUE INDEX IF NOT EXISTS oportunidades_id_externo ON oportunidades (tenant_id, id_externo) WHERE id_externo IS NOT NULL;
