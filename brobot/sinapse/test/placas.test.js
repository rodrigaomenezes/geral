'use strict';
// F18 · ONB-006: lote de placas do onboarding conferido no Sinapse (resultado parcial e rejeições com motivo), enviado
// à Platform pela exportação com confirmação; o item do checklist se marca sozinho.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarPlaca, renavamValido, conferir } = require('../server/modulos/onboarding/placas');
const { subir } = require('./ajuda');

/** Gera um Renavam válido a partir de 10 dígitos. */
function renavam(base) {
  const r = String(base).padStart(10, '0');
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let dv = 11 - (pesos.reduce((s, p, i) => s + p * Number(r[i]), 0) % 11);
  if (dv >= 10) dv = 0;
  return `${r}${dv}`;
}
const R1 = renavam('0063984071'); const R2 = renavam('1234567890'); const R3 = renavam('0987654321');
const errado = (r) => `${r.slice(0, 10)}${(Number(r[10]) + 1) % 10}`;

test('regras: placa antiga e Mercosul; Renavam com dígito; repetida e já enviada', () => {
  assert.equal(normalizarPlaca('abc-1234'), 'ABC1234');
  assert.equal(normalizarPlaca(' rsu 2b34 '), 'RSU2B34');
  assert.equal(normalizarPlaca('AB12345'), null);
  assert.equal(renavamValido(R1), R1);
  assert.equal(renavamValido(R1.slice(2)), R1, '9 dígitos: completa com zeros');
  assert.equal(renavamValido(errado(R1)), null);
  const linhas = [
    { numero: 2, valores: { placa: 'ABC1D23', renavam: R1 } }, { numero: 3, valores: { placa: 'abc-1d23', renavam: R2 } },
    { numero: 4, valores: { placa: 'XYZ9999', renavam: errado(R2) } }, { numero: 5, valores: { placa: '', renavam: R3 } },
    { numero: 6, valores: { placa: 'OLD1234', renavam: R3 } }];
  const r = conferir(linhas, new Set(['OLD1234']));
  assert.deepEqual(r.map((x) => [x.linha, x.aceita, x.motivo && x.motivo.split(' ')[0]]),
    [[2, true, null], [3, false, 'Placa'], [4, false, 'Renavam'], [5, false, 'Placa'], [6, false, 'Placa']]);
  assert.match(r[1].motivo, /repetida/);
  assert.match(r[4].motivo, /já enviada/);
});

let t; let pedro; let juliana; let carla; let conta;
before(async () => {
  t = await subir();
  [pedro, juliana, carla] = await Promise.all(['Pedro Santos', 'Juliana Alves', 'Carla Mendes'].map((n) => t.entrarComo(n)));
  conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'"))[0].id;
  await t.sql("UPDATE contas SET status = 'onboarding' WHERE id = $1", [conta]);
  assert.equal((await juliana.post(`/contas/${conta}/checklists`, { tipo: 'onboarding' })).status, 201);
});
after(async () => { await t.parar(); });

async function enviar(cookieDe, texto, nome = 'frota.csv') {
  const p = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas.find((x) => x.nome === cookieDe);
  const s = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: p.id }) });
  const cookie = s.headers.get('set-cookie').split(';')[0];
  const r = await fetch(`${t.base}/api/contas/${conta}/placas`, { method: 'POST', headers: { cookie, 'content-type': 'text/csv', 'x-nome-arquivo': encodeURIComponent(nome) }, body: texto });
  return { status: r.status, corpo: await r.json() };
}
const itemPlacas = async () => (await juliana.get(`/contas/${conta}/checklists`)).corpo.checklists.find((x) => x.tipo === 'onboarding').itens.find((i) => i.codigo === 'placas');

test('importar: resultado parcial com motivo; mesmo arquivo não entra de novo; Financeiro não importa', async () => {
  const csv1 = `Placa;Renavam\nABC1D23;${R1}\nABC-1D23;${R2}\nXYZ9999;${errado(R2)}\n`;
  assert.equal((await enviar('Carla Mendes', csv1)).status, 403);
  assert.equal((await enviar('Pedro Santos', 'veiculo;outro\nABC1234;1\n')).status, 400, 'sem coluna placa');
  const r = await enviar('Pedro Santos', csv1, 'frota novembro.csv');
  assert.equal(r.status, 201);
  assert.deepEqual([r.corpo.aceitas, r.corpo.rejeitadas], [1, 2]);
  assert.deepEqual(r.corpo.rejeicoes.map((x) => x.linha), [3, 4]);
  assert.equal((await enviar('Pedro Santos', csv1)).status, 409);
  const l = (await juliana.get(`/contas/${conta}/placas`)).corpo;
  assert.equal(l.lotes[0].arquivo, 'frota novembro.csv');
  assert.equal(l.rejeicoesDoUltimo.length, 2);
  assert.notEqual((await itemPlacas()).estado, 'feito', 'rejeição pendente: item não se marca');
});

test('rejeições tratadas + exportação confirmada na Platform marcam o item sozinho; placa já enviada é rejeitada depois', async () => {
  const lote = (await juliana.get(`/contas/${conta}/placas`)).corpo.lotes[0];
  assert.equal((await pedro.post(`/lotes-placas/${lote.id}/tratar`, {})).status, 400);
  assert.equal((await pedro.post(`/lotes-placas/${lote.id}/tratar`, { motivo: 'Cliente confirmou: veículos vendidos, ficam fora' })).status, 200);
  assert.equal((await pedro.post(`/lotes-placas/${lote.id}/tratar`, { motivo: 'De novo' })).status, 409);
  assert.notEqual((await itemPlacas()).estado, 'feito', 'falta a confirmação na Platform');

  const exp = await fetch(`${t.base}/api/integracoes/exportar/platform_placas_onboarding`, { headers: { cookie: await (async () => {
    const p = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas.find((x) => x.nome === 'Pedro Santos');
    const s = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: p.id }) });
    return s.headers.get('set-cookie').split(';')[0];
  })() } });
  assert.equal(exp.status, 200);
  const texto = await exp.text();
  assert.match(texto, /ABC1D23/);
  assert.doesNotMatch(texto, /XYZ9999/, 'rejeitada não vai para a Platform');
  const lotesExp = await t.sql("SELECT id FROM exportacoes WHERE tipo = 'platform_placas_onboarding' ORDER BY criado_em DESC LIMIT 1");
  assert.equal((await pedro.post(`/integracoes/lotes/${lotesExp[0].id}/resolver`, { resultado: 'confirmado', evidencia: 'Importado na Platform, 1 placa' })).status, 200);
  const item = await itemPlacas();
  assert.equal(item.estado, 'feito');
  assert.match(item.evidencia, /1 placa\(s\) aceita\(s\), 2 rejeição\(ões\) tratada\(s\).*confirmado na Platform/);

  const r = await enviar('Pedro Santos', `placa;renavam\nABC1D23;${R1}\nQWE4R56;${R3}\n`, 'complemento.csv');
  assert.deepEqual([r.corpo.aceitas, r.corpo.rejeitadas], [1, 1]);
  assert.match(r.corpo.rejeicoes[0].motivo, /já enviada/);
});
