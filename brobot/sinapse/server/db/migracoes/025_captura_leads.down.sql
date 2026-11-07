-- Volta da 025: remove o identificador externo do lead (as oportunidades continuam).
DROP INDEX IF EXISTS oportunidades_id_externo;
ALTER TABLE oportunidades DROP COLUMN IF EXISTS id_externo;
