'use strict';
// F8a · Verificação em duas etapas (TOTP), sessão que expira por inatividade e pedidos de titulares (LGPD).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../server/nucleo/totp');
const { garantirUsuariosTeste } = require('../server/modulos/identidade/usuarios-teste');
const { subir } = require('./ajuda');

const SENHA = 'senha-de-teste-longa-mfa';
process.env.SINAPSE_CHAVE = process.env.SINAPSE_CHAVE || 'chave-de-teste-com-mais-de-32-caracteres!!';

test('TOTP: vetores da RFC 6238 e janela de ±30 s', () => {
  const s = totp.base32(Buffer.from('12345678901234567890'));
  assert.deepEqual([totp.codigo(s, 59000), totp.codigo(s, 1111111109000), totp.codigo(s, 1234567890000)], ['287082', '081804', '005924']);
  const agora = 1_800_000_000_000;
  assert.ok(totp.conferir(s, totp.codigo(s, agora - 30000), agora), 'passo anterior aceito');
  assert.ok(!totp.conferir(s, totp.codigo(s, agora - 90000), agora), 'três passos atrás recusado');
  assert.ok(!totp.conferir(s, '12345', agora));
  assert.match(totp.uri('Sinapse Brobot', 'gestor@brobot.com.br', s), /^otpauth:\/\/totp\/Sinapse%20Brobot%3Agestor%40brobot\.com\.br\?secret=/);
});

let t;
before(async () => { t = await subir(); await garantirUsuariosTeste(t.app.db, { senhaTeste: SENHA, ambiente: 'desenvolvimento' }); });
after(async () => { await t.parar(); });

async function entrar(email, senha = SENHA) {
  const r = await fetch(`${t.base}/api/sessao/entrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) });
  return { status: r.status, corpo: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const chamar = async (cookie, metodo, caminho, corpo) => {
  const r = await fetch(`${t.base}/api${caminho}`, { method: metodo, headers: { cookie, ...(corpo ? { 'content-type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

test('MFA: ativar com o QR, entrar em duas etapas, código errado e bloqueio', async () => {
  const a = await entrar('gestor@brobot.com.br');
  assert.equal(a.corpo.usuario.mfaAtivo, false);
  const ini = await chamar(a.cookie, 'POST', '/mfa/iniciar', {});
  assert.match(ini.corpo.qr, /^data:image\/png;base64,/);
  assert.equal((await chamar(a.cookie, 'POST', '/mfa/confirmar', { codigo: '000000' })).status, 422);
  // o mesmo texto do código é reusado abaixo: gerar de novo pelo relógio pode cair no passo seguinte (outro código, válido)
  const codigoAtivacao = totp.codigo(ini.corpo.segredo);
  assert.equal((await chamar(a.cookie, 'POST', '/mfa/confirmar', { codigo: codigoAtivacao })).corpo.ativo, true);
  const [u] = await t.sql("SELECT mfa_segredo_cifrado FROM usuarios WHERE email = 'gestor@brobot.com.br'");
  assert.ok(!u.mfa_segredo_cifrado.includes(ini.corpo.segredo), 'segredo cifrado no banco');
  // novo login: senha certa ainda não basta
  const b = await entrar('gestor@brobot.com.br');
  assert.deepEqual(b.corpo, { mfaNecessario: true });
  assert.equal((await chamar(b.cookie, 'GET', '/sessao')).corpo.usuario, null, 'sessão pendente não vale');
  assert.equal((await chamar(b.cookie, 'GET', '/ocorrencias')).status, 401);
  assert.equal((await chamar(b.cookie, 'POST', '/sessao/mfa', { codigo: '111111' })).status, 422);
  assert.equal((await chamar(b.cookie, 'POST', '/sessao/mfa', { codigo: codigoAtivacao })).status, 422, 'o código da ativação não vale de novo');
  await t.sql("UPDATE usuarios SET mfa_ultimo_passo = mfa_ultimo_passo - 3 WHERE email = 'gestor@brobot.com.br'"); // simula o passo seguinte (30 s depois)
  const ok = await chamar(b.cookie, 'POST', '/sessao/mfa', { codigo: totp.codigo(ini.corpo.segredo) });
  assert.equal(ok.corpo.usuario.mfaAtivo, true);
  assert.equal((await chamar(b.cookie, 'GET', '/ocorrencias')).status, 200);
  // força bruta no código: 5 erros bloqueiam aquela sessão pendente
  const c = await entrar('gestor@brobot.com.br');
  for (let i = 0; i < 5; i++) await chamar(c.cookie, 'POST', '/sessao/mfa', { codigo: String(100000 + i) });
  assert.equal((await chamar(c.cookie, 'POST', '/sessao/mfa', { codigo: totp.codigo(ini.corpo.segredo) })).status, 429);
  // aparelho perdido: só a Administração redefine, com motivo; as sessões da pessoa caem
  const adm = await entrar('admin@brobot.com.br');
  const [gestor] = await t.sql("SELECT id FROM usuarios WHERE email = 'gestor@brobot.com.br'");
  const sup = await entrar('suporte1@brobot.com.br');
  assert.equal((await chamar(sup.cookie, 'POST', `/usuarios/${gestor.id}/mfa/redefinir`, { motivo: 'celular perdido' })).status, 403);
  assert.equal((await chamar(adm.cookie, 'POST', `/usuarios/${gestor.id}/mfa/redefinir`, { motivo: 'Celular perdido, confirmado por telefone' })).corpo.ativo, false);
  assert.equal((await chamar(b.cookie, 'GET', '/ocorrencias')).status, 401, 'sessão do gestor caiu');
  assert.equal((await t.sql("SELECT count(*)::int AS q FROM auditoria WHERE acao = 'usuario.mfa_redefinido'"))[0].q, 1);
});

test('MFA obrigatório: Administração e Supervisão sem MFA só acessam a ativação', async () => {
  t.cfg.mfaObrigatorio = true;
  try {
    const adm = await entrar('admin@brobot.com.br');
    assert.equal(adm.corpo.usuario.mfaObrigatorio, true);
    const r = await chamar(adm.cookie, 'GET', '/ocorrencias');
    assert.deepEqual([r.status, r.corpo.error.code], [403, 'mfa_obrigatorio']);
    assert.equal((await chamar(adm.cookie, 'POST', '/mfa/iniciar', {})).status, 200, 'a ativação fica liberada');
    const sup = await entrar('suporte1@brobot.com.br');
    assert.equal((await chamar(sup.cookie, 'GET', '/ocorrencias')).status, 200, 'Suporte não é obrigado');
  } finally { t.cfg.mfaObrigatorio = false; }
});

test('sessão parada há mais de 2 horas deixa de valer', async () => {
  const s = await entrar('cs@brobot.com.br');
  assert.ok((await chamar(s.cookie, 'GET', '/sessao')).corpo.usuario);
  await t.sql("UPDATE sessoes SET ultimo_uso_em = now() - interval '3 hours' WHERE usuario_id = (SELECT id FROM usuarios WHERE email = 'cs@brobot.com.br')");
  assert.equal((await chamar(s.cookie, 'GET', '/sessao')).corpo.usuario, null);
});

test('LGPD: localizar, exportar e anonimizar o titular, com motivo e auditoria sem o dado', async () => {
  const marina = await t.entrarComo('Marina Costa'); const rafael = await t.entrarComo('Rafael Lima');
  assert.equal((await rafael.get('/lgpd/titular?telefone=11987654321')).status, 403);
  const l = (await marina.get('/lgpd/titular?telefone=(11)98765-4321')).corpo;
  assert.ok(l.pontosFocais.length >= 1 && l.mensagens >= 0);
  const ex = await marina.post('/lgpd/exportar', { telefone: '11987654321', motivo: 'Pedido do titular, protocolo LGPD-001' });
  assert.equal(ex.corpo.titular.telefone, '+5511987654321');
  assert.ok(Array.isArray(ex.corpo.mensagens));
  assert.equal((await marina.post('/lgpd/anonimizar', { telefone: '11987654321', motivo: 'Pedido de eliminação LGPD-002' })).status, 400, 'exige a confirmação digitada');
  const an = await marina.post('/lgpd/anonimizar', { telefone: '11987654321', motivo: 'Pedido de eliminação LGPD-002', confirmacao: 'ANONIMIZAR' });
  assert.equal(an.status, 200);
  assert.ok(an.corpo.pontosFocais >= 1);
  const [pf] = await t.sql("SELECT nome, telefone, vigente, opt_out FROM pontos_focais WHERE id = $1", [l.pontosFocais[0].id]);
  assert.deepEqual([pf.nome, pf.telefone, pf.vigente, pf.opt_out], ['Titular anonimizado', null, false, true]);
  assert.equal((await t.sql("SELECT count(*)::int AS q FROM interacoes WHERE destinatario = '+5511987654321'"))[0].q, 0);
  const aud = await t.sql("SELECT entidade_id, depois FROM auditoria WHERE acao = 'lgpd.anonimizacao'");
  assert.doesNotMatch(JSON.stringify(aud), /98765/, 'auditoria sem o telefone');
  assert.equal((await marina.post('/lgpd/anonimizar', { telefone: '11987654321', motivo: 'De novo, LGPD-003', confirmacao: 'ANONIMIZAR' })).status, 404, 'nada mais a anonimizar');
});
