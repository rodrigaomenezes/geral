-- 014 · Verificação em duas etapas (MFA, RNF-005/R-05) e sessão com expiração por inatividade (R-19).
-- O segredo do autenticador fica cifrado (AES-256-GCM, SINAPSE_CHAVE); a sessão nasce "pendente" quando a pessoa tem
-- MFA e só vale depois do código; sessão parada além do limite deixa de valer.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_segredo_cifrado text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_ativo boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_ativado_em timestamptz;
-- Último passo de 30 s usado: o mesmo código não vale duas vezes (contra reuso de um código visto por outra pessoa).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_ultimo_passo bigint;
ALTER TABLE usuarios ADD CONSTRAINT mfa_com_segredo CHECK (NOT mfa_ativo OR mfa_segredo_cifrado IS NOT NULL);

ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS mfa_pendente boolean NOT NULL DEFAULT false;
ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS ultimo_uso_em timestamptz NOT NULL DEFAULT now();
