-- Volta da 011: some a volumetria importada; as ocorrências abertas pelos alertas continuam (só perdem a chave).
DROP TABLE IF EXISTS consultas_volume;
DROP INDEX IF EXISTS ocorrencias_alerta_ativa;
ALTER TABLE ocorrencias DROP COLUMN IF EXISTS alerta_chave;
