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

process.env.WHATSAPP_MODE = process.env.WHATSAPP_MODE || 'simulado'; // testes do simulador; o modo manual tem teste próprio
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

test('Motorista opera sozinho: registra cada passo e o destino confirma respondendo pelo WhatsApp', async () => {
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const marina = await t.login('portaria@serraazul.demo');
    // Login simplificado do motorista: celular + código
    assert.equal((await t.call('POST', '/api/login', { telefone: '(11) 98888-0001', pin: '0000' })).status, 401);
    const lj = await t.call('POST', '/api/login', { telefone: '(11) 98888-0001', pin: '1234' });
    assert.equal(lj.status, 200);
    assert.equal(lj.body.user.role, 'tac');
    const joao = lj.body.token;

    // QA-01: identificador único; destinatário não cria operação
    assert.equal((await t.call('POST', '/api/operations', { tipo: 'CARGA', destinoOrgId: 'serra-azul', placa: 'ABC1D23', capacidadeToneladas: 30 }, marina)).status, 403);
    const op = await nova(t, carla);
    const op2 = await nova(t, carla, { tipo: 'CARGA', placa: 'ABC1D23' });
    assert.notEqual(op.codigo, op2.codigo);

    // Viagens disponíveis para a placa do motorista: um toque para começar
    const v = await t.call('GET', '/api/tac/viagens', null, joao);
    assert.ok(v.body.disponiveis.some((o) => o.codigo === op.codigo));
    assert.ok(!v.body.disponiveis.some((o) => o.codigo === op2.codigo), 'só viagens da placa dele');
    assert.equal((await t.call('POST', '/api/operations/identify', { codigo: op.codigo, placa: 'RTB4F27', occurredAt: now() }, joao)).status, 200);
    const dc = await t.call('POST', `/api/operations/${op.id}/dados-conferidos`, {}, joao);
    assert.ok(dc.body.timeline.some((e) => e.type === 'DADOS_INFORMADOS' && e.payload.canal === 'conferencia'));

    const post = (tok, body) => t.call('POST', `/api/operations/${op.id}/events`, body, tok);
    const sim = (telefone, texto) => t.call('POST', '/api/sim/whatsapp/responder', { telefone, texto });

    // Chegada: foto obrigatória; dispara WhatsApp para destino (confirmar) e transportadora (avisar)
    assert.equal((await post(joao, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI })).status, 400);
    const cheg = await post(joao, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photo: PHOTO });
    assert.equal(cheg.status, 201);
    const msgs = cheg.body.detalhe.mensagens;
    const mDest = msgs.find((m) => m.para.papel === 'destino');
    const mTransp = msgs.find((m) => m.para.papel === 'transportadora');
    assert.equal(mDest.finalidade, 'CONFIRMAR');
    assert.equal(mDest.para.telefone, '5511900000001');
    assert.match(mDest.texto, /Responda \*SIM\*/);
    assert.match(mDest.texto, /\/c\/[A-Za-z0-9_-]{20,}/, 'mensagem leva o link da foto');
    assert.equal(mTransp.finalidade, 'INFORMAR');
    assert.equal(cheg.body.detalhe.apuracao.pendente, true, 'limite só começa na confirmação');
    assert.ok(!fs.readFileSync(path.join(t.dataDir, 'events.jsonl'), 'utf8').match(/\/c\/[A-Za-z0-9_-]{20,}/), 'link não fica no log');

    // Simulador marca entregue/lida; resposta "Sim" vira confirmação com origem WhatsApp
    await t.call('GET', '/api/sim/whatsapp');
    await t.call('POST', '/api/sim/whatsapp/abrir', { telefone: '5511900000001' });
    const r1 = await sim('5511900000001', 'Sim');
    assert.equal(r1.body.resultado, 'confirmado');
    let det = (await t.call('GET', `/api/operations/${op.id}`, null, joao)).body;
    const confEv = det.timeline.find((e) => e.type === 'CHEGADA_CONFIRMADA');
    assert.equal(confEv.origem, 'whatsapp');
    assert.match(confEv.actor.name, /Marina \(WhatsApp\)/);
    assert.equal(det.apuracao.marcoInicial, confEv.occurredAt, 'QA-08: confirmação inicia o Limite de Estadia');
    assert.equal(det.mensagens.find((m) => m.id === mDest.id).status, 'lida');
    // Transportadora responde OK = ciência do aviso
    const r2 = await sim('5511900000010', 'ok');
    assert.equal(r2.body.resultado, 'ciente');
    // Resposta repetida não duplica a confirmação
    await sim('5511900000001', 'sim');
    det = (await t.call('GET', `/api/operations/${op.id}`, null, joao)).body;
    assert.equal(det.timeline.filter((e) => e.type === 'CHEGADA_CONFIRMADA').length, 1);

    // Deslocamento > 300 m
    assert.equal((await t.call('POST', `/api/operations/${op.id}/posicao`, { lat: JUNDIAI.lat + 0.005, lng: JUNDIAI.lng }, joao)).body.foraDoLimite, true);

    // Início: destino responde NÃO → divergência, original preservado
    const ini = await post(joao, { type: 'INICIO', occurredAt: now(), gps: JUNDIAI });
    const r3 = await sim('5511900000001', 'Não, começou 11h');
    assert.equal(r3.body.resultado, 'divergencia');
    det = (await t.call('GET', `/api/operations/${op.id}`, null, carla)).body;
    assert.ok(det.timeline.some((e) => e.type === 'DIVERGENCIA' && e.refEventId === ini.body.evento.id && /Respondeu NÃO/.test(e.payload.note)));
    assert.equal(det.timeline.find((e) => e.type === 'INICIO').occurredAt, ini.body.evento.occurredAt);

    // Término: confirmação pelo webhook oficial (formato da Cloud API)
    await post(joao, { type: 'TERMINO', occurredAt: now() });
    const hook = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from: '5511900000001', id: 'wamid.X', timestamp: String(Math.floor(Date.now() / 1000)), type: 'button', button: { text: 'SIM' } }] } }] }] };
    const wh = await t.call('POST', '/api/whatsapp/webhook', hook);
    assert.equal(wh.body.resultados[0].resultado, 'confirmado');

    // Liberação registrada pelo próprio motorista; destino confirma pelo WhatsApp
    const lib = await post(joao, { type: 'LIBERACAO', occurredAt: now(), photo: PHOTO });
    assert.equal(lib.status, 201);
    assert.equal((await sim('5511900000001', '👍')).body.resultado, 'confirmado');
    det = (await t.call('GET', `/api/operations/${op.id}`, null, joao)).body;
    assert.equal(det.resumo.statusCode, 'LIBERACAO_CONFIRMADA');

    // Saída: foto do comprovante, sem GPS; aviso para a transportadora com o resumo
    assert.equal((await post(joao, { type: 'SAIDA', occurredAt: now() })).status, 400);
    const sai = await post(joao, { type: 'SAIDA', occurredAt: now(), photo: PHOTO });
    assert.equal(sai.status, 201);
    const aviso = sai.body.detalhe.mensagens.filter((m) => m.para.papel === 'transportadora').pop();
    assert.match(aviso.texto, /Tempo de estadia: 0h0\d\. Valor devido: R\$\s?0,00/);
    assert.equal(sai.body.detalhe.resumo.statusCode, 'APURADA');
    assert.equal(sai.body.detalhe.dossies.length, 1);
    const doc = (await t.call('GET', `/api/dossies/${sai.body.detalhe.dossies[0].hash}`, null, carla)).body;
    assert.equal(sha256(JSON.stringify(doc.content)), sai.body.detalhe.dossies[0].hash);
    assert.ok(doc.content.mensagensWhatsApp.some((n) => n.respostas.some((r) => r.interpretacao === 'NAO')));
    assert.ok(doc.content.ocorrencias.some((o) => o.codigo === 'DESLOCAMENTO_FORA_DO_LIMITE'));
  } finally {
    await t.close();
  }
});

test('Sem número do contato, sem resposta e resposta só no WhatsApp do motorista (print)', async () => {
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const joao = (await t.call('POST', '/api/login', { telefone: '11988880001', pin: '1234' })).body.token;
    const op = await nova(t, carla, { responsavelTelefone: '', responsavelNome: '' });
    await t.call('POST', '/api/operations/identify', { codigo: op.codigo, placa: 'RTB4F27', occurredAt: now() }, joao);
    const cheg = await t.call('POST', `/api/operations/${op.id}/events`, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photo: PHOTO }, joao);
    const falha = cheg.body.detalhe.mensagens.find((m) => m.para.papel === 'destino');
    assert.equal(falha.status, 'falha');
    assert.ok(cheg.body.detalhe.alertas.some((a) => a.codigo === 'WHATSAPP_FALHA'));
    // Motorista informa o WhatsApp da portaria: mensagem sai de novo automaticamente
    assert.equal((await t.call('POST', `/api/operations/${op.id}/contato`, { papel: 'destino', telefone: '12', nome: 'X' }, joao)).status, 400);
    const ct = await t.call('POST', `/api/operations/${op.id}/contato`, { papel: 'destino', telefone: '(11) 97777-6666', nome: 'Portaria' }, joao);
    const nova2 = ct.body.mensagens.find((m) => m.reenvioDe === falha.id);
    assert.ok(nova2 && nova2.status === 'enviada' && nova2.para.telefone === '5511977776666');
    // Reenvio manual pelo motorista
    const re = await t.call('POST', `/api/operations/${op.id}/whatsapp/reenviar`, { mensagemId: nova2.id }, joao);
    assert.equal(re.status, 201);
    const ultima = re.body.mensagens.filter((m) => m.para.papel === 'destino').pop();
    // A pessoa respondeu no WhatsApp pessoal do motorista: ele envia o print
    assert.equal((await t.call('POST', `/api/operations/${op.id}/whatsapp/print`, { mensagemId: ultima.id, resposta: 'SIM' }, joao)).status, 400);
    const pr = await t.call('POST', `/api/operations/${op.id}/whatsapp/print`, { mensagemId: ultima.id, resposta: 'SIM', photo: PHOTO }, joao);
    assert.equal(pr.body.resultado, 'confirmado');
    const c = pr.body.detalhe.timeline.find((e) => e.type === 'CHEGADA_CONFIRMADA');
    assert.equal(c.origem, 'print_whatsapp');
    assert.match(c.actor.name, /print do WhatsApp enviado por João/);
    assert.ok(c.payload.photo.sha256, 'print guardado como evidência');
    // Interpretação das respostas
    const Z = require('../server/whatsapp');
    for (const x of ['SIM', 'sim.', 'Ok', 'Confirmo', '👍', 's']) assert.equal(Z.interpretar(x), 'SIM', x);
    for (const x of ['não', 'Nao confere', 'N', '❌']) assert.equal(Z.interpretar(x), 'NAO', x);
    assert.equal(Z.interpretar('quem é?'), 'OUTRO');
    assert.equal(Z.normFone('(11) 98888-0001'), '5511988880001');
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

test('Modo manual: WhatsApp do próprio motorista, número informado na hora e confirmação pelo link', async () => {
  const antes = process.env.WHATSAPP_MODE;
  process.env.WHATSAPP_MODE = 'manual';
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const joao = (await t.call('POST', '/api/login', { telefone: '11988880001', pin: '1234' })).body.token;
    const op = await nova(t, carla, { responsavelTelefone: '', responsavelNome: '' });
    await t.call('POST', '/api/operations/identify', { codigo: op.codigo, placa: 'RTB4F27', occurredAt: now() }, joao);
    const cheg = await t.call('POST', `/api/operations/${op.id}/events`, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photo: PHOTO }, joao);
    const ms = cheg.body.detalhe.mensagens;
    assert.equal(ms.length, 1, 'um envio por passo: só a portaria');
    const m = ms[0];
    assert.equal(m.status, 'aguardando_envio');
    assert.match(m.texto, /Para \*CONFIRMAR\*, toque no link/);
    assert.match(m.whatsappUrl, /^https:\/\/wa\.me\/\?text=/, 'sem número: motorista escolhe o contato');
    // Motorista digita na hora o número de quem está na portaria
    assert.equal((await t.call('POST', `/api/operations/${op.id}/whatsapp/destinatario`, { mensagemId: m.id, telefone: '123' }, joao)).status, 400);
    const dst = await t.call('POST', `/api/operations/${op.id}/whatsapp/destinatario`, { mensagemId: m.id, telefone: '(11) 96666-5555', nome: 'Sr. Carlos', salvar: true }, joao);
    const m2 = dst.body.mensagens.find((x) => x.id === m.id);
    assert.equal(m2.para.telefone, '5511966665555');
    assert.match(m2.whatsappUrl, /^https:\/\/wa\.me\/5511966665555\?text=/);
    assert.equal(dst.body.op.responsavelTelefone, '+5511966665555', 'salvo para as próximas mensagens');
    await t.call('POST', `/api/operations/${op.id}/whatsapp/${m.id}/enviada`, {}, joao);
    // A pessoa abre o link e marca NÃO CONFERE
    const token = m2.texto.match(/\/c\/([A-Za-z0-9_-]{20,})/)[1];
    assert.equal((await t.call('GET', `/api/public/link/${token}`)).status, 200);
    const dv = await t.call('POST', `/api/public/link/${token}/divergir`, { nome: 'Carlos', motivo: 'Chegou às 06:31' });
    assert.equal(dv.status, 201);
    let det = (await t.call('GET', `/api/operations/${op.id}`, null, joao)).body;
    assert.ok(det.timeline.some((e) => e.type === 'DIVERGENCIA' && /Não confere/.test(e.payload.note)));
    assert.equal(det.mensagens[0].status, 'enviada_manual');
    assert.ok(det.mensagens[0].linkAbertoEm);
    // Próximo passo já vai com o número salvo; confirmação pelo link
    const ini = await t.call('POST', `/api/operations/${op.id}/events`, { type: 'INICIO', occurredAt: now(), gps: JUNDIAI }, joao);
    const mi = ini.body.detalhe.mensagens.find((x) => x.refEventId === ini.body.evento.id);
    assert.equal(mi.para.telefone, '5511966665555');
    const tk2 = mi.texto.match(/\/c\/([A-Za-z0-9_-]{20,})/)[1];
    assert.equal((await t.call('POST', `/api/public/link/${tk2}/confirmar`, { nome: 'Carlos' })).status, 201);
    det = (await t.call('GET', `/api/operations/${op.id}`, null, joao)).body;
    assert.equal(det.timeline.find((e) => e.type === 'INICIO_CONFIRMADO').origem, 'link_whatsapp');
    assert.equal((await t.call('GET', '/api/sim/whatsapp')).status, 404, 'simulador desligado no modo manual');
  } finally {
    await t.close();
    if (antes === undefined) delete process.env.WHATSAPP_MODE; else process.env.WHATSAPP_MODE = antes;
  }
});
