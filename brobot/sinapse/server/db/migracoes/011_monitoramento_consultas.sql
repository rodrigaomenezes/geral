-- 011 · Monitoramento (F5): volumetria de consultas da Platform por conta/produto/dia (CSV, REC-001/002/007/008),
-- consultas esperadas que não foram geradas (CRE-003, "erros invisíveis" — melhoria 3 da reunião), aviso de credencial
-- perto de vencer (CRE-004) e reincidência para análise de causa raiz (POS-009).
-- `alerta_chave` deduplica: um alerta (ex.: "consultas não geradas da conta X no produto Y") tem no máximo uma
-- ocorrência ativa; resolvida ou encerrada, um alerta novo pode abrir outra.

ALTER TABLE ocorrencias ADD COLUMN IF NOT EXISTS alerta_chave text;
CREATE UNIQUE INDEX IF NOT EXISTS ocorrencias_alerta_ativa ON ocorrencias (tenant_id, alerta_chave)
  WHERE alerta_chave IS NOT NULL AND estado NOT IN ('resolvida', 'encerrada_sem_resolucao');

CREATE TABLE consultas_volume (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  conta_id uuid NOT NULL,
  produto text NOT NULL CHECK (length(produto) BETWEEN 1 AND 80),
  dia date NOT NULL,
  esperadas integer NOT NULL CHECK (esperadas >= 0),
  geradas integer NOT NULL CHECK (geradas >= 0),
  erros_tecnicos integer NOT NULL DEFAULT 0 CHECK (erros_tecnicos >= 0),
  erros_usuario integer NOT NULL DEFAULT 0 CHECK (erros_usuario >= 0),
  indisponiveis integer NOT NULL DEFAULT 0 CHECK (indisponiveis >= 0),
  importacao_id uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, conta_id, produto, dia),
  FOREIGN KEY (tenant_id, conta_id) REFERENCES contas(tenant_id, id)
);
CREATE INDEX consultas_volume_dia ON consultas_volume (tenant_id, dia);

ALTER TABLE consultas_volume ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento ON consultas_volume
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON consultas_volume TO sinapse_app;
