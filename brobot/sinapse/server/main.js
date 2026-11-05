'use strict';
const { carregarConfig } = require('./config');
const { criarApp } = require('./app');

(async () => {
  const cfg = carregarConfig();
  const app = await criarApp(cfg);
  const porta = await app.iniciar(cfg.porta);
  console.log(`ERP Sinapse no ar na porta ${porta} · banco: ${app.db.motor} · demonstração: ${cfg.demo ? 'ligada' : 'desligada'}`);
  const encerrar = async (sinal) => {
    console.log(`${sinal} recebido: encerrando com segurança.`);
    try { await app.parar(); } finally { process.exit(0); }
  };
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
})().catch((e) => {
  console.error(`Falha ao iniciar: ${e.message}`);
  process.exit(1);
});
