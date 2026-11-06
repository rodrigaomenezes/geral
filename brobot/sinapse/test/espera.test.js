'use strict';
// F11 · WFL-006: o tempo esperando cliente ou terceiro fica registrado e não conta no prazo de resolução.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { calendario, horasUteisEntre, prazoDepoisDaEspera } = require('../server/modulos/ocorrencias/sla');
const { relogio } = require('../server/nucleo/relogio');
const { subir } = require('./ajuda');

test('horas úteis entre duas datas e prazo depois da espera (fim de semana não conta; crítica é corrida)', () => {
  const cal = calendario();
  assert.equal(horasUteisEntre(new Date('2026-11-04T13:00Z'), new Date('2026-11-05T13:00Z'), cal), 10, 'quarta 10h → quinta 10h');
  assert.equal(horasUteisEntre(new Date('2026-11-06T19:00Z'), new Date('2026-11-09T12:00Z'), cal), 3, 'sexta 16h → segunda 9h');
  assert.equal(horasUteisEntre(new Date('2026-11-07T13:00Z'), new Date('2026-11-08T13:00Z'), cal), 0, 'sábado a domingo');
  assert.equal(horasUteisEntre(new Date('2026-11-05T13:00Z'), new Date('2026-11-04T13:00Z'), cal), 0, 'invertido');
  assert.equal(prazoDepoisDaEspera(new Date('2026-11-06T20:00Z'), new Date('2026-11-06T19:00Z'), new Date('2026-11-09T12:00Z'), { cal }).toISOString(),
    '2026-11-09T13:00:00.000Z', 'sexta 17h + 3 h úteis = segunda 10h');
  assert.equal(prazoDepoisDaEspera(new Date('2026-11-06T20:00Z'), new Date('2026-11-06T19:00Z'), new Date('2026-11-06T21:00Z'), { corrido: true, cal }).toISOString(),
    '2026-11-06T22:00:00.000Z', 'crítica: 2 h corridas');
});

let t; let rafael; let marina; let conta;
before(async () => {
  t = await subir();
  [rafael, marina] = await Promise.all(['Rafael Lima', 'Marina Costa'].map((n) => t.entrarComo(n)));
  conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Logística Horizonte'"))[0].id;
});
after(async () => { await t.parar(); });

const acao = (quem, id, a, dados = {}) => quem.post(`/ocorrencias/${id}/transicoes`, { acao: a, dados });

test('aguardar cliente pausa o prazo; retomar soma o tempo e empurra o prazo pelas horas úteis esperadas', async () => {
  const o = (await rafael.post('/ocorrencias', { contaId: conta, tipo: 'duvida', prioridade: 'media', titulo: 'Espera pelo cliente' })).corpo;
  await acao(rafael, o.id, 'assumir');
  const prazoAntes = new Date((await rafael.get(`/ocorrencias/${o.id}`)).corpo.prazo_em);
  const revisao = new Date(relogio.agora().getTime() + 864e5).toISOString();
  assert.equal((await acao(rafael, o.id, 'aguardar_cliente', { motivo: 'Cliente vai mandar a planilha', revisaoEm: revisao })).status, 200);
  let d = (await rafael.get(`/ocorrencias/${o.id}`)).corpo;
  assert.equal(d.sla, 'pausado');
  assert.ok(d.espera_inicio_em);
  // Prazo que passaria durante a espera não aparece como vencido (fica pausado).
  const prazoReal = (await t.sql('SELECT prazo_em FROM ocorrencias WHERE id = $1', [o.id]))[0].prazo_em;
  await t.sql("UPDATE ocorrencias SET prazo_em = '2026-11-01T00:00:00Z' WHERE id = $1", [o.id]);
  const noQuadro = (await marina.get('/ocorrencias/quadro?vencidas=1')).corpo.colunas;
  assert.ok(!Object.values(noQuadro).some((col) => col.cartoes.some((x) => x.id === o.id)), 'em espera não conta como vencida');
  await t.sql('UPDATE ocorrencias SET prazo_em = $2 WHERE id = $1', [o.id, prazoReal]);

  await t.avancar(5); // quarta 10h → 15h: 5 horas úteis esperando
  assert.equal((await acao(rafael, o.id, 'retomar')).status, 200);
  d = (await rafael.get(`/ocorrencias/${o.id}`)).corpo;
  assert.equal(d.espera_inicio_em, null);
  assert.ok(Math.abs(d.espera_cliente_seg - 5 * 3600) < 60, `5 h registradas (${d.espera_cliente_seg}s)`);
  const andou = (new Date(d.prazo_em) - prazoAntes) / 3600e3;
  assert.ok(andou >= 5 - 0.02, `o prazo andou pelo menos as 5 h úteis esperadas (andou ${andou.toFixed(2)} h no relógio)`);
  assert.notEqual(d.sla, 'pausado');
});

test('espera de terceiro conta separado; encerrar durante a espera registra o tempo sem mexer no prazo', async () => {
  const o = (await rafael.post('/ocorrencias', { contaId: conta, tipo: 'erro_consulta', prioridade: 'alta', titulo: 'Espera pelo Detran' })).corpo;
  await acao(rafael, o.id, 'assumir');
  const revisao = new Date(relogio.agora().getTime() + 864e5).toISOString();
  assert.equal((await acao(rafael, o.id, 'aguardar_terceiro', { motivo: 'Portal do Detran fora do ar', revisaoEm: revisao })).status, 200);
  const prazo = (await rafael.get(`/ocorrencias/${o.id}`)).corpo.prazo_em;
  await t.avancar(2);
  assert.equal((await acao(rafael, o.id, 'encerrar_sem_resolucao', { motivo: 'Cliente cancelou o pedido', codigoDesfecho: 'sem_retorno_cliente' })).status, 200);
  const d = (await rafael.get(`/ocorrencias/${o.id}`)).corpo;
  assert.ok(Math.abs(d.espera_terceiro_seg - 2 * 3600) < 60);
  assert.equal(d.espera_cliente_seg, 0);
  assert.equal(new Date(d.prazo_em).toISOString(), new Date(prazo).toISOString(), 'encerrada: prazo fica como estava');
});

test('resposta do cliente (entrada) tira da espera pelo mesmo caminho: tempo somado e prazo ajustado', async () => {
  const pf = (await t.sql("SELECT telefone FROM pontos_focais WHERE vigente AND telefone IS NOT NULL AND conta_id = $1 LIMIT 1", [conta]))[0];
  assert.ok(pf, 'cenário: ponto focal com telefone');
  const o = (await rafael.post('/ocorrencias', { contaId: conta, tipo: 'duvida', prioridade: 'baixa', titulo: 'Conversa pelo WhatsApp' })).corpo;
  await t.sql('UPDATE ocorrencias SET conversa_chave = $2 WHERE id = $1', [o.id, `whatsapp:${pf.telefone}`]);
  await acao(rafael, o.id, 'assumir');
  await acao(rafael, o.id, 'aguardar_cliente', { motivo: 'Esperando a foto do documento', revisaoEm: new Date(relogio.agora().getTime() + 864e5).toISOString() });
  const prazoAntes = new Date((await rafael.get(`/ocorrencias/${o.id}`)).corpo.prazo_em);
  await t.avancar(1);
  const r = await fetch(`${t.base}/api/entrada/brobot/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sinapse-token': t.TOKEN },
    body: JSON.stringify({ idMensagem: 'wamid.espera-1', de: pf.telefone, texto: 'Segue a foto' }) });
  assert.ok(r.status < 300, `entrada aceita (${r.status})`);
  await t.processar();
  const d = (await rafael.get(`/ocorrencias/${o.id}`)).corpo;
  assert.equal(d.estado, 'em_atendimento');
  assert.ok(d.espera_cliente_seg >= 3500, 'cerca de 1 h registrada');
  assert.ok(new Date(d.prazo_em) > prazoAntes, 'o prazo andou');
});
