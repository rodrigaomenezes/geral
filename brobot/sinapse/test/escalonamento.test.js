'use strict';
// F13 · WFL-007: escalonamento por níveis com ciência da gestão; WFL-014: intervenção excepcional com justificativa.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { relogio } = require('../server/nucleo/relogio');
const { subir } = require('./ajuda');

let t; let rafael; let marina; let conta;
before(async () => {
  t = await subir();
  [rafael, marina] = await Promise.all(['Rafael Lima', 'Marina Costa'].map((n) => t.entrarComo(n)));
  conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Logística Horizonte'"))[0].id;
});
after(async () => { await t.parar(); });

const varrer = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar(); };
const vencerProximaAcao = (id) => t.sql("UPDATE ocorrencias SET proxima_acao_em = '2026-11-01T00:00:00Z' WHERE id = $1", [id]);
const ver = async (id) => (await rafael.get(`/ocorrencias/${id}`)).corpo;

test('próxima ação vencida sobe o nível; a gestão registra ciência com a ação; vencer de novo mostra "sem ciência"', async () => {
  const o = (await rafael.post('/ocorrencias', { contaId: conta, tipo: 'duvida', prioridade: 'media', titulo: 'Escalonamento com ciência' })).corpo;
  assert.equal((await marina.post(`/ocorrencias/${o.id}/ciencia`, { acao: 'Ligar para o cliente' })).status, 422, 'sem escalonamento');
  await vencerProximaAcao(o.id); await varrer();
  let d = await ver(o.id);
  assert.equal(d.nivel_escalonamento, 1);
  const tarefa1 = d.tarefas.find((x) => x.tipo === 'escalonamento' && x.estado === 'aberta');
  assert.ok(tarefa1, 'tarefa para a Supervisão');
  assert.doesNotMatch(tarefa1.titulo, /sem ciência/);

  assert.equal((await rafael.post(`/ocorrencias/${o.id}/ciencia`, { acao: 'Ligar para o cliente' })).status, 403, 'Suporte não registra ciência');
  assert.equal((await marina.post(`/ocorrencias/${o.id}/ciencia`, { acao: 'Ok' })).status, 400, 'ação curta');
  const passado = new Date(relogio.agora().getTime() - 3600e3).toISOString();
  assert.equal((await marina.post(`/ocorrencias/${o.id}/ciencia`, { acao: 'Ligar para o cliente', proximaAcaoEm: passado })).status, 400);
  const em3h = new Date(relogio.agora().getTime() + 3 * 3600e3).toISOString();
  const r = await marina.post(`/ocorrencias/${o.id}/ciencia`, { acao: 'Rafael liga para o cliente e confirma a planilha', proximaAcaoEm: em3h });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.tarefasConcluidas, 1);
  d = await ver(o.id);
  assert.equal(d.proxima_acao, 'Rafael liga para o cliente e confirma a planilha');
  assert.equal(new Date(d.proxima_acao_em).toISOString(), em3h);
  assert.equal(d.escalonamento_ciente_nivel, 1);
  assert.ok(d.linhaDoTempo.some((l) => l.acao === 'ocorrencia.escalonamento_ciente' && /nível 1/.test(l.motivo)));
  assert.equal((await marina.post(`/ocorrencias/${o.id}/ciencia`, { acao: 'De novo no mesmo nível' })).status, 409);

  // O novo prazo vence: nível 2. Depois vence de novo sem ciência: o título do nível 3 avisa.
  await vencerProximaAcao(o.id); await varrer();
  d = await ver(o.id);
  assert.equal(d.nivel_escalonamento, 2);
  assert.doesNotMatch(d.tarefas.find((x) => x.titulo.includes('nível 2')).titulo, /sem ciência/, 'nível 1 teve ciência');
  await vencerProximaAcao(o.id); await varrer();
  d = await ver(o.id);
  assert.equal(d.nivel_escalonamento, 3);
  assert.match(d.tarefas.find((x) => x.titulo.includes('nível 3')).titulo, /sem ciência da gestão/);
});

test('WFL-014: intervenção excepcional só pela gestão, com justificativa, auditada; ocorrência encerrada não', async () => {
  const o = (await rafael.post('/ocorrencias', { contaId: conta, tipo: 'duvida', prioridade: 'baixa', titulo: 'Intervenção excepcional' })).corpo;
  const juliana = (await t.sql("SELECT id FROM usuarios WHERE nome = 'Juliana Alves'"))[0].id;
  assert.equal((await rafael.post(`/ocorrencias/${o.id}/reatribuir`, { equipeCodigo: 'cs', motivo: 'Quero mandar para o CS' })).status, 403);
  assert.equal((await marina.post(`/ocorrencias/${o.id}/reatribuir`, { equipeCodigo: 'cs' })).status, 400, 'sem justificativa');
  assert.equal((await marina.post(`/ocorrencias/${o.id}/reatribuir`, { equipeCodigo: 'cs', motivo: 'ok' })).status, 400, 'justificativa mínima');
  const r = await marina.post(`/ocorrencias/${o.id}/reatribuir`, { equipeCodigo: 'cs', responsavelId: juliana, motivo: 'Cliente em renovação: CS acompanha', versao: (await ver(o.id)).version });
  assert.equal(r.status, 200);
  const d = await ver(o.id);
  assert.equal(d.equipe_codigo, 'cs');
  assert.equal(d.responsavel_nome, 'Juliana Alves');
  assert.equal(d.estado, 'em_atendimento');
  const aud = d.linhaDoTempo.find((l) => l.acao === 'ocorrencia.intervencao');
  assert.equal(aud.motivo, 'Cliente em renovação: CS acompanha');
  assert.equal(aud.ator_nome, 'Marina Costa');
  assert.equal((await marina.post(`/ocorrencias/${o.id}/reatribuir`, { equipeCodigo: 'suporte', motivo: 'Versão velha da tela', versao: 1 })).status, 409, 'trava otimista');
  await marina.post(`/ocorrencias/${o.id}/transicoes`, { acao: 'encerrar_sem_resolucao', dados: { motivo: 'Cliente desistiu do pedido', codigoDesfecho: 'sem_retorno_cliente' } });
  assert.equal((await marina.post(`/ocorrencias/${o.id}/reatribuir`, { equipeCodigo: 'suporte', motivo: 'Depois de encerrada' })).status, 422);
});
