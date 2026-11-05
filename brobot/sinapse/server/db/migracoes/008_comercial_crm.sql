-- 008 · Comercial como CRM que substitui o Pipedrive (diretriz, adendo Comercial; F3a do plano).
--   catálogo de produtos com "exige teste" por produto (DP-04: configurável, padrão = exige, como antes);
--   propostas versionadas com itens, validade e alçada de desconto (CRM-007/008);
--   atividades da negociação (ligação, reunião, e-mail, WhatsApp, nota) com resultado (CRM-005/010);
--   oportunidade suspensa (com data para retomar) e reaberta com motivo (CRM-011);
--   identificador externo para a migração do Pipedrive sem duplicar (CRM-018).

CREATE TABLE produtos_comerciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text NOT NULL CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 80),
  exige_teste boolean NOT NULL DEFAULT true,
  preco_referencia numeric(12,2) CHECK (preco_referencia IS NULL OR preco_referencia >= 0),
  unidade text NOT NULL DEFAULT 'veículo' CHECK (length(unidade) BETWEEN 2 AND 30),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo)
);

-- Os quatro produtos que já existiam como lista fixa entram no catálogo de toda organização, exigindo teste.
INSERT INTO produtos_comerciais (tenant_id, codigo, nome)
SELECT t.id, p.codigo, p.nome FROM tenants t CROSS JOIN (VALUES ('multas', 'Multas e Notificações'), ('indicacao_condutores', 'Indicação de Condutores'),
  ('licenciamento', 'Licenciamento'), ('caca_condutores', 'CaçaCondutores')) AS p(codigo, nome)
ON CONFLICT (tenant_id, codigo) DO NOTHING;

-- Teste dispensado: só quando nenhum produto da oportunidade exige teste (o serviço decide pelo catálogo).
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS teste_dispensado boolean NOT NULL DEFAULT false;
ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS fechamento_com_teste;
ALTER TABLE oportunidades ADD CONSTRAINT fechamento_com_teste
  CHECK (etapa NOT IN ('negociacao', 'ganha') OR teste_resultado = 'aprovado' OR teste_dispensado);

-- Suspensa: fora do funil ativo, mas com data para retomar (vira a próxima ação). Reaberta volta à qualificação.
ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS oportunidades_etapa_check;
ALTER TABLE oportunidades ADD CONSTRAINT oportunidades_etapa_check
  CHECK (etapa IN ('novo', 'qualificacao', 'demonstracao', 'proposta', 'teste', 'negociacao', 'suspensa', 'ganha', 'perdida'));
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS suspensa_de text;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS motivo_suspensao text;
ALTER TABLE oportunidades ADD CONSTRAINT suspensa_completa
  CHECK (etapa <> 'suspensa' OR (suspensa_de IS NOT NULL AND motivo_suspensao IS NOT NULL));

-- Migração do Pipedrive: o id do negócio lá nunca entra duas vezes.
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS fonte text NOT NULL DEFAULT 'sinapse' CHECK (fonte IN ('sinapse', 'pipedrive'));
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS id_externo text;
CREATE UNIQUE INDEX IF NOT EXISTS oportunidades_id_externo ON oportunidades (tenant_id, fonte, id_externo) WHERE id_externo IS NOT NULL;

CREATE TABLE propostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  oportunidade_id uuid NOT NULL,
  versao integer NOT NULL CHECK (versao > 0),
  itens jsonb NOT NULL CHECK (jsonb_typeof(itens) = 'array' AND jsonb_array_length(itens) BETWEEN 1 AND 20),
  valor_cheio numeric(12,2) NOT NULL CHECK (valor_cheio >= 0),
  desconto_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (desconto_pct BETWEEN 0 AND 100),
  valor_mensal numeric(12,2) NOT NULL CHECK (valor_mensal >= 0),
  validade date NOT NULL,
  condicoes text CHECK (condicoes IS NULL OR length(condicoes) <= 2000),
  estado text NOT NULL DEFAULT 'rascunho'
    CHECK (estado IN ('rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada', 'aceita', 'recusada', 'substituida')),
  -- Alçada (CRM-008): desconto acima do limite da organização precisa de aprovação de outra pessoa (gestão).
  exige_aprovacao boolean NOT NULL DEFAULT false,
  aprovada_por uuid REFERENCES usuarios(id),
  aprovada_em timestamptz,
  parecer text,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, oportunidade_id, versao),
  FOREIGN KEY (tenant_id, oportunidade_id) REFERENCES oportunidades(tenant_id, id),
  CHECK (NOT exige_aprovacao OR estado IN ('rascunho', 'aguardando_aprovacao', 'substituida', 'recusada') OR aprovada_por IS NOT NULL),
  CHECK (aprovada_por IS NULL OR aprovada_por <> criado_por)
);
CREATE UNIQUE INDEX propostas_uma_vigente ON propostas (tenant_id, oportunidade_id)
  WHERE estado IN ('rascunho', 'aguardando_aprovacao', 'aprovada', 'enviada', 'aceita');

-- Proposta enviada ao cliente não muda mais (o histórico prova o que foi oferecido): mudar = nova versão.
CREATE FUNCTION proposta_enviada_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('enviada', 'aceita', 'recusada', 'substituida')
     AND (NEW.itens IS DISTINCT FROM OLD.itens OR NEW.valor_mensal <> OLD.valor_mensal OR NEW.desconto_pct <> OLD.desconto_pct
          OR NEW.validade <> OLD.validade OR NEW.condicoes IS DISTINCT FROM OLD.condicoes) THEN
    RAISE EXCEPTION 'A proposta versão % já foi enviada e não pode ser alterada; crie uma nova versão.', OLD.versao;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proposta_sem_alteracao BEFORE UPDATE ON propostas FOR EACH ROW EXECUTE FUNCTION proposta_enviada_imutavel();

CREATE TABLE atividades_comerciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  oportunidade_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('ligacao', 'reuniao', 'email', 'whatsapp', 'visita', 'nota')),
  assunto text NOT NULL CHECK (length(assunto) BETWEEN 2 AND 200),
  quando timestamptz NOT NULL,
  feita boolean NOT NULL DEFAULT false,
  resultado text CHECK (resultado IS NULL OR length(resultado) <= 2000),
  autor_id uuid REFERENCES usuarios(id),
  id_externo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, oportunidade_id) REFERENCES oportunidades(tenant_id, id),
  CHECK (NOT feita OR tipo = 'nota' OR resultado IS NOT NULL)
);
CREATE INDEX atividades_oportunidade ON atividades_comerciais (tenant_id, oportunidade_id, quando DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['produtos_comerciais', 'propostas', 'atividades_comerciais']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sinapse_app', t);
  END LOOP;
END $$;
