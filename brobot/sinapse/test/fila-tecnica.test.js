'use strict';
// F27 · DEV-002/REC-005: a demanda técnica é acompanhada do pedido até a validação da operação, com prioridade,
// impacto, responsável e aceite visíveis na fila técnica do Desenvolvimento.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let rafael; let lucas;
before(async () => { t = await subir(); [rafael, lucas] = await Promise.all(['Rafael Lima', 'Lucas Ferreira'].map((n) => t.entrarComo(n))); });
after(async () => { await t.parar(); });

const naFila = async (id) => (await lucas.get('/desenvolvimento')).corpo.fila.itens.find((x) => x.id === id);
const agir = (quem, id, acao, dados = {}) => quem.post(`/ocorrencias/${id}/transicoes`, { acao, dados });

test('DEV-002/REC-005: pedido → aceite → com o Desenvolvimento → devolvida → validada pela operação sai da fila', async () => {
  const conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'"))[0].id;
  const o = (await rafael.post('/ocorrencias', { contaId: conta, tipo: 'tecnica', prioridade: 'critica', titulo: 'Consulta do DETRAN-SP falhando para a frota inteira' })).corpo;
  assert.equal((await naFila(o.id)), undefined, 'antes do pedido não é do Desenvolvimento');
  await agir(rafael, o.id, 'assumir');
  assert.equal((await agir(rafael, o.id, 'solicitar_handoff', { paraEquipe: 'dev', motivo: 'Erro técnico: precisa de análise do Desenvolvimento' })).status, 200);

  let f = await naFila(o.id);
  assert.equal(f.situacao, 'aguardando_aceite');
  assert.equal(f.prioridade, 'critica');
  assert.equal(f.conta, 'Cargas Litoral');
  assert.ok(f.prazo_aceite_em, 'prazo de aceite visível');
  const fila = (await lucas.get('/desenvolvimento')).corpo.fila.itens;
  assert.equal(fila[0].prioridade, 'critica', 'a mais urgente em primeiro');

  assert.equal((await agir(lucas, o.id, 'aceitar_handoff')).status, 200);
  f = await naFila(o.id);
  assert.deepEqual([f.situacao, f.aceito_por, f.responsavel], ['com_dev', 'Lucas Ferreira', 'Lucas Ferreira']);
  const r = await agir(lucas, o.id, 'resolver', { codigoDesfecho: 'corrigido_tecnico', evidencia: 'Ajuste no robô do DETRAN-SP publicado' });
  assert.equal(r.status, 422, 'o Desenvolvimento não resolve sozinho (DEV-005)');

  assert.equal((await agir(lucas, o.id, 'solicitar_handoff', { paraEquipe: 'suporte', motivo: 'Correção publicada: validar com o cliente' })).status, 200);
  assert.equal((await agir(rafael, o.id, 'aceitar_handoff')).status, 200);
  f = await naFila(o.id);
  assert.equal(f.situacao, 'aguardando_validacao', 'segue visível até a operação validar');
  const ok = await agir(rafael, o.id, 'resolver', { codigoDesfecho: 'corrigido_tecnico', evidencia: 'Cliente confirmou as consultas geradas hoje pela manhã' });
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
  assert.equal(await naFila(o.id), undefined, 'validada e resolvida: sai da fila');
});
