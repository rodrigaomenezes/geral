'use strict';
// Testes dos critérios de aceite principais. Rodar com: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/server');
const { demoPhotoPng } = require('../server/seed');

const PHOTO = 'data:image/png;base64,' + demoPhotoPng(40, 30).toString('base64');

async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'estadia-'));
  const app = createApp({ dataDir, quiet: true });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, p, body, token) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const login = async (email) => (await call('POST', '/api/login', { email, senha: 'estadia123' })).body.token;
  const close = () => new Promise((r) => app.server.close(r)).then(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return { app, call, login, close, dataDir };
}

const now = (offsetMin = 0) => new Date(Date.now() + offsetMin * 60000).toISOString();

test('fluxo completo: identificação → chegada → confirmação → … → saída → apuração → dossiê → advocacia', async () => {
  const t = await boot();
  try {
    const joao = await t.login('joao@tac.demo');
    const marina = await t.login('portaria@serraazul.demo');
    const adv = await t.login('juridico@andradeprado.demo');

    const id = await t.call('POST', '/api/operations/identify', { codigo: 'op-2026-0001', placa: 'RTB-4F27', occurredAt: now(-500) }, joao);
    assert.equal(id.status, 200);
    const opId = id.body.op.id;
    assert.equal(id.body.op.tacUserId, id.body.timeline.find((e) => e.type === 'OPERACAO_IDENTIFICADA').actor.userId);

    // Chegada sem foto é recusada (foto obrigatória)
    const semFoto = await t.call('POST', `/api/operations/${opId}/events`, { type: 'CHEGADA', occurredAt: now(-300), gps: { lat: -23.1857, lng: -46.8978, acc: 8 } }, joao);
    assert.equal(semFoto.status, 400);

    const cheg = await t.call('POST', `/api/operations/${opId}/events`, { clientEventId: 'c-1', type: 'CHEGADA', occurredAt: now(-400), gps: { lat: -23.1857, lng: -46.8978, acc: 8 }, photo: PHOTO }, joao);
    assert.equal(cheg.status, 201);
    assert.ok(cheg.body.evento.payload.photo.sha256);

    // Destino vê a confirmação pendente; TAC não pode confirmar o próprio registro
    const ownConfirm = await t.call('POST', `/api/operations/${opId}/events`, { type: 'CHEGADA_CONFIRMADA', occurredAt: now(-395), refEventId: cheg.body.evento.id }, joao);
    assert.equal(ownConfirm.status, 403);
    const conf = await t.call('POST', `/api/operations/${opId}/events`, { type: 'CHEGADA_CONFIRMADA', occurredAt: now(-390), refEventId: cheg.body.evento.id }, marina);
    assert.equal(conf.status, 201);

    const post = (tok, body) => t.call('POST', `/api/operations/${opId}/events`, body, tok);
    const ini = await post(joao, { type: 'INICIO', occurredAt: now(-200), gps: { erro: 'Permissão de localização negada' } });
    assert.equal(ini.status, 201);
    // Término antes do início é recusado (RN)
    assert.equal((await post(joao, { type: 'TERMINO', occurredAt: now(-250) })).status, 409);
    const ter = await post(joao, { type: 'TERMINO', occurredAt: now(-60) });
    assert.equal(ter.status, 201);
    // TAC não registra liberação
    assert.equal((await post(joao, { type: 'LIBERACAO', occurredAt: now(-20) })).status, 403);
    const lib = await post(marina, { type: 'LIBERACAO', occurredAt: now(-20) });
    assert.equal(lib.status, 201);
    const ci = await post(joao, { type: 'LIBERACAO_CIENCIA', occurredAt: now(-17), refEventId: lib.body.evento.id });
    assert.equal(ci.status, 201);
    // Ciência não altera o horário da liberação
    assert.equal(ci.body.detalhe.timeline.find((e) => e.type === 'LIBERACAO').occurredAt, lib.body.evento.occurredAt);

    const sai = await post(joao, { type: 'SAIDA', occurredAt: now(-10), gps: { lat: -23.186, lng: -46.897, acc: 12 } });
    assert.equal(sai.status, 201);
    const ap = sai.body.detalhe.apuracao;
    assert.equal(ap.permanenciaMin, 380);
    assert.equal(ap.excedenteMin, 80);
    assert.equal(ap.valorEstimado, Math.round((80 / 60) * 28 * 1.38 * 100) / 100);
    assert.ok(sai.body.detalhe.timeline.some((e) => e.type === 'APURACAO'), 'apuração automática na saída');
    assert.ok(sai.body.detalhe.alertas.some((a) => /localização indisponível/.test(a.texto)));

    // Advocacia não vê antes do encaminhamento
    assert.equal((await t.call('GET', `/api/operations/${opId}`, null, adv)).status, 404);
    const enc0 = await t.call('POST', `/api/operations/${opId}/encaminhar`, {}, marina);
    assert.equal(enc0.status, 409, 'sem dossiê não encaminha');

    const dos = await t.call('POST', `/api/operations/${opId}/dossie`, {}, marina);
    assert.equal(dos.status, 201);
    const doc = await t.call('GET', `/api/dossies/${dos.body.hash}`, null, marina);
    const { sha256 } = require('../server/store');
    assert.equal(sha256(JSON.stringify(doc.body.content)), dos.body.hash, 'hash do dossiê confere');
    assert.equal(doc.body.content.marcos.length, 6);

    assert.equal((await t.call('POST', `/api/operations/${opId}/encaminhar`, {}, marina)).status, 201);
    assert.equal((await t.call('GET', `/api/operations/${opId}`, null, adv)).status, 200);
    const st = await t.call('POST', `/api/operations/${opId}/juridico-status`, { status: 'EM_ANALISE' }, adv);
    assert.equal(st.body.juridico.status, 'EM_ANALISE');
  } finally {
    await t.close();
  }
});

test('sincronização offline é idempotente e preserva o horário original', async () => {
  const t = await boot();
  try {
    const joao = await t.login('joao@tac.demo');
    const opId = (await t.call('POST', '/api/operations/identify', { codigo: 'OP-2026-0001', placa: 'RTB4F27', occurredAt: now(-60) }, joao)).body.op.id;
    const body = { clientEventId: 'offline-123', type: 'CHEGADA', occurredAt: now(-45), gps: { lat: -23.1857, lng: -46.8978, acc: 8 }, photo: PHOTO };
    const a = await t.call('POST', `/api/operations/${opId}/events`, body, joao);
    const b = await t.call('POST', `/api/operations/${opId}/events`, body, joao);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.duplicado, true);
    assert.equal(b.body.detalhe.timeline.filter((e) => e.type === 'CHEGADA').length, 1);
    assert.equal(a.body.evento.occurredAt, body.occurredAt);
    assert.notEqual(a.body.evento.receivedAt, a.body.evento.occurredAt);
    assert.ok(a.body.detalhe.alertas.some((x) => /sem conexão/.test(x.texto)));
  } finally {
    await t.close();
  }
});

test('isolamento entre organizações e divergência preserva o registro original', async () => {
  const t = await boot();
  try {
    const marina = await t.login('portaria@serraazul.demo');
    const paulo = await t.login('cd@horizonte.demo');
    const opsMarina = (await t.call('GET', '/api/operations', null, marina)).body;
    const opsPaulo = (await t.call('GET', '/api/operations', null, paulo)).body;
    assert.ok(opsMarina.every((o) => o.destinoNome.includes('Serra Azul')));
    assert.ok(opsPaulo.every((o) => o.destinoNome.includes('Horizonte')));
    const hist = opsMarina.find((o) => o.codigo === 'OP-2026-0003');
    assert.equal((await t.call('GET', `/api/operations/${hist.id}`, null, paulo)).status, 404);

    const d = (await t.call('GET', `/api/operations/${hist.id}`, null, marina)).body;
    const cheg = d.timeline.find((e) => e.type === 'CHEGADA');
    const div = d.timeline.find((e) => e.type === 'DIVERGENCIA');
    assert.equal(div.refEventId, cheg.id);
    assert.ok(d.apuracao.cenarios.some((c) => /alegado/.test(c.label)));
    assert.ok(d.apuracao.excedenteMin > 0);

    const tr = await t.call('POST', `/api/operations/${hist.id}/events`, { type: 'OCORRENCIA_TRATADA', occurredAt: now(), refEventId: div.id, resolucao: 'acordo', note: 'Partes acordaram considerar 06:31.' }, marina);
    assert.equal(tr.status, 201);
    assert.equal(tr.body.detalhe.timeline.find((e) => e.type === 'CHEGADA').occurredAt, cheg.occurredAt);
  } finally {
    await t.close();
  }
});

test('cadeia de hash detecta adulteração do log', async () => {
  const t = await boot();
  try {
    assert.equal(t.app.store.verify().ok, true);
    const file = path.join(t.dataDir, 'events.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    const ev = JSON.parse(lines[5]);
    ev.occurredAt = '2020-01-01T00:00:00.000Z';
    lines[5] = JSON.stringify(ev);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const { EventStore } = require('../server/store');
    const r = new EventStore(t.dataDir).verify();
    assert.equal(r.ok, false);
    assert.equal(r.seq, ev.seq);
  } finally {
    await t.close();
  }
});

test('administrador reinicia a demonstração e a operação volta a ficar livre', async () => {
  const t = await boot();
  try {
    let joao = await t.login('joao@tac.demo');
    assert.equal((await t.call('POST', '/api/operations/identify', { codigo: 'OP-2026-0001', placa: 'RTB4F27' }, joao)).status, 200);
    const marina = await t.login('portaria@serraazul.demo');
    assert.equal((await t.call('POST', '/api/admin/reset-demo', {}, marina)).status, 403);
    const admin = await t.login('admin@brobot.demo');
    assert.equal((await t.call('POST', '/api/admin/reset-demo', {}, admin)).status, 200);
    assert.equal((await t.call('GET', '/api/operations', null, joao)).status, 401, 'sessões antigas expiram');
    joao = await t.login('joao@tac.demo');
    assert.deepEqual((await t.call('GET', '/api/operations', null, joao)).body, []);
    const again = await t.call('POST', '/api/operations/identify', { codigo: 'OP-2026-0001', placa: 'RTB4F27' }, joao);
    assert.equal(again.status, 200);
    assert.equal(t.app.store.verify().ok, true);
  } finally {
    await t.close();
  }
});
