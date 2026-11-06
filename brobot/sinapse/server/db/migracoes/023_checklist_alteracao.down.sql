-- Volta da 023: checklists de alteração abertos passam a cancelados. Nada é apagado: os registros de alteração ficam,
-- por isso a regra de tipo continua aceitando 'alteracao' (voltar a regra exigiria apagar histórico).
UPDATE checklists SET estado = 'cancelado', concluido_em = coalesce(concluido_em, now()) WHERE tipo = 'alteracao' AND estado = 'aberto';
ALTER TABLE checklists DROP CONSTRAINT IF EXISTS checklists_alteracao_com_motivo;
