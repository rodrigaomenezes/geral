-- Volta da 002: remove o motor de processos (a cadência de rodadas deixa de ser automática até reaplicar).
DELETE FROM jobs WHERE tipo IN ('processos.despachar', 'processo.avancar');
DROP TABLE IF EXISTS processo_passos_log, processo_execucoes, processo_versoes, processos CASCADE;
DROP FUNCTION IF EXISTS processo_versao_imutavel();
DROP INDEX IF EXISTS tarefas_execucao;
ALTER TABLE tarefas DROP COLUMN IF EXISTS resultado_codigo, DROP COLUMN IF EXISTS execucao_id;
ALTER TABLE contas DROP COLUMN IF EXISTS grupo_whatsapp;
