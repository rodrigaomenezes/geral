'use strict';
// Porta de envio de mensagens: escolhe o provedor real quando configurado, senão o de demonstração.
//   WhatsApp: número ativo da organização com provedor "cloud" → Meta Cloud API; sem número → demonstração.
//   E-mail: demonstração (o provedor transacional entra com variáveis próprias).
const { uma } = require('../../db');
const { exigirDisponivel, registrarSucesso } = require('./estado');
const demo = require('./mensageria-demo');
const cloud = require('./whatsapp-cloud');

async function enviar(c, canal, msg) {
  if (canal === 'whatsapp') {
    const numero = uma(await c.query("SELECT * FROM whatsapp_numeros WHERE ativo AND provedor = 'cloud' AND token_cifrado IS NOT NULL LIMIT 1"));
    if (numero) {
      await exigirDisponivel(c, 'whatsapp');
      const r = await cloud.enviar(numero, msg.para, msg);
      await registrarSucesso(c, 'whatsapp', { provedor: 'cloud', numero: numero.numero_exibicao });
      return r;
    }
  }
  return demo.enviar(c, canal, msg);
}

module.exports = { enviar };
