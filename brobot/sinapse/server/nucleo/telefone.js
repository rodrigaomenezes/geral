'use strict';
// Telefone brasileiro normalizado em E.164 (+55 DDD número) com a regra do nono dígito:
// celular de 8 dígitos (começando em 6-9) ganha o 9 na frente. É a chave para achar o ponto focal.

function normalizarTelefone(bruto) {
  if (bruto === null || bruto === undefined) return null;
  let d = String(bruto).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (!/^[1-9]{2}/.test(d)) return null;
  return `+55${d}`;
}

/** Máscara para exibir sem expor o número inteiro em telas e logs. */
const mascararTelefone = (e164) => (e164 ? `${e164.slice(0, 5)} ****-${e164.slice(-4)}` : null);

module.exports = { normalizarTelefone, mascararTelefone };
