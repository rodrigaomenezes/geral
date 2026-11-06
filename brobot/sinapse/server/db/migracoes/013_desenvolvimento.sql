-- 013 · Desenvolvimento (F7): incidentes críticos com linha do tempo, comunicação e post-mortem (DEV-006), backlog de
-- melhorias com aprovação, release e validação operacional (DEV-008, DEV-005), e problemas recorrentes ligados à ação
-- preventiva (DEV-007). Substitui o uso do Redmine para o que é decisão e acompanhamento (a execução técnica segue
-- onde o time de desenvolvimento trabalha).

CREATE TABLE incidentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text NOT NULL,
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 5 AND 200),
  severidade text NOT NULL CHECK (severidade IN ('sev1', 'sev2', 'sev3')),
  estado text NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto', 'mitigado', 'resolvido', 'encerrado')),
  produto text,
  impacto text NOT NULL CHECK (length(impacto) BETWEEN 5 AND 2000),
  responsavel_id uuid REFERENCES usuarios(id),
  inicio_em timestamptz NOT NULL,
  mitigado_em timestamptz,
  resolvido_em timestamptz,
  encerrado_em timestamptz,
  causa_raiz text CHECK (causa_raiz IS NULL OR length(causa_raiz) <= 4000),
  licoes text CHECK (licoes IS NULL OR length(licoes) <= 4000),
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, codigo),
  UNIQUE (tenant_id, id),
  CHECK (estado = 'aberto' OR mitigado_em IS NOT NULL),
  CHECK (estado NOT IN ('resolvido', 'encerrado') OR resolvido_em IS NOT NULL),
  -- Post-mortem (DEV-006): encerrar exige causa raiz e lições aprendidas.
  CHECK (estado <> 'encerrado' OR (causa_raiz IS NOT NULL AND licoes IS NOT NULL AND encerrado_em IS NOT NULL))
);

CREATE TABLE incidente_contas (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  incidente_id uuid NOT NULL,
  conta_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, incidente_id, conta_id),
  FOREIGN KEY (tenant_id, incidente_id) REFERENCES incidentes(tenant_id, id),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id)
);

-- Linha do tempo: só anexação (o que foi dito e quando não se reescreve).
CREATE TABLE incidente_atualizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  incidente_id uuid NOT NULL,
  texto text NOT NULL CHECK (length(texto) BETWEEN 3 AND 2000),
  estado text,
  comunicado_clientes boolean NOT NULL DEFAULT false,
  avisos integer NOT NULL DEFAULT 0,
  autor_id uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, incidente_id) REFERENCES incidentes(tenant_id, id)
);
CREATE INDEX incidente_atualizacoes_ordem ON incidente_atualizacoes (tenant_id, incidente_id, criado_em);

CREATE TABLE releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  versao text NOT NULL CHECK (versao ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$'),
  previsto_para date,
  estado text NOT NULL DEFAULT 'planejada' CHECK (estado IN ('planejada', 'publicada')),
  notas text CHECK (notas IS NULL OR length(notas) <= 4000),
  publicada_em timestamptz,
  publicada_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, versao),
  UNIQUE (tenant_id, id),
  CHECK (estado <> 'publicada' OR publicada_em IS NOT NULL)
);

CREATE TABLE melhorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text NOT NULL,
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 5 AND 200),
  descricao text NOT NULL CHECK (length(descricao) BETWEEN 10 AND 4000),
  tipo text NOT NULL CHECK (tipo IN ('correcao', 'melhoria', 'preventiva')),
  origem text NOT NULL CHECK (origem IN ('ocorrencia', 'incidente', 'reincidencia', 'cliente', 'interna')),
  incidente_id uuid,
  prioridade text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa', 'media', 'alta', 'critica')),
  estado text NOT NULL DEFAULT 'proposta'
    CHECK (estado IN ('proposta', 'aprovada', 'recusada', 'em_desenvolvimento', 'liberada', 'validada')),
  proposta_por uuid REFERENCES usuarios(id),
  decidida_por uuid REFERENCES usuarios(id),
  decisao_motivo text,
  release_id uuid,
  validada_por uuid REFERENCES usuarios(id),
  validacao_evidencia text,
  link_externo text CHECK (link_externo IS NULL OR link_externo ~ '^https://\S{4,}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, codigo),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, incidente_id) REFERENCES incidentes(tenant_id, id),
  FOREIGN KEY (tenant_id, release_id) REFERENCES releases(tenant_id, id),
  -- Aprovar ou recusar é de outra pessoa (não de quem propôs); recusar diz por quê.
  CHECK (estado = 'proposta' OR decidida_por IS NOT NULL),
  CHECK (decidida_por IS DISTINCT FROM proposta_por OR decidida_por IS NULL),
  CHECK (estado <> 'recusada' OR decisao_motivo IS NOT NULL),
  CHECK (estado NOT IN ('liberada', 'validada') OR release_id IS NOT NULL),
  -- DEV-005: liberado não é resolvido; a validação operacional tem evidência.
  CHECK (estado <> 'validada' OR (validada_por IS NOT NULL AND validacao_evidencia IS NOT NULL))
);

-- DEV-007: ocorrências que a melhoria resolve na causa (problema recorrente → ação preventiva).
CREATE TABLE melhoria_ocorrencias (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  melhoria_id uuid NOT NULL,
  ocorrencia_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, melhoria_id, ocorrencia_id),
  FOREIGN KEY (tenant_id, melhoria_id) REFERENCES melhorias(tenant_id, id)
);
CREATE INDEX melhoria_ocorrencias_ocorrencia ON melhoria_ocorrencias (tenant_id, ocorrencia_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['incidentes', 'incidente_contas', 'incidente_atualizacoes', 'releases', 'melhorias', 'melhoria_ocorrencias']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO sinapse_app', t);
  END LOOP;
END $$;
-- Linha do tempo do incidente e vínculos são só de inserção; o resto também atualiza.
GRANT UPDATE ON incidentes, releases, melhorias TO sinapse_app;
