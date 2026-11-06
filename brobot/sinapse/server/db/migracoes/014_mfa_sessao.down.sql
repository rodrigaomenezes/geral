-- Volta da 014: MFA desligado para todos (o segredo é descartado) e sessões sem controle de inatividade.
ALTER TABLE sessoes DROP COLUMN IF EXISTS ultimo_uso_em, DROP COLUMN IF EXISTS mfa_pendente;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS mfa_com_segredo;
ALTER TABLE usuarios DROP COLUMN IF EXISTS mfa_ultimo_passo, DROP COLUMN IF EXISTS mfa_ativado_em, DROP COLUMN IF EXISTS mfa_ativo, DROP COLUMN IF EXISTS mfa_segredo_cifrado;
