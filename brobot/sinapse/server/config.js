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
    // Modo demonstração: login por persona SEM SENHA, simulador, relógio ajustável e dados fictícios.
    // Fora de produção vem ligado; em produção (NODE_ENV=production) só liga com SINAPSE_DEMO=1 explícito (R-01).
    demo: producao ? env.SINAPSE_DEMO === '1' : env.SINAPSE_DEMO !== '0',
    // Vitrine (/demo): completa a demonstração com exemplo em todas as áreas. SINAPSE_DEMO_VITRINE=0 deixa só o cenário mínimo.
    vitrine: env.SINAPSE_DEMO_VITRINE !== '0',
    // SINAPSE_AMBIENTE=producao marca o ambiente com dados reais: recusa demonstração e exige banco gerenciado.
    ambiente: env.SINAPSE_AMBIENTE || (producao ? 'nao_informado' : 'desenvolvimento'),
    // TLS do PostgreSQL gerenciado (R-03): certificado verificado. SINAPSE_DB_CA = certificado da autoridade (PEM).
    dbTls: { ca: env.SINAPSE_DB_CA ? env.SINAPSE_DB_CA.replace(/\\n/g, '\n') : null, inseguro: env.SINAPSE_DB_TLS_INSEGURO === '1' },
    // Token exigido nos webhooks de entrada (cabeçalho x-sinapse-token). Sem ele, a rota fica desligada.
    tokenEntrada: env.SINAPSE_TOKEN_ENTRADA || null,
    // SUP-009: token do coletor de métricas (Prometheus/Grafana). Sem ele, /api/metricas fica desligada.
    tokenMetricas: env.SINAPSE_TOKEN_METRICAS || null,
    // Senha inicial do administrador (só usada ao semear). Sem ela, só o login de demonstração funciona.
    senhaAdmin: env.SINAPSE_SENHA_ADMIN || null,
    // Implantação real (sem demonstração): e-mail da primeira pessoa da Administração e nome da organização.
    adminEmail: env.SINAPSE_ADMIN_EMAIL ? env.SINAPSE_ADMIN_EMAIL.trim() : null,
    organizacao: env.SINAPSE_ORGANIZACAO ? env.SINAPSE_ORGANIZACAO.trim().slice(0, 80) : null,
    // Senha dos usuários de teste (gestor@brobot.com.br, suporte1@…); sem ela, eles não são criados.
    senhaTeste: env.SINAPSE_SENHA_TESTE || null,
    // MFA obrigatório para Administração e Supervisão: com SINAPSE_MFA_OBRIGATORIO=1, e sempre em produção real.
    mfaObrigatorio: env.SINAPSE_MFA_OBRIGATORIO === '1' || env.SINAPSE_AMBIENTE === 'producao',
    // Intervalo do ciclo do worker (ms). Os jobs ficam no banco; o ciclo só verifica o que venceu.
    cicloWorkerMs: Number(env.SINAPSE_CICLO_MS || 2000),
    worker: env.SINAPSE_WORKER !== '0',
  };
  if (cfg.tokenMetricas && cfg.tokenMetricas.length < 24) throw new Error('SINAPSE_TOKEN_METRICAS precisa ter pelo menos 24 caracteres.');
  if (cfg.tokenEntrada && cfg.tokenEntrada.length < 24) {
    throw new Error('SINAPSE_TOKEN_ENTRADA precisa ter pelo menos 24 caracteres.');
  }
  if (cfg.senhaTeste && cfg.senhaTeste.length < 12) throw new Error('SINAPSE_SENHA_TESTE precisa ter pelo menos 12 caracteres.');
  if (cfg.senhaAdmin && cfg.senhaAdmin.length < 12) {
    throw new Error('SINAPSE_SENHA_ADMIN precisa ter pelo menos 12 caracteres.');
  }
  if (cfg.adminEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.adminEmail)) throw new Error('SINAPSE_ADMIN_EMAIL não parece um e-mail.');
  if (env.SINAPSE_DEMO && !['0', '1'].includes(env.SINAPSE_DEMO)) throw new Error('SINAPSE_DEMO deve ser 0 ou 1.');
  if (cfg.ambiente === 'producao') {
    if (cfg.demo) throw new Error('SINAPSE_AMBIENTE=producao não aceita SINAPSE_DEMO=1: o login sem senha e os dados fictícios ficam proibidos.');
    if (!cfg.databaseUrl) throw new Error('SINAPSE_AMBIENTE=producao exige DATABASE_URL (PostgreSQL gerenciado, com backup).');
    if (cfg.dbTls.inseguro) throw new Error('SINAPSE_AMBIENTE=producao não aceita SINAPSE_DB_TLS_INSEGURO=1; informe SINAPSE_DB_CA.');
  }
  if (producao && !cfg.databaseUrl && !env.SINAPSE_DATA) {
    throw new Error('Em produção defina DATABASE_URL (PostgreSQL) ou SINAPSE_DATA (pasta do Volume, ex.: /data/pg).');
  }
  return cfg;
}

module.exports = { carregarConfig };
