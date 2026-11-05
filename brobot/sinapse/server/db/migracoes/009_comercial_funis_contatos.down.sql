-- Volta da 009: as oportunidades de expansão e renovação continuam (viram do funil único de antes); pessoas e
-- vínculos deixam de existir; o contato principal de cada oportunidade não é afetado.
DROP TABLE IF EXISTS oportunidade_contatos, contatos_comerciais;
DROP INDEX IF EXISTS oportunidades_conta_origem;
ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS funil_com_conta;
ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS oportunidade_conta_origem;
ALTER TABLE oportunidades DROP COLUMN IF EXISTS encaminhada_por, DROP COLUMN IF EXISTS fechamento_previsto,
  DROP COLUMN IF EXISTS conta_origem_id, DROP COLUMN IF EXISTS funil;
