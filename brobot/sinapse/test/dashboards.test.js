'use strict';
// Dashboards: todos respondem, filtros, permissão por perfil e CSV de cada bloco.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t;
before(async () => { t = await subir(); await t.processar(); });
after(async () => { await t.parar(); });

test('os seis dashboards respondem para a Supervisão, com filtros, e cada bloco tem dados coerentes', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const lista = (await marina.get('/dashboards')).corpo.itens.map((x) => x.nome);
  assert.deepEqual(lista, ['operacao', 'rodadas', 'carteira', 'comercial', 'pessoas', 'automacao']);
  for (const nome of lista) {
    for (const q of ['', '?dias=7&carteira=vip', '?dias=90&equipe=suporte&carteira=demais']) {
      const r = await marina.get(`/dashboards/${nome}${q}`);
      assert.equal(r.status, 200, `${nome}${q}`);
      for (const b of r.corpo.blocos) {
        assert.ok(Array.isArray(b.linhas), `${nome}/${b.id} tem linhas`);
        if (b.tipo !== 'tiles') assert.ok(b.colunas?.length, `${nome}/${b.id} tem colunas para a tabela`);
      }
    }
  }
  const rod = (await marina.get('/dashboards/rodadas')).corpo;
  const resumo = rod.blocos.find((b) => b.id === 'resumo').linhas;
  assert.ok(resumo.some((x) => /pré-rodada/.test(x.rotulo)), 'tela de sucesso da pré-rodada (melhoria 6)');
  const op = (await marina.get('/dashboards/operacao?dias=7')).corpo.blocos.find((b) => b.id === 'abertas_resolvidas');
  assert.equal(op.linhas.length, 7, 'uma linha por dia do período');
  const auto = (await marina.get('/dashboards/automacao')).corpo.blocos.find((b) => b.id === 'por_processo');
  assert.ok(auto.linhas.length >= 1, 'execuções de processos aparecem');
});

test('permissão por perfil: Comercial não vê Pessoas; Suporte não vê Comercial; CSV do bloco', async () => {
  const pat = await t.entrarComo('Patrícia Gomes');
  const itens = (await pat.get('/dashboards')).corpo.itens.map((x) => x.nome);
  assert.ok(itens.includes('comercial') && !itens.includes('pessoas'));
  assert.equal((await pat.get('/dashboards/pessoas')).status, 403);
  const rafael = await t.entrarComo('Rafael Lima');
  assert.equal((await rafael.get('/dashboards/comercial')).status, 403);
  const ps = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas;
  const r = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: ps.find((p) => p.nome === 'Marina Costa').id }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const c = await fetch(`${t.base}/api/dashboards/carteira/csv?bloco=saude`, { headers: { cookie } });
  assert.equal(c.status, 200);
  const texto = await c.text();
  assert.match(texto, /Conta;VIP;Saúde/);
  assert.match(texto, /Frota Nordeste Cargas/);
});
