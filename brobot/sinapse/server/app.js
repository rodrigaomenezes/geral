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
const motor = require('./modulos/processos/motor');
const agenda = require('./modulos/agenda/servico');
const telefonia = require('./modulos/telefonia/servico');
const path = require('node:path');
const os = require('node:os');
const whatsappQr = require('./modulos/integracoes/whatsapp-qr');
const { garantirUsuariosTeste } = require('./modulos/identidade/usuarios-teste');
const { aplicarStatus } = require('./modulos/integracoes/whatsapp-status');
const { normalizarTelefone } = require('./nucleo/telefone');
const seed = require('./modulos/demo/seed');

const ROTAS = [
  ...require('./modulos/identidade/rotas'),
  ...require('./modulos/ocorrencias/rotas'),
  ...require('./modulos/clientes/rotas'),
  ...require('./modulos/onboarding/rotas'),
  ...require('./modulos/monitoramento/rotas'),
  ...require('./modulos/treinamentos/rotas'),
  ...require('./modulos/rodadas/rotas'),
  ...require('./modulos/entrada/rotas'),
  ...require('./modulos/supervisor/rotas'),
  ...require('./modulos/painel/rotas'),
  ...require('./modulos/comunicacao/rotas'),
  ...require('./modulos/processos/rotas'),
  ...require('./modulos/agenda/rotas'),
  ...require('./modulos/comercial/rotas'),
  ...require('./modulos/integracoes/csv/rotas'),
  ...require('./modulos/telefonia/rotas'),
  ...require('./modulos/integracoes/whatsapp-rotas'),
  ...require('./modulos/demo/rotas'),
];

function handlersDeJobs(db) {
  return {
    'entrada.processar': entrada.processar,
    'rodada.pre_rodada': rodadas.jobPreRodada,
    'rodada.executar': rodadas.jobExecutar,
    'comunicacao.enviar': comunicacao.jobEnviar,
    'supervisor.varrer': async (c, ctx, p, job) => ({
      ...(await supervisor.jobVarrer(c, ctx, p, job)),
      depois: () => supervisor.varreduraGlobal(db),
    }),
    'omie.sincronizar': omieSync.jobSincronizar,
    'processos.despachar': motor.jobDespachar,
    'processos.agenda': motor.jobAgenda,
    'processo.avancar': motor.jobAvancar,
    'lembretes.avisar': agenda.jobAvisar,
    'telefonia.manutencao': telefonia.jobManutencao,
    // Item que esgotou as tentativas: efeitos de "falhou" ficam visíveis (RN-015).
    __aoMorrer: async (job) => {
      if (job.tipo === 'comunicacao.enviar') await db.comoTenant(job.tenant_id, (c) => comunicacao.aoFalharEnvio(c, job.payload));
    },
  };
}

/** WhatsApp por QR: sessão no Volume; o que chega vira entrada (deduplicada), o que o celular mandou vai ao histórico. */
function ligarWhatsappQr(db, cfg, log) {
  whatsappQr.configurar({
    db, log,
    pasta: cfg.dirDados ? path.join(path.dirname(cfg.dirDados), 'wa-sessoes') : path.join(os.tmpdir(), `sinapse-wa-${process.pid}`),
    aoReceber: (n, m) => entrada.receber(db, n.tenant_id, 'whatsapp', { idMensagem: m.id, de: m.numero, nome: m.nome || undefined, texto: m.texto }, 'whatsapp QR'),
    aoEco: (n, m) => db.comoTenant(n.tenant_id, async (c) => {
      if ((await c.query('SELECT 1 FROM interacoes WHERE id_externo = $1', [m.id])).rowCount) return; // já registrada (saiu pelo sistema)
      const tel = normalizarTelefone(m.numero);
      const oc = (await c.query(`SELECT id, conta_id FROM ocorrencias WHERE conversa_chave = $1 ORDER BY criado_em DESC LIMIT 1`, [`whatsapp:${tel}`])).rows[0];
      await c.query(`INSERT INTO interacoes (tenant_id, ocorrencia_id, conta_id, canal, direcao, destinatario, texto, status_entrega, id_externo, remetente)
        VALUES ($1,$2,$3,'whatsapp','saida',$4,$5,'enviada',$6,'celular da empresa')`, [n.tenant_id, oc?.id || null, oc?.conta_id || null, tel, m.texto.slice(0, 4000), m.id]);
    }),
    aoStatus: (n, id, st) => db.comoTenant(n.tenant_id, (c) => aplicarStatus(c, id, st)),
  });
}

async function criarApp(cfg, { log = console.log } = {}) {
  const db = await abrirBanco({ url: cfg.databaseUrl, dir: cfg.dirDados, tls: cfg.dbTls, log });
  if (cfg.demo) log('Modo DEMONSTRAÇÃO ligado: login por persona sem senha e dados fictícios. Não use com dados reais.');
  await migrar(db, log);
  await relogio.carregar(db);
  if (cfg.demo) await seed.semearSeVazio(db, cfg, log);
  await garantirUsuariosTeste(db, cfg, log);
  const worker = criarWorker(db, handlersDeJobs(db), { log });
  ligarWhatsappQr(db, cfg, log);
  const deps = { worker, log };
  const servidor = criarServidor({ db, cfg, rotas: ROTAS, deps, log });
  return {
    db, worker, servidor,
    async iniciar(porta) {
      await supervisor.varreduraGlobal(db);
      if (cfg.worker) worker.iniciar(cfg.cicloWorkerMs);
      await new Promise((ok) => servidor.listen(porta, ok));
      if (cfg.worker) whatsappQr.religarTodos().catch((e) => log(`WhatsApp QR: ${e.message}`));
      return servidor.address().port;
    },
    async parar() {
      worker.parar();
      await whatsappQr.pararTodos();
      await new Promise((ok) => servidor.close(() => ok()));
      await db.fechar();
    },
  };
}

module.exports = { criarApp, ROTAS };
