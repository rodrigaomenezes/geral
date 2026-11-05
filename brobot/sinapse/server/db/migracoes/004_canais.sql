-- 004 · Canais: telefonia (treino, SIP/WebRTC, celular) e WhatsApp oficial (Meta Cloud API).
-- Portado do Lumen Operações e adaptado: multiempresa com RLS, segredos cifrados (AES-256-GCM, SINAPSE_CHAVE).

CREATE TABLE telefonia_config (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  provedor text NOT NULL DEFAULT 'treino' CHECK (provedor IN ('desligado', 'treino', 'sip')),
  operadora text,
  ws_url text CHECK (ws_url IS NULL OR ws_url ~ '^wss://'),
  dominio text,
  ice_servers text,
  formato_numero text NOT NULL DEFAULT '55' CHECK (formato_numero IN ('e164', '55', '0ddd', 'ddd')),
  prefixo text CHECK (prefixo IS NULL OR prefixo ~ '^[0-9*#]{0,6}$'),
  celular boolean NOT NULL DEFAULT true,
  atualizado_por uuid REFERENCES usuarios(id),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telefonia_ramais (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  usuario_sip text NOT NULL,
  senha_cifrada text,
  nome_exibicao text,
  ativo boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, usuario_id)
);

CREATE TABLE chamadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  conta_id uuid,
  ponto_focal_id uuid,
  ocorrencia_id uuid,
  oportunidade_id uuid,
  tarefa_id uuid,
  numero text NOT NULL CHECK (numero ~ '^\+?\d{8,15}$'),
  nome text,
  provedor text NOT NULL,
  canal text NOT NULL CHECK (canal IN ('computador', 'celular')),
  direcao text NOT NULL DEFAULT 'saida' CHECK (direcao IN ('saida', 'entrada')),
  estado text NOT NULL DEFAULT 'criada' CHECK (estado IN ('criada', 'discando', 'tocando', 'em_ligacao', 'em_espera', 'encerrada')),
  status text NOT NULL DEFAULT 'chamando'
    CHECK (status IN ('chamando', 'atendida', 'nao_atendida', 'ocupado', 'falhou', 'cancelada', 'perdida')),
  motivo text,
  anotacao text,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  tocando_em timestamptz,
  atendida_em timestamptz,
  encerrada_em timestamptz,
  duracao_seg integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chamadas_usuario ON chamadas (tenant_id, usuario_id, iniciada_em DESC);
CREATE INDEX chamadas_abertas ON chamadas (tenant_id, estado) WHERE estado <> 'encerrada';

CREATE TABLE chamada_eventos (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  chamada_id uuid NOT NULL,
  evento text NOT NULL,
  dados jsonb,
  usuario_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- Número de WhatsApp da organização. phone_number_id é único no mundo: é por ele que o webhook acha a organização.
CREATE TABLE whatsapp_numeros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provedor text NOT NULL DEFAULT 'cloud' CHECK (provedor IN ('cloud', 'demo')),
  phone_number_id text UNIQUE,
  waba_id text,
  numero_exibicao text,
  token_cifrado text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_um_ativo ON whatsapp_numeros (tenant_id) WHERE ativo;

-- Status de entrega vindo do provedor (lida) e busca pelo id da mensagem no provedor.
ALTER TABLE interacoes DROP CONSTRAINT IF EXISTS interacoes_status_entrega_check;
ALTER TABLE interacoes ADD CONSTRAINT interacoes_status_entrega_check
  CHECK (status_entrega IN ('registrada', 'enfileirada', 'enviada', 'entregue', 'lida', 'falhou', 'bloqueada'));
ALTER TABLE interacoes ADD COLUMN IF NOT EXISTS erro_entrega text;
ALTER TABLE interacoes ADD COLUMN IF NOT EXISTS chamada_id uuid;
CREATE INDEX IF NOT EXISTS interacoes_id_externo ON interacoes (tenant_id, id_externo) WHERE id_externo IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['telefonia_config', 'telefonia_ramais', 'chamadas', 'chamada_eventos', 'whatsapp_numeros']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sinapse_app', t);
  END LOOP;
END $$;
GRANT DELETE ON telefonia_ramais TO sinapse_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sinapse_app;

-- Toda organização começa com a telefonia em modo de treino e a ligação pelo celular ligada.
INSERT INTO telefonia_config (tenant_id) SELECT id FROM tenants ON CONFLICT DO NOTHING;
INSERT INTO jobs (tenant_id, tipo, payload, executar_em, chave, max_tentativas)
SELECT id, 'telefonia.manutencao', '{}', now(), 'recorrente:telefonia', 1000 FROM tenants ON CONFLICT (tenant_id, chave) DO NOTHING;
