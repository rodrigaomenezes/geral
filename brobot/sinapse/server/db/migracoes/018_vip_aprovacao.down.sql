-- Volta da 018: some o histórico de pedidos de VIP; o VIP atual das contas fica como está.
DROP TABLE IF EXISTS vip_pedidos;
ALTER TABLE contas DROP COLUMN IF EXISTS vip_aviso_validade_em;
ALTER TABLE contas DROP COLUMN IF EXISTS vip_aprovado_por;
