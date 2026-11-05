-- Volta da 008: oportunidades suspensas voltam à etapa de onde saíram; as importadas do Pipedrive continuam (só
-- perdem a marca de origem); teste dispensado volta a exigir teste (negociação/ganha sem teste aprovado voltam a proposta).
UPDATE oportunidades SET etapa = suspensa_de WHERE etapa = 'suspensa';
UPDATE oportunidades SET etapa = 'proposta' WHERE etapa = 'negociacao' AND teste_dispensado AND teste_resultado IS DISTINCT FROM 'aprovado';
DROP TABLE IF EXISTS atividades_comerciais, propostas, produtos_comerciais;
DROP FUNCTION IF EXISTS proposta_enviada_imutavel();
DROP INDEX IF EXISTS oportunidades_id_externo;
ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS suspensa_completa;
ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS fechamento_com_teste;
-- Regra original de volta para o que entrar daqui em diante; vendas já fechadas com teste dispensado ficam como estão.
ALTER TABLE oportunidades ADD CONSTRAINT fechamento_com_teste CHECK (etapa NOT IN ('negociacao', 'ganha') OR teste_resultado = 'aprovado') NOT VALID;
ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS oportunidades_etapa_check;
ALTER TABLE oportunidades ADD CONSTRAINT oportunidades_etapa_check
  CHECK (etapa IN ('novo', 'qualificacao', 'demonstracao', 'proposta', 'teste', 'negociacao', 'ganha', 'perdida'));
ALTER TABLE oportunidades DROP COLUMN IF EXISTS id_externo, DROP COLUMN IF EXISTS fonte, DROP COLUMN IF EXISTS motivo_suspensao,
  DROP COLUMN IF EXISTS suspensa_de, DROP COLUMN IF EXISTS teste_dispensado;
