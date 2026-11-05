'use strict';
// Configuração lida só de variáveis de ambiente, validada no boot. Nenhum segredo com valor padrão.

const path = require('node:path');

function carregarConfig(env = process.env) {
  const producao = env.NODE_ENV === 'production';
  const cfg = {
    producao,
    porta: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL || null,
    // PostgreSQL embutido: pasta dos dados (Volume /data no Railway). Vazio em teste = memória.
    dirDados: env.SINAPSE_DATA === ':memoria:' ? null : env.SINAPSE_DATA || path.join(__dirname, '..', 'data', 'pg'),
    // Modo demonstração: login por persona, simulador e relógio ajustável. Desligue com SINAPSE_DEMO=0.
    demo: env.SINAPSE_DEMO !== '0',
    // Token exigido nos webhooks de entrada (cabeçalho x-sinapse-token). Sem ele, a rota fica desligada.
    tokenEntrada: env.SINAPSE_TOKEN_ENTRADA || null,
    // Senha inicial do administrador (só usada ao semear). Sem ela, só o login de demonstração funciona.
    senhaAdmin: env.SINAPSE_SENHA_ADMIN || null,
    // Intervalo do ciclo do worker (ms). Os jobs ficam no banco; o ciclo só verifica o que venceu.
    cicloWorkerMs: Number(env.SINAPSE_CICLO_MS || 2000),
    worker: env.SINAPSE_WORKER !== '0',
  };
  if (cfg.tokenEntrada && cfg.tokenEntrada.length < 24) {
    throw new Error('SINAPSE_TOKEN_ENTRADA precisa ter pelo menos 24 caracteres.');
  }
  if (cfg.senhaAdmin && cfg.senhaAdmin.length < 12) {
    throw new Error('SINAPSE_SENHA_ADMIN precisa ter pelo menos 12 caracteres.');
  }
  if (producao && !cfg.databaseUrl && !env.SINAPSE_DATA) {
    throw new Error('Em produção defina DATABASE_URL (PostgreSQL) ou SINAPSE_DATA (pasta do Volume, ex.: /data/pg).');
  }
  return cfg;
}

module.exports = { carregarConfig };
