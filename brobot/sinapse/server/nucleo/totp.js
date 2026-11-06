'use strict';
// TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 dígitos) sem dependência: o código de 6 dígitos dos aplicativos autenticadores
// (Google Authenticator, Microsoft Authenticator, 1Password…). Usa a hora real (o aplicativo do celular também usa).

const crypto = require('node:crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32(buf) {
  let bits = 0; let valor = 0; let saida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte; bits += 8;
    while (bits >= 5) { saida += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

function deBase32(texto) {
  const limpo = String(texto).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0; let valor = 0; const saida = [];
  for (const ch of limpo) {
    const i = ALFABETO.indexOf(ch);
    if (i < 0) throw new Error('segredo TOTP inválido');
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { saida.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(saida);
}

const gerarSegredo = () => base32(crypto.randomBytes(20));

function codigo(segredo, quando = Date.now(), passo = 30, digitos = 6) {
  const contador = Math.floor(quando / 1000 / passo);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = crypto.createHmac('sha1', deBase32(segredo)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digitos).padStart(digitos, '0');
}

/** Aceita o código do passo atual e de um passo antes/depois (relógio do celular pode estar ~30 s diferente).
 *  Devolve o número do passo aceito (para o chamador impedir o reuso) ou false. */
function passoAceito(segredo, informado, quando = Date.now(), janela = 1) {
  const c = String(informado || '').replace(/\D/g, '');
  if (c.length !== 6) return false;
  for (let d = -janela; d <= janela; d++) {
    const t = quando + d * 30000;
    if (crypto.timingSafeEqual(Buffer.from(codigo(segredo, t)), Buffer.from(c))) return Math.floor(t / 30000);
  }
  return false;
}
const conferir = (segredo, informado, quando, janela) => passoAceito(segredo, informado, quando, janela) !== false;

const uri = (emissor, conta, segredo) => `otpauth://totp/${encodeURIComponent(`${emissor}:${conta}`)}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=30`;

module.exports = { gerarSegredo, codigo, conferir, passoAceito, uri, base32, deBase32 };
