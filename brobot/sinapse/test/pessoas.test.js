'use strict';
// F9b · Cadastro de pessoas e equipes (GOV-001): senha temporária com troca obrigatória, perfil, substituto,
// desativar sem apagar, nunca sem Administração; disponibilidade da própria pessoa.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { senhaTemporaria, validarSenhaNova } = require('../server/modulos/identidade/pessoas');
const { subir } = require('./ajuda');

test('senha temporária: 16 caracteres sem ambíguos; regra da senha nova', () => {
  const s = senhaTemporaria();
  assert.equal(s.length, 16);
  assert.doesNotMatch(s, /[0O1lI]/);
  assert.notEqual(senhaTemporaria(), s);
  assert.throws(() => validarSenhaNova('curta', 'ana@x.com'), /12 caracteres/);
  assert.throws(() => validarSenhaNova('ana.silva-2026-forte', 'ana.silva@x.com'), /e-mail/);
  assert.throws(() => validarSenhaNova('aaaaaaaaaaaaaa', 'b@x.com'), /previsível/);
  validarSenhaNova('cavalo-bateria-grampo-9', 'ana@x.com');
});

let t; let admin; let marina; let rafael;
const eq = {};
before(async () => {
  t = await subir();
  [admin, marina, rafael] = await Promise.all(['Administração Sinapse', 'Marina Costa', 'Rafael Lima'].map((n) => t.entrarComo(n)));
  for (const e of await t.sql("SELECT id, codigo FROM equipes WHERE tenant_id = (SELECT tenant_id FROM usuarios WHERE nome = 'Marina Costa')")) eq[e.codigo] = e.id;
});
after(async () => { await t.parar(); });

async function entrar(email, senha) {
  const r = await fetch(`${t.base}/api/sessao/entrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const chamar = async (metodo, caminho, corpo) => {
    const x = await fetch(`${t.base}/api${caminho}`, { method: metodo, headers: { cookie, ...(corpo ? { 'content-type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: x.status, corpo: await x.json().catch(() => null) };
  };
  return { status: r.status, corpo: await r.json(), get: (c) => chamar('GET', c), post: (c, b = {}) => chamar('POST', c, b) };
}

test('cadastro: só a Administração; senha temporária obriga a troca antes de qualquer coisa; nada da senha na auditoria', async () => {
  assert.equal((await marina.get('/pessoas')).status, 403, 'Supervisão não cadastra pessoas');
  assert.equal((await marina.post('/pessoas', { nome: 'Nova Pessoa', email: 'nova@brobot.com.br', papel: 'suporte', equipeId: eq.suporte })).status, 403);
  const r = await admin.post('/pessoas', { nome: 'Nova Pessoa', email: 'Nova@Brobot.com.br', papel: 'suporte', equipeId: eq.suporte });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.usuario.email, 'nova@brobot.com.br');
  const temp = r.corpo.senhaTemporaria;
  assert.equal((await admin.post('/pessoas', { nome: 'Outra', email: 'nova@brobot.com.br', papel: 'cs', equipeId: eq.cs })).status, 409, 'e-mail repetido');
  assert.equal((await admin.post('/pessoas', { nome: 'Sem equipe', email: 'x@brobot.com.br', papel: 'cs', equipeId: '00000000-0000-0000-0000-000000000000' })).status, 404);
  assert.equal((await admin.post('/pessoas', { nome: 'Perfil ruim', email: 'y@brobot.com.br', papel: 'dono', equipeId: eq.cs })).status, 400);

  const s = await entrar('nova@brobot.com.br', temp);
  assert.equal(s.status, 200);
  assert.equal(s.corpo.usuario.senhaTrocar, true);
  const bloqueado = await s.get('/ocorrencias');
  assert.equal(bloqueado.status, 403);
  assert.equal(bloqueado.corpo.error.code, 'senha_temporaria');
  assert.equal((await s.post('/senha', { atual: 'errada-errada-1', nova: 'cavalo-bateria-grampo-9' })).status, 422);
  assert.equal((await s.post('/senha', { atual: temp, nova: 'curta' })).status, 400);
  assert.equal((await s.post('/senha', { atual: temp, nova: 'cavalo-bateria-grampo-9' })).status, 200);
  assert.equal((await s.get('/ocorrencias')).status, 200, 'depois da troca, entra normalmente');
  assert.equal((await entrar('nova@brobot.com.br', temp)).status, 422, 'a temporária deixa de valer');

  const aud = JSON.stringify(await t.sql("SELECT antes, depois, motivo FROM auditoria WHERE entidade_id = $1", [r.corpo.usuario.id]));
  assert.ok(!aud.includes(temp) && !aud.includes('cavalo-bateria'), 'senha nunca vai para a auditoria');
});

test('perfil, equipe e substituto; trocar perfil derruba a sessão; nunca sem Administração', async () => {
  const lista = (await admin.get('/pessoas?q=nova')).corpo;
  assert.equal(lista.itens.length, 1);
  const id = lista.itens[0].id;
  const s = await entrar('nova@brobot.com.br', 'cavalo-bateria-grampo-9');
  assert.equal((await s.get('/ocorrencias')).status, 200);
  const rafaelId = (await t.sql("SELECT id FROM usuarios WHERE nome = 'Rafael Lima'"))[0].id;
  const alt = await admin.post(`/pessoas/${id}`, { papel: 'cs', equipeId: eq.cs, substitutoId: rafaelId, motivo: 'Mudou para o CS' });
  assert.deepEqual(alt.corpo.campos.sort(), ['equipe_id', 'papel', 'substituto_id']);
  assert.equal((await s.get('/ocorrencias')).status, 401, 'perfil novo: entra de novo');
  assert.equal((await admin.post(`/pessoas/${id}`, { substitutoId: id })).status, 400, 'não substitui a si mesma');
  assert.equal((await admin.post(`/pessoas/${id}`, { substitutoId: null })).corpo.campos[0], 'substituto_id', 'tira o substituto');

  const adminId = (await t.sql("SELECT id FROM usuarios WHERE nome = 'Administração Sinapse'"))[0].id;
  const outros = await t.sql("SELECT count(*)::int AS n FROM usuarios WHERE papel = 'admin' AND ativo AND tenant_id = (SELECT tenant_id FROM usuarios WHERE id = $1) AND id <> $1", [adminId]);
  assert.equal(outros[0].n, 0, 'cenário: só uma Administração');
  const r = await admin.post(`/pessoas/${adminId}`, { papel: 'supervisor' });
  assert.equal(r.status, 422);
  assert.equal(r.corpo.error.code, 'ultima_administracao');
  assert.equal((await admin.post(`/pessoas/${adminId}/desativar`, { motivo: 'Teste da própria' })).status, 422, 'não se desativa');
});

test('desativar: não apaga, derruba sessão, tira de substituto, o supervisor devolve as ocorrências; reativar; redefinir senha', async () => {
  const id = (await admin.get('/pessoas?q=nova')).corpo.itens[0].id;
  const marinaId = (await t.sql("SELECT id FROM usuarios WHERE nome = 'Marina Costa'"))[0].id;
  await t.sql('UPDATE usuarios SET substituto_id = $1 WHERE id = $2', [id, marinaId]);
  const conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Logística Horizonte'"))[0];
  const oc = (await rafael.post('/ocorrencias', { contaId: conta.id, tipo: 'duvida', prioridade: 'baixa', titulo: 'Com a pessoa que vai sair' })).corpo;
  await t.sql("UPDATE ocorrencias SET responsavel_id = $1, estado = 'em_atendimento' WHERE id = $2", [id, oc.id]);
  const s = await entrar('nova@brobot.com.br', 'cavalo-bateria-grampo-9');

  assert.equal((await admin.post(`/pessoas/${id}/desativar`, {})).status, 400, 'motivo obrigatório');
  assert.equal((await admin.post(`/pessoas/${id}/desativar`, { motivo: 'Saiu da empresa' })).status, 200);
  assert.equal((await s.get('/ocorrencias')).status, 401);
  assert.equal((await entrar('nova@brobot.com.br', 'cavalo-bateria-grampo-9')).status, 422, 'desativada não entra');
  assert.equal((await t.sql('SELECT substituto_id FROM usuarios WHERE id = $1', [marinaId]))[0].substituto_id, null);
  assert.equal((await t.sql('SELECT count(*)::int AS n FROM usuarios WHERE id = $1', [id]))[0].n, 1, 'nada some');
  assert.equal((await admin.get('/pessoas?q=nova')).corpo.itens.length, 0, 'some da lista padrão');
  assert.equal((await admin.get('/pessoas?q=nova&inativos=1')).corpo.itens[0].ativo, false);
  await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar();
  assert.equal((await t.sql('SELECT responsavel_id FROM ocorrencias WHERE id = $1', [oc.id]))[0].responsavel_id, null, 'voltou à fila');

  assert.equal((await admin.post(`/pessoas/${id}/senha`, { motivo: 'Esqueceu a senha' })).status, 422, 'inativa: reative antes');
  assert.equal((await admin.post(`/pessoas/${id}/reativar`, { motivo: 'Voltou' })).status, 200);
  const nova = await admin.post(`/pessoas/${id}/senha`, { motivo: 'Esqueceu a senha' });
  assert.equal(nova.status, 200);
  assert.equal((await entrar('nova@brobot.com.br', 'cavalo-bateria-grampo-9')).status, 422, 'a antiga deixa de valer');
  const s2 = await entrar('nova@brobot.com.br', nova.corpo.senhaTemporaria);
  assert.equal(s2.corpo.usuario.senhaTrocar, true);
});

test('disponibilidade própria e equipes novas', async () => {
  assert.equal((await rafael.post('/eu/disponivel', { disponivel: false })).corpo.disponivel, false);
  assert.equal((await t.sql("SELECT disponivel FROM usuarios WHERE nome = 'Rafael Lima'"))[0].disponivel, false);
  await rafael.post('/eu/disponivel', { disponivel: true });
  assert.equal((await rafael.post('/equipes', { codigo: 'implantacao', nome: 'Implantação' })).status, 403);
  assert.equal((await admin.post('/equipes', { codigo: 'Implantação', nome: 'Implantação' })).status, 400);
  const e = await admin.post('/equipes', { codigo: 'implantacao', nome: 'Implantação' });
  assert.equal(e.status, 201);
  assert.equal((await admin.post('/equipes', { codigo: 'implantacao', nome: 'De novo' })).status, 409);
  assert.equal((await admin.post(`/equipes/${e.corpo.id}`, { nome: 'Implantação de clientes' })).corpo.nome, 'Implantação de clientes');
});
