'use strict';
// Simulador da apresentação: dispara os cenários da matriz de aceite (AT-001 a AT-015) pelos mesmos serviços
// que a operação real usa. Só existe com SINAPSE_DEMO ligado e só para quem tem `demo.simular`.

const crypto = require('node:crypto');
const { validar, erro, ErroNegocio } = require('../../nucleo/erros');
const { auditar } = require('../../nucleo/registro');
const { relogio, HORA } = require('../../nucleo/relogio');
const entrada = require('../entrada/servico');
const ocorrencias = require('../ocorrencias/servico');
const clientes = require('../clientes/servico');
const supervisor = require('../supervisor/servico');
const { migrar, voltar } = require('../../db/migrar');
const seed = require('./seed');

const telDe = async (c, contaNome) => (await c.query(
  "SELECT p.telefone FROM pontos_focais p JOIN contas c ON c.id = p.conta_id WHERE c.nome = $1 AND p.vigente AND p.papel = 'principal'", [contaNome])).rows[0]?.telefone;

async function processar(deps, db) {
  const n = await deps.worker.executarPendentes();
  await supervisor.varreduraGlobal(db);
  return n;
}

const CENARIOS = {
  async mensagem_desconhecida({ db, ctx }) {
    const r = await entrada.receber(db, ctx.tenantId, 'whatsapp', { idMensagem: `wamid.sim-${crypto.randomUUID()}`, de: '(41) 99777-1234',
      nome: 'Desconhecido', texto: 'Oi, vocês podem me ajudar com uma notificação?' }, 'simulador');
    return { ...r, mensagem: 'Mensagem de número não cadastrado: ficou registrada e foi para a fila de Triagem com prazo (AT-001).' };
  },
  async webhook_triplo({ db, ctx }) {
    const tel = await db.comoTenant(ctx.tenantId, (c) => telDe(c, 'Logística Horizonte'));
    const corpo = { idMensagem: `wamid.sim-${crypto.randomUUID()}`, de: tel, nome: 'Henrique Dias', texto: 'A consulta deu erro na placa HZT2B22, não gerou nada hoje' };
    const r = [];
    for (let i = 0; i < 3; i++) r.push(await entrada.receber(db, ctx.tenantId, 'whatsapp', corpo, 'simulador'));
    return { resultados: r, mensagem: `O mesmo webhook chegou 3 vezes: 1 entrada processada e ${r.filter((x) => x.duplicada).length} repetições ignoradas e auditadas (AT-002).` };
  },
  async responsavel_indisponivel({ db, ctx }) {
    const r = await db.comoTenant(ctx.tenantId, async (c) => {
      const u = (await c.query("UPDATE usuarios SET disponivel = NOT disponivel WHERE email = 'rafael@sinapse.demo' RETURNING nome, disponivel")).rows[0];
      await auditar(c, ctx, { acao: 'usuario.disponibilidade', entidade: 'usuario', depois: u, motivo: 'Simulador' });
      return u;
    });
    return { mensagem: r.disponivel ? `${r.nome} voltou a ficar disponível.`
      : `${r.nome} ficou indisponível. Ao processar, as ocorrências dele vão para a substituta Bianca Rocha (AT-003).` };
  },
  async alternar_integracao({ db, ctx, corpo }) {
    const d = validar(corpo, { nome: { obrigatorio: true, tipo: 'texto', em: ['platform', 'omie', 'whatsapp', 'email'] } });
    const r = await db.comoTenant(ctx.tenantId, async (c) => {
      const x = (await c.query('UPDATE integracoes SET disponivel = NOT disponivel WHERE nome = $1 RETURNING nome, disponivel', [d.nome])).rows[0];
      await auditar(c, ctx, { acao: 'integracao.simulada', entidade: 'integracao', entidadeId: d.nome, depois: x, motivo: 'Simulador' });
      return x;
    });
    return { mensagem: `${r.nome}: ${r.disponivel ? 'voltou a responder' : 'agora está fora do ar (falhas vão para retentativa)'}.` };
  },
  async cliente_corrigiu({ db, ctx, corpo }) {
    const d = validar(corpo, { pendenciaId: { obrigatorio: true, tipo: 'uuid' } });
    const r = await db.comoTenant(ctx.tenantId, async (c) => {
      const p = (await c.query('SELECT conta_id, placa, erro_codigo FROM pendencias WHERE id = $1', [d.pendenciaId])).rows[0];
      if (!p) throw erro.naoEncontrado('Pendência');
      await c.query('UPDATE demo_platform_veiculos SET erro_codigo = NULL WHERE conta_id = $1 AND placa = $2', [p.conta_id, p.placa]);
      return p;
    });
    return { mensagem: `Na Platform, o cliente corrigiu ${r.placa}. Agora use "Revalidar" para o ERP confirmar tecnicamente.` };
  },
  async avancar_relogio({ db, deps, corpo }) {
    const d = validar(corpo, { horas: { obrigatorio: true, tipo: 'inteiro' } });
    if (d.horas < 1 || d.horas > 24 * 10) throw erro.entrada('Avance entre 1 hora e 10 dias.');
    await relogio.salvar(db, relogio.deslocamento() + d.horas * HORA);
    const n = await processar(deps, db);
    return { mensagem: `Relógio adiantado ${d.horas} h (agora: ${relogio.agora().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}). ${n} rotina(s) executada(s).` };
  },
  async processar_agora({ db, deps }) {
    const n = await processar(deps, db);
    return { mensagem: `${n} rotina(s) executada(s) agora.` };
  },
  async acesso_outro_tenant({ db, ctx, usuario }) {
    const alvo = (await db.query("SELECT o.id FROM ocorrencias o JOIN tenants t ON t.id = o.tenant_id WHERE t.slug = 'parceiro-demo' LIMIT 1")).rows[0];
    if (!alvo) return { mensagem: 'Não há outra organização de demonstração.' };
    try {
      await db.comoTenant(ctx.tenantId, (c) => ocorrencias.detalhe(c, usuario, alvo.id));
      return { mensagem: 'FALHA DE ISOLAMENTO: a ocorrência de outra organização foi lida.' };
    } catch (e) {
      if (!(e instanceof ErroNegocio) || e.status !== 404) throw e;
      await db.comoTenant(ctx.tenantId, (c) => auditar(c, ctx, { acao: 'acesso.negado_ou_inexistente', entidade: 'ocorrencia', entidadeId: alvo.id }));
      return { mensagem: 'Tentativa de abrir uma ocorrência da organização "Parceiro White-label": o banco não devolveu nada (Row Level Security) e o acesso foi auditado (AT-014).' };
    }
  },
  async bloqueio_inadimplencia({ db, ctx }) {
    const r = await db.comoTenant(ctx.tenantId, async (c) => {
      const conta = (await c.query("SELECT id FROM contas WHERE nome = 'Logística Horizonte'")).rows[0];
      return clientes.pedirBloqueio(c, ctx, conta.id, 'Simulador: pedido de bloqueio por atraso no pagamento');
    });
    return { mensagem: r.erro.message };
  },
};

let reiniciando = false;

module.exports = [
  { metodo: 'GET', caminho: '/api/demo/estado', permissao: 'demo.simular', demo: true,
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, async (c) => ({
      agora: relogio.agora(), deslocamentoHoras: Math.round(relogio.deslocamento() / HORA),
      integracoes: (await c.query('SELECT nome, disponivel FROM integracoes ORDER BY nome')).rows,
      rafaelDisponivel: (await c.query("SELECT disponivel FROM usuarios WHERE email = 'rafael@sinapse.demo'")).rows[0]?.disponivel,
      pendencias: (await c.query(`SELECT p.id, p.placa, p.erro_codigo, c.nome AS conta_nome FROM pendencias p JOIN contas c ON c.id = p.conta_id
        WHERE p.estado <> 'corrigida' ORDER BY c.nome, p.placa LIMIT 50`)).rows,
    })) },
  { metodo: 'POST', caminho: '/api/demo/cenarios/:nome', permissao: 'demo.simular', demo: true, descricao: 'usar o simulador',
    handler: async (args) => {
      const fn = CENARIOS[args.params.nome];
      if (!fn) throw erro.entrada('Cenário desconhecido.');
      return fn(args);
    } },
  { metodo: 'POST', caminho: '/api/demo/reiniciar', permissao: 'demo.simular', demo: true, descricao: 'reiniciar a demonstração',
    handler: async ({ db, cfg, deps }) => {
      const reais = (await db.query('SELECT count(*)::int AS n FROM tenants WHERE NOT demonstracao')).rows[0].n;
      if (reais) throw erro.regra('dados_reais', 'Existem organizações reais neste banco: a demonstração não pode ser reiniciada aqui.');
      if (reiniciando) throw erro.conflito('A demonstração já está sendo reiniciada.');
      reiniciando = true;
      deps.worker.parar();
      try {
        await voltar(db);
        await migrar(db);
        await relogio.salvar(db, 0);
        await seed.semearSeVazio(db, cfg);
      } finally {
        reiniciando = false;
        if (cfg.worker) deps.worker.iniciar(cfg.cicloWorkerMs);
      }
      return { mensagem: 'Demonstração reiniciada. Entre novamente.' };
    } },
];

module.exports.CENARIOS = CENARIOS;
