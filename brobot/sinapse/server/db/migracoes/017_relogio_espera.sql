-- 017 · Relógio da espera (WFL-006): tempo aguardando cliente ou terceiro fica registrado e não conta no prazo de
-- resolução (o prazo anda o mesmo tanto, em horas úteis, ao sair da espera).
ALTER TABLE ocorrencias ADD COLUMN espera_inicio_em timestamptz;
ALTER TABLE ocorrencias ADD COLUMN espera_cliente_seg integer NOT NULL DEFAULT 0 CHECK (espera_cliente_seg >= 0);
ALTER TABLE ocorrencias ADD COLUMN espera_terceiro_seg integer NOT NULL DEFAULT 0 CHECK (espera_terceiro_seg >= 0);
-- Em espera, o início da espera está marcado (ocorrências já em espera antes desta migração: marca agora).
UPDATE ocorrencias SET espera_inicio_em = atualizado_em WHERE estado IN ('aguardando_cliente', 'aguardando_terceiro');
