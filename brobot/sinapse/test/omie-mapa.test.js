'use strict';
// F24 · FIN-002: o vínculo conta ↔ cliente OMIE não é trocado nem repetido em silêncio (divergência para o Financeiro);
// o banco recusa o mesmo código OMIE em duas contas ativas.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let cookie;
before(async () => {
  t = await subir();
  const p = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas.find((x) => x.nome === 'Carla Mendes');
  const r = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: p.id }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(async () => { await t.parar(); });

const aplicar = async (texto) => {
  const r = await fetch(`${t.base}/api/integracoes/csv/omie_clientes/aplicar`, { method: 'POST', headers: { cookie, 'content-type': 'text/csv' }, body: texto });
  return { status: r.status, corpo: await r.json() };
};
const div = (tipo) => t.sql("SELECT descricao FROM divergencias WHERE tipo = $1 AND estado = 'aberta'", [tipo]);

test('código diferente do que a conta já tem: nada é trocado, divergência e erro na linha', async () => {
  const [rota] = await t.sql("SELECT id, id_omie, cnpj FROM contas WHERE nome = 'Transportadora Rota Sul'");
  assert.equal(rota.id_omie, 'OM-501', 'cenário');
  const r = await aplicar(`codigo_omie;cnpj;situacao\nOM-777;${rota.cnpj};em_dia\n`);
  assert.ok(r.status < 300, JSON.stringify(r.corpo));
  assert.match(JSON.stringify(r.corpo), /já tem o código OMIE OM-501/);
  assert.equal((await t.sql('SELECT id_omie FROM contas WHERE id = $1', [rota.id]))[0].id_omie, 'OM-501', 'não trocou');
  assert.match((await div('omie_codigo_diferente'))[0].descricao, /OM-501.*OM-777/);
});

test('código que já é de outra conta não é repetido; conta sem código recebe o código livre', async () => {
  const [lit] = await t.sql("SELECT id, cnpj FROM contas WHERE nome = 'Cargas Litoral'");
  await t.sql('UPDATE contas SET id_omie = NULL WHERE id = $1', [lit.id]);
  const r = await aplicar(`codigo_omie;cnpj;situacao\nOM-501;${lit.cnpj};em_dia\n`);
  assert.match(JSON.stringify(r.corpo), /já está na conta Transportadora Rota Sul/);
  assert.equal((await t.sql('SELECT id_omie FROM contas WHERE id = $1', [lit.id]))[0].id_omie, null);
  assert.equal((await div('omie_codigo_em_outra_conta')).length, 1);
  const ok = await aplicar(`codigo_omie;cnpj;situacao\nOM-606;${lit.cnpj};em_dia\n`);
  assert.ok(ok.status < 300);
  assert.equal((await t.sql('SELECT id_omie FROM contas WHERE id = $1', [lit.id]))[0].id_omie, 'OM-606', 'código livre vincula');
});

test('banco recusa o mesmo código OMIE em duas contas ativas da mesma organização', async () => {
  const [lit] = await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'");
  await assert.rejects(() => t.sql("UPDATE contas SET id_omie = 'OM-501' WHERE id = $1", [lit.id]), /contas_id_omie_unico|duplicate|unique/i);
});
