-- Volta da 006: números por QR deixam de existir (o oficial continua).
UPDATE whatsapp_numeros SET ativo = false WHERE provedor = 'qr';
DELETE FROM whatsapp_numeros WHERE provedor = 'qr';
ALTER TABLE whatsapp_numeros DROP COLUMN IF EXISTS ultimo_erro, DROP COLUMN IF EXISTS status;
ALTER TABLE whatsapp_numeros DROP CONSTRAINT IF EXISTS whatsapp_numeros_provedor_check;
ALTER TABLE whatsapp_numeros ADD CONSTRAINT whatsapp_numeros_provedor_check CHECK (provedor IN ('cloud', 'demo'));
