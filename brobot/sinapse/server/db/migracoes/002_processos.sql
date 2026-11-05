-- 002 · Motor de processos (WFL-001, WFL-003, WFL-013, WFL-015, SUP-010, RN-012)
-- Processos escritos pela operação (gatilho → condições → passos) com versões imutáveis depois de ativadas,
-- execuções presas à versão em que começaram e registro de cada passo.

CREATE TABLE processos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nome text NOT NULL CHECK (length(nome) BETWEEN 3 AND 120),
  descricao text,
  sistema boolean NOT NULL DEFAULT false,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz,
  UNIQUE (tenant_id, id)
);

CREATE TABLE processo_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  processo_id uuid NOT NULL,
  versao integer NOT NULL CHECK (versao > 0),
  definicao jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'ativa', 'substituida', 'desativada')),
  nota text,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  ativada_em timestamptz,
  ativada_por uuid REFERENCES usuarios(id),
  FOREIGN KEY (tenant_id, processo_id) REFERENCES processos(tenant_id, id),
  UNIQUE (tenant_id, processo_id, versao),
  UNIQUE (tenant_id, id),
  CHECK (estado = 'rascunho' OR ativada_em IS NOT NULL)
);
-- Uma versão ativa por processo; um rascunho por processo.
CREATE UNIQUE INDEX processo_uma_ativa ON processo_versoes (tenant_id, processo_id) WHERE estado = 'ativa';
CREATE UNIQUE INDEX processo_um_rascunho ON processo_versoes (tenant_id, processo_id) WHERE estado = 'rascunho';

-- Versão ativada não muda mais (WFL-013): só o estado pode passar a substituída/desativada.
CREATE FUNCTION processo_versao_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado <> 'rascunho' AND (NEW.definicao IS DISTINCT FROM OLD.definicao OR NEW.versao <> OLD.versao) THEN
    RAISE EXCEPTION 'Versão % do processo já foi ativada e não pode ser alterada; crie uma nova versão.', OLD.versao;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER processo_versao_sem_alteracao BEFORE UPDATE ON processo_versoes
  FOR EACH ROW EXECUTE FUNCTION processo_versao_imutavel();

CREATE TABLE processo_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  processo_id uuid NOT NULL,
  versao_id uuid NOT NULL,
  evento_id uuid,
  chave text NOT NULL,
  ocorrencia_id uuid,
  rodada_id uuid,
  conta_id uuid,
  tarefa_aguardada uuid,
  estado text NOT NULL DEFAULT 'em_andamento'
    CHECK (estado IN ('em_andamento', 'aguardando', 'concluida', 'encerrada', 'cancelada', 'falhou')),
  passo_atual integer NOT NULL DEFAULT 0,
  espera_ate timestamptz,
  motivo text,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  finalizada_em timestamptz,
  FOREIGN KEY (tenant_id, versao_id) REFERENCES processo_versoes(tenant_id, id),
  UNIQUE (tenant_id, chave),
  CHECK (estado <> 'aguardando' OR espera_ate IS NOT NULL)
);
CREATE INDEX processo_execucoes_vivas ON processo_execucoes (tenant_id, estado) WHERE estado IN ('em_andamento', 'aguardando');
CREATE INDEX processo_execucoes_ocorrencia ON processo_execucoes (tenant_id, ocorrencia_id);
CREATE INDEX processo_execucoes_rodada ON processo_execucoes (tenant_id, rodada_id);
CREATE INDEX processo_execucoes_conta ON processo_execucoes (tenant_id, conta_id) WHERE estado IN ('em_andamento', 'aguardando');

CREATE TABLE processo_passos_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  execucao_id uuid NOT NULL,
  passo integer NOT NULL,
  tipo text NOT NULL,
  resultado text NOT NULL CHECK (resultado IN ('executado', 'pulado', 'aguardando', 'encerrado', 'falhou')),
  detalhe text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processo_passos_log_execucao ON processo_passos_log (tenant_id, execucao_id, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['processos', 'processo_versoes', 'processo_execucoes', 'processo_passos_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sinapse_app', t);
  END LOOP;
END $$;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sinapse_app;

-- Grupo de WhatsApp do cliente (destino "no grupo" das decisões de 03/11) e ligação com resultado estruturado.
ALTER TABLE contas ADD COLUMN IF NOT EXISTS grupo_whatsapp text;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS execucao_id uuid;
ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS resultado_codigo text
  CHECK (resultado_codigo IS NULL OR resultado_codigo IN ('atendeu', 'nao_atendeu', 'feito', 'nao_feito'));
CREATE INDEX IF NOT EXISTS tarefas_execucao ON tarefas (tenant_id, execucao_id) WHERE execucao_id IS NOT NULL;

-- Eventos anteriores ao motor não disparam processos retroativamente.
UPDATE eventos SET publicado_em = now() WHERE publicado_em IS NULL;

-- Despachante de eventos para os processos: job recorrente por organização.
INSERT INTO jobs (tenant_id, tipo, payload, executar_em, chave, max_tentativas)
SELECT id, 'processos.despachar', '{}', now(), 'recorrente:processos', 1000 FROM tenants
ON CONFLICT (tenant_id, chave) DO NOTHING;
INSERT INTO jobs (tenant_id, tipo, payload, executar_em, chave, max_tentativas)
SELECT id, 'processos.agenda', '{}', now(), 'recorrente:agenda', 1000 FROM tenants
ON CONFLICT (tenant_id, chave) DO NOTHING;
