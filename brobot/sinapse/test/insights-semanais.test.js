'use strict';
// CS-010 / BL-05 / COM-010: insights do CaçaCondutores uma vez por semana, para contas ativas com ponto focal,
// respeitando o opt-out; a mesma semana não envia de novo e o processo começa desligado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let marina; let proc;
before(async () => {
  t = await subir();
  marina = await t.entrarComo('Marina Costa');
  proc = (await marina.get('/processos')).corpo.itens.find((p) => /CaçaCondutores/.test(p.nome));
});
after(async () => { await t.parar(); });

const agenda = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:agenda'"); await t.processar(); await t.processar(); };
const enviados = () => t.sql("SELECT i.conta_id, i.status_entrega FROM interacoes i WHERE i.modelo LIKE 'insights_caca_condutores@%' ORDER BY i.criado_em");

test('começa desligado: nada é enviado na terça', async () => {
  assert.ok(proc, 'processo padrão existe');
  assert.equal(proc.ativo, false);
  await t.avancar(6 * 24); // quarta 04/11 10h → terça 10/11 10h
  await agenda();
  assert.equal((await enviados()).length, 0);
});

test('ligado: uma mensagem por conta ativa com ponto focal; opt-out bloqueia; mesma semana não repete; semana seguinte envia', async () => {
  const pfOpt = (await t.sql("SELECT pf.id, pf.conta_id FROM pontos_focais pf JOIN contas c ON c.id = pf.conta_id WHERE c.nome = 'Cargas Litoral' AND pf.vigente AND pf.papel = 'principal'"))[0];
  assert.ok(pfOpt, 'cenário: Cargas Litoral tem ponto focal');
  await t.sql('UPDATE pontos_focais SET opt_out = true WHERE id = $1', [pfOpt.id]);
  const r = await marina.post(`/processos/${proc.id}/ativar`, { nota: 'Texto revisado' });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  await agenda();
  const ativas = await t.sql(`SELECT c.id FROM contas c WHERE c.status = 'ativa' AND c.arquivada_em IS NULL AND c.tenant_id = (SELECT id FROM tenants WHERE slug = 'brobot')
    AND EXISTS (SELECT 1 FROM pontos_focais pf WHERE pf.conta_id = c.id AND pf.vigente)`);
  const primeira = await enviados();
  assert.equal(primeira.length, ativas.length, 'uma por conta ativa com ponto focal');
  assert.equal(new Set(primeira.map((x) => x.conta_id)).size, primeira.length, 'sem duplicar conta');
  assert.equal(primeira.find((x) => x.conta_id === pfOpt.conta_id).status_entrega, 'bloqueada', 'opt-out respeitado');

  await t.avancar(5); await agenda();
  assert.equal((await enviados()).length, primeira.length, 'mesma semana não repete');

  await t.avancar(7 * 24 - 5); await agenda(); // terça seguinte
  assert.equal((await enviados()).length, primeira.length * 2, 'semana seguinte: mais uma por conta');
});
