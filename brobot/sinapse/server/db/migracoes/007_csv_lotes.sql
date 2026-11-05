-- 007 · Integração CSV (adendo CSV da diretriz, 05/11/2026): sem amostras reais, o layout do arquivo de verdade é
-- ligado aos campos do Sinapse na prévia (mapa versionado por fluxo); exportar gera um lote que só conta como
-- aplicado no destino depois da confirmação com evidência; importação registra se entrou inteira ou parcial.

CREATE TABLE mapas_csv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tipo text NOT NULL,
  versao integer NOT NULL CHECK (versao > 0),
  mapa jsonb NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tipo, versao)
);
CREATE UNIQUE INDEX mapas_csv_um_ativo ON mapas_csv (tenant_id, tipo) WHERE ativo;

CREATE TABLE exportacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tipo text NOT NULL,
  destino text NOT NULL CHECK (destino IN ('platform', 'omie')),
  arquivo text NOT NULL,
  hash text NOT NULL,
  linhas integer NOT NULL,
  estado text NOT NULL DEFAULT 'aguardando_confirmacao' CHECK (estado IN ('aguardando_confirmacao', 'confirmado', 'falhou')),
  prazo_confirmacao_em timestamptz NOT NULL,
  evidencia text CHECK (evidencia IS NULL OR length(evidencia) BETWEEN 10 AND 1000),
  resolvido_por uuid REFERENCES usuarios(id),
  resolvido_em timestamptz,
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- Gerar ou baixar o arquivo não é aplicar no destino: confirmar ou dar como falho exige evidência/motivo.
  CHECK (estado = 'aguardando_confirmacao' OR (evidencia IS NOT NULL AND resolvido_em IS NOT NULL))
);
CREATE INDEX exportacoes_pendentes ON exportacoes (tenant_id, prazo_confirmacao_em) WHERE estado = 'aguardando_confirmacao';

ALTER TABLE importacoes ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'concluido' CHECK (estado IN ('concluido', 'parcial'));
ALTER TABLE importacoes ADD COLUMN IF NOT EXISTS mapa_id uuid REFERENCES mapas_csv(id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mapas_csv', 'exportacoes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY isolamento ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO sinapse_app', t);
  END LOOP;
END $$;
