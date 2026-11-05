-- 005 · Mensagens padrão editáveis com revisão e aprovação (COM-001, COM-002; reunião de 03/11: o Meira reescreve
-- os textos com as equipes). Versão aprovada não muda mais; a anterior fica no histórico.

CREATE TABLE modelos_mensagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  codigo text NOT NULL CHECK (codigo ~ '^[a-z0-9_]{3,40}$'),
  versao integer NOT NULL CHECK (versao > 0),
  texto text NOT NULL CHECK (length(texto) BETWEEN 5 AND 3000),
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'em_revisao', 'ativa', 'substituida', 'reprovada')),
  nota text,
  template_nome text CHECK (template_nome IS NULL OR template_nome ~ '^[a-z0-9_]{1,120}$'),
  template_idioma text,
  template_variaveis text[] NOT NULL DEFAULT '{}',
  criado_por uuid REFERENCES usuarios(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  enviado_revisao_em timestamptz,
  revisado_por uuid REFERENCES usuarios(id),
  revisado_em timestamptz,
  parecer text,
  UNIQUE (tenant_id, codigo, versao),
  CHECK (estado <> 'reprovada' OR parecer IS NOT NULL)
);
CREATE UNIQUE INDEX modelos_uma_ativa ON modelos_mensagem (tenant_id, codigo) WHERE estado = 'ativa';
CREATE UNIQUE INDEX modelos_um_rascunho ON modelos_mensagem (tenant_id, codigo) WHERE estado IN ('rascunho', 'em_revisao');

CREATE FUNCTION modelo_aprovado_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('ativa', 'substituida') AND (NEW.texto IS DISTINCT FROM OLD.texto OR NEW.versao <> OLD.versao) THEN
    RAISE EXCEPTION 'A versão % do modelo % já foi aprovada e não pode ser alterada; crie uma nova versão.', OLD.versao, OLD.codigo;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER modelo_sem_alteracao BEFORE UPDATE ON modelos_mensagem FOR EACH ROW EXECUTE FUNCTION modelo_aprovado_imutavel();

-- Valores das variáveis da mensagem enviada (para enviar como template aprovado da Meta fora da janela de 24 h).
ALTER TABLE interacoes ADD COLUMN IF NOT EXISTS variaveis jsonb;

ALTER TABLE modelos_mensagem ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento ON modelos_mensagem
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON modelos_mensagem TO sinapse_app;
