-- 018 · VIP com pedido, aprovação por outra pessoa da gestão, validade e histórico (GOV-002).
-- Conceder, renovar ou retirar o VIP muda o roteamento (VIP → CS, demais → Suporte), por isso passa por aprovação.

CREATE TABLE vip_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('conceder', 'renovar', 'retirar')),
  criterio text CHECK (criterio IS NULL OR length(criterio) BETWEEN 5 AND 300),
  validade date,
  motivo text NOT NULL CHECK (length(motivo) BETWEEN 5 AND 500),
  pedido_por uuid NOT NULL REFERENCES usuarios(id),
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'aprovado', 'recusado', 'automatico')),
  decidido_por uuid REFERENCES usuarios(id),
  decidido_em timestamptz,
  decisao_motivo text CHECK (decisao_motivo IS NULL OR length(decisao_motivo) <= 500),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id),
  CHECK (tipo = 'retirar' OR (criterio IS NOT NULL AND validade IS NOT NULL)),
  -- Segregação: quem pede não aprova.
  CHECK (decidido_por IS NULL OR decidido_por <> pedido_por),
  CHECK (estado IN ('pendente', 'automatico') OR (decidido_por IS NOT NULL AND decidido_em IS NOT NULL))
);
-- Um pedido pendente por conta.
CREATE UNIQUE INDEX vip_pedidos_um_pendente ON vip_pedidos (tenant_id, conta_id) WHERE estado = 'pendente';
CREATE INDEX vip_pedidos_conta ON vip_pedidos (tenant_id, conta_id, criado_em DESC);

-- Quem aprovou por último (o texto `vip_aprovador` continua para exibição e para o que veio do cadastro antigo).
ALTER TABLE contas ADD COLUMN vip_aprovado_por uuid REFERENCES usuarios(id);
ALTER TABLE contas ADD COLUMN vip_aviso_validade_em date;

ALTER TABLE vip_pedidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento ON vip_pedidos
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON vip_pedidos TO sinapse_app;
