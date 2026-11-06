-- 015 · Governança (F9): delegação temporária com expiração e auditoria (GOV-009), matriz RACI por processo
-- (GOV-010, GOV-003), plantões por equipe (GOV-008) e SLA por contrato na conta (GOV-008).

-- Chave composta para os vínculos abaixo não cruzarem organizações.
ALTER TABLE usuarios ADD CONSTRAINT usuarios_tenant_id_id_key UNIQUE (tenant_id, id);

-- GOV-009: "enquanto eu estiver fora, o que chegar para mim vai para fulano". Vale de `inicio` a `fim`;
-- revogar antes encerra. Nunca é apagada (histórico).
CREATE TABLE delegacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  de_id uuid NOT NULL,
  para_id uuid NOT NULL,
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  motivo text NOT NULL CHECK (length(motivo) BETWEEN 5 AND 300),
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz,
  revogada_por uuid REFERENCES usuarios(id),
  expiracao_registrada_em timestamptz,
  FOREIGN KEY (tenant_id, de_id) REFERENCES usuarios(tenant_id, id),
  FOREIGN KEY (tenant_id, para_id) REFERENCES usuarios(tenant_id, id),
  CHECK (de_id <> para_id),
  CHECK (fim > inicio),
  -- Delegação é temporária: no máximo 90 dias. Mais que isso é troca de responsável.
  CHECK (fim - inicio <= interval '90 days')
);
CREATE INDEX delegacoes_de ON delegacoes (tenant_id, de_id, fim) WHERE revogada_em IS NULL;

-- GOV-010: quem é Responsável, Aprovador (um só), Consultado e Informado em cada processo; por pessoa ou por equipe.
CREATE TABLE raci (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  processo text NOT NULL CHECK (processo ~ '^[a-z_]{3,40}$'),
  papel text NOT NULL CHECK (papel IN ('R', 'A', 'C', 'I')),
  usuario_id uuid,
  equipe_id uuid,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios(tenant_id, id),
  FOREIGN KEY (tenant_id, equipe_id) REFERENCES equipes(tenant_id, id),
  CHECK ((usuario_id IS NULL) <> (equipe_id IS NULL))
);
CREATE UNIQUE INDEX raci_unico ON raci (tenant_id, processo, papel, coalesce(usuario_id, equipe_id));
CREATE UNIQUE INDEX raci_um_aprovador ON raci (tenant_id, processo) WHERE papel = 'A';

-- GOV-008: plantão de uma pessoa por equipe fora do expediente. Cancelar não apaga.
CREATE TABLE plantoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  equipe_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  cancelado_em timestamptz,
  FOREIGN KEY (tenant_id, equipe_id) REFERENCES equipes(tenant_id, id),
  FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios(tenant_id, id),
  CHECK (fim > inicio),
  CHECK (fim - inicio <= interval '7 days')
);
CREATE INDEX plantoes_equipe ON plantoes (tenant_id, equipe_id, inicio) WHERE cancelado_em IS NULL;

-- GOV-008: SLA acordado em contrato substitui o padrão da organização para a conta (horas por prioridade).
ALTER TABLE contas ADD COLUMN sla_contrato jsonb;
ALTER TABLE contas ADD CONSTRAINT contas_sla_contrato_objeto CHECK (sla_contrato IS NULL OR jsonb_typeof(sla_contrato) = 'object');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delegacoes', 'raci', 'plantoes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO sinapse_app', t);
  END LOOP;
END $$;
-- Delegação e plantão só atualizam para revogar/cancelar; a linha da RACI sai quando o papel muda (é configuração).
GRANT UPDATE ON delegacoes, plantoes TO sinapse_app;
GRANT DELETE ON raci TO sinapse_app;
