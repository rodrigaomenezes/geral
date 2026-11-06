'use strict';
// F14 · SUP-002: canal em silêncio (webhook interrompido), entrada parada e rotina parada viram divergência e tarefa
// da Supervisão, uma vez por episódio; o canal que volta fecha a divergência sozinho.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t;
before(async () => { t = await subir(); });
after(async () => { await t.parar(); });

const varrer = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar(); };
const brobot = "(SELECT id FROM tenants WHERE slug = 'brobot')";
const abertas = (tipo) => t.sql(`SELECT chave, entidade_id, descricao FROM divergencias WHERE tipo = $1 AND estado = 'aberta' AND tenant_id = ${brobot}`, [tipo]);
const webhook = (corpo, origem = 'whatsapp') => fetch(`${t.base}/api/entrada/brobot/${origem}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-sinapse-token': t.TOKEN }, body: JSON.stringify(corpo) });

test('WhatsApp sem mensagens além do limite (horas úteis) vira divergência e tarefa uma vez; e-mail ainda no limite não', async () => {
  await varrer();
  assert.equal((await abertas('canal_silencio')).length, 0, 'tudo em dia no começo');
  await t.avancar(5); // quarta 10h → 15h: 5 h úteis sem mensagens
  await varrer(); await varrer();
  const d = await abertas('canal_silencio');
  assert.deepEqual(d.map((x) => x.entidade_id), ['whatsapp'], 'só o WhatsApp (limite 4 h); e-mail tem 24 h');
  assert.match(d[0].descricao, /WhatsApp há 5 h úteis/);
  const tarefas = await t.sql(`SELECT titulo FROM tarefas WHERE chave = $1`, [d[0].chave]);
  assert.equal(tarefas.length, 1, 'uma tarefa por episódio');
  assert.match(tarefas[0].titulo, /conferir conexão e webhook/);
});

test('noite e fim de semana não contam; mensagem nova fecha a divergência sozinha', async () => {
  const r = await webhook({ idMensagem: 'wamid.volta-1', de: '(41) 99000-2222', texto: 'Oi, voltou?' });
  assert.ok(r.status < 300);
  await t.processar(); await varrer();
  assert.equal((await abertas('canal_silencio')).filter((x) => x.entidade_id === 'whatsapp').length, 0, 'voltou: tratada');
  await t.avancar(16); // 15h de quarta → 7h de quinta: só 3 h úteis (15h–18h)
  await varrer();
  assert.equal((await abertas('canal_silencio')).filter((x) => x.entidade_id === 'whatsapp').length, 0, 'a noite não conta');
});

test('entrada recebida e não processada há mais de 15 min, e rotina recorrente na fila de falhas', async () => {
  await t.sql(`INSERT INTO entradas (tenant_id, origem, chave_idempotencia, payload, recebida_em)
    VALUES (${brobot}, 'email', 'parada-1', '{"de":"x@y.com","texto":"teste"}', '2026-11-01T00:00:00Z')`);
  await t.sql(`UPDATE jobs SET estado = 'morto', concluido_em = '2026-11-05T09:00:00Z', ultimo_erro = 'OMIE fora do ar' WHERE chave = 'recorrente:omie' AND tenant_id = ${brobot}`);
  await varrer(); await varrer();
  const parada = await abertas('entrada_parada');
  assert.equal(parada.length, 1);
  assert.match(parada[0].descricao, /não processada/);
  const rotina = await abertas('rotina_parada');
  assert.equal(rotina.length, 1);
  assert.match(rotina[0].descricao, /omie\.sincronizar parou.*OMIE fora do ar/);
  assert.equal((await t.sql('SELECT count(*)::int AS n FROM tarefas WHERE chave = $1', [rotina[0].chave]))[0].n, 1);
  const painel = (await (await t.entrarComo('Marina Costa')).get('/supervisor')).corpo;
  assert.ok(painel.divergencias.some((x) => x.tipo === 'rotina_parada'), 'aparece no painel do Supervisor');
});
