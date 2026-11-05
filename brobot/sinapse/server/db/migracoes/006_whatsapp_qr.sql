-- 006 · WhatsApp por QR Code (Baileys, portado do Lumen Operações): o número da organização vira um "aparelho
-- conectado", como o WhatsApp Web. A sessão fica em arquivo no Volume; aqui só o estado da conexão.
ALTER TABLE whatsapp_numeros DROP CONSTRAINT IF EXISTS whatsapp_numeros_provedor_check;
ALTER TABLE whatsapp_numeros ADD CONSTRAINT whatsapp_numeros_provedor_check CHECK (provedor IN ('cloud', 'demo', 'qr'));
ALTER TABLE whatsapp_numeros ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'conectado'
  CHECK (status IN ('conectando', 'conectado', 'desconectado', 'erro'));
ALTER TABLE whatsapp_numeros ADD COLUMN IF NOT EXISTS ultimo_erro text;
