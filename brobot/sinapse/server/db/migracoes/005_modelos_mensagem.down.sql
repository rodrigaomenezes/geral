-- Volta da 005: as mensagens voltam ao texto padrão do sistema (versões editadas são apagadas: faça backup antes).
DROP TABLE IF EXISTS modelos_mensagem CASCADE;
DROP FUNCTION IF EXISTS modelo_aprovado_imutavel();
ALTER TABLE interacoes DROP COLUMN IF EXISTS variaveis;
