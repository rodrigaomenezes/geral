'use strict';
// Webhook de entrada (INT-001). Autenticado pelo cabeçalho x-sinapse-token (SINAPSE_TOKEN_ENTRADA).
// Responde 202 assim que a mensagem está gravada; o processamento é assíncrono (fila de jobs).

const { ErroNegocio } = require('../../nucleo/erros');
const { conferirToken } = require('../../nucleo/token-entrada');
const { com } = require('../../http/servidor');
const s = require('./servico');

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
