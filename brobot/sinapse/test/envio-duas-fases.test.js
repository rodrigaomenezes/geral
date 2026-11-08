'use strict';
// P0 · R-20 (idempotência de efeito externo): a mensagem ao cliente não sai duas vezes quando algo falha no meio.
//   - provedor recusou (erro) → não saiu: volta à fila e sai uma vez na próxima tentativa;
//   - o provedor pode ter recebido (queda/timeout depois do envio) → fica "enviando", o job não reenvia, o supervisor
//     marca "incerta" e pede a uma pessoa que confira no canal;
//   - job que derruba o processo em todas as tentativas vai para a fila de falhas (não volta para sempre).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const mensageria = require('../server/modulos/integracoes/mensageria');
const supervisor = require('../server/modulos/supervisor/servico');

let t; let juliana; let ocId; const original = mensageria.enviar;
before(async () => {
  t = await subir();
  juliana = await t.entrarComo('Juliana Alves');
  [{ id: ocId }] = await t.sql("SELECT id FROM ocorrencias WHERE titulo = 'Como exportar o relatório de multas por filial?'");
});
after(async () => { mensageria.enviar = original; await t.parar(); });

const varrer = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar(); };
const responder = async (texto) => {
  const r = await juliana.post(`/ocorrencias/${ocId}/respostas`, { texto });
  assert.ok(r.status < 300, JSON.stringify(r.corpo));
  return (await t.sql('SELECT id FROM interacoes WHERE ocorrencia_id = $1 AND texto = $2', [ocId, texto]))[0].id;
};
const estado = async (id) => (await t.sql('SELECT status_entrega, id_externo, envio_iniciado_em FROM interacoes WHERE id = $1', [id]))[0];
const deixarVencer = (id) => t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = $1 AND estado = 'pendente'", [`enviar:${id}`]);

test('provedor recusou: não saiu, volta à fila e sai uma vez depois', async () => {
  await t.processar(); // o que já estava na fila sai antes
  let chamadas = 0; const TEXTO = 'Segue o passo a passo do relatório por filial.';
  mensageria.enviar = async (c, canal, msg) => {
    if (msg.texto !== TEXTO) return original(c, canal, msg);
    chamadas++; if (chamadas === 1) throw new Error('Provedor fora do ar (503)'); return original(c, canal, msg);
  };
  const id = await responder(TEXTO);
  await t.processar();
  let e = await estado(id);
  assert.equal(e.status_entrega, 'enfileirada', 'recusado = não saiu: volta para a fila');
  assert.equal(e.envio_iniciado_em, null);
  await deixarVencer(id); await t.processar();
  e = await estado(id);
  assert.equal(e.status_entrega, 'enviada');
  assert.ok(e.id_externo);
  assert.equal(chamadas, 2, 'uma recusa e um envio');
  await deixarVencer(id); await t.processar();
  assert.equal(chamadas, 2, 'job repetido não reenvia o que já saiu');
});

test('queda depois do envio: não reenvia; vira "incerta" com tarefa para conferir no canal', async () => {
  let chamadas = 0; const TEXTO = 'Confirmando o acesso do novo analista.';
  mensageria.enviar = async (c, canal, msg) => {
    if (msg.texto !== TEXTO) return original(c, canal, msg);
    chamadas++; await original(c, canal, msg); const e = new Error('Tempo esgotado esperando a resposta do provedor'); e.envioIncerto = true; throw e;
  };
  const id = await responder(TEXTO);
  await t.processar();
  assert.equal((await estado(id)).status_entrega, 'enviando', 'pode ter saído: não volta para a fila');
  await deixarVencer(id); await t.processar(); await deixarVencer(id); await t.processar();
  assert.equal(chamadas, 1, 'nenhum reenvio automático');
  mensageria.enviar = original;

  await varrer();
  assert.equal((await estado(id)).status_entrega, 'enviando', 'antes de 10 minutos ainda espera a confirmação');
  await t.sql("UPDATE interacoes SET envio_iniciado_em = envio_iniciado_em - interval '15 minutes' WHERE id = $1", [id]);
  await varrer();
  assert.equal((await estado(id)).status_entrega, 'incerta');
  const tarefas = await t.sql("SELECT titulo FROM tarefas WHERE chave = $1", [`msg-incerta:${id}`]);
  assert.equal(tarefas.length, 1);
  assert.match(tarefas[0].titulo, /Conferir se a mensagem .* chegou; reenviar só se não chegou/);
  assert.equal((await t.sql("SELECT count(*)::int AS n FROM auditoria WHERE acao = 'mensagem.envio_incerto' AND entidade_id = $1", [id]))[0].n, 1);
  await varrer();
  assert.equal((await t.sql('SELECT count(*)::int AS n FROM tarefas WHERE chave = $1', [`msg-incerta:${id}`]))[0].n, 1, 'uma tarefa só');
});

test('job interrompido em todas as tentativas vai para a fila de falhas; o que ainda tem tentativa volta à fila', async () => {
  const tenant = await t.tenant('brobot');
  const [preso] = await t.sql(`INSERT INTO jobs (tenant_id, tipo, executar_em, estado, tentativas, max_tentativas, bloqueado_em)
    VALUES ($1, 'teste_derruba', now(), 'executando', 5, 5, now() - interval '10 minutes') RETURNING id`, [tenant]);
  const [volta] = await t.sql(`INSERT INTO jobs (tenant_id, tipo, executar_em, estado, tentativas, max_tentativas, bloqueado_em)
    VALUES ($1, 'teste_derruba', now() + interval '1 day', 'executando', 2, 5, now() - interval '10 minutes') RETURNING id`, [tenant]);
  await supervisor.varreduraGlobal(t.app.db);
  assert.equal((await t.sql('SELECT estado FROM jobs WHERE id = $1', [preso.id]))[0].estado, 'morto');
  assert.equal((await t.sql("SELECT count(*)::int AS n FROM auditoria WHERE acao = 'job.fila_de_falhas' AND entidade_id = $1", [String(preso.id)]))[0].n, 1);
  assert.equal((await t.sql('SELECT estado FROM jobs WHERE id = $1', [volta.id]))[0].estado, 'pendente');
});
