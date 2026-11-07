'use strict';
// Token dos webhooks de entrada (mensagens e leads): cabeçalho x-sinapse-token = SINAPSE_TOKEN_ENTRADA.
// Comparação em tempo constante; sem a variável, a entrada fica desligada com mensagem do que fazer.

const crypto = require('node:crypto');
const { ErroNegocio } = require('./erros');

function conferirToken(recebido, esperado) {
  if (!esperado) throw new ErroNegocio(503, 'entrada_desligada', 'Entrada por webhook desligada: defina SINAPSE_TOKEN_ENTRADA no ambiente.');
  const a = crypto.createHash('sha256').update(String(recebido || '')).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new ErroNegocio(401, 'token_invalido', 'Token de entrada inválido.');
}

module.exports = { conferirToken };
