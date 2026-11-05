'use strict';
// Quadro (Kanban) de ocorrências com tarefas e responsáveis (pedido de 05/11).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { TRANSICOES, planejar } = require('../server/modulos/ocorrencias/maquina');
const { subir } = require('./ajuda');

let t;
before(async () => { t = await subir(); });
after(async () => { await t.parar(); });

test('cada transição declara o destino que a máquina realmente grava (o quadro confia nisso)', () => {
  for (const [acao, def] of Object.entries(TRANSICOES)) assert.ok(def.para, `${acao} sem destino`);
  const u = { id: 'u', papel: 'supervisor', equipe_id: 'e1' };
  const ctx = { usuario: u, agora: new Date('2026-11-04T13:00:00Z'), cal: require('../server/modulos/ocorrencias/sla').calendario() };
  const casos = { assumir: [{ estado: 'aberta', equipe_id: 'e1' }, {}], retomar: [{ estado: 'aguardando_cliente', equipe_id: 'e1' }, {}],
    resolver: [{ estado: 'em_atendimento', equipe_id: 'e1', tipo: 'duvida' }, { codigoDesfecho: 'orientado', evidencia: 'Cliente confirmou por WhatsApp' }],
    encerrar_sem_resolucao: [{ estado: 'aberta', equipe_id: 'e1' }, { codigoDesfecho: 'duplicada', motivo: 'Duplicada da 2026-0001' }] };
  for (const [acao, [oc, dados]] of Object.entries(casos)) assert.equal(planejar(oc, acao, dados, ctx).para, TRANSICOES[acao].para, acao);
});

test('quadro: colunas por situação com total, responsável, tarefas agregadas e ações possíveis', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const r = await marina.get('/ocorrencias/quadro');
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.colunas.map((c) => c.estado), ['triagem', 'aberta', 'em_atendimento', 'aguardando_cliente', 'aguardando_terceiro', 'em_handoff', 'resolvida', 'encerrada_sem_resolucao']);
  const cartoes = r.corpo.colunas.flatMap((c) => c.cartoes);
  const [{ q }] = await t.sql("SELECT count(*)::int AS q FROM ocorrencias WHERE tenant_id = $1 AND estado NOT IN ('resolvida','encerrada_sem_resolucao')", [await t.tenant()]);
  assert.equal(r.corpo.colunas.filter((c) => !['resolvida', 'encerrada_sem_resolucao'].includes(c.estado)).reduce((s, c) => s + c.total, 0), q, 'totais batem com o banco, só desta organização');
  for (const c of r.corpo.colunas) assert.ok(c.cartoes.every((o) => o.estado === c.estado) && c.cartoes.length <= r.corpo.porColuna);
  const comTarefa = await t.sql("SELECT ocorrencia_id, count(*) FILTER (WHERE estado = 'aberta')::int AS abertas, count(*) FILTER (WHERE estado <> 'cancelada')::int AS total FROM tarefas WHERE tenant_id = $1 AND ocorrencia_id IS NOT NULL GROUP BY 1", [await t.tenant()]);
  for (const x of comTarefa) {
    const o = cartoes.find((y) => y.id === x.ocorrencia_id);
    if (o) assert.deepEqual([o.tarefas_abertas, o.tarefas_total], [x.abertas, x.total]);
  }
  const aberta = cartoes.find((o) => o.estado === 'aberta');
  assert.ok(aberta.acoes.some((a) => a.acao === 'assumir' && a.para === 'em_atendimento'));
});

test('quadro: filtros (minhas, sem responsável, VIP) e escopo da organização', async () => {
  const bianca = await t.entrarComo('Bianca Rocha');
  const minhas = (await bianca.get('/ocorrencias/quadro?responsavel=eu')).corpo.colunas.flatMap((c) => c.cartoes);
  assert.ok(minhas.every((o) => o.responsavel_nome === 'Bianca Rocha'));
  const fila = (await bianca.get('/ocorrencias/quadro?responsavel=ninguem')).corpo.colunas.flatMap((c) => c.cartoes);
  assert.ok(fila.every((o) => !o.responsavel_nome));
  const vip = (await bianca.get('/ocorrencias/quadro?vip=1')).corpo.colunas.flatMap((c) => c.cartoes);
  assert.ok(vip.length && vip.every((o) => o.vip));
  assert.equal((await bianca.get('/ocorrencias/quadro?responsavel=qualquer')).status, 400);
  const ana = await t.entrarComo('Ana Parceira');
  const daParceira = (await ana.get('/ocorrencias/quadro')).corpo.colunas.flatMap((c) => c.cartoes).map((o) => o.id);
  const [{ q }] = await t.sql('SELECT count(*)::int AS q FROM ocorrencias WHERE id = ANY($1) AND tenant_id = $2', [daParceira, await t.tenant()]);
  assert.equal(q, 0, 'parceira não vê cartão da Brobot');
});

test('quadro: arrastar = transição da máquina; destino inválido e versão velha dão conflito', async () => {
  const juliana = await t.entrarComo('Juliana Alves');
  const q1 = (await juliana.get('/ocorrencias/quadro?equipe=cs')).corpo;
  const o = q1.colunas.find((c) => c.estado === 'aberta').cartoes.find((x) => x.acoes.some((a) => a.acao === 'assumir'));
  assert.ok(o, 'cartão na fila do CS');
  assert.equal((await juliana.post(`/ocorrencias/${o.id}/transicoes`, { acao: 'resolver', versao: o.version, dados: {} })).status, 409, 'da fila não vai direto para resolvida');
  const ok = await juliana.post(`/ocorrencias/${o.id}/transicoes`, { acao: 'assumir', versao: o.version, dados: {} });
  assert.equal(ok.status, 200);
  assert.equal((await juliana.post(`/ocorrencias/${o.id}/transicoes`, { acao: 'devolver_fila', versao: o.version, dados: { motivo: 'teste de versão' } })).status, 409, 'cartão desatualizado');
  const q2 = (await juliana.get('/ocorrencias/quadro?equipe=cs')).corpo;
  const movido = q2.colunas.find((c) => c.estado === 'em_atendimento').cartoes.find((x) => x.id === o.id);
  assert.equal(movido.responsavel_nome, 'Juliana Alves');
});
