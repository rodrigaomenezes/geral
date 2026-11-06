-- 020 · Anexos de ocorrência (INT-009, R-12): tipo conferido pelo conteúdo (não pela extensão), até 10 MB, resumo
-- SHA-256 (o mesmo arquivo na mesma ocorrência não entra duas vezes), arquivar com motivo (nada some) e retenção:
-- depois do prazo configurado, o conteúdo é expurgado e fica o registro (nome, tamanho, resumo, quem e quando).

CREATE TABLE anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ocorrencia_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 160),
  tipo_mime text NOT NULL CHECK (tipo_mime IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  tamanho integer NOT NULL CHECK (tamanho BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  conteudo bytea,
  enviado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz,
  arquivado_por uuid REFERENCES usuarios(id),
  motivo_arquivamento text CHECK (motivo_arquivamento IS NULL OR length(motivo_arquivamento) BETWEEN 5 AND 300),
  expurgado_em timestamptz,
  FOREIGN KEY (tenant_id, ocorrencia_id) REFERENCES ocorrencias(tenant_id, id),
  CHECK (arquivado_em IS NULL OR motivo_arquivamento IS NOT NULL),
  -- Conteúdo só some pela retenção (expurgo registrado).
  CHECK ((conteudo IS NULL) = (expurgado_em IS NOT NULL))
);
CREATE UNIQUE INDEX anexos_sem_repetir ON anexos (tenant_id, ocorrencia_id, sha256) WHERE arquivado_em IS NULL;
CREATE INDEX anexos_ocorrencia ON anexos (tenant_id, ocorrencia_id, criado_em);

ALTER TABLE anexos ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento ON anexos
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON anexos TO sinapse_app;
