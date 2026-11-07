'use strict';
// /demo: a vitrine abre (mesma casca do app) e a demonstração tem exemplo em TODAS as áreas, criado pelos serviços reais.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let admin;
before(async () => { t = await subir({ vitrine: true }); admin = await t.entrarComo('Administração Sinapse'); });
after(async () => { await t.parar(); });

test('/demo devolve a casca do aplicativo', async () => {
  const r = await fetch(`${t.base}/demo`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<div id="app"/);
});

test('cada área da demonstração abre com dados', async () => {
  const conta = async (u, f) => f((await admin.get(u)).corpo);
  assert.ok(await conta('/treinamentos', (x) => x.itens.length) >= 1, 'treinamento agendado');
  assert.ok(await conta('/vip/pedidos', (x) => x.pedidos.length) >= 1, 'pedido de VIP aguardando');
  const d = (await admin.get('/desenvolvimento')).corpo;
  assert.ok(d.incidentes.itens.length >= 1 && d.melhorias.itens.length >= 1 && d.releases.length >= 1, 'incidente, melhoria e release');
  assert.ok(await conta('/monitoramento/consultas', (x) => x.itens.length) >= 2, 'volume de consultas');
  assert.ok(await conta('/telefonia/chamadas?todas=1', (x) => x.itens.length) >= 2, 'ligações registradas');
  const g = (await admin.get('/governanca')).corpo;
  assert.ok(g.delegacoes.length >= 1 && g.plantoes.length >= 1, 'delegação e plantão');
  const [pioneiro] = await t.sql("SELECT id FROM contas WHERE nome = 'Rodoviário Pioneiro'");
  assert.ok(pioneiro, 'cliente ganho virou conta');
  assert.equal((await t.sql('SELECT count(*)::int AS n FROM checklists WHERE conta_id = $1', [pioneiro.id]))[0].n, 1, 'com onboarding');
  const [lote] = await t.sql('SELECT aceitas, rejeitadas FROM lotes_placas WHERE conta_id = $1', [pioneiro.id]);
  assert.deepEqual([lote.aceitas, lote.rejeitadas], [2, 2], 'lote com placas aceitas e rejeitadas');
});

test('reiniciar a demonstração recria a vitrine completa', async () => {
  const r = await admin.post('/demo/reiniciar');
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const [n] = await t.sql("SELECT (SELECT count(*) FROM treinamento_sessoes)::int AS treinos, (SELECT count(*) FROM contas WHERE nome = 'Rodoviário Pioneiro')::int AS pioneiro");
  assert.deepEqual(n, { treinos: 1, pioneiro: 1 });
});
