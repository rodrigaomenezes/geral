'use strict';
// F17 · SUP-009 / RNF-011: métricas no formato do Prometheus, só com o token do coletor; rótulos sem ids nem dados.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { criarMetricas } = require('../server/nucleo/metricas');
const { carregarConfig } = require('../server/config');
const { subir } = require('./ajuda');

test('contador e histograma por modelo de rota e classe de status (regra pura)', () => {
  const m = criarMetricas();
  m.registrar({ metodo: 'GET', rota: '/api/ocorrencias/:id', status: 200, ms: 40 });
  m.registrar({ metodo: 'GET', rota: '/api/ocorrencias/:id', status: 200, ms: 300 });
  m.registrar({ metodo: 'POST', rota: '/api/sessao/entrar', status: 422, ms: 20 });
  const t = m.exportar([{ nome: 'sinapse_x', ajuda: 'teste', valores: [{ rotulos: { estado: 'a"b' }, valor: 3 }] }]);
  assert.match(t, /sinapse_requisicoes_total\{metodo="GET",rota="\/api\/ocorrencias\/:id",status="2xx"\} 2/);
  assert.match(t, /sinapse_requisicao_ms_bucket\{metodo="GET",rota="\/api\/ocorrencias\/:id",status="2xx",le="50"\} 1/);
  assert.match(t, /sinapse_requisicao_ms_bucket\{metodo="GET",rota="\/api\/ocorrencias\/:id",status="2xx",le="500"\} 2/);
  assert.match(t, /sinapse_requisicao_ms_sum\{metodo="GET",rota="\/api\/ocorrencias\/:id",status="2xx"\} 340/);
  assert.match(t, /status="4xx"\} 1/);
  assert.match(t, /sinapse_x\{estado="a\\"b"\} 3/, 'aspas escapadas');
  assert.throws(() => carregarConfig({ SINAPSE_DATA: ':memoria:', SINAPSE_TOKEN_METRICAS: 'curto' }), /24 caracteres/);
});

let t;
const TOKEN = 'token-do-coletor-com-mais-de-24-caracteres';
before(async () => { t = await subir(); });
after(async () => { await t.parar(); });

const pegar = (headers = {}) => fetch(`${t.base}/api/metricas`, { headers });

test('sem token configurado a rota não existe; com token errado, 401; com o certo, o texto do Prometheus', async () => {
  assert.equal((await pegar({ authorization: `Bearer ${TOKEN}` })).status, 404, 'desligada sem SINAPSE_TOKEN_METRICAS');
  t.cfg.tokenMetricas = TOKEN;
  assert.equal((await pegar()).status, 401);
  assert.equal((await pegar({ authorization: 'Bearer errado' })).status, 401);
  const marina = await t.entrarComo('Marina Costa');
  const id = (await marina.get('/ocorrencias')).corpo.itens[0].id;
  await marina.get(`/ocorrencias/${id}`);
  const r = await pegar({ authorization: `Bearer ${TOKEN}` });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/plain; version=0\.0\.4/);
  const texto = await r.text();
  assert.match(texto, /sinapse_requisicoes_total\{metodo="GET",rota="\/api\/ocorrencias\/:id",status="2xx"\} \d+/, 'modelo da rota, sem o id');
  assert.ok(!texto.includes(id), 'nenhum identificador nos rótulos');
  assert.match(texto, /sinapse_jobs\{estado="pendente"\} \d+/);
  assert.match(texto, /sinapse_supervisor_heartbeat_segundos -?\d+/);
  assert.match(texto, /sinapse_entrada_mais_antiga_segundos \d+/);
  assert.match(texto, /sinapse_ocorrencias\{situacao="ativas"\} \d+/);
  assert.ok(!/Logística|Rota Sul|Marina|brobot/i.test(texto), 'sem nome de cliente, pessoa ou organização');
  t.cfg.tokenMetricas = null;
});
