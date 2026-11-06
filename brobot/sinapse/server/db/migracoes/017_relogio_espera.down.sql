-- Volta da 017: o tempo de espera registrado deixa de existir; os prazos já ajustados ficam como estão.
ALTER TABLE ocorrencias DROP COLUMN IF EXISTS espera_terceiro_seg;
ALTER TABLE ocorrencias DROP COLUMN IF EXISTS espera_cliente_seg;
ALTER TABLE ocorrencias DROP COLUMN IF EXISTS espera_inicio_em;
