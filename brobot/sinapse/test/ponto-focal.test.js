'use strict';
// F21 · RN-002 / GOV-007: conta operacional sem ponto focal principal válido (vigente, sem opt-out, com canal
// autorizado) vira tarefa da equipe da conta, uma vez por situação; com pendência de rodada é risco (2 h + Supervisão).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let juliana;
before(async () => { t = await subir(); juliana = await t.entrarComo('Juliana Alves'); });
after(async () => { await t.parar(); });

const varrer = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar(); };
const tarefasDa = (contaId) => t.sql("SELECT chave, titulo, e.codigo AS equipe FROM tarefas ta JOIN equipes e ON e.id = ta.equipe_id WHERE chave LIKE $1 ORDER BY chave", [`ponto-focal%:${contaId}:%`]);

test('sem ponto focal principal: tarefa da equipe da conta, uma vez; com pendência de rodada, risco também para a Supervisão', async () => {
  const sem = (await t.sql(`SELECT c.id, c.vip FROM contas c WHERE c.status IN ('ativa','onboarding') AND c.tenant_id = (SELECT id FROM tenants WHERE slug = 'brobot')
    AND NOT EXISTS (SELECT 1 FROM pontos_focais p WHERE p.conta_id = c.id AND p.vigente AND p.papel = 'principal') ORDER BY c.nome LIMIT 1`))[0];
  assert.ok(sem, 'cenário: a demonstração tem conta sem ponto focal principal');
  await varrer(); await varrer();
  // A varredura também roda outras rotinas (pré-rodada etc.): a contagem vale depois dela.
  sem.pend = (await t.sql("SELECT count(*)::int AS n FROM pendencias WHERE conta_id = $1 AND estado IN ('aberta','persistente')", [sem.id]))[0].n;
  const ts = await tarefasDa(sem.id);
  const daConta = ts.filter((x) => x.chave.startsWith('ponto-focal:'));
  assert.equal(daConta.length, 1, 'uma tarefa só');
  assert.equal(daConta[0].equipe, sem.vip ? 'cs' : 'suporte');
  assert.match(daConta[0].titulo, /sem ponto focal principal vigente/);
  assert.equal(ts.some((x) => x.chave.startsWith('ponto-focal-risco:')), sem.pend > 0, 'Supervisão só quando há pendência de rodada');
});

test('ponto focal com opt-out ou sem canal autorizado também é inválido; corrigido, não abre mais', async () => {
  const conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'"))[0].id;
  await varrer();
  assert.equal((await tarefasDa(conta)).length, 0, 'ponto focal válido: nada');
  await t.sql("UPDATE pontos_focais SET opt_out = true WHERE conta_id = $1 AND vigente AND papel = 'principal'", [conta]);
  await t.sql(`INSERT INTO pendencias (tenant_id, conta_id, placa, erro_codigo, erro_categoria, descricao, origem)
    SELECT tenant_id, id, 'PFX1A23', 'CRED_EXPIRADA', 'credencial', 'Credencial expirada', 'pre_rodada' FROM contas WHERE id = $1`, [conta]);
  await varrer();
  const ts = await tarefasDa(conta);
  assert.equal(ts.length, 2);
  assert.match(ts.find((x) => x.chave.startsWith('ponto-focal:')).titulo, /opt-out/);
  assert.match(ts.find((x) => x.chave.startsWith('ponto-focal-risco:')).titulo, /\d+ pendência\(s\) de rodada e nenhum ponto focal/);

  // A CS troca o ponto focal (histórico mantido): a situação nova é válida e nada mais é aberto.
  assert.equal((await juliana.post(`/contas/${conta}/pontos-focais`, { papel: 'principal', nome: 'Novo Contato Litoral', telefone: '(13) 99123-0000',
    email: 'novo@litoral.example', canalPreferido: 'email', consentimentoWhatsapp: true })).status, 201);
  await varrer(); await varrer();
  assert.equal((await tarefasDa(conta)).length, 2, 'nenhuma tarefa nova');
  const estados = await t.sql("SELECT estado, resultado FROM tarefas WHERE chave LIKE $1 OR chave LIKE $2", [`ponto-focal:${conta}:%`, `ponto-focal-risco:${conta}:%`]);
  assert.ok(estados.every((x) => x.estado === 'concluida' && /Novo Contato Litoral/.test(x.resultado)), 'corrigido: as tarefas se fecham sozinhas');
});
