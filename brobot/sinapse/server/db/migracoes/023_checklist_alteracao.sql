-- 023 · Checklist de alteração de cliente ativo (ONB-011): mudança de módulos, dados, carteira ou ponto focal passa por
-- itens com dono, prazo e evidência, como o onboarding. Exige o motivo (o que muda).
ALTER TABLE checklist_modelos DROP CONSTRAINT checklist_modelos_tipo_check;
ALTER TABLE checklist_modelos ADD CONSTRAINT checklist_modelos_tipo_check CHECK (tipo IN ('onboarding', 'offboarding', 'alteracao'));
ALTER TABLE checklists DROP CONSTRAINT checklists_tipo_check;
ALTER TABLE checklists ADD CONSTRAINT checklists_tipo_check CHECK (tipo IN ('onboarding', 'offboarding', 'alteracao'));
ALTER TABLE checklists ADD CONSTRAINT checklists_alteracao_com_motivo CHECK (tipo <> 'alteracao' OR motivo IS NOT NULL);
