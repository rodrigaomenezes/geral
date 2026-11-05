'use strict';
// Porta de envio de mensagens: escolhe o provedor real quando configurado, senão o de demonstração.
//   WhatsApp: número ativo da organização com provedor "cloud" → Meta Cloud API; sem número → demonstração.
//   E-mail: demonstração (o provedor transacional entra com variáveis próprias).
const { uma } = require('../../db');
const { exigirDisponivel, registrarSucesso } = require('./estado');
const demo = require('./mensageria-demo');
const cloud = require('./whatsapp-cloud');
const qr = require('./whatsapp-qr');

async function enviar(c, canal, msg) {
  if (canal === 'whatsapp') {
    const numero = uma(await c.query("SELECT * FROM whatsapp_numeros WHERE ativo AND (provedor = 'qr' OR (provedor = 'cloud' AND token_cifrado IS NOT NULL)) LIMIT 1"));
    if (numero) {
      await exigirDisponivel(c, 'whatsapp');
      // Pelo QR não há janela de 24 h nem template: sai o texto. Pela API oficial, o template aprovado, se houver.
      const r = numero.provedor === 'qr' ? await qr.enviar(numero, msg.para, msg) : await cloud.enviar(numero, msg.para, msg);
      await registrarSucesso(c, 'whatsapp', { provedor: numero.provedor, numero: numero.numero_exibicao });
      return r;
    }
  }
  return demo.enviar(c, canal, msg);
}

module.exports = { enviar };
