'use strict';
// Cifra de segredos no banco (senha de ramal SIP, token do WhatsApp): AES-256-GCM com a chave de SINAPSE_CHAVE.
// Sem a variável, o sistema recusa guardar segredo (nunca usa chave padrão). Formato: v1:iv:tag:dados (base64).

const crypto = require('node:crypto');
const { erro } = require('./erros');

function chave() {
  const bruta = process.env.SINAPSE_CHAVE;
  if (!bruta || bruta.length < 32) {
    throw erro.regra('sem_chave', 'Para guardar senhas e tokens, defina a variável de ambiente SINAPSE_CHAVE (32 caracteres ou mais) e reinicie o serviço.');
  }
  return crypto.createHash('sha256').update(bruta).digest();
}

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join(':');
}

function decifrar(guardado) {
  if (!guardado) return null;
  const [v, iv, tag, dados] = String(guardado).split(':');
  if (v !== 'v1') throw new Error('Formato de segredo desconhecido.');
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}

const chaveConfigurada = () => !!(process.env.SINAPSE_CHAVE && process.env.SINAPSE_CHAVE.length >= 32);

module.exports = { cifrar, decifrar, chaveConfigurada };
