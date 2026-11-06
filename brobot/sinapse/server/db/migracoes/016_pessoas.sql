-- 016 · Cadastro de pessoas pela Administração (GOV-001): senha temporária obriga a troca no primeiro acesso.
ALTER TABLE usuarios ADD COLUMN senha_trocar boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN senha_alterada_em timestamptz;
