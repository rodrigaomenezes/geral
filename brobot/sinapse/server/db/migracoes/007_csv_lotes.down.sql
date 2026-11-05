-- Volta da 007: some o controle de lotes e mapas; as importações já aplicadas continuam (só perdem estado e mapa).
ALTER TABLE importacoes DROP COLUMN IF EXISTS mapa_id, DROP COLUMN IF EXISTS estado;
DROP TABLE IF EXISTS exportacoes, mapas_csv;
