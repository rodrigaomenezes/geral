-- Volta da 022: o checklist deixa de pedir dados ao cliente sozinho (as mensagens enviadas continuam no histórico).
ALTER TABLE checklists DROP COLUMN IF EXISTS ultimo_pedido_cliente_em;
ALTER TABLE checklists DROP COLUMN IF EXISTS pedidos_cliente;
ALTER TABLE checklist_itens DROP COLUMN IF EXISTS pedido_cliente;
