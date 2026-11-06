-- 024 · Código OMIE único por organização (FIN-002): o mesmo cliente do OMIE não pode estar ligado a duas contas ativas.
-- Se já houver duplicata (dado antigo), a regra não é criada aqui (nada é apagado nem trocado em silêncio): fica o aviso
-- e a importação continua recusando; trate as duplicatas e rode a verificação de novo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM contas WHERE id_omie IS NOT NULL AND arquivada_em IS NULL GROUP BY tenant_id, id_omie HAVING count(*) > 1) THEN
    RAISE WARNING 'Código OMIE repetido em contas ativas: índice único não criado. Trate as duplicatas (Supervisor → divergências).';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS contas_id_omie_unico ON contas (tenant_id, id_omie) WHERE id_omie IS NOT NULL AND arquivada_em IS NULL;
  END IF;
END $$;
