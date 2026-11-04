-- 001 · Fundação do ERP Sinapse (Fase 1)
-- Organizações, identidade, carteira, entrada durável, ocorrências, tarefas, handoff, rodadas, pendências,
-- comunicação, outbox de eventos, auditoria só de anexação, fila durável de jobs, integrações e supervisor.
-- Toda tabela de negócio tem tenant_id e Row Level Security (política `isolamento`).

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  nome text NOT NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'suspenso')),
  config jsonb NOT NULL DEFAULT '{}',
  demonstracao boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE equipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text NOT NULL CHECK (codigo ~ '^[a-z_]{2,30}$'),
  nome text NOT NULL,
  contingencia boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, codigo),
  UNIQUE (tenant_id, id)
);

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nome text NOT NULL,
  email text NOT NULL,
  senha_hash text,
  papel text NOT NULL CHECK (papel IN ('admin', 'supervisor', 'suporte', 'cs', 'operacoes', 'dev', 'financeiro')),
  equipe_id uuid NOT NULL,
  disponivel boolean NOT NULL DEFAULT true,
  substituto_id uuid REFERENCES usuarios(id),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email),
  FOREIGN KEY (tenant_id, equipe_id) REFERENCES equipes(tenant_id, id)
);

CREATE TABLE sessoes (
  token_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  criada_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL
);

CREATE TABLE contadores (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nome text NOT NULL,
  valor bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, nome)
);

CREATE TABLE feriados (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data date NOT NULL,
  nome text NOT NULL,
  PRIMARY KEY (tenant_id, data)
);

-- Carteira ------------------------------------------------------------------------------------------------
CREATE TABLE contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nome text NOT NULL,
  cnpj text NOT NULL CHECK (cnpj ~ '^\d{14}$'),
  segmento text,
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('onboarding', 'ativa', 'suspensa', 'encerrada')),
  vip boolean NOT NULL DEFAULT false,
  vip_criterio text,
  vip_validade date,
  vip_aprovador text,
  roteamento_excecao text,
  roteamento_justificativa text,
  id_platform text,
  id_omie text,
  version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  arquivada_em timestamptz,
  UNIQUE (tenant_id, cnpj),
  UNIQUE (tenant_id, id_platform),
  UNIQUE (tenant_id, id),
  CHECK (NOT vip OR (vip_criterio IS NOT NULL AND vip_aprovador IS NOT NULL)),
  CHECK (roteamento_excecao IS NULL OR roteamento_justificativa IS NOT NULL)
);

CREATE TABLE pontos_focais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  papel text NOT NULL CHECK (papel IN ('principal', 'suplente')),
  nome text NOT NULL,
  telefone text CHECK (telefone IS NULL OR telefone ~ '^\+55\d{10,11}$'),
  email text,
  canal_preferido text NOT NULL DEFAULT 'whatsapp' CHECK (canal_preferido IN ('whatsapp', 'email')),
  consentimento_whatsapp boolean NOT NULL DEFAULT false,
  opt_out boolean NOT NULL DEFAULT false,
  vigente boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  encerrado_em timestamptz,
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id),
  CHECK (telefone IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX pontos_focais_um_vigente ON pontos_focais (tenant_id, conta_id, papel) WHERE vigente;
CREATE INDEX pontos_focais_telefone ON pontos_focais (tenant_id, telefone) WHERE vigente;

-- Referência a credenciais da Platform: só tipo, status e referência. Nunca o segredo (CRE-007).
CREATE TABLE credenciais_ref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('certificado', 'govbr', 'sne', 'portal_detran')),
  status text NOT NULL CHECK (status IN ('ok', 'ausente', 'invalida', 'expirada', '2fa_pendente', 'vinculo_sne')),
  expira_em date,
  referencia_platform text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id),
  UNIQUE (tenant_id, conta_id, tipo)
);

-- Situação financeira mínima vinda do OMIE (FIN-003/FIN-010). O ERP não calcula nem altera.
CREATE TABLE status_financeiro (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  situacao text NOT NULL CHECK (situacao IN ('em_dia', 'em_atraso', 'desconhecido')),
  fonte text NOT NULL DEFAULT 'omie',
  sincronizado_em timestamptz,
  PRIMARY KEY (tenant_id, conta_id),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id)
);

-- Entrada durável (inbox) --------------------------------------------------------------------------------
CREATE TABLE entradas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  origem text NOT NULL CHECK (origem IN ('whatsapp', 'email', 'portal', 'api', 'platform', 'comercial')),
  chave_idempotencia text NOT NULL,
  payload jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'recebida' CHECK (estado IN ('recebida', 'processada', 'falhou')),
  duplicatas integer NOT NULL DEFAULT 0,
  recebida_em timestamptz NOT NULL DEFAULT now(),
  processada_em timestamptz,
  erro text,
  UNIQUE (tenant_id, origem, chave_idempotencia)
);

-- Ocorrências -----------------------------------------------------------------------------------------------
CREATE TABLE ocorrencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  protocolo text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('nao_classificada', 'duvida', 'erro_consulta', 'credencial', 'pre_rodada',
    'pos_rodada', 'onboarding', 'tecnica', 'incidente', 'solicitacao')),
  origem text NOT NULL,
  conta_id uuid,
  ponto_focal_id uuid REFERENCES pontos_focais(id),
  rodada_id uuid,
  titulo text NOT NULL,
  descricao text,
  estado text NOT NULL CHECK (estado IN ('triagem', 'aberta', 'em_atendimento', 'aguardando_cliente',
    'aguardando_terceiro', 'em_handoff', 'resolvida', 'encerrada_sem_resolucao')),
  prioridade text NOT NULL CHECK (prioridade IN ('baixa', 'media', 'alta', 'critica')),
  equipe_id uuid NOT NULL,
  responsavel_id uuid REFERENCES usuarios(id),
  prazo_em timestamptz,
  sla_resposta_em timestamptz,
  primeira_resposta_em timestamptz,
  proxima_acao_em timestamptz,
  proxima_acao text,
  nivel_escalonamento integer NOT NULL DEFAULT 0,
  codigo_desfecho text,
  evidencia text,
  motivo_encerramento text,
  conversa_chave text,
  reaberturas integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  encerrada_em timestamptz,
  UNIQUE (tenant_id, protocolo),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id),
  FOREIGN KEY (tenant_id, equipe_id) REFERENCES equipes(tenant_id, id),
  -- RN-008: ocorrência ativa sempre tem fila, prazo e próxima ação.
  CONSTRAINT ativa_completa CHECK (estado IN ('resolvida', 'encerrada_sem_resolucao')
    OR (prazo_em IS NOT NULL AND proxima_acao_em IS NOT NULL AND proxima_acao IS NOT NULL)),
  -- RN-009: resolvida exige evidência; encerrada sem resolução exige motivo.
  CONSTRAINT resolvida_com_evidencia CHECK (estado <> 'resolvida' OR evidencia IS NOT NULL),
  CONSTRAINT encerrada_com_motivo CHECK (estado <> 'encerrada_sem_resolucao' OR motivo_encerramento IS NOT NULL),
  CONSTRAINT classificada_tem_conta CHECK (estado = 'triagem' OR conta_id IS NOT NULL)
);
CREATE INDEX ocorrencias_fila ON ocorrencias (tenant_id, estado, equipe_id, prazo_em);
CREATE INDEX ocorrencias_proxima ON ocorrencias (tenant_id, proxima_acao_em)
  WHERE estado NOT IN ('resolvida', 'encerrada_sem_resolucao');
CREATE INDEX ocorrencias_conversa ON ocorrencias (tenant_id, conversa_chave, criado_em DESC);
CREATE INDEX ocorrencias_conta ON ocorrencias (tenant_id, conta_id, criado_em DESC);

CREATE TABLE ocorrencia_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ocorrencia_id uuid NOT NULL,
  pendencia_id uuid,
  placa text,
  descricao text NOT NULL,
  FOREIGN KEY (tenant_id, ocorrencia_id) REFERENCES ocorrencias(tenant_id, id),
  UNIQUE (tenant_id, ocorrencia_id, pendencia_id)
);

CREATE TABLE ocorrencia_vinculos (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ocorrencia_id uuid NOT NULL,
  relacionada_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('relacionada', 'mesclada_em', 'dividida_de', 'reaberta_por')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ocorrencia_id, relacionada_id, tipo)
);

CREATE TABLE interacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ocorrencia_id uuid,
  entrada_id uuid REFERENCES entradas(id),
  conta_id uuid,
  canal text NOT NULL CHECK (canal IN ('whatsapp', 'email', 'portal', 'api', 'platform', 'telefone', 'interno')),
  direcao text NOT NULL CHECK (direcao IN ('entrada', 'saida', 'nota')),
  remetente text,
  destinatario text,
  texto text NOT NULL CHECK (length(texto) <= 4000),
  modelo text,
  status_entrega text NOT NULL DEFAULT 'registrada'
    CHECK (status_entrega IN ('registrada', 'enfileirada', 'enviada', 'entregue', 'falhou', 'bloqueada')),
  id_externo text,
  autor_id uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interacoes_ocorrencia ON interacoes (tenant_id, ocorrencia_id, criado_em);

CREATE TABLE handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ocorrencia_id uuid NOT NULL,
  de_equipe_id uuid NOT NULL,
  para_equipe_id uuid NOT NULL,
  motivo text NOT NULL,
  solicitado_por uuid REFERENCES usuarios(id),
  prazo_aceite_em timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'aceito', 'expirado')),
  aceito_por uuid REFERENCES usuarios(id),
  resolvido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, ocorrencia_id) REFERENCES ocorrencias(tenant_id, id)
);
CREATE UNIQUE INDEX handoffs_um_pendente ON handoffs (tenant_id, ocorrencia_id) WHERE estado = 'pendente';

-- Rodadas, pendências e contatos programados ------------------------------------------------------------
CREATE TABLE rodadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  id_platform text NOT NULL,
  produto text NOT NULL,
  agendada_para timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'agendada'
    CHECK (estado IN ('agendada', 'pre_rodada', 'pronta', 'com_pendencias', 'executada', 'concluida')),
  pre_iniciada_em timestamptz,
  veiculos_total integer,
  veiculos_sucesso integer,
  veiculos_falha integer,
  pendencias_detectadas integer NOT NULL DEFAULT 0,
  pendencias_corrigidas_ate_d0 integer,
  executada_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id_platform),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id)
);

CREATE TABLE pendencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  rodada_id uuid,
  ocorrencia_id uuid,
  placa text NOT NULL,
  erro_codigo text NOT NULL,
  erro_categoria text NOT NULL CHECK (erro_categoria IN ('credencial', 'vinculo_sne', 'certificado', 'cadastro',
    'usuario', 'consulta', 'indisponibilidade')),
  descricao text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('pre_rodada', 'pos_rodada', 'recorrente')),
  estado text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'persistente', 'corrigida')),
  recorrencias integer NOT NULL DEFAULT 1,
  detectada_em timestamptz NOT NULL DEFAULT now(),
  corrigida_em timestamptz,
  evidencia_correcao text,
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id),
  CHECK (estado <> 'corrigida' OR evidencia_correcao IS NOT NULL)
);
-- PRE-005: o mesmo erro aberto na mesma placa é uma pendência só.
CREATE UNIQUE INDEX pendencias_uma_aberta ON pendencias (tenant_id, conta_id, placa, erro_codigo) WHERE estado <> 'corrigida';

CREATE TABLE contatos_programados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  rodada_id uuid NOT NULL,
  marco text NOT NULL CHECK (marco IN ('D-3', 'intermediaria', 'D-1', 'pos_inicial', 'D+3')),
  canal text NOT NULL CHECK (canal IN ('whatsapp', 'email', 'telefone')),
  programado_para timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'programado'
    CHECK (estado IN ('programado', 'enviado', 'cancelado', 'falhou', 'concluido')),
  motivo text,
  interacao_id uuid,
  tarefa_id uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rodada_id, marco),
  FOREIGN KEY (tenant_id, rodada_id) REFERENCES rodadas(tenant_id, id)
);

-- Tarefas ----------------------------------------------------------------------------------------------------
CREATE TABLE tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ocorrencia_id uuid,
  rodada_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('ligacao', 'revisar_espera', 'escalonamento', 'validar_correcao', 'geral')),
  titulo text NOT NULL,
  -- GOV-004: tarefa sempre tem fila (equipe); responsável é opcional.
  equipe_id uuid NOT NULL,
  responsavel_id uuid REFERENCES usuarios(id),
  prazo_em timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'concluida', 'cancelada')),
  resultado text,
  concluida_por uuid REFERENCES usuarios(id),
  concluida_em timestamptz,
  chave text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, equipe_id) REFERENCES equipes(tenant_id, id),
  UNIQUE (tenant_id, chave),
  CHECK (estado <> 'concluida' OR resultado IS NOT NULL)
);
CREATE INDEX tarefas_abertas ON tarefas (tenant_id, estado, prazo_em);

-- Eventos (outbox), auditoria e jobs -------------------------------------------------------------------------
CREATE TABLE eventos (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_type text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'sinapse',
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}',
  correlation_id uuid,
  causation_id uuid,
  idempotency_key text NOT NULL,
  publicado_em timestamptz,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX eventos_agregado ON eventos (tenant_id, aggregate_id, occurred_at);
CREATE INDEX eventos_nao_publicados ON eventos (received_at) WHERE publicado_em IS NULL;

CREATE TABLE auditoria (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ator_id uuid,
  ator_nome text NOT NULL,
  acao text NOT NULL,
  entidade text NOT NULL,
  entidade_id text,
  antes jsonb,
  depois jsonb,
  motivo text,
  correlacao uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_recente ON auditoria (tenant_id, id DESC);
CREATE INDEX auditoria_entidade ON auditoria (tenant_id, entidade_id);

CREATE FUNCTION auditoria_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A trilha de auditoria é só de anexação (tentativa de %).', TG_OP;
END $$;
CREATE TRIGGER auditoria_sem_alteracao BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_imutavel();

CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tipo text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  executar_em timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'executando', 'concluido', 'morto', 'cancelado')),
  tentativas integer NOT NULL DEFAULT 0,
  max_tentativas integer NOT NULL DEFAULT 5,
  ultimo_erro text,
  chave text,
  bloqueado_em timestamptz,
  concluido_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, chave)
);
CREATE INDEX jobs_prontos ON jobs (executar_em) WHERE estado = 'pendente';

CREATE TABLE integracoes (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  nome text NOT NULL CHECK (nome IN ('platform', 'omie', 'whatsapp', 'email')),
  disponivel boolean NOT NULL DEFAULT true,
  checkpoint jsonb NOT NULL DEFAULT '{}',
  ultima_sincronizacao timestamptz,
  ultimo_erro text,
  falhas_consecutivas integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, nome)
);

CREATE TABLE divergencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tipo text NOT NULL,
  descricao text NOT NULL,
  entidade_id text,
  estado text NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'tratada')),
  chave text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, chave)
);

-- Dados do simulador da Platform (adaptador de demonstração). Não é dado do ERP.
CREATE TABLE demo_platform_veiculos (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  placa text NOT NULL,
  erro_codigo text,
  PRIMARY KEY (tenant_id, conta_id, placa)
);
CREATE TABLE demo_omie (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id_omie text NOT NULL,
  situacao text NOT NULL,
  PRIMARY KEY (tenant_id, id_omie)
);

-- Estado global do sistema (heartbeat do supervisor, relógio da demonstração). Sem dado de cliente.
CREATE TABLE sistema (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Isolamento por organização ---------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinapse_app') THEN
    CREATE ROLE sinapse_app NOLOGIN;
  END IF;
  BEGIN
    EXECUTE format('GRANT sinapse_app TO %I', current_user);
  EXCEPTION WHEN OTHERS THEN NULL; -- superusuário ou já membro
  END;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['equipes', 'usuarios', 'contadores', 'feriados', 'contas', 'pontos_focais',
    'credenciais_ref', 'status_financeiro', 'entradas', 'ocorrencias', 'ocorrencia_itens', 'ocorrencia_vinculos',
    'interacoes', 'handoffs', 'rodadas', 'pendencias', 'contatos_programados', 'tarefas', 'eventos', 'auditoria',
    'jobs', 'integracoes', 'divergencias', 'demo_platform_veiculos', 'demo_omie']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sinapse_app', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO sinapse_app;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento ON tenants USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT ON tenants TO sinapse_app;
-- Auditoria: o papel da aplicação só anexa e lê (sem UPDATE).
REVOKE UPDATE ON auditoria FROM sinapse_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sinapse_app;
