'use strict';
// F3b · Comercial: funis de expansão e renovação (cliente da carteira, CS encaminha), pessoas da negociação sem
// duplicar e previsão de fechamento ponderada por etapa.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { previsao } = require('../server/modulos/comercial/funil');
const { subir } = require('./ajuda');

test('previsão: valor × probabilidade por mês; sem data e atrasadas contadas à parte (regra pura)', () => {
  const r = previsao([
    { etapa: 'proposta', valor_mensal: '1000', fechamento_previsto: '2026-11-28' },
    { etapa: 'negociacao', valor_mensal: '2000', fechamento_previsto: '2026-12-15' },
    { etapa: 'novo', valor_mensal: '500' },
    { etapa: 'teste', valor_mensal: '300', fechamento_previsto: '2026-10-10' },
    { etapa: 'ganha', valor_mensal: '9999', fechamento_previsto: '2026-11-01' },
  ], 2, new Date('2026-11-04T13:00:00Z'));
  assert.deepEqual(r.meses.map((m) => [m.mes, m.ponderado, m.bruto, m.oportunidades]), [['2026-11', 500, 1000, 1], ['2026-12', 1600, 2000, 1]]);
  assert.deepEqual([r.semData, r.atrasadas], [1, 1]);
  assert.match(r.formula, /probabilidade da etapa/);
});

let t; let pat; let juliana;
before(async () => {
  t = await subir(); pat = await t.entrarComo('Patrícia Gomes'); juliana = await t.entrarComo('Juliana Alves');
  // Contrato atual das contas usadas aqui (a demonstração não preenche produtos e valor).
  await t.sql("UPDATE contas SET produtos = '{multas}', valor_mensal = 2000 WHERE nome IN ('Transportadora Rota Sul', 'Cargas Litoral')");
});
after(async () => { await t.parar(); });

const conta = async (nome) => (await t.sql('SELECT id, cnpj, produtos, valor_mensal FROM contas WHERE nome = $1', [nome]))[0];
const mover = (op, para, extra = {}) => pat.post(`/comercial/oportunidades/${op.id}/etapa`, { para, ...extra });

test('CS encaminha expansão ao Comercial: fica na fila sem dono, com a observação e o cliente da carteira', async () => {
  const c = await conta('Logística Horizonte');
  assert.equal((await pat.post('/comercial/encaminhar', { contaId: c.id, funil: 'expansao', observacao: 'Quer o CaçaCondutores' })).status, 403, 'Comercial cria direto, não encaminha');
  const r = await juliana.post('/comercial/encaminhar', { contaId: c.id, funil: 'expansao', observacao: 'Cliente pediu o CaçaCondutores na reunião' });
  assert.equal(r.status, 201);
  assert.deepEqual([r.corpo.funil, r.corpo.empresa, r.corpo.cnpj, r.corpo.responsavel_id, r.corpo.origem], ['expansao', 'Logística Horizonte', c.cnpj, null, 'base']);
  const d = (await pat.get(`/comercial/oportunidades/${r.corpo.id}`)).corpo;
  assert.equal(d.encaminhada_por_nome, 'Juliana Alves');
  assert.equal(d.atividades.itens[0].resultado, 'Cliente pediu o CaçaCondutores na reunião');
  assert.equal((await juliana.post('/comercial/encaminhar', { contaId: c.id, funil: 'aquisicao', observacao: 'teste de funil' })).status, 400);
  const me = (await pat.get('/sessao')).corpo;
  const assumida = await pat.post(`/comercial/oportunidades/${r.corpo.id}`, { responsavelId: me.usuario.id, versao: d.version });
  assert.equal(assumida.corpo.responsavel_id, me.usuario.id, 'vendedor assume a oportunidade encaminhada');
  const lista = (await pat.get('/comercial/oportunidades?funil=expansao')).corpo;
  assert.ok((await pat.get('/comercial/oportunidades?funil=expansao&minhas=1')).corpo.itens.some((o) => o.id === r.corpo.id), 'minhas inclui a fila sem dono');
  assert.ok(lista.itens.length >= 1 && lista.itens.every((o) => o.funil === 'expansao'));
});

test('expansão: produto que a conta já tem não exige teste; produto novo que exige, exige; ganhar soma à conta', async () => {
  const c = await conta('Transportadora Rota Sul');
  const jaTem = c.produtos[0];
  const op = (await pat.post('/comercial/oportunidades', { funil: 'expansao', contaOrigemId: c.id, produtos: [jaTem], contatoNome: 'Fernanda', contatoTelefone: '11 98765-4321' })).corpo;
  assert.equal(op.cnpj, c.cnpj);
  assert.equal((await pat.post('/comercial/oportunidades', { funil: 'expansao', empresa: 'Sem conta' })).status, 400, 'expansão sem cliente da carteira');
  for (const e of ['qualificacao', 'demonstracao']) assert.equal((await mover(op, e)).status, 200);
  assert.equal((await mover(op, 'proposta', { frota: 100, valorMensal: '800' })).status, 200);
  assert.equal((await pat.get(`/comercial/oportunidades/${op.id}`)).corpo.exigeTeste, false);
  assert.equal((await mover(op, 'negociacao')).status, 200, 'mais do mesmo produto: sem teste');
  assert.equal((await mover(op, 'ganha')).status, 200);
  const depois = await conta('Transportadora Rota Sul');
  assert.equal(Number(depois.valor_mensal), Number(c.valor_mensal || 0) + 800, 'expansão soma ao contrato');
  const novo = (await pat.post('/comercial/oportunidades', { funil: 'expansao', contaOrigemId: c.id, produtos: ['caca_condutores'] })).corpo;
  for (const e of ['qualificacao', 'demonstracao']) await mover(novo, e);
  await mover(novo, 'proposta', { frota: 10, valorMensal: '100' });
  assert.equal((await mover(novo, 'negociacao')).status, 422, 'produto novo que exige teste');
});

test('renovação: dispensa o teste e, ao ganhar, troca o valor do contrato sem abrir onboarding', async () => {
  const c = await conta('Cargas Litoral');
  const op = (await pat.post('/comercial/oportunidades', { funil: 'renovacao', contaOrigemId: c.id, produtos: c.produtos, contatoNome: 'Leonardo', contatoTelefone: '13 99123-4567' })).corpo;
  assert.equal(Number(op.valor_mensal), Number(c.valor_mensal), 'renovação parte do valor atual');
  for (const e of ['qualificacao', 'demonstracao']) await mover(op, e);
  await mover(op, 'proposta', { frota: 50, valorMensal: '1500' });
  assert.equal((await mover(op, 'negociacao')).status, 200);
  const onbAntes = (await t.sql("SELECT count(*)::int AS q FROM ocorrencias WHERE conta_id = $1 AND tipo = 'onboarding'", [c.id]))[0].q;
  const g = await mover(op, 'ganha');
  assert.equal(g.status, 200);
  assert.equal(g.corpo.venda.renovacao, true);
  assert.equal(Number((await conta('Cargas Litoral')).valor_mensal), 1500, 'troca, não soma');
  assert.equal((await t.sql("SELECT count(*)::int AS q FROM ocorrencias WHERE conta_id = $1 AND tipo = 'onboarding'", [c.id]))[0].q, onbAntes);
  assert.equal((await t.sql("SELECT count(*)::int AS q FROM auditoria WHERE acao = 'conta.renovada' AND entidade_id = $1", [c.id]))[0].q, 1);
});

test('pessoas: a mesma pessoa (telefone/e-mail) não duplica entre oportunidades; dado existente não é sobrescrito', async () => {
  const a = (await pat.post('/comercial/oportunidades', { empresa: 'Pessoas A' })).corpo;
  const b = (await pat.post('/comercial/oportunidades', { empresa: 'Pessoas B' })).corpo;
  const p1 = await pat.post(`/comercial/oportunidades/${a.id}/pessoas`, { nome: 'Rita Souza', cargo: 'Diretora de frota', telefone: '(11) 97000-1111', papel: 'decisor' });
  assert.equal(p1.status, 201);
  assert.equal(p1.corpo.nova, true);
  const p2 = await pat.post(`/comercial/oportunidades/${b.id}/pessoas`, { nome: 'Rita S.', telefone: '11970001111', email: 'rita@frota.example', papel: 'influenciador' });
  assert.deepEqual([p2.corpo.nova, p2.corpo.id, p2.corpo.nome, p2.corpo.email], [false, p1.corpo.id, 'Rita Souza', 'rita@frota.example'], 'mesma pessoa, completa o e-mail, mantém o nome');
  assert.equal((await pat.post(`/comercial/oportunidades/${a.id}/pessoas`, { nome: 'Sem contato', papel: 'outro' })).status, 400);
  await pat.post(`/comercial/oportunidades/${a.id}/pessoas`, { nome: 'Outro', email: 'outro@x.example', papel: 'tecnico' });
  assert.equal((await pat.post(`/comercial/oportunidades/${a.id}/pessoas`, { nome: 'Mistura', telefone: '11970001111', email: 'outro@x.example', papel: 'outro' })).status, 409, 'telefone de uma e e-mail de outra');
  const d = (await pat.get(`/comercial/oportunidades/${a.id}`)).corpo;
  assert.deepEqual(d.contatos.map((x) => [x.nome, x.papel, x.oportunidades]), [['Rita Souza', 'decisor', 2], ['Outro', 'tecnico', 1]]);
  assert.equal((await pat.post(`/comercial/oportunidades/${a.id}/pessoas/${p1.corpo.id}/desvincular`)).status, 200);
  assert.equal((await t.sql('SELECT count(*)::int AS q FROM contatos_comerciais WHERE id = $1', [p1.corpo.id]))[0].q, 1, 'a pessoa continua cadastrada');
});

test('indicadores: previsão por mês e totais por funil', async () => {
  const op = (await pat.post('/comercial/oportunidades', { empresa: 'Previsão SA', valorMensal: '1000', fechamentoPrevisto: '2026-12-10' })).corpo;
  assert.equal(op.fechamento_previsto, '2026-12-10');
  assert.equal((await pat.post('/comercial/oportunidades', { empresa: 'Data ruim', fechamentoPrevisto: '10/12/2026' })).status, 400);
  const ind = (await pat.get('/comercial/indicadores')).corpo;
  const dez = ind.previsao.meses.find((m) => m.mes === '2026-12');
  assert.ok(dez.ponderado >= 100, 'novo = 10% de 1000');
  assert.ok(ind.porFunil.some((f) => f.funil === 'expansao'));
  assert.match(ind.previsao.formula, /Negociação 80%/);
});
