-- Volta da 015: delegações, RACI e plantões deixam de existir; o SLA de contrato volta ao padrão da organização.
DROP TABLE IF EXISTS plantoes, raci, delegacoes;
ALTER TABLE contas DROP CONSTRAINT IF EXISTS contas_sla_contrato_objeto;
ALTER TABLE contas DROP COLUMN IF EXISTS sla_contrato;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tenant_id_id_key;
