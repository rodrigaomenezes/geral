'use strict';
// R-22 · Prompt Mestre 7.2: arquivo semanal da Platform e do OMIE que não chega vira divergência e tarefa da equipe
// que o traz (uma vez por episódio); quando chega, a divergência fecha sozinha. Ausência nunca é sucesso.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { prazos, ESPERADOS_PADRAO } = require('../server/modulos/integracoes/csv/chegada');

let t; let carla;
before(async () => { t = await subir(); carla = await t.entrarComo('Carla Mendes'); });
after(async () => { await t.parar(); });

const varrer = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar(); };
const abertas = (tipo) => t.sql(`SELECT d.descricao FROM divergencias d JOIN tenants x ON x.id = d.tenant_id
  WHERE x.slug = 'brobot' AND d.tipo = 'csv_atrasado' AND d.entidade_id = $1 AND d.estado = 'aberta'`, [tipo]);
const importarOmie = async (codigo) => {
  const [rota] = await t.sql("SELECT cnpj FROM contas WHERE nome = 'Transportadora Rota Sul'");
  const r = await fetch(`${t.base}/api/integracoes/csv/omie_clientes/aplicar`, { method: 'POST', headers: { cookie: carla.cookie, 'content-type': 'text/csv' },
    body: `codigo_omie;cnpj;situacao\n${codigo};${rota.cnpj};em_dia\n` });
  return r.status;
};

test('regra pura: semanal por padrão; organização muda o prazo (0 desliga); inválido volta ao padrão', () => {
  assert.equal(ESPERADOS_PADRAO.omie_clientes, 7);
  assert.equal(ESPERADOS_PADRAO.platform_rodada, 7);
  assert.equal(ESPERADOS_PADRAO.pipedrive_negocios, undefined, 'migração pontual não entra');
  assert.deepEqual(prazos({ platform_uso: 0, omie_clientes: 'x', platform_rodada: 3 }), { ...ESPERADOS_PADRAO, platform_uso: 0, platform_rodada: 3 });
});

test('organização nova: dentro da primeira semana nada; passou a semana sem arquivo → "nunca recebido" uma vez', async () => {
  await varrer();
  assert.equal((await abertas('omie_clientes')).length, 0);
  await t.sql("UPDATE tenants SET criado_em = now() - interval '8 days'");
  await varrer(); await varrer();
  const d = await abertas('omie_clientes');
  assert.equal(d.length, 1, 'uma divergência só');
  assert.match(d[0].descricao, /nunca foi recebido/);
  const [tarefa] = await t.sql("SELECT t.titulo, e.codigo FROM tarefas t JOIN equipes e ON e.id = t.equipe_id JOIN tenants x ON x.id = t.tenant_id WHERE x.slug = 'brobot' AND t.chave = 'csv_atrasado:omie_clientes:nunca'");
  assert.equal(tarefa.codigo, 'financeiro', 'OMIE é do Financeiro');
  const [plat] = await t.sql("SELECT e.codigo FROM tarefas t JOIN equipes e ON e.id = t.equipe_id JOIN tenants x ON x.id = t.tenant_id WHERE x.slug = 'brobot' AND t.chave = 'csv_atrasado:platform_rodada:nunca'");
  assert.equal(plat.codigo, 'operacoes', 'Platform é de Operações');
  const [parc] = await t.sql("SELECT e.codigo FROM tarefas t JOIN equipes e ON e.id = t.equipe_id JOIN tenants x ON x.id = t.tenant_id WHERE x.slug = 'parceiro-demo' AND t.chave = 'csv_atrasado:omie_clientes:nunca'");
  assert.equal(parc.codigo, 'supervisao', 'organização sem Financeiro: a gestão recebe');
});

test('arquivo chega: fecha sozinha; fica velho de novo: novo episódio com a data do último arquivo', async () => {
  carla.cookie = (await (async () => { const p = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas.find((x) => x.nome === 'Carla Mendes');
    const r = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: p.id }) });
    return r.headers.get('set-cookie').split(';')[0]; })());
  const st = await importarOmie('OM-501');
  assert.ok(st < 300, `importação: ${st}`);
  await varrer();
  assert.equal((await abertas('omie_clientes')).length, 0, 'chegou: tratada');
  assert.equal((await abertas('platform_rodada')).length, 1, 'os outros continuam em aberto');
  await t.sql("UPDATE importacoes SET criado_em = now() - interval '9 days' WHERE tipo = 'omie_clientes'");
  await varrer();
  const d = await abertas('omie_clientes');
  assert.equal(d.length, 1);
  assert.match(d[0].descricao, /sem atualização há 9 dia\(s\) \(esperado a cada 7\)/);
});

test('organização que desligou o prazo de um arquivo não recebe alerta dele', async () => {
  await t.sql(`UPDATE tenants SET config = config || '{"csv_esperados": {"platform_uso": 0}}'::jsonb WHERE slug = 'brobot'`);
  await t.sql("UPDATE divergencias SET estado = 'tratada' WHERE tipo = 'csv_atrasado' AND entidade_id = 'platform_uso'");
  await varrer();
  assert.equal((await abertas('platform_uso')).length, 0);
  await t.sql("UPDATE tenants SET config = config - 'csv_esperados' WHERE slug = 'brobot'");
});
