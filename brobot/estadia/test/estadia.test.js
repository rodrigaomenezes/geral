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
    assert.equal(cheg.body.detalhe.apuracao.pendente, false, 'D-29: com GPS no local o limite começa no registro, sem esperar a confirmação');
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
    assert.equal(det.apuracao.marcoInicial, cheg.body.evento.occurredAt, 'D-29: chegada registrada com GPS no local inicia o Limite de Estadia');
    assert.equal(det.apuracao.inicioPor, 'localizacao');
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
  assert.equal(D.apurar(mk(315)).valorDevido, 393.75, '5h15 cobra 5h15: não há tempo sem cobrança');
  assert.equal(D.apurar(mk(360, 24)).valorDevido, 360);
  assert.equal(D.apurar(mk(360)).marcoInicial, '2026-10-05T09:00:00.000Z', 'sem GPS na chegada: marco inicial = confirmação da chegada');
  // D-29: com GPS no local, o tempo conta do registro do motorista, mesmo sem confirmação do destino
  const comGps = (gps, confirma) => {
    const t0 = Date.parse('2026-10-05T09:00:00Z');
    const ev = (id, type, min, extra = {}) => ({ id, type, opId: 'y', occurredAt: new Date(t0 + min * 60000).toISOString(), receivedAt: new Date(t0 + min * 60000).toISOString(), actor: { role: 'tac' }, refEventId: null, payload: {}, ...extra });
    return D.project([
      { id: 'c', type: 'OPERACAO_CRIADA', opId: 'y', occurredAt: '2026-10-05T08:00:00Z', receivedAt: '2026-10-05T08:00:00Z', actor: { role: 'transportadora' }, payload: { capacidadeToneladas: 30, lat: JUNDIAI.lat, lng: JUNDIAI.lng } },
      ev('a', 'CHEGADA', 0, { payload: { gps } }), ...(confirma ? [ev('b', 'CHEGADA_CONFIRMADA', 40, { refEventId: 'a', actor: { role: 'destino' } })] : []), ev('l', 'LIBERACAO', 360),
    ]);
  };
  const noLocal = D.apurar(comGps(JUNDIAI, false));
  assert.equal(noLocal.pendente, false, 'não depende da confirmação');
  assert.equal(noLocal.inicioPor, 'localizacao');
  assert.equal(noLocal.valorDevido, 450, '6h desde o registro × 30 t × R$ 2,50');
  const longe = D.apurar(comGps({ lat: JUNDIAI.lat + 0.01, lng: JUNDIAI.lng, acc: 10 }, false));
  assert.equal(longe.pendente, true, 'GPS a mais de 300 m não comprova a chegada');
  const longeConfirmado = D.apurar(comGps({ lat: JUNDIAI.lat + 0.01, lng: JUNDIAI.lng, acc: 10 }, true));
  assert.equal(longeConfirmado.inicioPor, 'confirmacao');
  assert.equal(longeConfirmado.marcoInicial, '2026-10-05T09:40:00.000Z');
});

test('RN-29..34: conciliação financeira e status (aguardando, parcial, divergente, em tratativa, pago)', async () => {
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const ana = await t.login('ana@tac.demo');
    const marina = await t.login('portaria@serraazul.demo');
    const ops = (await t.call('GET', '/api/operations', null, carla)).body;
    const op3 = ops.find((o) => o.codigo === 'OP-2026-0003');
    assert.equal(op3.financeiro.devido, 850, '11h20 desde a chegada registrada no local × 30 t × R$ 2,50');
    assert.equal(op3.financeiro.pago, 400);
    assert.equal(op3.financeiro.saldo, 450);
    assert.equal(op3.statusCode, 'PAGAMENTO_PARCIAL');
    assert.equal(ops.find((o) => o.codigo === 'OP-2026-0004').statusCode, 'ENCERRADA');

    const post = (tok, body) => t.call('POST', `/api/operations/${op3.id}/events`, body, tok);
    assert.equal((await post(marina, { type: 'PAGAMENTO_REGISTRADO', occurredAt: now(), valor: 10 })).status, 403, 'destino não registra pagamento');
    let r = await post(ana, { type: 'SITUACAO_FINANCEIRA', occurredAt: now(), situacao: 'EM_TRATATIVA', note: 'Negociando saldo' });
    assert.equal(r.body.detalhe.resumo.statusCode, 'EM_TRATATIVA');
    r = await post(carla, { type: 'PAGAMENTO_REGISTRADO', occurredAt: now(), valor: '450,00', origem: 'negociacao' });
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
    const ops = (await t.call('GET', '/api/operations', null, admin2)).body;
    for (const c of ['OP-2026-0001', 'OP-2026-0002', 'OP-2026-0003', 'OP-2026-0004']) assert.ok(ops.some((o) => o.codigo === c), c);
    assert.ok(ops.length > 20, 'histórico de demonstração para os painéis');
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

test('Autocadastro do motorista, cadastro guiado do caminhão, viagem própria e várias fotos por registro', async () => {
  const t = await boot();
  try {
    // Autocadastro: código óbvio recusado, celular repetido recusado
    assert.equal((await t.call('POST', '/api/cadastro/motorista', { nome: 'José Ribeiro', telefone: '11977776666', pin: '1111', aceite: true })).status, 400);
    assert.equal((await t.call('POST', '/api/cadastro/motorista', { nome: 'José Ribeiro', telefone: '11977776666', pin: '2580' })).status, 400, 'sem aceite');
    const c = await t.call('POST', '/api/cadastro/motorista', { nome: 'José Ribeiro', telefone: '(11) 97777-6666', pin: '2580', cpf: '529.982.247-25', aceite: true });
    assert.equal(c.status, 201);
    assert.equal(c.body.user.role, 'tac');
    assert.equal((await t.call('POST', '/api/cadastro/motorista', { nome: 'Outro', telefone: '11977776666', pin: '2581', aceite: true })).status, 409);
    const ze = c.body.token;

    // Sem caminhão não cria viagem; composição exige o número certo de placas
    assert.equal((await t.call('POST', '/api/tac/viagens', { tipo: 'DESCARGA', destinoNome: 'Coop' }, ze)).status, 409);
    assert.equal((await t.call('POST', '/api/frota/conjuntos', { composicao: 'BITREM', placaVeiculo: 'ABC1D23', placasImplementos: ['ABC1D24'], carroceria: 'GRANELEIRO', capacidadeToneladas: 37 }, ze)).status, 400);
    const cj = await t.call('POST', '/api/frota/conjuntos', { composicao: 'BITREM', placaVeiculo: 'abc-1d23', placasImplementos: ['ABC1D24', 'ABC1D25'], carroceria: 'GRANELEIRO', capacidadeToneladas: '37,5', padrao: true }, ze);
    assert.equal(cj.status, 201, JSON.stringify(cj.body));
    assert.equal(cj.body.me.placa, 'ABC1D23');
    assert.deepEqual(cj.body.conjunto.placasImplementos, ['ABC1D24', 'ABC1D25']);

    // Viagem cadastrada pelo motorista: já vinculada, com placas, composição e capacidade do conjunto; idempotente
    const body = { tipo: 'DESCARGA', destinoOrgId: 'serra-azul', tipoCarga: 'GRANEL_SOLIDO', mercadoria: 'soja', responsavelTelefone: '11900000001', clientEventId: 'viagem-1' };
    const v = await t.call('POST', '/api/tac/viagens', body, ze);
    assert.equal(v.status, 201);
    assert.equal(v.body.op.tacUserId, c.body.user.id);
    assert.equal(v.body.op.capacidadeToneladas, 37.5);
    assert.equal(v.body.op.composicao, 'BITREM');
    assert.equal((await t.call('POST', '/api/tac/viagens', body, ze)).body.op.id, v.body.op.id);
    // Viagem própria aparece para o destino escolhido; frota isolada entre donos
    const marina = await t.login('portaria@serraazul.demo');
    assert.ok((await t.call('GET', '/api/operations', null, marina)).body.some((o) => o.id === v.body.op.id));
    assert.equal((await t.call('GET', '/api/frota', null, await t.login('operacao@rodoviasul.demo'))).body.conjuntos.some((x) => x.placa === 'ABC1D23'), false);

    // Várias fotos no mesmo registro e fotos adicionadas depois (evento próprio)
    const p2 = 'data:image/png;base64,' + demoPhotoPng(41, 30).toString('base64');
    const ch = await t.call('POST', `/api/operations/${v.body.op.id}/events`, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photos: [PHOTO, p2] }, ze);
    assert.equal(ch.status, 201);
    assert.equal(ch.body.evento.payload.photos.length, 2);
    assert.equal((await t.call('POST', `/api/operations/${v.body.op.id}/events`, { type: 'INICIO', occurredAt: now(), photos: Array(7).fill(PHOTO) }, ze)).status, 400, 'máximo de fotos');
    const ex = await t.call('POST', `/api/operations/${v.body.op.id}/events`, { type: 'EVIDENCIA_ADICIONADA', occurredAt: now(), refEventId: ch.body.evento.id, photos: [p2.replace('A', 'A')], note: 'lacre' }, ze);
    assert.equal(ex.status, 201);
    const st = D.project(t.app.store.forOp(v.body.op.id));
    assert.equal(D.fotosDo(st, st.milestones.CHEGADA).length, 3);
    assert.equal(st.milestones.CHEGADA.payload.photos.length, 2, 'registro original não muda');
  } finally { await t.close(); }
});

test('Painel: cada perfil vê só as próprias viagens, com tempos, origens, destinos e cargas', async () => {
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const pc = (await t.call('GET', '/api/painel', null, carla)).body;
    assert.ok(pc.linhas.length > 10);
    assert.ok(pc.linhas.every((r) => r.transportadora === 'Rodovia Sul Transportes'));
    const r = pc.linhas.find((x) => x.tempoMin != null && x.concluida);
    for (const k of ['dia', 'destino', 'origem', 'motorista', 'composicao', 'tipoCarga', 'devido', 'status']) assert.ok(k in r, k);
    const paulo = await t.login('cd@horizonte.demo');
    assert.ok((await t.call('GET', '/api/painel', null, paulo)).body.linhas.every((x) => x.destinoOrgId === 'horizonte'));
    const joao = (await t.call('POST', '/api/login', { telefone: '11988880001', pin: '1234' })).body.token;
    const pj = (await t.call('GET', '/api/painel', null, joao)).body;
    assert.ok(pj.linhas.length > 0 && pj.linhas.every((x) => x.motorista === 'João Batista Ferreira'));
    // João continua com a viagem da demonstração ao vivo disponível (nenhuma viagem dele em andamento)
    const v = (await t.call('GET', '/api/tac/viagens', null, joao)).body;
    assert.ok(v.disponiveis.some((o) => o.codigo === 'OP-2026-0001'));
    assert.ok(v.minhas.every((o) => !['AGUARDANDO_CHEGADA', 'AGUARDANDO_CONFIRMACAO_CHEGADA', 'CHEGADA_CONFIRMADA', 'OPERACAO_INICIADA', 'INICIO_CONFIRMADO', 'OPERACAO_FINALIZADA', 'TERMINO_CONFIRMADO', 'LIBERADA', 'LIBERACAO_CONFIRMADA'].includes(o.statusCode)));
  } finally { await t.close(); }
});

test('Autocadastro de empresa com CNPJ válido e operação a partir do conjunto da frota', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('POST', '/api/cadastro/empresa', { tipo: 'transportadora', empresa: 'Teste', cnpj: '11.222.333/0001-00', nome: 'Maria', email: 'm@t.com', senha: 'segredo123', aceite: true })).status, 400);
    const e = await t.call('POST', '/api/cadastro/empresa', { tipo: 'transportadora', empresa: 'Transportes Teste', cnpj: '11.222.333/0001-81', nome: 'Maria', email: 'm@t.com', senha: 'segredo123', aceite: true });
    assert.equal(e.status, 201);
    assert.equal(e.body.user.role, 'transportadora');
    const carla = await t.login('operacao@rodoviasul.demo');
    const fr = (await t.call('GET', '/api/frota', null, carla)).body;
    const bitrem = fr.conjuntos.find((x) => x.composicao === 'BITREM');
    const op = await nova(t, carla, { conjuntoId: bitrem.id, placa: '', capacidadeToneladas: '', tipoCarga: 'GRANEL_SOLIDO' });
    assert.equal(op.placa, bitrem.placa);
    assert.equal(op.capacidadeToneladas, bitrem.capacidadeToneladas);
    assert.deepEqual(op.placasImplementos, bitrem.placasImplementos);
  } finally { await t.close(); }
});

test('A mesma foto em duas operações continua visível para quem vê qualquer uma delas', async () => {
  const t = await boot();
  try {
    const joao = (await t.call('POST', '/api/login', { telefone: '11988880001', pin: '1234' })).body.token;
    const op = (await t.call('GET', '/api/tac/viagens', null, joao)).body.disponiveis[0];
    await t.call('POST', '/api/operations/identify', { codigo: op.codigo, placa: op.placa }, joao);
    // Mesma imagem usada no histórico de demonstração (outra operação, de outro motorista)
    const igual = 'data:image/png;base64,' + demoPhotoPng().toString('base64');
    const ch = await t.call('POST', `/api/operations/${op.id}/events`, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photos: [igual] }, joao);
    const file = ch.body.evento.payload.photos[0].file;
    const base = `http://127.0.0.1:${t.app.server.address().port}`;
    assert.equal((await fetch(`${base}/api/evidencias/${file}?token=${joao}`)).status, 200);
    // Empresa sem nenhuma operação com essa foto não acessa
    const nova = await t.call('POST', '/api/cadastro/empresa', { tipo: 'destino', empresa: 'Destino Sem Viagens', cnpj: '11.222.333/0001-81', nome: 'Rita', email: 'rita@t.com', senha: 'segredo123', aceite: true });
    assert.equal((await fetch(`${base}/api/evidencias/${file}?token=${nova.body.token}`)).status, 404);
  } finally { await t.close(); }
});

test('Conferência das fotos: origem, horário e foto repetida viram selo de apoio, sem bloquear o registro', async () => {
  const t = await boot();
  try {
    const joao = (await t.call('POST', '/api/login', { telefone: '11988880001', pin: '1234' })).body.token;
    const op = (await t.call('GET', '/api/tac/viagens', null, joao)).body.disponiveis[0];
    await t.call('POST', '/api/operations/identify', { codigo: op.codigo, placa: op.placa }, joao);
    const cfg = (await t.call('GET', '/api/config', null, joao)).body;
    assert.ok(cfg.guiasFoto.CHEGADA.pedir.includes('placa'));
    assert.equal(cfg.iaFotos, false, 'sem chave da API a IA fica desligada');
    const grande = 'data:image/png;base64,' + demoPhotoPng(400, 300).toString('base64');
    // Foto da galeria, tirada 2 horas antes: o registro vale, mas a conferência marca como duvidosa
    const ch = await t.call('POST', `/api/operations/${op.id}/events`, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI,
      photos: [{ data: grande, origem: 'galeria', capturadaEm: now(-120) }] }, joao);
    assert.equal(ch.status, 201);
    assert.equal(ch.body.evento.payload.photos[0].origem, 'galeria');
    const an = ch.body.detalhe.timeline.find((e) => e.type === 'EVIDENCIA_ANALISADA' && e.refEventId === ch.body.evento.id);
    assert.ok(an, 'conferência gravada como evento próprio');
    assert.equal(an.actor.role, 'sistema');
    assert.equal(an.payload.resultado, 'duvidosa');
    assert.equal(an.payload.motor, 'regras');
    assert.ok(an.payload.achados.some((a) => a.regra === 'origem'));
    assert.ok(an.payload.achados.some((a) => a.regra === 'horario'));
    // Foto nova tirada na hora: reconfere o marco com todas as fotos
    const outra = 'data:image/png;base64,' + demoPhotoPng(420, 300).toString('base64');
    const ad = await t.call('POST', `/api/operations/${op.id}/events`, { type: 'EVIDENCIA_ADICIONADA', occurredAt: now(), refEventId: ch.body.evento.id,
      photos: [{ data: outra, origem: 'camera', capturadaEm: now() }] }, joao);
    assert.equal(ad.status, 201);
    assert.equal(ad.body.detalhe.timeline.filter((e) => e.type === 'EVIDENCIA_ANALISADA' && e.refEventId === ch.body.evento.id).pop().payload.fotos.length, 2);
    // A mesma foto da chegada reaproveitada na saída: não aderente
    const sai = await t.call('POST', `/api/operations/${op.id}/events`, { type: 'SAIDA', occurredAt: now(), photos: [{ data: grande, origem: 'camera', capturadaEm: now() }] }, joao);
    assert.equal(sai.status, 201);
    const anSai = sai.body.detalhe.timeline.find((e) => e.type === 'EVIDENCIA_ANALISADA' && e.refEventId === sai.body.evento.id);
    assert.equal(anSai.payload.resultado, 'nao_aderente');
    assert.ok(anSai.payload.achados.some((a) => a.regra === 'repetida' && a.txt.includes(op.codigo)));
    // O Dossiê da saída já sai com a conferência de cada marco
    const doc = (await t.call('GET', `/api/dossies/${sai.body.detalhe.dossies[0].hash}`, null, joao)).body.content;
    assert.equal(doc.marcos.find((m) => m.tipo === 'SAIDA').conferenciaFotos.resultado, 'Não aderente');
    assert.match(doc.ressalva, /conferência das fotos/i);
  } finally { await t.close(); }
});

test('IA de visão: lê a placa, confere a cena e o resultado entra no selo (cliente simulado)', async () => {
  const V = require('../server/visao');
  const pedidos = [];
  const cliente = { beta: { messages: { create: async (req) => { pedidos.push(req); return { model: req.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
    cena_corresponde: true, foto_de_tela: false, nitida: true, placa_lida: 'RTB-4F27', resumo: 'Caminhão na portaria com a placa legível.',
    itens: [{ id: 'placa', atendido: 'sim', detalhe: 'RTB4F27' }, { id: 'local', atendido: 'sim', detalhe: 'Portaria com nome do CD' }] }) }] }; } } } };
  const foto = { file: 'x.jpg', sha256: 'a'.repeat(64), bytes: 90000, mime: 'image/jpeg', origem: 'camera', capturadaEm: now() };
  const base = { marco: 'CHEGADA', op: { placa: 'RTB4F27', placasImplementos: ['RTC5A12'], tipo: 'DESCARGA' }, fotos: [foto], ocorridoEm: now(), usosDe: () => [], lerArquivo: () => Buffer.from('img') };
  const ok = await V.analisar(base, cliente);
  assert.equal(ok.resultado, 'aderente');
  assert.equal(ok.motor, 'ia');
  assert.equal(ok.placaLida, 'RTB4F27');
  assert.equal(ok.placaConfere, true);
  assert.equal(pedidos[0].messages[0].content[0].type, 'image');
  assert.equal(pedidos[0].output_config.format.type, 'json_schema');
  // Placa diferente e item faltando: duvidosa; cena errada: não aderente
  cliente.beta.messages.create = async (req) => ({ model: req.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
    cena_corresponde: false, foto_de_tela: false, nitida: true, placa_lida: 'ABC1D23', resumo: 'Foto de dentro da cabine.', itens: [{ id: 'placa', atendido: 'nao', detalhe: '' }] }) }] });
  const ruim = await V.analisar(base, cliente);
  assert.equal(ruim.resultado, 'nao_aderente');
  assert.equal(ruim.placaConfere, false);
  // Falha da API não derruba nada: ficam as regras
  cliente.beta.messages.create = async () => { throw new Error('rede'); };
  const falha = await V.analisar(base, cliente);
  assert.equal(falha.motor, 'regras');
  assert.equal(falha.resultado, 'aderente');
});

test('WhatsApp por transportadora: plano manual (sem custo) ou API oficial, escolhido pela administração', async () => {
  const antes = { mode: process.env.WHATSAPP_MODE, token: process.env.WHATSAPP_TOKEN, id: process.env.WHATSAPP_PHONE_ID };
  const fetchReal = global.fetch;
  const enviados = [];
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://graph.facebook.com/')) { enviados.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ messages: [{ id: 'wamid.teste' + enviados.length }] }), { status: 200 }); }
    return fetchReal(url, opts);
  };
  process.env.WHATSAPP_MODE = 'manual'; process.env.WHATSAPP_TOKEN = 'token-teste'; process.env.WHATSAPP_PHONE_ID = '123';
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const admin = await t.login('admin@estadiabr.demo');
    const joao = (await t.call('POST', '/api/login', { telefone: '11988880001', pin: '1234' })).body.token;
    const lista = (await t.call('GET', '/api/admin/users', null, admin)).body;
    assert.equal(lista.whatsappApi, true);
    assert.equal(lista.orgs.find((o) => o.id === 'rodovia-sul').whatsappEfetivo, 'manual', 'padrão do ambiente: manual');
    // Plano manual: a mensagem fica para o motorista enviar pelo próprio WhatsApp
    const op1 = await nova(t, carla);
    await t.call('POST', '/api/operations/identify', { codigo: op1.codigo, placa: 'RTB4F27', occurredAt: now() }, joao);
    const c1 = await t.call('POST', `/api/operations/${op1.id}/events`, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photo: PHOTO }, joao);
    assert.equal(c1.body.detalhe.zapModo, 'manual');
    assert.equal(c1.body.detalhe.mensagens[0].status, 'aguardando_envio');
    assert.equal(enviados.length, 0);
    // A administração passa a Rodovia Sul para a API oficial: envio automático, sem o motorista sair do app
    assert.equal((await t.call('POST', '/api/admin/orgs/rodovia-sul/whatsapp', { modo: 'api' }, carla)).status, 403);
    const r = await t.call('POST', '/api/admin/orgs/rodovia-sul/whatsapp', { modo: 'api' }, admin);
    assert.equal(r.body.efetivo, 'api');
    const op2 = await nova(t, carla, { nfe: '1000' });
    await t.call('POST', '/api/operations/identify', { codigo: op2.codigo, placa: 'RTB4F27', occurredAt: now() }, joao);
    const c2 = await t.call('POST', `/api/operations/${op2.id}/events`, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photo: PHOTO }, joao);
    assert.equal(c2.body.detalhe.zapModo, 'api');
    const m = c2.body.detalhe.mensagens.find((x) => x.para.papel === 'destino');
    assert.equal(m.status, 'enviada');
    assert.equal(enviados[0].to, '5511900000001');
    assert.match(enviados[0].text.body, /Responda \*SIM\*/);
    // A resposta SIM chega pelo webhook e confirma a chegada
    const hook = { entry: [{ changes: [{ value: { messages: [{ from: '5511900000001', id: 'wamid.resp', type: 'text', text: { body: 'Sim' }, context: { id: m.externalId }, timestamp: String(Math.floor(Date.now() / 1000)) }], statuses: [{ id: m.externalId, status: 'read', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] };
    assert.equal((await t.call('POST', '/api/whatsapp/webhook', hook)).status, 200);
    const det = (await t.call('GET', `/api/operations/${op2.id}`, null, joao)).body;
    assert.ok(det.timeline.some((e) => e.type === 'CHEGADA_CONFIRMADA' && e.origem === 'whatsapp'));
    assert.equal(det.mensagens.find((x) => x.id === m.id).status, 'lida');
    // Resposta sem citar a mensagem, vinda do número sem o 9 (como o WhatsApp identifica muitos celulares do Brasil)
    const op3 = await nova(t, carla, { nfe: '1001' });
    await t.call('POST', '/api/operations/identify', { codigo: op3.codigo, placa: 'RTB4F27', occurredAt: now() }, joao);
    await t.call('POST', `/api/operations/${op3.id}/events`, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photo: PHOTO }, joao);
    const hook2 = { entry: [{ changes: [{ value: { messages: [{ from: '551100000001', id: 'wamid.resp2', type: 'text', text: { body: 'sim' }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] };
    await t.call('POST', '/api/whatsapp/webhook', hook2);
    assert.ok((await t.call('GET', `/api/operations/${op3.id}`, null, joao)).body.timeline.some((e) => e.type === 'CHEGADA_CONFIRMADA'), 'número sem o 9 também confirma');
  } finally {
    await t.close();
    global.fetch = fetchReal;
    for (const [k, v] of [['WHATSAPP_MODE', antes.mode], ['WHATSAPP_TOKEN', antes.token], ['WHATSAPP_PHONE_ID', antes.id]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('SMS pelo chip do motorista: texto curto com o link, enviado e entregue entram na mensagem e no Dossiê', async () => {
  const t = await boot();
  try {
    const carla = await t.login('operacao@rodoviasul.demo');
    const joao = (await t.call('POST', '/api/login', { telefone: '11988880001', pin: '1234' })).body.token;
    const op = await nova(t, carla);
    await t.call('POST', '/api/operations/identify', { codigo: op.codigo, placa: 'RTB4F27', occurredAt: now() }, joao);
    const c = await t.call('POST', `/api/operations/${op.id}/events`, { type: 'CHEGADA', occurredAt: now(), gps: JUNDIAI, photo: PHOTO }, joao);
    const m = c.body.detalhe.mensagens.find((x) => x.para.papel === 'destino');
    assert.match(m.smsTexto, /^Estadia BR OP-.*informou que chegou a CD Jundiaí às \d\d:\d\d\. Confirme ou conteste: http.*\/c\//);
    assert.ok(!m.smsTexto.includes('*'), 'SMS sem a formatação do WhatsApp');
    assert.ok(m.smsUrl.startsWith('sms:+5511900000001?&body='));
    // Só o motorista da operação informa o SMS
    assert.equal((await t.call('POST', `/api/operations/${op.id}/sms/${m.id}`, { status: 'enviado', via: 'app' }, carla)).status, 403);
    assert.equal((await t.call('POST', `/api/operations/${op.id}/sms/${m.id}`, { status: 'qualquer' }, joao)).status, 400);
    assert.equal((await t.call('POST', `/api/operations/${op.id}/sms/${m.id}`, { status: 'enviado', via: 'app' }, joao)).status, 201);
    await t.call('POST', `/api/operations/${op.id}/sms/${m.id}`, { status: 'enviado', via: 'app' }, joao); // repetido: ignora
    await t.call('POST', `/api/operations/${op.id}/sms/${m.id}`, { status: 'entregue', via: 'app' }, joao);
    const d = (await t.call('GET', `/api/operations/${op.id}`, null, joao)).body;
    const s = d.mensagens.find((x) => x.id === m.id).sms;
    assert.equal(s.status, 'entregue'); assert.equal(s.via, 'app'); assert.ok(s.enviadoEm && s.entregueEm);
    assert.equal(d.timeline.filter((e) => e.type === 'SMS_STATUS').length, 2);
    // O tempo continua contando pela chegada com GPS, independente do SMS
    assert.equal(d.apuracao.inicioPor, 'localizacao');
    const dz = await t.call('POST', `/api/operations/${op.id}/dossie`, {}, carla);
    assert.equal(dz.status, 201);
  } finally { await t.close(); }
});
