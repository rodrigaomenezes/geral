'use strict';
// F7 · Desenvolvimento: incidentes (linha do tempo, aviso aos clientes, post-mortem), melhorias (aprovação por outra
// pessoa, release, validação operacional) e problema recorrente ligado à ação preventiva.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizar } = require('../server/nucleo/sanitizar');
const { subir } = require('./ajuda');

test('sanitizar: tira senha, token e chave longa; mantém placa, protocolo e UUID', () => {
  const s = sanitizar('Login falhou senha: Abc@123 token=xyz Bearer eyJhbGciOiJIUzI1NiJ9abc chave AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 placa RSU2B34 SIN-000004 6adf1800-e1ae-40fb-9a4e-9c72f369b956');
  assert.doesNotMatch(s, /Abc@123|xyz|eyJ|AbCdEfGh/);
  assert.match(s, /RSU2B34 SIN-000004 6adf1800-e1ae-40fb-9a4e-9c72f369b956/);
});

let t; let lucas; let marina; let rafael; let juliana;
before(async () => { t = await subir(); [lucas, marina, rafael, juliana] = await Promise.all(['Lucas Ferreira', 'Marina Costa', 'Rafael Lima', 'Juliana Alves'].map((n) => t.entrarComo(n))); });
after(async () => { await t.parar(); });

test('incidente SEV1: abre com clientes afetados, avisa pelo ponto focal, mitiga, resolve e só encerra com post-mortem', async () => {
  const contas = await t.sql("SELECT id FROM contas WHERE nome IN ('Transportadora Rota Sul', 'Logística Horizonte') ORDER BY nome");
  assert.equal((await rafael.post('/incidentes', { titulo: 'Consultas paradas', severidade: 'sev1', impacto: 'Nenhuma consulta' })).status, 403, 'Suporte não abre incidente');
  const r = await lucas.post('/incidentes', { titulo: 'Robô de multas parado no Detran-SP', severidade: 'sev1', produto: 'Multas e Notificações',
    impacto: 'Consultas de SP não estão sendo geradas desde 9h (log: token=abc123secreto)', contaIds: contas.map((c) => c.id), comunicar: true,
    primeiraAtualizacao: 'Identificamos instabilidade no portal do Detran-SP. Estamos trabalhando na correção.' });
  assert.equal(r.status, 201);
  assert.match(r.corpo.codigo, /^INC-\d{4}$/);
  assert.doesNotMatch(r.corpo.impacto, /abc123secreto/, 'segredo colado no texto é removido');
  const avisos = await t.sql("SELECT conta_id, texto FROM interacoes WHERE modelo LIKE 'aviso_incidente@%'");
  assert.ok(avisos.length >= 1 && avisos.every((a) => new RegExp(r.corpo.codigo).test(a.texto)), 'cliente afetado avisado com a referência');
  const sup = await t.sql('SELECT titulo FROM tarefas WHERE chave = $1', [`inc-sev1:${r.corpo.id}`]);
  assert.match(sup[0].titulo, /SEV1/, 'gestão acompanha o SEV1');
  const id = r.corpo.id;
  assert.equal((await lucas.post(`/incidentes/${id}/encerrar`, { causaRaiz: 'Mudança no captcha do Detran', licoes: 'Monitorar mudanças no portal' })).status, 422, 'não resolvido');
  assert.equal((await lucas.post(`/incidentes/${id}/atualizacoes`, { texto: 'Contorno aplicado: fila reprocessada', estado: 'mitigado' })).status, 201);
  assert.equal((await lucas.post(`/incidentes/${id}/atualizacoes`, { texto: 'voltar', estado: 'mitigado' })).status, 409, 'mitigado não volta para mitigado');
  await lucas.post(`/incidentes/${id}/atualizacoes`, { texto: 'Correção publicada; consultas normalizadas', estado: 'resolvido', comunicar: true });
  assert.equal((await lucas.post(`/incidentes/${id}/encerrar`, { causaRaiz: 'curta', licoes: 'curta' })).status, 400);
  const fim = await lucas.post(`/incidentes/${id}/encerrar`, { causaRaiz: 'O Detran-SP trocou o captcha sem aviso e o robô não tinha alerta de falha em série.',
    licoes: 'Alertar quando a taxa de erro técnico passar de 5% em 30 minutos.', acoes: ['Alerta de falha em série no robô de multas', 'Teste diário do captcha do Detran-SP'] });
  assert.equal(fim.corpo.estado, 'encerrado');
  assert.equal(fim.corpo.acoes.length, 2, 'ações preventivas viram melhorias propostas');
  const d = (await rafael.get(`/incidentes/${id}`)).corpo;
  assert.deepEqual(d.linha.map((l) => l.estado), ['aberto', 'mitigado', 'resolvido']);
  assert.ok(d.linha[0].comunicado_clientes && d.linha[0].avisos >= 1);
  assert.deepEqual(d.melhorias.map((m) => m.estado), ['proposta', 'proposta']);
});

test('melhoria: outra pessoa da gestão aprova; release libera; a operação (não o Dev) valida com evidência e avisa as ocorrências', async () => {
  const [oc] = await t.sql("SELECT id FROM ocorrencias WHERE tenant_id = $1 AND estado NOT IN ('resolvida','encerrada_sem_resolucao') LIMIT 1", [await t.tenant()]);
  const m = await rafael.post('/melhorias', { titulo: 'Exportar relatório de multas por filial', descricao: 'Clientes pedem o relatório separado por filial, hoje feito à mão.',
    tipo: 'melhoria', origem: 'cliente', ocorrenciaIds: [oc.id] });
  assert.equal(m.status, 201);
  const notas = await t.sql("SELECT texto FROM interacoes WHERE ocorrencia_id = $1 AND direcao = 'nota' AND texto LIKE $2", [oc.id, `%${m.corpo.codigo}%`]);
  assert.equal(notas.length, 1, 'a ocorrência sabe que virou melhoria');
  assert.equal((await lucas.post(`/melhorias/${m.corpo.id}/aprovar`)).status, 403, 'Dev não aprova backlog');
  assert.equal((await marina.post(`/melhorias/${m.corpo.id}/recusar`, {})).status, 400, 'recusar exige motivo');
  assert.equal((await marina.post(`/melhorias/${m.corpo.id}/aprovar`, { prioridade: 'alta' })).corpo.estado, 'aprovada');
  assert.equal((await lucas.post(`/melhorias/${m.corpo.id}/iniciar`, { linkExterno: 'https://git.example/issues/42' })).corpo.estado, 'em_desenvolvimento');
  const rel = (await lucas.post('/releases', { versao: '2026.11.1', previstoPara: '2026-11-10' })).corpo;
  assert.equal((await lucas.post(`/releases/${rel.id}/publicar`)).status, 422, 'release vazia');
  assert.equal((await lucas.post(`/releases/${rel.id}/melhorias`, { melhoriaId: m.corpo.id })).status, 200);
  const pub = await lucas.post(`/releases/${rel.id}/publicar`);
  assert.equal(pub.corpo.melhorias, 1);
  assert.equal((await t.sql('SELECT count(*)::int AS q FROM tarefas WHERE chave = $1', [`validar-mel:${m.corpo.id}`]))[0].q, 1, 'operação recebe a tarefa de validar');
  assert.equal((await lucas.post(`/melhorias/${m.corpo.id}/validar`, { evidencia: 'Testei e funcionou no ambiente' })).status, 403, 'quem desenvolveu não valida');
  assert.equal((await rafael.post(`/melhorias/${m.corpo.id}/validar`, { evidencia: 'ok' })).status, 400);
  assert.equal((await rafael.post(`/melhorias/${m.corpo.id}/validar`, { evidencia: 'Cliente Rota Sul exportou o relatório por filial e confirmou' })).corpo.estado, 'validada');
  const validada = await t.sql("SELECT count(*)::int AS q FROM interacoes WHERE ocorrencia_id = $1 AND texto LIKE $2", [oc.id, `%${m.corpo.codigo} validada%`]);
  assert.equal(validada[0].q, 1);
  assert.equal((await lucas.post(`/releases/${rel.id}/publicar`)).status, 409);
  const painel = (await juliana.get('/desenvolvimento')).corpo;
  assert.ok(painel.releases.find((x) => x.versao === '2026.11.1').validadas === 1);
});

test('quem propôs não aprova a própria melhoria', async () => {
  const m = (await marina.post('/melhorias', { titulo: 'Atalho para reprocessar fila', descricao: 'Supervisão pediu um atalho para reprocessar a fila de falhas.' })).corpo;
  assert.equal((await marina.post(`/melhorias/${m.id}/aprovar`)).status, 422);
});
