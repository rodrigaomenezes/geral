-- 010 · Onboarding com checklist e offboarding (ONB-001…012, CS-012; F4 do plano).
-- Modelo versionado por organização (o checklist aberto guarda a cópia dos itens: mudar o modelo não mexe no que já
-- está em andamento); itens com equipe, prazo, evidência e verificação automática quando o sistema tem o dado;
-- dispensa de item obrigatório só como exceção aprovada por outra pessoa da gestão (ONB-010).

CREATE TABLE checklist_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tipo text NOT NULL CHECK (tipo IN ('onboarding', 'offboarding')),
  versao integer NOT NULL CHECK (versao > 0),
  itens jsonb NOT NULL CHECK (jsonb_typeof(itens) = 'array' AND jsonb_array_length(itens) BETWEEN 1 AND 40),
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tipo, versao)
);
CREATE UNIQUE INDEX checklist_modelos_um_ativo ON checklist_modelos (tenant_id, tipo) WHERE ativo;

CREATE TABLE checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('onboarding', 'offboarding')),
  modelo_versao integer NOT NULL,
  estado text NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto', 'concluido', 'cancelado')),
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 1000),
  ocorrencia_id uuid,
  oportunidade_id uuid,
  aberto_por uuid REFERENCES usuarios(id),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  concluido_por uuid REFERENCES usuarios(id),
  concluido_em timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id),
  CHECK (tipo <> 'offboarding' OR motivo IS NOT NULL),
  CHECK (estado = 'aberto' OR concluido_em IS NOT NULL)
);
CREATE UNIQUE INDEX checklists_um_aberto ON checklists (tenant_id, conta_id, tipo) WHERE estado = 'aberto';

CREATE TABLE checklist_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  checklist_id uuid NOT NULL,
  ordem integer NOT NULL,
  codigo text NOT NULL CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 200),
  grupo text NOT NULL CHECK (grupo IN ('administrativa', 'tecnica', 'financeira', 'relacionamento', 'encerramento')),
  equipe_codigo text NOT NULL,
  obrigatorio boolean NOT NULL DEFAULT true,
  verificacao text,
  prazo_em timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'feito', 'dispensa_pedida', 'dispensado')),
  evidencia text CHECK (evidencia IS NULL OR length(evidencia) <= 1000),
  automatico boolean NOT NULL DEFAULT false,
  feito_por uuid REFERENCES usuarios(id),
  feito_em timestamptz,
  dispensa_motivo text CHECK (dispensa_motivo IS NULL OR length(dispensa_motivo) <= 500),
  dispensa_pedida_por uuid REFERENCES usuarios(id),
  dispensa_aprovada_por uuid REFERENCES usuarios(id),
  UNIQUE (tenant_id, checklist_id, codigo),
  FOREIGN KEY (tenant_id, checklist_id) REFERENCES checklists(tenant_id, id),
  CHECK (estado <> 'feito' OR (evidencia IS NOT NULL AND feito_em IS NOT NULL)),
  CHECK (estado NOT IN ('dispensa_pedida', 'dispensado') OR dispensa_motivo IS NOT NULL),
  CHECK (estado <> 'dispensado' OR (dispensa_aprovada_por IS NOT NULL AND dispensa_aprovada_por IS DISTINCT FROM dispensa_pedida_por))
);
CREATE INDEX checklist_itens_pendentes ON checklist_itens (tenant_id, prazo_em) WHERE estado IN ('pendente', 'dispensa_pedida');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['checklist_modelos', 'checklists', 'checklist_itens']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sinapse_app', t);
  END LOOP;
END $$;
