-- 012 · Treinamentos do CS (CS-004…009; reunião de 03/11: treinamento coletivo por link com conta de demonstração e
-- documento por tela). Roteiro versionado (sessão guarda a versão usada); sessão com link e conta de demonstração
-- (nunca de cliente); participantes com convite, presença, avaliação, dúvidas, próximo passo e o uso antes do treino.

CREATE TABLE treinamento_roteiros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text NOT NULL CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  versao integer NOT NULL CHECK (versao > 0),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 120),
  produto text,
  passos jsonb NOT NULL CHECK (jsonb_typeof(passos) = 'array' AND jsonb_array_length(passos) BETWEEN 1 AND 40),
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo, versao),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX treinamento_roteiros_um_ativo ON treinamento_roteiros (tenant_id, codigo) WHERE ativo;

CREATE TABLE treinamento_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 120),
  roteiro_id uuid NOT NULL,
  inicio timestamptz NOT NULL,
  duracao_min integer NOT NULL DEFAULT 60 CHECK (duracao_min BETWEEN 15 AND 480),
  -- (o PostgreSQL limita a repetição de regex a 255: o tamanho máximo vai num CHECK à parte)
  link text NOT NULL CHECK (link ~ '^https://\S{4,}$' AND length(link) <= 310),
  conta_demo text NOT NULL CHECK (length(conta_demo) BETWEEN 2 AND 120),
  vagas integer CHECK (vagas IS NULL OR vagas BETWEEN 1 AND 500),
  estado text NOT NULL DEFAULT 'agendada' CHECK (estado IN ('agendada', 'realizada', 'cancelada')),
  instrutor_id uuid REFERENCES usuarios(id),
  observacoes text CHECK (observacoes IS NULL OR length(observacoes) <= 2000),
  motivo_cancelamento text,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  realizada_em timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, roteiro_id) REFERENCES treinamento_roteiros(tenant_id, id),
  CHECK (estado <> 'cancelada' OR motivo_cancelamento IS NOT NULL),
  CHECK (estado <> 'realizada' OR realizada_em IS NOT NULL)
);
CREATE INDEX treinamento_sessoes_inicio ON treinamento_sessoes (tenant_id, inicio);

CREATE TABLE treinamento_participantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sessao_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  ponto_focal_id uuid REFERENCES pontos_focais(id),
  convite_interacao_id uuid,
  convidado_em timestamptz,
  presenca text NOT NULL DEFAULT 'pendente' CHECK (presenca IN ('pendente', 'presente', 'ausente')),
  avaliacao integer CHECK (avaliacao IS NULL OR avaliacao BETWEEN 1 AND 5),
  duvidas text CHECK (duvidas IS NULL OR length(duvidas) <= 2000),
  proximo_passo text CHECK (proximo_passo IS NULL OR length(proximo_passo) <= 500),
  -- CS-009: uso da Platform no convite, para medir a evolução depois do treinamento.
  consultas_30d_antes integer,
  ultimo_login_antes timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sessao_id, conta_id),
  FOREIGN KEY (tenant_id, sessao_id) REFERENCES treinamento_sessoes(tenant_id, id),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['treinamento_roteiros', 'treinamento_sessoes', 'treinamento_participantes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sinapse_app', t);
  END LOOP;
END $$;
