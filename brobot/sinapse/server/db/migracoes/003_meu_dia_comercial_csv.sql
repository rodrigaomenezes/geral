-- 003 · Meu dia (lembretes e notificações), Comercial (funil de aquisição com teste) e integração por CSV
-- com a Platform e o OMIE. Aditiva: nada existente muda de sentido.

-- Papel e equipe do Comercial ------------------------------------------------------------------------------
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_papel_check
  CHECK (papel IN ('admin', 'supervisor', 'suporte', 'cs', 'operacoes', 'dev', 'financeiro', 'comercial'));

-- Lembretes e notificações ---------------------------------------------------------------------------------
CREATE TABLE lembretes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  usuario_id uuid REFERENCES usuarios(id),
  equipe_id uuid,
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 2 AND 200),
  detalhe text,
  quando timestamptz NOT NULL,
  recorrencia text CHECK (recorrencia IS NULL OR recorrencia IN ('diaria', 'dias_uteis', 'semanal', 'mensal')),
  estado text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'concluido', 'cancelado')),
  avisado_para timestamptz,
  adiamentos integer NOT NULL DEFAULT 0,
  ocorrencia_id uuid,
  conta_id uuid,
  oportunidade_id uuid,
  execucao_id uuid,
  chave text,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  FOREIGN KEY (tenant_id, equipe_id) REFERENCES equipes(tenant_id, id),
  UNIQUE (tenant_id, chave),
  CHECK (usuario_id IS NOT NULL OR equipe_id IS NOT NULL)
);
CREATE INDEX lembretes_ativos ON lembretes (tenant_id, quando) WHERE estado = 'ativo';

CREATE TABLE notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  titulo text NOT NULL,
  texto text,
  link text CHECK (link IS NULL OR link ~ '^#/[a-z0-9/_-]*$'),
  gravidade text NOT NULL DEFAULT 'info' CHECK (gravidade IN ('info', 'alerta', 'critica')),
  chave text NOT NULL,
  lida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, usuario_id, chave)
);
CREATE INDEX notificacoes_nao_lidas ON notificacoes (tenant_id, usuario_id, criado_em DESC) WHERE lida_em IS NULL;

-- Comercial: oportunidades ------------------------------------------------------------------------------------
CREATE TABLE oportunidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text NOT NULL,
  empresa text NOT NULL CHECK (length(empresa) BETWEEN 2 AND 160),
  cnpj text CHECK (cnpj IS NULL OR cnpj ~ '^\d{14}$'),
  contato_nome text,
  contato_telefone text CHECK (contato_telefone IS NULL OR contato_telefone ~ '^\+55\d{10,11}$'),
  contato_email text,
  origem text NOT NULL DEFAULT 'outbound' CHECK (origem IN ('indicacao', 'site', 'evento', 'outbound', 'parceiro', 'base')),
  produtos text[] NOT NULL DEFAULT '{}',
  frota integer CHECK (frota IS NULL OR frota >= 0),
  valor_mensal numeric(12,2) CHECK (valor_mensal IS NULL OR valor_mensal >= 0),
  etapa text NOT NULL DEFAULT 'novo'
    CHECK (etapa IN ('novo', 'qualificacao', 'demonstracao', 'proposta', 'teste', 'negociacao', 'ganha', 'perdida')),
  responsavel_id uuid REFERENCES usuarios(id),
  proxima_acao text,
  proxima_acao_em timestamptz,
  teste_inicio date,
  teste_fim date,
  teste_criterio text,
  teste_resultado text CHECK (teste_resultado IS NULL OR teste_resultado IN ('aprovado', 'reprovado')),
  teste_parecer text,
  motivo_perda text,
  detalhe_perda text,
  conta_id uuid,
  etapa_desde timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  fechada_em timestamptz,
  UNIQUE (tenant_id, codigo),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id),
  -- Oportunidade aberta sempre tem próxima ação com data (mesma regra das ocorrências).
  CONSTRAINT oportunidade_aberta_completa CHECK (etapa IN ('ganha', 'perdida') OR (proxima_acao IS NOT NULL AND proxima_acao_em IS NOT NULL)),
  -- Teste antes do fechamento: negociação e ganho exigem teste aprovado.
  CONSTRAINT fechamento_com_teste CHECK (etapa NOT IN ('negociacao', 'ganha') OR teste_resultado = 'aprovado'),
  CONSTRAINT teste_com_periodo CHECK (etapa <> 'teste' OR (teste_inicio IS NOT NULL AND teste_fim IS NOT NULL AND teste_criterio IS NOT NULL)),
  CONSTRAINT ganha_com_conta CHECK (etapa <> 'ganha' OR conta_id IS NOT NULL),
  CONSTRAINT perdida_com_motivo CHECK (etapa <> 'perdida' OR motivo_perda IS NOT NULL)
);
CREATE INDEX oportunidades_funil ON oportunidades (tenant_id, etapa, proxima_acao_em);

ALTER TABLE contas ADD COLUMN IF NOT EXISTS produtos text[] NOT NULL DEFAULT '{}';
ALTER TABLE contas ADD COLUMN IF NOT EXISTS valor_mensal numeric(12,2);
ALTER TABLE contas ADD COLUMN IF NOT EXISTS oportunidade_id uuid;
ALTER TABLE processo_execucoes ADD COLUMN IF NOT EXISTS oportunidade_id uuid;
CREATE INDEX IF NOT EXISTS processo_execucoes_oportunidade ON processo_execucoes (tenant_id, oportunidade_id);
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS oportunidade_id uuid;

-- Uso da Platform por conta (CSV): último login e uso, para o CS (melhoria 7 da reunião de 03/11).
CREATE TABLE uso_contas (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  ultimo_login timestamptz,
  usuarios_ativos integer,
  consultas_30d integer,
  modulos_usados text[] NOT NULL DEFAULT '{}',
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, conta_id),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id)
);

-- Rodada vinda da Platform por CSV: o ERP não chama a Platform, espera o arquivo.
ALTER TABLE rodadas ADD COLUMN IF NOT EXISTS fonte text NOT NULL DEFAULT 'api' CHECK (fonte IN ('api', 'csv'));

-- Importações por CSV: cada arquivo aplicado uma vez (hash), com o resultado linha a linha.
CREATE TABLE importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tipo text NOT NULL,
  arquivo text NOT NULL,
  hash text NOT NULL,
  linhas integer NOT NULL,
  aplicadas integer NOT NULL,
  com_erro integer NOT NULL,
  erros jsonb NOT NULL DEFAULT '[]',
  resumo jsonb NOT NULL DEFAULT '{}',
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tipo, hash)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lembretes', 'notificacoes', 'oportunidades', 'uso_contas', 'importacoes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sinapse_app', t);
  END LOOP;
END $$;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sinapse_app;

-- Equipe Comercial e rotina de lembretes em toda organização existente.
INSERT INTO equipes (tenant_id, codigo, nome) SELECT id, 'comercial', 'Comercial' FROM tenants ON CONFLICT (tenant_id, codigo) DO NOTHING;
INSERT INTO jobs (tenant_id, tipo, payload, executar_em, chave, max_tentativas)
SELECT id, 'lembretes.avisar', '{}', now(), 'recorrente:lembretes', 1000 FROM tenants ON CONFLICT (tenant_id, chave) DO NOTHING;
