'use strict';
// Testes dos critérios de aceite do Estadia BR (DEV 2.0). Rodar com: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/server');
const { demoPhotoPng } = require('../server/seed');
const D = require('../server/domain');
const Amelia = require('../server/amelia');
const { sha256, EventStore } = require('../server/store');

const PHOTO = 'data:image/png;base64,' + demoPhotoPng(40, 30).toString('base64');
const JUNDIAI = { lat: -23.18571, lng: -46.89784, acc: 8 };
const now = (offsetMin = 0) => new Date(Date.now() + offsetMin * 60000).toISOString();

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

async function nova(t, carla, extra = {}) {
  const r = await t.call('POST', '/api/operations', { tipo: 'DESCARGA', destinoOrgId: 'serra-azul', placa: 'RTB4F27', capacidadeToneladas: 30, nfe: '999', localNome: 'CD Jundiaí', lat: JUNDIAI.lat, lng: JUNDIAI.lng, responsavelNome: 'Marina', responsavelTelefone: '+55 11 90000-0001', ...extra }, carla);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.op;
}

test('QA-01..32: fluxo completo da descarga com confirmação via link, limite de 5h, cálculo sobre o tempo total e conciliação', async () => {
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const joao = await t.login('joao@tac.demo');
    const marina = await t.login('portaria@serraazul.demo');
    const rafael = await t.login('doca@serraazul.demo');
    const adv = await t.login('juridico@andradeprado.demo');

    // QA-01: identificador único; destino não cria operação
    assert.equal((await t.call('POST', '/api/operations', { tipo: 'CARGA', destinoOrgId: 'serra-azul', placa: 'ABC1D23', capacidadeToneladas: 30 }, marina)).status, 403);
    const op = await nova(t, carla);
    const op2 = await nova(t, carla, { tipo: 'CARGA' });
    assert.notEqual(op.codigo, op2.codigo);
    assert.equal(op.tipo, 'DESCARGA');

    // Amélia (QA-33/35): interpreta texto, confirma uma vez, sem inventar dados
    const am = await t.call('POST', '/api/amelia/interpretar', { texto: `Placa RTB 4F27, carreta sider, descarga de 28 toneladas de açúcar no CD Jundiaí, nota fiscal 999, ${op.codigo}` }, joao);
    assert.equal(am.status, 200);
    const campos = Object.fromEntries(am.body.entidades.map((e) => [e.campo, e.valor]));
    assert.equal(campos.placa, 'RTB4F27');
    assert.equal(campos.tipo, 'DESCARGA');
    assert.equal(campos.pesoToneladas, 28);
    assert.equal(campos.nfe, '999');
    assert.equal(campos.mdfe, undefined, 'não inventa MDF-e');
    assert.equal(am.body.candidatos.length, 1);
    const conf = await t.call('POST', '/api/amelia/confirmar', { opId: op.id, texto: am.body.texto, clientEventId: 'am-1' }, joao);
    assert.equal(conf.status, 200);
    assert.ok(conf.body.timeline.some((e) => e.type === 'DADOS_INFORMADOS' && e.origem === 'amelia'));
    assert.equal(conf.body.op.tacUserId != null, true);

    const post = (tok, body) => t.call('POST', `/api/operations/${op.id}/events`, body, tok);
    // QA-02/03: chegada com foto e GPS; foto obrigatória
    assert.equal((await post(joao, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI })).status, 400);
    const cheg = await post(joao, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photo: PHOTO });
    assert.equal(cheg.status, 201);
    assert.ok(cheg.body.evento.payload.photo.sha256);
    assert.equal(cheg.body.evento.origem, 'app');
    // Antes da confirmação, o limite não começou
    assert.equal(cheg.body.detalhe.apuracao.pendente, true);
    // QA-04/05: link de confirmação gerado automaticamente para o destino
    const link = cheg.body.detalhe.links.find((l) => l.confirmType === 'CHEGADA_CONFIRMADA');
    assert.ok(link && link.url.includes('/c/') && link.whatsappUrl.startsWith('https://wa.me/5511900000001'));
    const token = link.url.split('/c/')[1];
    // O token não aparece no log de eventos (só o hash)
    assert.ok(!fs.readFileSync(path.join(t.dataDir, 'events.jsonl'), 'utf8').includes(token));
    // RN-45: a página pública mostra só o necessário
    const pub = await t.call('GET', `/api/public/link/${token}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.operacao.placa, 'RTB4F27');
    assert.equal(pub.body.operacao.nfe, undefined);
    assert.equal(pub.body.botao, 'Confirmar chegada');

    // Confirmação pelo portal também é possível; aqui usamos o link (QA-06/07)
    const pc = await t.call('POST', `/api/public/link/${token}/confirmar`, { nome: 'Marina Coelho' });
    assert.equal(pc.status, 201);
    assert.match(pc.body.confirmado.por, /Marina Coelho \(via link\)/);
    const again = await t.call('POST', `/api/public/link/${token}/confirmar`, {});
    assert.equal(again.status, 200, 'reconfirmar não duplica');
    let det = (await t.call('GET', `/api/operations/${op.id}`, null, carla)).body;
    const confEv = det.timeline.filter((e) => e.type === 'CHEGADA_CONFIRMADA');
    assert.equal(confEv.length, 1);
    assert.equal(confEv[0].origem, 'link_whatsapp');
    assert.notEqual(confEv[0].occurredAt, cheg.body.evento.occurredAt, 'confirmação tem timestamp próprio');
    assert.equal(det.timeline.find((e) => e.type === 'CHEGADA').occurredAt, cheg.body.evento.occurredAt, 'registro original preservado');
    // QA-08: a confirmação inicia o Limite de Estadia
    assert.equal(det.apuracao.pendente, false);
    assert.equal(det.apuracao.marcoInicial, confEv[0].occurredAt);
    assert.ok(det.timeline.some((e) => e.type === 'LINK_VISUALIZADO'));

    // QA-09/10: deslocamento > 300 m vira ocorrência
    const pos = await t.call('POST', `/api/operations/${op.id}/posicao`, { lat: JUNDIAI.lat + 0.005, lng: JUNDIAI.lng }, joao);
    assert.equal(pos.body.foraDoLimite, true);
    assert.ok(pos.body.distanciaM > 300);
    const dentro = await t.call('POST', `/api/operations/${op.id}/posicao`, { lat: JUNDIAI.lat + 0.0005, lng: JUNDIAI.lng }, joao);
    assert.equal(dentro.body.foraDoLimite, false);

    // QA-11..16 (início pelo TAC, confirmação no portal, término, liberação e confirmação da liberação)
    const ini = await post(joao, { type: 'INICIO', occurredAt: now(), gps: { erro: 'Permissão de localização negada' } });
    assert.equal(ini.status, 201);
    assert.equal((await post(rafael, { type: 'INICIO_CONFIRMADO', occurredAt: now(), refEventId: ini.body.evento.id })).status, 201);
    const ter = await post(joao, { type: 'TERMINO', occurredAt: now() });
    assert.equal((await post(rafael, { type: 'TERMINO_CONFIRMADO', occurredAt: now(), refEventId: ter.body.evento.id })).status, 201);
    assert.equal((await post(joao, { type: 'LIBERACAO', occurredAt: now() })).status, 403);
    const lib = await post(marina, { type: 'LIBERACAO', occurredAt: now(), photo: PHOTO });
    assert.equal(lib.status, 201);
    const lc = await post(joao, { type: 'LIBERACAO_CONFIRMADA', occurredAt: now(), refEventId: lib.body.evento.id });
    assert.equal(lc.status, 201);
    assert.equal(lc.body.detalhe.resumo.statusCode, 'LIBERACAO_CONFIRMADA');

    // QA-17..19: saída exige foto do comprovante, mas não GPS
    assert.equal((await post(joao, { type: 'SAIDA', occurredAt: now() })).status, 400);
    const sai = await post(joao, { type: 'SAIDA', occurredAt: now(), photo: PHOTO });
    assert.equal(sai.status, 201);
    assert.equal(sai.body.evento.payload.gps, undefined);

    // QA-20..25: apuração automática na saída. Liberação − confirmação da chegada.
    det = sai.body.detalhe;
    const ap = det.apuracao;
    assert.equal(ap.marcoFinal, lib.body.evento.occurredAt);
    assert.equal(ap.excedeu, false, 'operação curta fica dentro do limite');
    assert.equal(ap.valorDevido, 0);
    assert.equal(det.resumo.statusCode, 'APURADA');
    assert.equal(det.dossies.length, 1, 'dossiê gerado automaticamente');

    // QA-29: dossiê reúne eventos, ocorrências e notificações; hash confere
    const doc = (await t.call('GET', `/api/dossies/${det.dossies[0].hash}`, null, carla)).body;
    assert.equal(sha256(JSON.stringify(doc.content)), det.dossies[0].hash);
    assert.ok(doc.content.ocorrencias.some((o) => o.codigo === 'DESLOCAMENTO_FORA_DO_LIMITE'));
    assert.ok(doc.content.notificacoes.length >= 2);
    assert.equal(doc.content.marcos.length, 6);
    assert.ok(doc.content.dadosInformados);

    // Jurídico só vê depois do encaminhamento
    assert.equal((await t.call('GET', `/api/operations/${op.id}`, null, adv)).status, 404);
    assert.equal((await t.call('POST', `/api/operations/${op.id}/encaminhar`, {}, marina)).status, 403, 'destino não encaminha');
    assert.equal((await t.call('POST', `/api/operations/${op.id}/encaminhar`, {}, carla)).status, 201);
    const jr = await t.call('POST', `/api/operations/${op.id}/juridico-status`, { status: 'CONCLUIDO', resultado: 'Sem valor a cobrar.' }, adv);
    assert.equal(jr.body.juridico.status, 'CONCLUIDO');
    assert.equal((await t.call('POST', `/api/operations/${op.id}/encerrar`, {}, carla)).body.resumo.statusCode, 'ENCERRADA');
    assert.equal((await post(joao, { type: 'PAGAMENTO_REGISTRADO', occurredAt: now(), valor: 10 })).status, 409, 'encerrada não aceita registros');
  } finally {
    await t.close();
  }
});

test('RN-22..27: até 5h → R$ 0; acima de 5h → tempo total × capacidade × R$ 2,50 (exemplo 6h × 30 t = R$ 450)', () => {
  const rule = D.ruleFor('2026-10-05');
  assert.equal(rule.id, 'ESTADIA-BR');
  assert.equal(rule.valorTonHora, 2.5);
  const mk = (minutos, cap = 30) => {
    const t0 = Date.parse('2026-10-05T09:00:00Z');
    const ev = (id, type, min, ref) => ({ id, type, opId: 'x', occurredAt: new Date(t0 + min * 60000).toISOString(), receivedAt: new Date(t0 + min * 60000).toISOString(), actor: { role: 'tac' }, refEventId: ref || null, payload: {} });
    return D.project([
      { id: 'c', type: 'OPERACAO_CRIADA', opId: 'x', occurredAt: '2026-10-05T08:00:00Z', receivedAt: '2026-10-05T08:00:00Z', actor: { role: 'transportadora' }, payload: { capacidadeToneladas: cap } },
      ev('a', 'CHEGADA', -10), ev('b', 'CHEGADA_CONFIRMADA', 0, 'a'), ev('i', 'INICIO', 30), ev('t', 'TERMINO', 60), ev('l', 'LIBERACAO', minutos),
    ]);
  };
  assert.equal(D.apurar(mk(300)).valorDevido, 0, 'exatamente 5h');
  assert.equal(D.apurar(mk(299)).valorDevido, 0);
  assert.equal(D.apurar(mk(360)).valorDevido, 450, 'exemplo do documento');
  assert.equal(D.apurar(mk(301)).valorDevido, Math.round((301 / 60) * 30 * 2.5 * 100) / 100, 'tempo total, não só o excedente');
  assert.equal(D.apurar(mk(360, 24)).valorDevido, 360);
  assert.equal(D.apurar(mk(360)).marcoInicial, '2026-10-05T09:00:00.000Z', 'marco inicial = confirmação da chegada');
});

test('RN-29..34: conciliação financeira e status (aguardando, parcial, divergente, em tratativa, pago)', async () => {
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const ana = await t.login('ana@tac.demo');
    const marina = await t.login('portaria@serraazul.demo');
    const ops = (await t.call('GET', '/api/operations', null, carla)).body;
    const op3 = ops.find((o) => o.codigo === 'OP-2026-0003');
    assert.equal(op3.financeiro.devido, 840, '11,2 h × 30 t × R$ 2,50');
    assert.equal(op3.financeiro.pago, 400);
    assert.equal(op3.financeiro.saldo, 440);
    assert.equal(op3.statusCode, 'PAGAMENTO_PARCIAL');
    assert.equal(ops.find((o) => o.codigo === 'OP-2026-0004').statusCode, 'ENCERRADA');

    const post = (tok, body) => t.call('POST', `/api/operations/${op3.id}/events`, body, tok);
    assert.equal((await post(marina, { type: 'PAGAMENTO_REGISTRADO', occurredAt: now(), valor: 10 })).status, 403, 'destino não registra pagamento');
    let r = await post(ana, { type: 'SITUACAO_FINANCEIRA', occurredAt: now(), situacao: 'EM_TRATATIVA', note: 'Negociando saldo' });
    assert.equal(r.body.detalhe.resumo.statusCode, 'EM_TRATATIVA');
    r = await post(carla, { type: 'PAGAMENTO_REGISTRADO', occurredAt: now(), valor: '440,00', origem: 'negociacao' });
    assert.equal(r.body.detalhe.financeiro.saldo, 0);
    assert.equal(r.body.detalhe.resumo.statusCode, 'PAGO');
    r = await post(carla, { type: 'PAGAMENTO_REGISTRADO', occurredAt: now(), valor: 50, origem: 'outros' });
    assert.equal(r.body.detalhe.resumo.statusCode, 'VALOR_DIVERGENTE', 'pago acima do devido');
    const doc = await t.call('POST', `/api/operations/${op3.id}/dossie`, {}, carla);
    const content = (await t.call('GET', `/api/dossies/${doc.body.hash}`, null, carla)).body.content;
    assert.equal(content.financeiro.pagamentos.length, 3);
    assert.equal(content.financeiro.negociacoes.length, 1);
  } finally {
    await t.close();
  }
});

test('retificação auditável, offline idempotente, link expirado e isolamento entre organizações', async () => {
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const joao = await t.login('joao@tac.demo');
    const paulo = await t.login('cd@horizonte.demo');
    const op = await nova(t, carla, { capacidadeToneladas: 28 });

    // Retificação preserva valor anterior e motivo (RF-50)
    assert.equal((await t.call('POST', `/api/operations/${op.id}/retificar`, { campo: 'capacidadeToneladas', novo: '30', motivo: 'x' }, carla)).status, 400);
    const rt = await t.call('POST', `/api/operations/${op.id}/retificar`, { campo: 'capacidadeToneladas', novo: '30', motivo: 'Conferido no CRLV' }, carla);
    assert.equal(rt.body.op.capacidadeToneladas, 30);
    const ev = rt.body.timeline.find((e) => e.type === 'OPERACAO_RETIFICADA');
    assert.equal(ev.payload.anterior, 28);
    assert.equal(ev.payload.motivo, 'Conferido no CRLV');

    // Offline: idempotência e horário original (QA-31/32)
    await t.call('POST', '/api/operations/identify', { codigo: op.codigo, placa: 'RTB4F27', occurredAt: now(-90) }, joao);
    const body = { clientEventId: 'off-1', type: 'CHEGADA', occurredAt: now(-60), gps: JUNDIAI, photo: PHOTO };
    const a = await t.call('POST', `/api/operations/${op.id}/events`, body, joao);
    const b = await t.call('POST', `/api/operations/${op.id}/events`, body, joao);
    assert.equal(a.status, 201);
    assert.equal(b.body.duplicado, true);
    assert.equal(b.body.detalhe.timeline.filter((e) => e.type === 'CHEGADA').length, 1);
    assert.equal(a.body.evento.occurredAt, body.occurredAt);
    assert.ok(a.body.detalhe.alertas.some((x) => x.codigo === 'SINCRONIZACAO_TARDIA'));

    // Link expirado: página informa e permite pedir outro (35.4)
    const token = a.body.detalhe.links[0].url.split('/c/')[1];
    const links = t.app.store.loadLinks();
    links[token].expiraEm = now(-1);
    t.app.store.saveLinks(links);
    const exp = await t.call('GET', `/api/public/link/${token}`);
    assert.equal(exp.status, 410);
    assert.equal((await t.call('POST', `/api/public/link/${token}/confirmar`, {})).status, 410);
    assert.equal((await t.call('POST', `/api/public/link/${token}/renovar`, {})).status, 200);
    const nl = await t.call('POST', `/api/operations/${op.id}/links`, {}, carla);
    assert.equal(nl.body.links.length, 1, 'novo link ativo');
    assert.ok(nl.body.timeline.some((e) => e.type === 'LINK_RENOVACAO_SOLICITADA'));
    assert.equal((await t.call('GET', '/api/public/link/tokeninvalidotokeninvalido')).status, 404);

    // Isolamento (RN-43)
    assert.equal((await t.call('GET', `/api/operations/${op.id}`, null, paulo)).status, 404);
    assert.ok((await t.call('GET', '/api/operations', null, paulo)).body.every((o) => o.destinoNome.includes('Horizonte')));

    // Relatórios com relação carga × descarga pela NF-e
    const rel = await t.call('GET', '/api/relatorios', null, carla);
    assert.equal(rel.status, 200);
    assert.ok(rel.body.relacoesCargaDescarga.some((g) => g.operacoes.some((o) => o.tipo === 'CARGA') && g.operacoes.some((o) => o.tipo === 'DESCARGA')));
    assert.equal((await t.call('GET', '/api/relatorios', null, joao)).status, 403);
  } finally {
    await t.close();
  }
});

test('Amélia não cria dados que não estão na mensagem e entende placa soletrada', () => {
  const r = Amelia.interpretar('bom dia, tô chegando');
  assert.equal(r.compreendido, false);
  const v = Amelia.interpretar('placa Q P E 2 H 91 carregamento de soja 32 toneladas CT-e 4455 MDF-e 7788');
  const c = Object.fromEntries(v.entidades.map((e) => [e.campo, e.valor]));
  assert.equal(c.placa, 'QPE2H91');
  assert.equal(c.tipo, 'CARGA');
  assert.equal(c.mercadoria, 'soja');
  assert.equal(c.pesoToneladas, 32);
  assert.equal(c.cte, '4455');
  assert.equal(c.mdfe, '7788');
  assert.equal(c.nfe, undefined);
  for (const e of v.entidades) assert.ok(e.trecho.length > 0, 'todo dado traz o trecho de origem');
});

test('cadeia de hash detecta adulteração e o reinício da demonstração recria os dados', async () => {
  const t = await boot();
  try {
    assert.equal(t.app.store.verify().ok, true);
    const admin = await t.login('admin@estadiabr.demo');
    const file = path.join(t.dataDir, 'events.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    const ev = JSON.parse(lines[5]);
    ev.occurredAt = '2020-01-01T00:00:00.000Z';
    lines[5] = JSON.stringify(ev);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const r = new EventStore(t.dataDir).verify();
    assert.equal(r.ok, false);
    assert.equal(r.seq, ev.seq);

    assert.equal((await t.call('POST', '/api/admin/reset-demo', {}, admin)).status, 200);
    assert.equal(t.app.store.verify().ok, true);
    const admin2 = await t.login('admin@estadiabr.demo');
    assert.equal((await t.call('GET', '/api/operations', null, admin2)).body.length, 4);
  } finally {
    await t.close();
  }
});
