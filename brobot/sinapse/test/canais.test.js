'use strict';
// Canais: telefonia (treino, celular, SIP) e WhatsApp oficial (webhook assinado, status, envio pela Cloud API).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { cifrar, decifrar } = require('../server/nucleo/cifra');
const { numeroParaDiscar } = require('../server/modulos/telefonia/provedores');
const { subir } = require('./ajuda');
const whatsappQr = require('../server/modulos/integracoes/whatsapp-qr');
const falso = require('../server/modulos/integracoes/whatsapp-qr-falso')._teste;
process.env.SINAPSE_WA_QR_FALSO = '1';

const CHAVE = 'chave-de-teste-com-mais-de-32-caracteres!!';
const SEGREDO = 'segredo-do-app-da-meta-para-teste';

test('cifra AES-256-GCM: ida e volta; sem SINAPSE_CHAVE recusa guardar segredo', () => {
  const antes = process.env.SINAPSE_CHAVE;
  delete process.env.SINAPSE_CHAVE;
  assert.throws(() => cifrar('x'), /SINAPSE_CHAVE/);
  process.env.SINAPSE_CHAVE = CHAVE;
  const c = cifrar('senha-do-ramal');
  assert.doesNotMatch(c, /senha/);
  assert.equal(decifrar(c), 'senha-do-ramal');
  if (antes === undefined) delete process.env.SINAPSE_CHAVE; else process.env.SINAPSE_CHAVE = antes;
});

test('número para a operadora: formatos e prefixo', () => {
  assert.equal(numeroParaDiscar('+5511987654321', { formato_numero: '0ddd' }), '011987654321');
  assert.equal(numeroParaDiscar('+5511987654321', { formato_numero: 'ddd', prefixo: '0' }), '011987654321');
  assert.equal(numeroParaDiscar('+5511987654321', { formato_numero: 'e164' }), '+5511987654321');
});

let t; let fetchOriginal; const enviadosMeta = [];
before(async () => {
  process.env.SINAPSE_CHAVE = CHAVE;
  process.env.META_APP_SECRET = SEGREDO;
  process.env.WA_VERIFY_TOKEN = 'verifica-teste';
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, op) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      enviadosMeta.push({ url: String(url), corpo: JSON.parse(op.body) });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.meta-${enviadosMeta.length}` }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return fetchOriginal(url, op);
  };
  t = await subir();
  await t.processar();
});
after(async () => { globalThis.fetch = fetchOriginal; await t.parar(); });

async function tarefaDeLigacao() {
  await t.avancar(48); // pré-rodada da Rota Sul chega no D-2 (ligação)
  const [lig] = await t.sql("SELECT id FROM tarefas WHERE tipo = 'ligacao' AND estado = 'aberta' AND titulo LIKE '%Transportadora Rota Sul%'");
  return lig;
}

test('ligação em treino a partir da tarefa: atendida conclui a tarefa ("atendeu"), registra na ocorrência e o processo segue', async () => {
  const lig = await tarefaDeLigacao();
  assert.ok(lig, 'tarefa de ligação existe');
  const juliana = await t.entrarComo('Juliana Alves');
  const cfg = await juliana.get('/telefonia/config');
  assert.equal(cfg.corpo.provedor, 'treino');
  const ch = await juliana.post('/telefonia/chamadas', { canal: 'computador', tarefaId: lig.id });
  assert.equal(ch.status, 201);
  assert.equal(ch.corpo.numero, '+5511987654321', 'liga para o ponto focal da conta da tarefa');
  assert.equal((await juliana.post(`/telefonia/chamadas/${ch.corpo.id}/eventos`, { evento: 'espera' })).status, 409, 'espera antes de atender é inválida');
  for (const ev of ['discando', 'tocando', 'atendida']) assert.equal((await juliana.post(`/telefonia/chamadas/${ch.corpo.id}/eventos`, { evento: ev })).status, 200);
  const fim = await juliana.post(`/telefonia/chamadas/${ch.corpo.id}/eventos`, { evento: 'encerrada', resultado: 'atendida', anotacao: 'Vai fazer o vínculo SNE hoje à tarde.' });
  assert.equal(fim.corpo.status, 'atendida');
  const [tar] = await t.sql('SELECT estado, resultado_codigo, resultado FROM tarefas WHERE id = $1', [lig.id]);
  assert.deepEqual([tar.estado, tar.resultado_codigo], ['concluida', 'atendeu']);
  assert.match(tar.resultado, /vínculo SNE/);
  const reg = await t.sql("SELECT texto FROM interacoes WHERE canal = 'telefone' AND chamada_id = $1", [ch.corpo.id]);
  assert.equal(reg.length, 1);
  await t.avancar(0.01);
  const formal = await t.sql("SELECT count(*)::int AS n FROM interacoes i JOIN contas c ON c.id = i.conta_id WHERE c.nome = 'Transportadora Rota Sul' AND i.modelo = 'formalizacao_ligacao@1'");
  assert.equal(formal[0].n, 0, 'atendeu: não formaliza "tentamos ligar"');
  const rafael = await t.entrarComo('Rafael Lima');
  assert.equal((await rafael.post(`/telefonia/chamadas/${ch.corpo.id}/eventos`, { evento: 'encerrada' })).status, 404, 'ligação de outra pessoa');
});

test('SIP: sem ramal não liga pelo computador; ramal com senha cifrada; a credencial só sai para o dono', async () => {
  const marina = await t.entrarComo('Marina Costa');
  assert.equal((await marina.post('/telefonia/admin/config', { provedor: 'sip', operadora: 'Teste VoIP', wsUrl: 'wss://sip.exemplo.com/ws', dominio: 'sip.exemplo.com', celular: true })).status, 200);
  const rafael = await t.entrarComo('Rafael Lima');
  const cfg = await rafael.get('/telefonia/config');
  assert.equal(cfg.corpo.computador.ok, false);
  assert.match(cfg.corpo.computador.motivo, /ramal/);
  assert.equal((await rafael.post('/telefonia/chamadas', { canal: 'computador', numero: '(11) 91234-5678' })).status, 409);
  const [u] = await t.sql("SELECT id FROM usuarios WHERE email = 'rafael@sinapse.demo'");
  assert.equal((await rafael.post(`/telefonia/admin/ramais/${u.id}`, { usuarioSip: '1001', senha: 'x' })).status, 403, 'só a gestão cadastra ramal');
  assert.equal((await marina.post(`/telefonia/admin/ramais/${u.id}`, { usuarioSip: '1001', senha: 'senha-sip-1001', nomeExibicao: 'Rafael' })).status, 200);
  const [r] = await t.sql('SELECT senha_cifrada FROM telefonia_ramais WHERE usuario_id = $1', [u.id]);
  assert.ok(r.senha_cifrada.startsWith('v1:') && !r.senha_cifrada.includes('senha-sip'));
  const sessao = await rafael.post('/telefonia/sessao');
  assert.equal(sessao.corpo.senha, 'senha-sip-1001');
  assert.equal(sessao.corpo.ws_url, 'wss://sip.exemplo.com/ws');
  const admin = await marina.get('/telefonia/admin');
  assert.ok(!JSON.stringify(admin.corpo).includes('senha-sip'), 'a tela de configuração nunca mostra a senha');
  await marina.post('/telefonia/admin/config', { provedor: 'treino', celular: true });
});

test('celular: "não atendeu" conclui a tarefa e o painel da gestão conta a ligação', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const ch = await marina.post('/telefonia/chamadas', { canal: 'celular', numero: '(21) 99876-5432', nome: 'Henrique' });
  assert.equal(ch.corpo.discar, '+5521998765432');
  const fim = await marina.post(`/telefonia/chamadas/${ch.corpo.id}/eventos`, { evento: 'encerrada', resultado: 'nao_atendida' });
  assert.equal(fim.corpo.status, 'nao_atendida');
  const painel = await marina.get('/telefonia/painel?dias=7');
  assert.ok(painel.corpo.equipe.some((x) => x.nome === 'Marina Costa' && x.total >= 1));
});

const assinar = (corpo) => `sha256=${crypto.createHmac('sha256', SEGREDO).update(corpo).digest('hex')}`;
const webhook = (corpo, assinatura) => fetch(`${t.base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': assinatura ?? assinar(corpo) }, body: corpo });

test('WhatsApp oficial: conectar número, enviar pela Cloud API, receber mensagem (dedup) e status de entrega', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const v = await fetch(`${t.base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verifica-teste&hub.challenge=12345`);
  assert.equal(await v.text(), '12345');
  assert.equal((await fetch(`${t.base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`)).status, 403);
  assert.equal((await marina.post('/whatsapp/numero', { phoneNumberId: '1098765432', numeroExibicao: '+55 11 4000-0000', token: 'EAAG-token-de-teste-bem-longo' })).status, 200);
  const [num] = await t.sql('SELECT token_cifrado FROM whatsapp_numeros WHERE phone_number_id = $1', ['1098765432']);
  assert.ok(!num.token_cifrado.includes('EAAG'), 'token cifrado no banco');
  // envio: resposta ao cliente sai pela Cloud API
  const [o] = await t.sql("SELECT id FROM ocorrencias WHERE titulo LIKE 'Como exportar o relatório%'");
  const r = await marina.post(`/ocorrencias/${o.id}/respostas`, { texto: 'Teste pela API oficial' });
  await t.avancar(0.01);
  const [it] = await t.sql('SELECT status_entrega, id_externo FROM interacoes WHERE id = $1', [r.corpo.id]);
  assert.equal(it.status_entrega, 'enviada');
  assert.match(it.id_externo, /^wamid\.meta-/);
  assert.equal(enviadosMeta.at(-1).corpo.text.body, 'Teste pela API oficial');
  assert.match(enviadosMeta.at(-1).url, /1098765432\/messages$/);
  // status: lida, e um "entregue" atrasado não volta o status
  const st = (status) => JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1098765432' }, statuses: [{ id: it.id_externo, status }] } }] }] });
  assert.equal((await webhook(st('read'))).status, 200);
  await webhook(st('delivered'));
  assert.equal((await t.sql('SELECT status_entrega FROM interacoes WHERE id = $1', [r.corpo.id]))[0].status_entrega, 'lida');
  // mensagem recebida: assinatura errada é recusada; repetida não duplica
  const msg = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1098765432' }, contacts: [{ wa_id: '5531987651234', profile: { name: 'Isabela' } }],
    messages: [{ id: 'wamid.recebida-1', from: '5531987651234', type: 'text', text: { body: 'Corrigi a credencial, podem revalidar?' } }] } }] }] });
  assert.equal((await webhook(msg, 'sha256=errada')).status, 401);
  assert.equal((await webhook(msg)).status, 200);
  assert.equal((await webhook(msg)).status, 200);
  await t.avancar(0.01);
  const [ent] = await t.sql("SELECT duplicatas, estado FROM entradas WHERE chave_idempotencia = 'wamid.recebida-1'");
  assert.deepEqual([ent.duplicatas, ent.estado], [1, 'processada']);
  const rec = await t.sql("SELECT ocorrencia_id FROM interacoes WHERE id_externo = 'wamid.recebida-1'");
  assert.equal(rec.length, 1, 'uma mensagem só, na conversa do ponto focal');
});

const esperar = async (fn, ms = 3000) => { const fim = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > fim) throw new Error('tempo esgotado'); await new Promise((r) => setTimeout(r, 40)); } };

test('WhatsApp por QR Code: conectar, escanear, receber (dedup), responder, eco do celular, status e queda', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const lucas = await t.entrarComo('Lucas Ferreira');
  assert.equal((await lucas.post('/whatsapp/qr/conectar')).status, 403, 'só quem gere canais');
  const c = await marina.post('/whatsapp/qr/conectar');
  assert.equal(c.status, 200);
  const id = c.corpo.id;
  const qr = await esperar(async () => { const r = await marina.get('/whatsapp/qr'); return r.corpo.qr ? r.corpo : null; });
  assert.match(qr.qr, /^data:image\/png;base64,/);
  assert.equal(qr.estado, 'aguardando_qr');
  const pasta = whatsappQr.pastaDa(id);
  falso.escanear(pasta, '5511940000001');
  await esperar(async () => (await marina.get('/whatsapp/qr')).corpo.estado === 'conectado');
  const [n] = await t.sql('SELECT status, ativo, numero_exibicao FROM whatsapp_numeros WHERE id = $1', [id]);
  assert.deepEqual([n.status, n.ativo, n.numero_exibicao], ['conectado', true, '+5511940000001']);
  assert.equal((await t.sql("SELECT count(*)::int AS q FROM whatsapp_numeros WHERE ativo AND tenant_id = $1", [await t.tenant()]))[0].q, 1, 'só um número ativo');
  // cliente escreve pelo WhatsApp: vira entrada e ocorrência; a mesma mensagem repetida não duplica
  const sock = falso.sockDa(pasta);
  const msg = { key: { remoteJid: '5531965432109@s.whatsapp.net', id: 'QR-IN-1', fromMe: false }, pushName: 'Karina', message: { conversation: 'Meu certificado venceu, o que faço?' } };
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [msg] });
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [msg] });
  await esperar(async () => (await t.sql("SELECT 1 FROM entradas WHERE chave_idempotencia = 'QR-IN-1'")).length);
  await t.avancar(0.01);
  const [ent] = await t.sql("SELECT duplicatas, estado FROM entradas WHERE chave_idempotencia = 'QR-IN-1'");
  assert.deepEqual([ent.duplicatas, ent.estado], [1, 'processada']);
  const [rec] = await t.sql("SELECT ocorrencia_id FROM interacoes WHERE id_externo = 'QR-IN-1'");
  assert.ok(rec.ocorrencia_id, 'mensagem ligada a uma ocorrência');
  // resposta pelo sistema sai pelo celular conectado; status chega até "lida"
  const r = await marina.post(`/ocorrencias/${rec.ocorrencia_id}/respostas`, { texto: 'Olá! Vamos renovar com você.' });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  await t.avancar(0.01);
  assert.equal(sock._enviadas.at(-1).conteudo.text, 'Olá! Vamos renovar com você.');
  await esperar(async () => (await t.sql('SELECT status_entrega FROM interacoes WHERE id = $1', [r.corpo.id]))[0].status_entrega === 'lida');
  // quem respondeu direto no celular também fica no histórico da conversa (uma vez)
  falso.ecoar(pasta, { para: '553165432109', texto: 'Mandei o passo a passo pelo celular' });
  await esperar(async () => (await t.sql("SELECT 1 FROM interacoes WHERE texto = 'Mandei o passo a passo pelo celular' AND ocorrencia_id = $1", [rec.ocorrencia_id])).length);
  // queda de rede: reconecta sozinho; saída no celular (401): pede QR de novo
  falso.cair(pasta, 401);
  await esperar(async () => (await t.sql('SELECT status FROM whatsapp_numeros WHERE id = $1', [id]))[0].status === 'erro');
  const fim = await marina.get('/whatsapp/qr');
  assert.match(fim.corpo.erro, /Escaneie o QR Code de novo/);
  assert.equal((await marina.post('/whatsapp/qr/desconectar')).status, 200);
});
