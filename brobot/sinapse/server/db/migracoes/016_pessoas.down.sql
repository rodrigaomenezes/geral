-- Volta da 016: some a obrigação de trocar a senha temporária (quem tinha uma continua entrando com ela).
ALTER TABLE usuarios DROP COLUMN IF EXISTS senha_alterada_em;
ALTER TABLE usuarios DROP COLUMN IF EXISTS senha_trocar;
