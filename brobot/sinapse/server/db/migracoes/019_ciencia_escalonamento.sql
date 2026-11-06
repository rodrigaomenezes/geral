-- 019 · Ciência do escalonamento (WFL-007): a gestão registra que viu o atraso e qual ação será tomada, em que nível.
ALTER TABLE ocorrencias ADD COLUMN escalonamento_ciente_em timestamptz;
ALTER TABLE ocorrencias ADD COLUMN escalonamento_ciente_por uuid REFERENCES usuarios(id);
ALTER TABLE ocorrencias ADD COLUMN escalonamento_ciente_nivel integer NOT NULL DEFAULT 0 CHECK (escalonamento_ciente_nivel >= 0);
ALTER TABLE ocorrencias ADD CONSTRAINT ciencia_ate_o_nivel CHECK (escalonamento_ciente_nivel <= greatest(nivel_escalonamento, 0));
