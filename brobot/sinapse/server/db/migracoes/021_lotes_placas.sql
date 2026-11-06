-- 021 · Lote de placas do onboarding (ONB-006): a planilha do cliente é conferida no Sinapse antes de ir para a
-- Platform (dona dos veículos). Cada linha fica aceita ou rejeitada com o motivo; o mesmo arquivo não entra duas vezes.

CREATE TABLE lotes_placas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  arquivo text NOT NULL CHECK (length(arquivo) BETWEEN 1 AND 160),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  aceitas integer NOT NULL CHECK (aceitas >= 0),
  rejeitadas integer NOT NULL CHECK (rejeitadas >= 0),
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- Rejeições tratadas sem novo arquivo (ex.: veículo vendido, fica fora): quem decidiu e por quê.
  rejeicoes_tratadas_em timestamptz,
  rejeicoes_tratadas_por uuid REFERENCES usuarios(id),
  rejeicoes_motivo text CHECK (rejeicoes_motivo IS NULL OR length(rejeicoes_motivo) BETWEEN 5 AND 300),
  UNIQUE (tenant_id, conta_id, hash),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id),
  CHECK (rejeicoes_tratadas_em IS NULL OR rejeicoes_motivo IS NOT NULL)
);
CREATE INDEX lotes_placas_conta ON lotes_placas (tenant_id, conta_id, criado_em DESC);

CREATE TABLE lote_placas_linhas (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  lote_id uuid NOT NULL,
  linha integer NOT NULL,
  placa text,
  renavam text,
  aceita boolean NOT NULL,
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 200),
  PRIMARY KEY (tenant_id, lote_id, linha),
  FOREIGN KEY (tenant_id, lote_id) REFERENCES lotes_placas(tenant_id, id),
  CHECK (aceita OR motivo IS NOT NULL)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lotes_placas', 'lote_placas_linhas']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO sinapse_app', t);
  END LOOP;
END $$;
-- O lote só atualiza para registrar o tratamento das rejeições; as linhas são só de inserção.
GRANT UPDATE ON lotes_placas TO sinapse_app;
