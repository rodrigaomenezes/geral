'use strict';
// F22 · INT-008: a fila de triagem tem supervisão automática (prazo próprio vencido sobe o nível e chama a Supervisão).
// DEV-004: transferência avisa a equipe de destino ao ser pedida e a equipe de origem quando não é aceita no prazo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let marina; let rafael;
before(async () => { t = await subir(); [marina, rafael] = await Promise.all(['Marina Costa', 'Rafael Lima'].map((n) => t.entrarComo(n))); });
after(async () => { await t.parar(); });

const varrer = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar(); };
const avisar = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:lembretes'"); await t.processar(); };
const webhook = (corpo) => fetch(`${t.base}/api/entrada/brobot/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sinapse-token': t.TOKEN }, body: JSON.stringify(corpo) });

test('INT-008: mensagem sem cliente fica na triagem com prazo; vencido, sobe o nível e a Supervisão recebe tarefa', async () => {
  assert.ok((await webhook({ idMensagem: 'wamid.triagem-int008', de: '(41) 99111-2222', texto: 'Bom dia, preciso de ajuda com o sistema' })).status < 300);
  await t.processar();
  const [o] = await t.sql("SELECT id, estado, prazo_em, proxima_acao FROM ocorrencias WHERE conversa_chave = 'whatsapp:+5541991112222'");
  assert.equal(o.estado, 'triagem');
  assert.ok(o.prazo_em && o.proxima_acao, 'triagem tem prazo e próxima ação');
  await t.avancar(2); await varrer();
  const d = (await marina.get(`/ocorrencias/${o.id}`)).corpo;
  assert.equal(d.nivel_escalonamento, 1);
  const tarefa = d.tarefas.find((x) => x.tipo === 'escalonamento');
  assert.ok(tarefa, 'Supervisão chamada');
  assert.equal(tarefa.equipe_nome, 'Supervisão');
  assert.ok((await marina.get('/ocorrencias/quadro')).corpo.colunas.find((col) => col.estado === 'triagem').cartoes.some((x) => x.id === o.id), 'segue visível na coluna da triagem');
});

test('DEV-004: pedir transferência avisa a equipe de destino; sem aceite no prazo, a origem é avisada', async () => {
  const conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Logística Horizonte'"))[0].id;
  const o = (await rafael.post('/ocorrencias', { contaId: conta, tipo: 'erro_consulta', prioridade: 'media', titulo: 'Erro técnico para o Desenvolvimento' })).corpo;
  await rafael.post(`/ocorrencias/${o.id}/transicoes`, { acao: 'assumir', dados: {} });
  const r = await rafael.post(`/ocorrencias/${o.id}/transicoes`, { acao: 'solicitar_handoff', dados: { paraEquipe: 'dev', motivo: 'Erro técnico de consulta: precisa de análise' } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  await avisar();
  const lucas = (await t.sql("SELECT id FROM usuarios WHERE nome = 'Lucas Ferreira'"))[0].id;
  const paraDev = await t.sql("SELECT titulo FROM notificacoes WHERE usuario_id = $1 AND link = $2", [lucas, `#/ocorrencias/${o.id}`]);
  assert.match(paraDev[0].titulo, /Transferência para sua equipe/);

  await t.sql("UPDATE handoffs SET prazo_aceite_em = '2026-11-01T00:00:00Z' WHERE ocorrencia_id = $1 AND estado = 'pendente'", [o.id]);
  await varrer(); await avisar(); await avisar();
  const rafaelId = (await t.sql("SELECT id FROM usuarios WHERE nome = 'Rafael Lima'"))[0].id;
  const paraOrigem = await t.sql("SELECT titulo, texto FROM notificacoes WHERE usuario_id = $1 AND chave LIKE 'handoff-expirado:%' AND link = $2", [rafaelId, `#/ocorrencias/${o.id}`]);
  assert.equal(paraOrigem.length, 1, 'uma vez');
  assert.match(paraOrigem[0].texto, /não aceitou no prazo; foi para a fila de contingência/);
});
