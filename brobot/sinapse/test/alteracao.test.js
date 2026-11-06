'use strict';
// F20 · ONB-011: alteração de cliente ativo (módulos, dados, carteira, ponto focal) por checklist com dono, prazo e
// evidência; o sistema confere o que tem dado; concluir não muda a situação da conta.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let juliana; let pedro; let carla; let conta;
before(async () => {
  t = await subir();
  [juliana, pedro, carla] = await Promise.all(['Juliana Alves', 'Pedro Santos', 'Carla Mendes'].map((n) => t.entrarComo(n)));
  conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Transportadora Rota Sul'"))[0].id;
});
after(async () => { await t.parar(); });

const doTipo = async (tipo) => (await juliana.get(`/contas/${conta}/checklists`)).corpo.checklists.find((x) => x.tipo === tipo && x.estado === 'aberto');

test('abrir: só cliente ativo, com o que muda; um aberto por vez', async () => {
  assert.equal((await juliana.post(`/contas/${conta}/checklists`, { tipo: 'alteracao' })).status, 400, 'sem motivo');
  const r = await juliana.post(`/contas/${conta}/checklists`, { tipo: 'alteracao', motivo: 'Inclusão do módulo CaçaCondutores a partir de 01/12' });
  assert.equal(r.status, 201);
  assert.equal((await juliana.post(`/contas/${conta}/checklists`, { tipo: 'alteracao', motivo: 'Outra mudança qualquer' })).corpo.id, r.corpo.id, 'idempotente');
  const ck = await doTipo('alteracao');
  assert.deepEqual(ck.itens.map((i) => i.codigo), ['combinado', 'platform', 'financeiro', 'ponto_focal', 'vip', 'aviso_cliente']);
  assert.equal(ck.itens.find((i) => i.codigo === 'ponto_focal').estado, 'feito', 'ponto focal vigente conferido pelo sistema');
  const outra = (await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'"))[0].id;
  await t.sql("UPDATE contas SET status = 'onboarding' WHERE id = $1", [outra]);
  assert.equal((await juliana.post(`/contas/${outra}/checklists`, { tipo: 'alteracao', motivo: 'Mudança em onboarding' })).status, 422);
});

test('cada área faz o seu; Platform confirmada marca sozinho; concluir mantém a conta ativa e registra', async () => {
  let ck = await doTipo('alteracao');
  const item = (cod) => ck.itens.find((i) => i.codigo === cod);
  assert.equal((await juliana.post(`/checklists/${ck.id}/concluir`)).status, 422, 'faltam itens');
  const lucas = await t.entrarComo('Lucas Ferreira');
  assert.equal((await lucas.post(`/checklists/itens/${item('financeiro').id}/feito`, { evidencia: 'Avisei o Financeiro' })).status, 403, 'fora da equipe e sem editar contas');
  assert.equal((await carla.post(`/checklists/itens/${item('financeiro').id}/feito`, { evidencia: 'Valor novo lançado no OMIE (contrato aditivo 12)' })).status, 200);
  assert.equal((await juliana.post(`/checklists/itens/${item('combinado').id}/feito`, { evidencia: 'E-mail do cliente de 04/11 aprovando a inclusão' })).status, 200);
  assert.equal((await juliana.post(`/checklists/itens/${item('aviso_cliente').id}/feito`, { evidencia: 'Mensagem enviada ao ponto focal' })).status, 200);

  const exp = await t.sql(`INSERT INTO exportacoes (tenant_id, tipo, destino, arquivo, hash, linhas, prazo_confirmacao_em)
    SELECT tenant_id, 'platform_carteira', 'platform', 'sinapse-platform_carteira-teste.csv', repeat('a', 64), 6, now() + interval '1 day' FROM contas WHERE id = $1 RETURNING id`, [conta]);
  assert.equal((await pedro.post(`/integracoes/lotes/${exp[0].id}/resolver`, { resultado: 'confirmado', evidencia: 'Carteira importada na Platform' })).status, 200);
  ck = await doTipo('alteracao');
  assert.equal(item('platform').estado, 'feito');
  assert.match(item('platform').evidencia, /confirmado como aplicado na Platform/);

  const r = await juliana.post(`/checklists/${ck.id}/concluir`);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.contaStatus, 'ativa');
  assert.equal((await t.sql('SELECT status FROM contas WHERE id = $1', [conta]))[0].status, 'ativa');
  assert.ok((await t.sql("SELECT 1 FROM eventos WHERE event_type = 'conta.alteracao_concluida' AND aggregate_id = $1", [conta])).length);
  const hist = (await juliana.get(`/contas/${conta}/checklists`)).corpo.checklists.filter((x) => x.tipo === 'alteracao');
  assert.equal(hist[0].estado, 'concluido');
  assert.equal(hist[0].motivo, 'Inclusão do módulo CaçaCondutores a partir de 01/12');
});
