-- Volta da 003. Apaga lembretes, notificações, oportunidades, uso e histórico de importações.
DELETE FROM jobs WHERE tipo = 'lembretes.avisar';
DROP TABLE IF EXISTS importacoes, uso_contas, oportunidades, notificacoes, lembretes CASCADE;
ALTER TABLE rodadas DROP COLUMN IF EXISTS fonte;
ALTER TABLE tarefas DROP COLUMN IF EXISTS oportunidade_id;
DROP INDEX IF EXISTS processo_execucoes_oportunidade;
ALTER TABLE processo_execucoes DROP COLUMN IF EXISTS oportunidade_id;
ALTER TABLE contas DROP COLUMN IF EXISTS oportunidade_id, DROP COLUMN IF EXISTS valor_mensal, DROP COLUMN IF EXISTS produtos;
UPDATE usuarios SET ativo = false WHERE papel = 'comercial';
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_papel_check
  CHECK (papel IN ('admin', 'supervisor', 'suporte', 'cs', 'operacoes', 'dev', 'financeiro') OR NOT ativo);
