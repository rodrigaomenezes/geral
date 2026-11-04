'use strict';
// Montagem: banco → migrações → relógio → dados de demonstração → jobs → HTTP. Usado pelo main e pelos testes.

const { abrirBanco } = require('./db');
const { migrar } = require('./db/migrar');
const { relogio } = require('./nucleo/relogio');
const { criarServidor } = require('./http/servidor');
const { criarWorker } = require('./jobs/fila');
const entrada = require('./modulos/entrada/servico');
const rodadas = require('./modulos/rodadas/servico');
const comunicacao = require('./modulos/comunicacao/servico');
const supervisor = require('./modulos/supervisor/servico');
const omieSync = require('./modulos/integracoes/omie-sync');
const seed = require('./modulos/demo/seed');

const ROTAS = [
  ...require('./modulos/identidade/rotas'),
  ...require('./modulos/ocorrencias/rotas'),
  ...require('./modulos/clientes/rotas'),
  ...require('./modulos/rodadas/rotas'),
  ...require('./modulos/entrada/rotas'),
  ...require('./modulos/supervisor/rotas'),
  ...require('./modulos/demo/rotas'),
];

function handlersDeJobs(db) {
  return {
    'entrada.processar': entrada.processar,
    'rodada.pre_rodada': rodadas.jobPreRodada,
    'rodada.contato': rodadas.jobContato,
    'rodada.executar': rodadas.jobExecutar,
    'comunicacao.enviar': comunicacao.jobEnviar,
    'supervisor.varrer': async (c, ctx, p, job) => ({
      ...(await supervisor.jobVarrer(c, ctx, p, job)),
      depois: () => supervisor.varreduraGlobal(db),
    }),
    'omie.sincronizar': omieSync.jobSincronizar,
    // Item que esgotou as tentativas: efeitos de "falhou" ficam visíveis (RN-015).
    __aoMorrer: async (job) => {
      if (job.tipo === 'comunicacao.enviar') await db.comoTenant(job.tenant_id, (c) => comunicacao.aoFalharEnvio(c, job.payload));
    },
  };
}

async function criarApp(cfg, { log = console.log } = {}) {
  const db = await abrirBanco({ url: cfg.databaseUrl, dir: cfg.dirDados });
  await migrar(db, log);
  await relogio.carregar(db);
  if (cfg.demo) await seed.semearSeVazio(db, cfg, log);
  const worker = criarWorker(db, handlersDeJobs(db), { log });
  const deps = { worker, log };
  const servidor = criarServidor({ db, cfg, rotas: ROTAS, deps, log });
  return {
    db, worker, servidor,
    async iniciar(porta) {
      await supervisor.varreduraGlobal(db);
      if (cfg.worker) worker.iniciar(cfg.cicloWorkerMs);
      await new Promise((ok) => servidor.listen(porta, ok));
      return servidor.address().port;
    },
    async parar() {
      worker.parar();
      await new Promise((ok) => servidor.close(() => ok()));
      await db.fechar();
    },
  };
}

module.exports = { criarApp, ROTAS };
