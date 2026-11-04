'use strict';
// Conectores de DEMONSTRAÇÃO de WhatsApp e e-mail, atrás da mesma porta: enviar(c, canal, { para, texto }).
// Não enviam nada para fora; devolvem um id de mensagem como o provedor real devolveria.
// O conector oficial (WhatsApp Cloud API / e-mail transacional) entra com variáveis de ambiente próprias.

const crypto = require('node:crypto');
const { exigirDisponivel, registrarSucesso } = require('./estado');

async function enviar(c, canal, { para, texto }) {
  if (!para) throw new Error('Destinatário ausente.');
  if (!texto) throw new Error('Mensagem vazia.');
  await exigirDisponivel(c, canal);
  await registrarSucesso(c, canal);
  return { idExterno: `${canal}-demo-${crypto.randomUUID().slice(0, 8)}`, status: 'enviada' };
}

module.exports = { enviar };
