'use strict';
// F19 · ONB-003: o onboarding pede ao cliente, sozinho, o que depende dele — uma mensagem com tudo o que falta e o
// prazo; repete a cada 3 dias, até 3 vezes; depois, ligação do CS. Item feito sai do pedido.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let juliana; let conta; let ck;
before(async () => {
  t = await subir();
  juliana = await t.entrarComo('Juliana Alves');
  conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'"))[0].id;
  await t.sql("UPDATE contas SET status = 'onboarding' WHERE id = $1", [conta]);
  ck = (await juliana.post(`/contas/${conta}/checklists`, { tipo: 'onboarding' })).corpo;
});
after(async () => { await t.parar(); });

const varrer = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar(); };
const pedidos = () => t.sql("SELECT texto, status_entrega FROM interacoes WHERE conta_id = $1 AND modelo LIKE 'onboarding_pendencias_cliente@%' ORDER BY criado_em", [conta]);

test('no primeiro dia nada; depois de 1 dia, uma mensagem com o que depende do cliente e o prazo', async () => {
  await varrer();
  assert.equal((await pedidos()).length, 0, 'recém-aberto não incomoda o cliente');
  await t.avancar(25); await varrer(); await varrer();
  const p = await pedidos();
  assert.equal(p.length, 1, 'uma mensagem só');
  assert.match(p[0].texto, /Enviar o contrato assinado \(até \d{2}\/\d{2}\)/);
  assert.match(p[0].texto, /planilha da frota com placa e Renavam/);
  assert.match(p[0].texto, /nunca envie senhas/);
  assert.doesNotMatch(p[0].texto, /Robôs e agendamentos|Platform \(sem copiar segredo\)/, 'só o que é do cliente, sem termo interno');
});

test('item feito sai do pedido; repete a cada 3 dias até 3 vezes; depois, ligação do CS', async () => {
  const contrato = (await juliana.get(`/contas/${conta}/checklists`)).corpo.checklists.find((x) => x.id === ck.id).itens.find((i) => i.codigo === 'contrato');
  assert.equal((await juliana.post(`/checklists/itens/${contrato.id}/feito`, { evidencia: 'Contrato assinado recebido por e-mail' })).status, 200);
  await t.avancar(24); await varrer();
  assert.equal((await pedidos()).length, 1, 'antes de 3 dias não repete');
  await t.avancar(48); await varrer();
  const p = await pedidos();
  assert.equal(p.length, 2);
  assert.doesNotMatch(p[1].texto, /contrato/, 'o que já foi feito não é pedido de novo');
  await t.avancar(72); await varrer();
  assert.equal((await pedidos()).length, 3);
  await t.avancar(72); await varrer();
  assert.equal((await pedidos()).length, 3, 'no máximo 3 pedidos');
  const lig = await t.sql("SELECT tipo, titulo FROM tarefas WHERE chave = $1", [`onboarding-cliente:${ck.id}`]);
  assert.equal(lig.length, 1);
  assert.equal(lig[0].tipo, 'ligacao');
  assert.match(lig[0].titulo, /não respondeu a 3 pedidos/);
  assert.ok((await t.sql("SELECT 1 FROM auditoria WHERE acao = 'checklist.pedido_cliente' AND entidade_id = $1", [conta])).length >= 3);
});
