-- 009 · Comercial F3b: funis (aquisição, expansão, renovação), cliente da carteira encaminhado pelo CS, pessoas
-- separadas da empresa (contatos com papel na decisão) e previsão de fechamento (CRM-001, 003, 014, 015; CS-011).

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS funil text NOT NULL DEFAULT 'aquisicao' CHECK (funil IN ('aquisicao', 'expansao', 'renovacao'));
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS conta_origem_id uuid;
ALTER TABLE oportunidades ADD CONSTRAINT oportunidade_conta_origem FOREIGN KEY (tenant_id, conta_origem_id) REFERENCES contas(tenant_id, id);
-- Expansão e renovação são sempre de um cliente da carteira.
ALTER TABLE oportunidades ADD CONSTRAINT funil_com_conta CHECK (funil = 'aquisicao' OR conta_origem_id IS NOT NULL);
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS fechamento_previsto date;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS encaminhada_por uuid REFERENCES usuarios(id);
CREATE INDEX IF NOT EXISTS oportunidades_conta_origem ON oportunidades (tenant_id, conta_origem_id) WHERE conta_origem_id IS NOT NULL;

-- Pessoas (contatos comerciais): uma pessoa por telefone ou e-mail na organização; ligadas às oportunidades com o
-- papel que têm na decisão. O contato da oportunidade (contato_nome/telefone/e-mail) continua como o principal.
CREATE TABLE contatos_comerciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  cargo text CHECK (cargo IS NULL OR length(cargo) <= 80),
  telefone text CHECK (telefone IS NULL OR telefone ~ '^\+55\d{10,11}$'),
  email text CHECK (email IS NULL OR length(email) <= 200),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (telefone IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX contatos_comerciais_telefone ON contatos_comerciais (tenant_id, telefone) WHERE telefone IS NOT NULL;
CREATE UNIQUE INDEX contatos_comerciais_email ON contatos_comerciais (tenant_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE oportunidade_contatos (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  oportunidade_id uuid NOT NULL,
  contato_id uuid NOT NULL,
  papel text NOT NULL CHECK (papel IN ('decisor', 'influenciador', 'usuario', 'financeiro', 'tecnico', 'outro')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, oportunidade_id, contato_id),
  FOREIGN KEY (tenant_id, oportunidade_id) REFERENCES oportunidades(tenant_id, id),
  FOREIGN KEY (tenant_id, contato_id) REFERENCES contatos_comerciais(tenant_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contatos_comerciais', 'oportunidade_contatos']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sinapse_app', t);
  END LOOP;
END $$;
GRANT DELETE ON oportunidade_contatos TO sinapse_app; -- desvincular pessoa da oportunidade (a pessoa continua cadastrada)
