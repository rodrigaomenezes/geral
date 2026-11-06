-- 022 · Pedido ao cliente dos dados que faltam no onboarding (ONB-003). O item que depende do cliente traz o texto do
-- pedido (como o cliente entende, sem termo interno); o checklist guarda quantas vezes e quando o cliente foi lembrado.
ALTER TABLE checklist_itens ADD COLUMN pedido_cliente text CHECK (pedido_cliente IS NULL OR length(pedido_cliente) BETWEEN 5 AND 200);
ALTER TABLE checklists ADD COLUMN pedidos_cliente integer NOT NULL DEFAULT 0 CHECK (pedidos_cliente >= 0);
ALTER TABLE checklists ADD COLUMN ultimo_pedido_cliente_em timestamptz;
