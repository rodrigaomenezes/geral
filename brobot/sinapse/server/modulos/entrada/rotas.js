'use strict';
// Webhook de entrada (INT-001). Autenticado pelo cabeçalho x-sinapse-token (SINAPSE_TOKEN_ENTRADA).
// Responde 202 assim que a mensagem está gravada; o processamento é assíncrono (fila de jobs).

const crypto = require('node:crypto');
const { ErroNegocio } = require('../../nucleo/erros');
const { com } = require('../../http/servidor');
const s = require('./servico');

function conferirToken(recebido, esperado) {
  if (!esperado) throw new ErroNegocio(503, 'entrada_desligada', 'Entrada por webhook desligada: defina SINAPSE_TOKEN_ENTRADA no ambiente.');
  const a = crypto.createHash('sha256').update(String(recebido || '')).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new ErroNegocio(401, 'token_invalido', 'Token de entrada inválido.');
}

module.exports = [
  { metodo: 'POST', caminho: '/api/entrada/:tenant/:origem', publica: true,
    handler: async ({ req, db, cfg, params, corpo }) => {
      conferirToken(req.headers['x-sinapse-token'], cfg.tokenEntrada);
      const t = await s.tenantPorSlug(db, params.tenant);
      if (!t) throw new ErroNegocio(404, 'organizacao_inexistente', 'Organização não encontrada.');
      const r = await s.receber(db, t.id, params.origem, corpo);
      return com(r.duplicada ? 200 : 202, r);
    } },
];
