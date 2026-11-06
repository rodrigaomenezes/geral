-- Volta da 019: o registro de ciência do escalonamento deixa de existir (a auditoria continua com o histórico).
ALTER TABLE ocorrencias DROP CONSTRAINT IF EXISTS ciencia_ate_o_nivel;
ALTER TABLE ocorrencias DROP COLUMN IF EXISTS escalonamento_ciente_nivel;
ALTER TABLE ocorrencias DROP COLUMN IF EXISTS escalonamento_ciente_por;
ALTER TABLE ocorrencias DROP COLUMN IF EXISTS escalonamento_ciente_em;
