'use strict';
// F12 · GOV-002: VIP por pedido e aprovação de outra pessoa da gestão, com critério, validade, aviso antes de vencer,
// saída automática e histórico. O VIP muda o roteamento das ocorrências novas.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let juliana; let marina; let admin; let rafael; let carla;
const ids = {};
before(async () => {
  t = await subir();
  [juliana, marina, admin, rafael, carla] = await Promise.all(['Juliana Alves', 'Marina Costa', 'Administração Sinapse', 'Rafael Lima', 'Carla Mendes'].map((n) => t.entrarComo(n)));
  for (const x of await t.sql("SELECT id, nome FROM contas WHERE nome IN ('Cargas Litoral', 'Transportadora Rota Sul')")) ids[x.nome] = x.id;
});
after(async () => { await t.parar(); });

const varrer = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar(); };

test('conceder: pedido de quem cuida da conta, aprovado por outra pessoa da gestão; roteamento passa ao CS', async () => {
  const id = ids['Cargas Litoral'];
  assert.equal((await carla.post(`/contas/${id}/vip`, { tipo: 'conceder', criterio: 'Frota grande', validade: '2027-06-30', motivo: 'Teste' })).status, 403, 'Financeiro não pede');
  assert.equal((await juliana.post(`/contas/${id}/vip`, { tipo: 'conceder', validade: '2027-06-30', motivo: 'Sem critério' })).status, 400);
  assert.equal((await juliana.post(`/contas/${id}/vip`, { tipo: 'conceder', criterio: 'Frota acima de 400 veículos', validade: '2026-10-01', motivo: 'Validade passada' })).status, 400);
  assert.equal((await juliana.post(`/contas/${id}/vip`, { tipo: 'conceder', criterio: 'Frota acima de 400 veículos', validade: '2030-01-01', motivo: 'Validade longa' })).status, 400, 'até 2 anos');
  assert.equal((await juliana.post(`/contas/${id}/vip`, { tipo: 'retirar', motivo: 'Não é VIP' })).status, 409);
  const p = await juliana.post(`/contas/${id}/vip`, { tipo: 'conceder', criterio: 'Frota passou de 400 veículos', validade: '2027-11-30', motivo: 'Contrato ampliado em novembro' });
  assert.equal(p.status, 201);
  assert.equal((await juliana.post(`/contas/${id}/vip`, { tipo: 'conceder', criterio: 'De novo', validade: '2027-11-30', motivo: 'Segundo pedido' })).status, 409, 'um pendente por conta');
  assert.equal((await juliana.get('/vip/pedidos')).status, 403, 'CS não decide');
  const pend = (await marina.get('/vip/pedidos')).corpo.pedidos;
  assert.ok(pend.some((x) => x.id === p.corpo.id));
  // Antes de aprovar, segue no Suporte.
  const antes = (await rafael.post('/ocorrencias', { contaId: id, tipo: 'duvida', prioridade: 'baixa', titulo: 'Antes do VIP' })).corpo;
  assert.equal((await t.sql('SELECT e.codigo FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id WHERE o.id = $1', [antes.id]))[0].codigo, 'suporte');
  assert.equal((await marina.post(`/vip/pedidos/${p.corpo.id}/aprovar`, {})).status, 200);
  assert.equal((await marina.post(`/vip/pedidos/${p.corpo.id}/aprovar`, {})).status, 409, 'já decidido');
  const ct = (await t.sql('SELECT vip, vip_criterio, vip_validade, vip_aprovador FROM contas WHERE id = $1', [id]))[0];
  assert.deepEqual(ct, { vip: true, vip_criterio: 'Frota passou de 400 veículos', vip_validade: '2027-11-30', vip_aprovador: 'Marina Costa' });
  const depois = (await rafael.post('/ocorrencias', { contaId: id, tipo: 'duvida', prioridade: 'baixa', titulo: 'Depois do VIP' })).corpo;
  assert.equal((await t.sql('SELECT e.codigo FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id WHERE o.id = $1', [depois.id]))[0].codigo, 'cs', 'VIP → CS');
  assert.equal((await t.sql('SELECT e.codigo FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id WHERE o.id = $1', [antes.id]))[0].codigo, 'suporte', 'a aberta não se move');
  const aud = await t.sql("SELECT antes, depois FROM auditoria WHERE acao = 'conta.vip_alterado' AND entidade_id = $1", [id]);
  assert.equal(aud.length, 1);
  assert.equal(aud[0].antes.vip, false);
});

test('quem pediu não aprova; recusa exige motivo; histórico mostra tudo', async () => {
  const id = ids['Cargas Litoral'];
  const p = await marina.post(`/contas/${id}/vip`, { tipo: 'retirar', motivo: 'Contrato reduzido para 80 veículos' });
  assert.equal(p.status, 201);
  const r = await marina.post(`/vip/pedidos/${p.corpo.id}/aprovar`, {});
  assert.equal(r.status, 422);
  assert.equal(r.corpo.error.code, 'mesma_pessoa');
  assert.equal((await admin.post(`/vip/pedidos/${p.corpo.id}/recusar`, {})).status, 400, 'recusa sem motivo');
  assert.equal((await admin.post(`/vip/pedidos/${p.corpo.id}/recusar`, { motivo: 'Aguardar o fim do trimestre' })).status, 200);
  assert.equal((await t.sql('SELECT vip FROM contas WHERE id = $1', [id]))[0].vip, true, 'recusado: nada muda');
  const h = (await rafael.get(`/contas/${id}/vip`)).corpo.pedidos;
  assert.deepEqual(h.map((x) => [x.tipo, x.estado]), [['retirar', 'recusado'], ['conceder', 'aprovado']]);
  assert.equal(h[0].decisao_motivo, 'Aguardar o fim do trimestre');
});

test('validade: aviso ao CS 15 dias antes (uma vez); vencida, o VIP sai sozinho e o roteamento volta ao Suporte', async () => {
  const id = ids['Transportadora Rota Sul'];
  await t.sql("UPDATE contas SET vip_validade = '2026-11-14', vip_aviso_validade_em = NULL WHERE id = $1", [id]); // hoje: 04/11
  await varrer(); await varrer();
  const avisos = await t.sql("SELECT titulo FROM tarefas WHERE chave = $1", [`vip-validade:${id}:2026-11-14`]);
  assert.equal(avisos.length, 1, 'uma tarefa só');
  assert.match(avisos[0].titulo, /VIP vence em 14\/11\/2026/);
  assert.equal((await t.sql('SELECT vip FROM contas WHERE id = $1', [id]))[0].vip, true, 'ainda vale');

  await t.avancar(11 * 24); // 15/11: venceu
  await varrer();
  const ct = (await t.sql('SELECT vip, vip_validade FROM contas WHERE id = $1', [id]))[0];
  assert.deepEqual(ct, { vip: false, vip_validade: null });
  const auto = (await rafael.get(`/contas/${id}/vip`)).corpo.pedidos[0];
  assert.deepEqual([auto.tipo, auto.estado], ['retirar', 'automatico']);
  assert.ok((await t.sql("SELECT 1 FROM tarefas WHERE chave = $1", [`vip-expirou:${id}:2026-11-14`])).length);
  const nova = (await rafael.post('/ocorrencias', { contaId: id, tipo: 'duvida', prioridade: 'baixa', titulo: 'Depois de vencer' })).corpo;
  assert.equal((await t.sql('SELECT e.codigo FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id WHERE o.id = $1', [nova.id]))[0].codigo, 'suporte');
  await varrer();
  assert.equal((await t.sql("SELECT count(*)::int AS n FROM vip_pedidos WHERE conta_id = $1 AND estado = 'automatico'", [id]))[0].n, 1, 'não repete');
});
