'use strict';
// Dados de DEMONSTRAÇÃO (empresas e pessoas fictícias). Só semeia quando não existe nenhuma organização:
// o boot nunca apaga nem sobrescreve dados reais. Os prazos são relativos ao relógio para a apresentação
// sempre ter rodadas em D-4, D-3 e D-1.

const { relogio, DIA, HORA } = require('../../nucleo/relogio');
const { ctxSistema } = require('../../nucleo/registro');
const { enfileirar } = require('../../jobs/fila');
const { hashSenha } = require('../identidade/servico');
const ocorrencias = require('../ocorrencias/servico');
const rodadas = require('../rodadas/servico');
const entrada = require('../entrada/servico');
const processos = require('../processos/servico');
const padroes = require('../processos/padroes');

const EQUIPES = [
  ['triagem', 'Triagem', false], ['suporte', 'Suporte', false], ['cs', 'Customer Success', false], ['operacoes', 'Operações', false],
  ['dev', 'Desenvolvimento', false], ['supervisao', 'Supervisão', false], ['contingencia', 'Contingência', true], ['financeiro', 'Financeiro', false],
];

const PESSOAS = [
  ['admin', 'Administração Sinapse', 'admin@sinapse.demo', 'admin', 'supervisao'],
  ['marina', 'Marina Costa', 'marina@sinapse.demo', 'supervisor', 'supervisao'],
  ['rafael', 'Rafael Lima', 'rafael@sinapse.demo', 'suporte', 'suporte'],
  ['bianca', 'Bianca Rocha', 'bianca@sinapse.demo', 'suporte', 'suporte'],
  ['juliana', 'Juliana Alves', 'juliana@sinapse.demo', 'cs', 'cs'],
  ['pedro', 'Pedro Santos', 'pedro@sinapse.demo', 'operacoes', 'operacoes'],
  ['lucas', 'Lucas Ferreira', 'lucas@sinapse.demo', 'dev', 'dev'],
  ['carla', 'Carla Mendes', 'carla@sinapse.demo', 'financeiro', 'financeiro'],
];

// Grupo de WhatsApp do cliente (id fictício do grupo no provedor).
const GRUPOS = { rotasul: '120363000000000001@g.us', horizonte: '120363000000000002@g.us', transminas: '120363000000000005@g.us', litoral: '120363000000000006@g.us' };

// [chave, nome, cnpj, segmento, vip, idOmie, situacaoOmie, excecao]
const CONTAS = [
  ['rotasul', 'Transportadora Rota Sul', '12345678000190', 'Transporte rodoviário · 620 veículos', true, 'OM-501', 'em_dia', null],
  ['horizonte', 'Logística Horizonte', '23456789000101', 'Logística · 85 veículos', false, 'OM-502', 'em_atraso', null],
  ['valeverde', 'Expresso Vale Verde', '34567890000112', 'Fretamento · 410 veículos', true, 'OM-503', 'em_dia', null],
  ['nordeste', 'Frota Nordeste Cargas', '45678901000123', 'Cargas · 60 veículos', false, 'OM-999', null, null],
  ['transminas', 'TransMinas Fretes', '56789012000134', 'Fretes · 140 veículos', false, 'OM-505', 'em_dia', 'cs'],
  ['litoral', 'Cargas Litoral', '67890123000145', 'Cargas · 95 veículos', false, 'OM-506', 'em_dia', null],
];

// Pontos focais: [conta, papel, nome, telefone, email, consentimentoWhatsapp]
const PONTOS_FOCAIS = [
  ['rotasul', 'principal', 'Fernanda Ribeiro', '+5511987654321', 'fernanda@rotasul.example', true],
  ['rotasul', 'suplente', 'Gustavo Prado', '+5511976543210', 'gustavo@rotasul.example', true],
  ['horizonte', 'principal', 'Henrique Dias', '+5521998765432', 'henrique@horizonte.example', true],
  ['valeverde', 'principal', 'Isabela Nunes', '+5531987651234', 'isabela@valeverde.example', false],
  ['valeverde', 'suplente', 'João Martins', '+5531976540987', 'joao@valeverde.example', true],
  ['transminas', 'principal', 'Karina Lopes', '+5531965432109', 'karina@transminas.example', true],
  ['litoral', 'principal', 'Leonardo Souza', '+5513991234567', 'leonardo@litoral.example', true],
];

// Veículos no simulador da Platform: [conta, placa, erro]
const VEICULOS = [
  ['rotasul', 'RSU1A23', null], ['rotasul', 'RSU2B34', 'SNE_VINCULO_AUSENTE'], ['rotasul', 'RSU3C45', 'SNE_VINCULO_AUSENTE'],
  ['rotasul', 'RSU4D56', null], ['rotasul', 'RSU5E67', 'CERT_EXPIRADO'], ['rotasul', 'RSU6F78', null], ['rotasul', 'RSU7G89', null],
  ['horizonte', 'HZT1A11', 'GOVBR_2FA'], ['horizonte', 'HZT2B22', null], ['horizonte', 'HZT3C33', 'RENAVAM_DIVERGENTE'], ['horizonte', 'HZT4D44', null],
  ['valeverde', 'VVD1A01', null], ['valeverde', 'VVD2B02', 'CRED_INVALIDA'], ['valeverde', 'VVD3C03', null], ['valeverde', 'VVD4D04', null],
  ['nordeste', 'NDE1A10', 'SNE_VINCULO_AUSENTE'], ['nordeste', 'NDE2B20', null],
  ['transminas', 'TMF1A90', null], ['transminas', 'TMF2B80', 'CERT_EXPIRADO'], ['transminas', 'TMF3C70', null],
  ['litoral', 'CLT1A55', 'TIMEOUT_CONSULTA'], ['litoral', 'CLT2B66', null], ['litoral', 'CLT3C77', 'SNE_VINCULO_AUSENTE'],
];

// Rodadas: [conta, produto, dias até D0]. D0 às 10h (Brasília).
const RODADAS = [
  ['rotasul', 'Multas e Notificações', 4], ['horizonte', 'Multas e Notificações', 3], ['valeverde', 'Licenciamento', 6],
  ['nordeste', 'Multas e Notificações', 2], ['transminas', 'Multas e Notificações', -2], ['litoral', 'Indicação de Condutores', 1],
];

const FERIADOS = [['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'], ['2026-11-20', 'Consciência Negra'],
  ['2026-12-25', 'Natal'], ['2027-01-01', 'Confraternização Universal']];

function d0Em(dias) {
  const a = relogio.agora();
  return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate() + dias, 13, 0, 0)); // 10h BRT
}

async function semearSeVazio(db, cfg, log = () => {}) {
  const n = (await db.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n;
  if (n > 0) return false;
  const brobot = await semearTenant(db, cfg, { slug: 'brobot', nome: 'Brobot' }, true);
  await semearParceiro(db);
  log(`Dados de demonstração criados (organização ${brobot}).`);
  return true;
}

async function criarTenantBase(db, { slug, nome }, equipes) {
  const t = (await db.query("INSERT INTO tenants (slug, nome, demonstracao, config) VALUES ($1, $2, true, '{}') RETURNING id", [slug, nome])).rows[0];
  await db.comoTenant(t.id, async (c) => {
    for (const [codigo, nomeEq, cont] of equipes) {
      await c.query('INSERT INTO equipes (tenant_id, codigo, nome, contingencia) VALUES ($1,$2,$3,$4)', [t.id, codigo, nomeEq, cont]);
    }
    for (const nomeI of ['platform', 'omie', 'whatsapp', 'email']) {
      await c.query('INSERT INTO integracoes (tenant_id, nome) VALUES ($1, $2)', [t.id, nomeI]);
    }
    const ctx = ctxSistema(t.id, 'implantação');
    await enfileirar(c, ctx, { tipo: 'supervisor.varrer', chave: 'recorrente:supervisor', maxTentativas: 1000 });
    await enfileirar(c, ctx, { tipo: 'omie.sincronizar', chave: 'recorrente:omie', maxTentativas: 1000 });
    await enfileirar(c, ctx, { tipo: 'processos.despachar', chave: 'recorrente:processos', maxTentativas: 1000 });
    await enfileirar(c, ctx, { tipo: 'processos.agenda', chave: 'recorrente:agenda', maxTentativas: 1000 });
    await padroes.garantir(c, ctx, processos);
  });
  return t.id;
}

async function semearTenant(db, cfg, base) {
  const tenantId = await criarTenantBase(db, base, EQUIPES);
  const ids = { u: {}, conta: {}, pf: {} };
  await db.comoTenant(tenantId, async (c) => {
    const eq = Object.fromEntries((await c.query('SELECT codigo, id FROM equipes')).rows.map((r) => [r.codigo, r.id]));
    for (const [k, nome, email, papel, equipe] of PESSOAS) {
      const senha = k === 'admin' && cfg.senhaAdmin ? hashSenha(cfg.senhaAdmin) : null;
      ids.u[k] = (await c.query('INSERT INTO usuarios (tenant_id, nome, email, senha_hash, papel, equipe_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [tenantId, nome, email, senha, papel, eq[equipe]])).rows[0];
    }
    await c.query('UPDATE usuarios SET substituto_id = $2 WHERE id = $1', [ids.u.rafael.id, ids.u.bianca.id]);
    await c.query('UPDATE usuarios SET substituto_id = $2 WHERE id = $1', [ids.u.juliana.id, ids.u.marina.id]);
    for (const [d, nome] of FERIADOS) await c.query('INSERT INTO feriados (tenant_id, data, nome) VALUES ($1,$2,$3)', [tenantId, d, nome]);

    for (const [k, nome, cnpj, seg, vip, idOmie, situacao, excecao] of CONTAS) {
      ids.conta[k] = (await c.query(
        `INSERT INTO contas (tenant_id, nome, cnpj, segmento, vip, vip_criterio, vip_aprovador, vip_validade, id_platform, id_omie,
           roteamento_excecao, roteamento_justificativa) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [tenantId, nome, cnpj, seg, vip, vip ? 'Frota acima de 400 veículos' : null, vip ? 'Diretoria de CS' : null, vip ? '2027-06-30' : null,
          `PLT-${cnpj.slice(0, 4)}`, idOmie, excecao, excecao ? 'Conta em recuperação: acompanhamento do CS até dez/2026' : null])).rows[0];
      if (situacao) await c.query('INSERT INTO demo_omie (tenant_id, id_omie, situacao) VALUES ($1,$2,$3)', [tenantId, idOmie, situacao]);
      if (GRUPOS[k]) await c.query('UPDATE contas SET grupo_whatsapp = $2 WHERE id = $1', [ids.conta[k].id, GRUPOS[k]]);
    }
    for (const [conta, papel, nome, tel, email, consent] of PONTOS_FOCAIS) {
      ids.pf[`${conta}:${papel}`] = (await c.query(
        `INSERT INTO pontos_focais (tenant_id, conta_id, papel, nome, telefone, email, consentimento_whatsapp) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [tenantId, ids.conta[conta].id, papel, nome, tel, email, consent])).rows[0];
    }
    for (const [conta, placa, erroCod] of VEICULOS) {
      await c.query('INSERT INTO demo_platform_veiculos (tenant_id, conta_id, placa, erro_codigo) VALUES ($1,$2,$3,$4)', [tenantId, ids.conta[conta].id, placa, erroCod]);
    }
    const creds = [['rotasul', 'sne', 'vinculo_sne'], ['rotasul', 'certificado', 'expirada'], ['horizonte', 'govbr', '2fa_pendente'],
      ['valeverde', 'portal_detran', 'invalida'], ['nordeste', 'govbr', 'ok'], ['transminas', 'certificado', 'expirada'], ['litoral', 'sne', 'ok']];
    for (const [conta, tipo, status] of creds) {
      await c.query(`INSERT INTO credenciais_ref (tenant_id, conta_id, tipo, status, expira_em, referencia_platform) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, ids.conta[conta].id, tipo, status, status === 'expirada' ? '2026-10-30' : '2027-03-31', `cred-ref-${conta}-${tipo}`]);
    }
    const ctx = ctxSistema(tenantId, 'implantação');
    for (const [conta, produto, dias] of RODADAS) {
      const r = (await c.query('INSERT INTO rodadas (tenant_id, conta_id, id_platform, produto, agendada_para) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [tenantId, ids.conta[conta].id, `RD-${conta.toUpperCase()}-${dias + 10}`, produto, d0Em(dias)])).rows[0];
      await rodadas.agendar(c, ctx, r);
    }
  });
  await semearOcorrencias(db, tenantId, ids);
  return tenantId;
}

async function semearOcorrencias(db, tenantId, ids) {
  const ctxDe = (k) => ({ tenantId, usuario: { ...ids.u[k], equipe_id: ids.u[k].equipe_id }, correlacao: null });
  const em = (h) => new Date(relogio.agora().getTime() + h * HORA).toISOString();
  await db.comoTenant(tenantId, async (c) => {
    const sis = ctxSistema(tenantId, 'implantação');
    const a = await ocorrencias.criar(c, sis, { origem: 'whatsapp', contaId: ids.conta.rotasul.id, tipo: 'duvida', prioridade: 'media',
      pontoFocalId: ids.pf['rotasul:principal'].id, titulo: 'Como exportar o relatório de multas por filial?', conversaChave: 'whatsapp:+5511987654321' });
    await ocorrencias.transicionar(c, ctxDe('juliana'), a.id, 'assumir', {});
    await ocorrencias.responder(c, ctxDe('juliana'), a.id, 'Oi, Fernanda! Em Relatórios > Multas use o filtro "Filial" e clique em Exportar. Posso te mostrar numa chamada rápida?');

    const b = await ocorrencias.criar(c, sis, { origem: 'email', contaId: ids.conta.horizonte.id, tipo: 'erro_consulta', prioridade: 'alta',
      pontoFocalId: ids.pf['horizonte:principal'].id, titulo: 'Consulta não gerada para 3 placas novas', conversaChave: 'email:henrique@horizonte.example' });
    await ocorrencias.transicionar(c, ctxDe('rafael'), b.id, 'assumir', {});
    await ocorrencias.transicionar(c, ctxDe('rafael'), b.id, 'aguardar_cliente', { motivo: 'Cliente vai reenviar planilha com Renavam', revisaoEm: em(20) });

    await ocorrencias.criar(c, sis, { origem: 'portal', contaId: ids.conta.valeverde.id, tipo: 'solicitacao', prioridade: 'media',
      pontoFocalId: ids.pf['valeverde:suplente'].id, titulo: 'Inclusão de 40 placas novas da filial BH' });
    await ocorrencias.criar(c, sis, { origem: 'whatsapp', contaId: ids.conta.transminas.id, tipo: 'credencial', prioridade: 'alta',
      pontoFocalId: ids.pf['transminas:principal'].id, titulo: 'Certificado digital vencido: consultas paradas' });

    const e = await ocorrencias.criar(c, sis, { origem: 'platform', contaId: ids.conta.litoral.id, tipo: 'tecnica', prioridade: 'alta',
      titulo: 'Timeout recorrente na consulta do DETRAN-SP' });
    await ocorrencias.transicionar(c, ctxDe('bianca'), e.id, 'assumir', {});
    await ocorrencias.transicionar(c, ctxDe('bianca'), e.id, 'solicitar_handoff', { paraEquipe: 'dev', motivo: 'Erro técnico de consulta: precisa de análise do Desenvolvimento' });

    const f = await ocorrencias.criar(c, sis, { origem: 'whatsapp', contaId: ids.conta.rotasul.id, tipo: 'solicitacao', prioridade: 'baixa',
      pontoFocalId: ids.pf['rotasul:suplente'].id, titulo: 'Acesso para novo analista de frota', conversaChave: 'whatsapp:+5511976543210' });
    await ocorrencias.transicionar(c, ctxDe('juliana'), f.id, 'assumir', {});
    await ocorrencias.transicionar(c, ctxDe('juliana'), f.id, 'resolver', { codigoDesfecho: 'configurado',
      evidencia: 'Usuário criado na Platform (perfil Analista) e acesso confirmado pelo Gustavo por WhatsApp.' });
  });
  await entrada.receber(db, tenantId, 'whatsapp', { idMensagem: 'wamid.demo-0001', de: '(11) 98888-7777', nome: 'Número desconhecido',
    texto: 'Bom dia, preciso de ajuda com o sistema' }, 'demonstração');
  await entrada.receber(db, tenantId, 'email', { idMensagem: '<demo-0002@horizonte.example>', de: 'henrique@horizonte.example', nome: 'Henrique Dias',
    assunto: 'Dúvida: onde vejo o comprovante de indicação de condutor?', texto: 'Olá, onde vejo o comprovante da indicação de condutor feita ontem?' }, 'demonstração');
}

async function semearParceiro(db) {
  const tid = await criarTenantBase(db, { slug: 'parceiro-demo', nome: 'Parceiro White-label (demo)' },
    [['triagem', 'Triagem', false], ['suporte', 'Suporte', false], ['supervisao', 'Supervisão', false], ['contingencia', 'Contingência', true]]);
  await db.comoTenant(tid, async (c) => {
    const eq = (await c.query("SELECT id FROM equipes WHERE codigo = 'supervisao'")).rows[0].id;
    await c.query('INSERT INTO usuarios (tenant_id, nome, email, papel, equipe_id) VALUES ($1,$2,$3,$4,$5)', [tid, 'Ana Parceira', 'ana@parceiro.demo', 'supervisor', eq]);
    const conta = (await c.query("INSERT INTO contas (tenant_id, nome, cnpj) VALUES ($1, 'Cliente do Parceiro', '99887766000155') RETURNING id", [tid])).rows[0];
    await ocorrencias.criar(c, ctxSistema(tid, 'implantação'), { origem: 'api', contaId: conta.id, tipo: 'duvida', prioridade: 'baixa',
      titulo: 'Ocorrência confidencial do parceiro' });
  });
}

module.exports = { semearSeVazio };
