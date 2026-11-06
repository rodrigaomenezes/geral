'use strict';
// Implantação de uma organização (GOV-001): equipes, integrações, rotinas do supervisor e dos processos, processos
// padrão e a sugestão da matriz RACI. Usada pela demonstração e pela implantação real (sem dados fictícios).
// Implantação real: com SINAPSE_DEMO desligado e o banco sem nenhuma organização, cria a organização e a primeira
// pessoa da Administração a partir de SINAPSE_ADMIN_EMAIL + SINAPSE_SENHA_ADMIN. Nunca mexe em organização existente.

const { ctxSistema, auditar } = require('../../nucleo/registro');
const { enfileirar } = require('../../jobs/fila');
const { hashSenha } = require('../identidade/servico');
const processos = require('../processos/servico');
const padroes = require('../processos/padroes');
const governanca = require('../governanca/servico');

const EQUIPES_PADRAO = [
  ['triagem', 'Triagem', false], ['suporte', 'Suporte', false], ['cs', 'Customer Success', false], ['operacoes', 'Operações', false],
  ['dev', 'Desenvolvimento', false], ['supervisao', 'Supervisão', false], ['contingencia', 'Contingência', true], ['financeiro', 'Financeiro', false],
  ['comercial', 'Comercial', false],
];

// Feriados nacionais (Lei 662/1949, 6.802/1980, 14.759/2023). Estaduais e municipais entram pela configuração.
const FERIADOS_NACIONAIS = [
  ['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'], ['2026-11-20', 'Consciência Negra'], ['2026-12-25', 'Natal'],
  ['2027-01-01', 'Confraternização Universal'], ['2027-03-26', 'Sexta-feira Santa'], ['2027-04-21', 'Tiradentes'], ['2027-05-01', 'Dia do Trabalho'],
  ['2027-09-07', 'Independência'], ['2027-10-12', 'Nossa Senhora Aparecida'], ['2027-11-02', 'Finados'], ['2027-11-15', 'Proclamação da República'],
  ['2027-11-20', 'Consciência Negra'], ['2027-12-25', 'Natal'],
];

async function criarOrganizacao(db, { slug, nome, demonstracao }, equipes = EQUIPES_PADRAO) {
  const t = (await db.query("INSERT INTO tenants (slug, nome, demonstracao, config) VALUES ($1, $2, $3, '{}') RETURNING id", [slug, nome, demonstracao])).rows[0];
  await db.comoTenant(t.id, async (c) => {
    for (const [codigo, nomeEq, cont] of equipes) {
      await c.query('INSERT INTO equipes (tenant_id, codigo, nome, contingencia) VALUES ($1,$2,$3,$4)', [t.id, codigo, nomeEq, cont]);
    }
    for (const nomeI of ['platform', 'omie', 'whatsapp', 'email']) {
      await c.query('INSERT INTO integracoes (tenant_id, nome) VALUES ($1, $2)', [t.id, nomeI]);
    }
    const ctx = ctxSistema(t.id, 'implantação');
    for (const [tipo, chave] of [['supervisor.varrer', 'supervisor'], ['omie.sincronizar', 'omie'], ['processos.despachar', 'processos'],
      ['processos.agenda', 'agenda'], ['lembretes.avisar', 'lembretes'], ['telefonia.manutencao', 'telefonia']]) {
      await enfileirar(c, ctx, { tipo, chave: `recorrente:${chave}`, maxTentativas: 1000 });
    }
    await c.query("INSERT INTO telefonia_config (tenant_id, provedor, celular) VALUES ($1, 'treino', true) ON CONFLICT DO NOTHING", [t.id]);
    await padroes.garantir(c, ctx, processos);
    await governanca.aplicarSugestao(c, ctx);
  });
  return t.id;
}

/** Implantação real no primeiro boot sem demonstração. Devolve o que fez (para o log). */
async function implantarSeVazio(db, cfg, log = () => {}) {
  if (cfg.demo) return { feito: false };
  const n = (await db.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n;
  if (n > 0) return { feito: false };
  if (!cfg.adminEmail || !cfg.senhaAdmin) {
    log('Banco sem organização. Para implantar, crie SINAPSE_ADMIN_EMAIL e SINAPSE_SENHA_ADMIN (12+ caracteres) e reinicie.');
    return { feito: false, faltando: true };
  }
  const tid = await criarOrganizacao(db, { slug: 'brobot', nome: cfg.organizacao || 'Brobot', demonstracao: false });
  await db.comoTenant(tid, async (c) => {
    for (const [d, nome] of FERIADOS_NACIONAIS) await c.query('INSERT INTO feriados (tenant_id, data, nome) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [tid, d, nome]);
    const eq = (await c.query("SELECT id FROM equipes WHERE codigo = 'supervisao'")).rows[0].id;
    const u = (await c.query(`INSERT INTO usuarios (tenant_id, nome, email, senha_hash, papel, equipe_id) VALUES ($1, 'Administração', $2, $3, 'admin', $4) RETURNING id`,
      [tid, cfg.adminEmail.toLowerCase(), hashSenha(cfg.senhaAdmin), eq])).rows[0];
    await auditar(c, ctxSistema(tid, 'implantação'), { acao: 'organizacao.implantada', entidade: 'usuario', entidadeId: u.id, depois: { papel: 'admin' } });
  });
  log(`Organização implantada (${cfg.organizacao || 'Brobot'}). Entre com ${cfg.adminEmail.replace(/^(.).*@/, '$1…@')} e troque a senha.`);
  return { feito: true, tenantId: tid };
}

module.exports = { criarOrganizacao, implantarSeVazio, EQUIPES_PADRAO, FERIADOS_NACIONAIS };
