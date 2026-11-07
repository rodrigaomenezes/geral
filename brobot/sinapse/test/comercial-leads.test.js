'use strict';
// F26 · CRM-002: lead de fora do sistema por webhook (idempotente, sem duplicar contato, com dono distribuído).
// CRM-004/CRM-015: probabilidade por etapa configurável por organização e fórmula em vigor na tela.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { previsao, probabilidades, PROBABILIDADE } = require('../server/modulos/comercial/funil');

let t; let patricia;
before(async () => { t = await subir(); patricia = await t.entrarComo('Patrícia Gomes'); });
after(async () => { await t.parar(); });

const lead = (corpo, token = t.TOKEN, org = 'brobot') => fetch(`${t.base}/api/leads/${org}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-sinapse-token': token }, body: JSON.stringify(corpo) })
  .then(async (r) => ({ status: r.status, corpo: await r.json() }));

test('CRM-002: lead do site vira "Novo lead" com dono; repetir o mesmo lead não duplica', async () => {
  const abertas = async (nome) => (await t.sql(`SELECT count(*)::int AS n FROM oportunidades o JOIN usuarios u ON u.id = o.responsavel_id
    WHERE u.nome = $1 AND o.etapa IN ('novo','qualificacao','demonstracao','proposta','teste','negociacao')`, [nome]))[0].n;
  const [antesP, antesD] = [await abertas('Patrícia Gomes'), await abertas('Diego Araújo')];
  const esperado = antesP === antesD ? 'Diego Araújo' : antesP < antesD ? 'Patrícia Gomes' : 'Diego Araújo';
  const corpo = { idLead: 'site-2026-0001', empresa: 'Transportes Aurora', contatoNome: 'Lívia Campos', contatoTelefone: '(41) 99876-5544',
    contatoEmail: 'Livia@Aurora.example', origem: 'site', frota: 150, mensagem: 'Quero uma demonstração do painel de multas' };
  const r = await lead(corpo);
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.responsavel, esperado, 'dono = Comercial disponível com menos oportunidades em andamento');
  const [o] = await t.sql('SELECT etapa, origem, contato_telefone, contato_email, frota, proxima_acao, proxima_acao_em FROM oportunidades WHERE id = $1', [r.corpo.oportunidadeId]);
  assert.deepEqual([o.etapa, o.origem, o.contato_telefone, o.contato_email, o.frota], ['novo', 'site', '+5541998765544', 'livia@aurora.example', 150]);
  assert.ok(o.proxima_acao && o.proxima_acao_em, 'chega com próxima ação');
  const [aud] = await t.sql("SELECT ator_nome, motivo FROM auditoria WHERE entidade_id = $1 AND acao = 'oportunidade.criada'", [r.corpo.oportunidadeId]);
  assert.match(aud.ator_nome, /captura de lead/);
  assert.equal(aud.motivo, 'Quero uma demonstração do painel de multas');

  const de = await lead(corpo);
  assert.equal(de.status, 200);
  assert.deepEqual([de.corpo.duplicada, de.corpo.oportunidadeId], [true, r.corpo.oportunidadeId]);
  const mesmos = await Promise.all([1, 2, 3].map(() => lead({ ...corpo, idLead: 'site-2026-0002', contatoTelefone: '(41) 3333-1111', contatoEmail: 'outro@aurora2.example', empresa: 'Aurora Filial' })));
  assert.equal(mesmos.filter((x) => x.status === 201).length, 1, 'três envios simultâneos: uma oportunidade');
  assert.equal((await t.sql("SELECT count(*)::int AS n FROM oportunidades WHERE id_externo = 'site-2026-0002'"))[0].n, 1);
});

test('CRM-002: mesmo contato com oportunidade em andamento não abre outra; o pedido fica registrado nela', async () => {
  const r = await lead({ idLead: 'evento-77', empresa: 'Transportes Aurora (evento)', contatoNome: 'Lívia', contatoEmail: 'livia@aurora.example', origem: 'evento',
    mensagem: 'Passou no estande e pediu contato de novo' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.motivo, 'contato com oportunidade em andamento');
  const [aud] = await t.sql("SELECT motivo FROM auditoria WHERE entidade_id = $1 AND acao = 'oportunidade.lead_repetido'", [r.corpo.oportunidadeId]);
  assert.equal(aud.motivo, 'Passou no estande e pediu contato de novo');
});

test('CRM-002: token, organização e dados são conferidos', async () => {
  const base = { idLead: 'x-1', empresa: 'Empresa Teste', contatoNome: 'Fulano', contatoTelefone: '(11) 98888-1111' };
  assert.equal((await lead(base, 'token-errado')).status, 401);
  assert.equal((await lead(base, t.TOKEN, 'nao-existe')).status, 404);
  assert.equal((await lead({ ...base, contatoTelefone: undefined })).status, 400, 'telefone ou e-mail');
  assert.equal((await lead({ ...base, contatoTelefone: '123' })).status, 400, 'telefone inválido');
  assert.equal((await lead({ ...base, origem: 'base' })).status, 400, 'origem "base" é só da carteira');
  const parceiro = await lead({ ...base, idLead: 'parc-1' }, t.TOKEN, 'parceiro-demo');
  assert.equal(parceiro.status, 201, 'cada organização recebe os seus');
  assert.equal(parceiro.corpo.responsavel, null, 'sem Comercial na organização: fica sem dono');
  const [o] = await t.sql('SELECT t.slug FROM oportunidades o JOIN tenants t ON t.id = o.tenant_id WHERE o.id = $1', [parceiro.corpo.oportunidadeId]);
  assert.equal(o.slug, 'parceiro-demo');
});

test('CRM-004/CRM-015: probabilidade por etapa da organização entra na previsão e na fórmula', async () => {
  assert.deepEqual(probabilidades({ proposta: 70, teste: 'x', novo: 150 }), { ...PROBABILIDADE, proposta: 0.7 }, 'inválido volta ao padrão');
  const linhas = [{ etapa: 'proposta', valor_mensal: 1000, fechamento_previsto: '2026-11-20' }];
  const hoje = new Date('2026-11-07T12:00:00Z');
  assert.equal(previsao(linhas, 1, hoje).meses[0].ponderado, 500);
  const p = previsao(linhas, 1, hoje, probabilidades({ proposta: 70 }));
  assert.equal(p.meses[0].ponderado, 700);
  assert.match(p.formula, /Proposta 70%/);

  await t.sql(`UPDATE tenants SET config = config || '{"comercial": {"probabilidades": {"proposta": 70}}}'::jsonb WHERE slug = 'brobot'`);
  const ind = (await patricia.get('/comercial/indicadores')).corpo;
  assert.match(ind.previsao.formula, /Proposta 70%/);
  assert.equal(ind.previsao.probabilidade.proposta, 0.7);
  assert.equal((await patricia.get('/comercial/catalogo')).corpo.probabilidade.proposta, 0.7, 'a tela recebe a da organização');
  await t.sql("UPDATE tenants SET config = config - 'comercial' WHERE slug = 'brobot'");
});
