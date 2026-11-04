'use strict';
// Matriz de testes de aceite e resiliência (seção 12 da especificação): AT-001 a AT-016.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { voltar, migrar } = require('../server/db/migrar');

let t;
before(async () => { t = await subir(); await t.processar(); });
after(async () => { await t.parar(); });

const webhook = (corpo, origem = 'whatsapp', token = t.TOKEN) => fetch(`${t.base}/api/entrada/brobot/${origem}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-sinapse-token': token }, body: JSON.stringify(corpo) });

test('AT-001: mensagem sem cliente identificado fica na triagem com prazo, sem perda', async () => {
  const r = await webhook({ idMensagem: 'wamid.at001', de: '(41) 99000-1111', texto: 'Olá, preciso de ajuda' });
  assert.equal(r.status, 202);
  await t.processar();
  const [o] = await t.sql(`SELECT o.estado, o.prazo_em, o.proxima_acao_em, e.codigo FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id
    WHERE o.conversa_chave = 'whatsapp:+5541990001111'`);
  assert.equal(o.estado, 'triagem');
  assert.equal(o.codigo, 'triagem');
  assert.ok(o.prazo_em && o.proxima_acao_em, 'triagem tem prazo e próxima ação');
  const [ent] = await t.sql("SELECT estado FROM entradas WHERE chave_idempotencia = 'wamid.at001'");
  assert.equal(ent.estado, 'processada');
});

test('AT-002: o mesmo webhook três vezes gera um efeito só, e as repetições ficam auditadas', async () => {
  const corpo = { idMensagem: 'wamid.at002', de: '+55 21 99876-5432', texto: 'A consulta deu erro na placa HZT2B22' };
  const status = [];
  for (let i = 0; i < 3; i++) status.push((await webhook(corpo)).status);
  assert.deepEqual(status, [202, 200, 200]);
  await t.processar();
  const [e] = await t.sql("SELECT duplicatas FROM entradas WHERE chave_idempotencia = 'wamid.at002'");
  assert.equal(e.duplicatas, 2);
  const msgs = await t.sql("SELECT count(*)::int AS n FROM interacoes WHERE id_externo = 'wamid.at002'");
  assert.equal(msgs[0].n, 1);
  const aud = await t.sql("SELECT count(*)::int AS n FROM auditoria WHERE acao = 'entrada.duplicada_ignorada'");
  assert.equal(aud[0].n, 2);
});

test('webhook sem o token certo é recusado', async () => {
  const r = await webhook({ idMensagem: 'x', de: '1', texto: 'x' }, 'whatsapp', 'errado');
  assert.equal(r.status, 401);
});

test('AT-003: responsável indisponível → ocorrência vai para o substituto', async () => {
  await t.sql("UPDATE usuarios SET disponivel = false WHERE email = 'rafael@sinapse.demo'");
  await t.sql("UPDATE jobs SET executar_em = now() - interval '1 day' WHERE chave = 'recorrente:supervisor'");
  await t.processar();
  const r = await t.sql(`SELECT u.nome FROM ocorrencias o JOIN usuarios u ON u.id = o.responsavel_id
    WHERE o.titulo = 'Consulta não gerada para 3 placas novas'`);
  assert.equal(r[0].nome, 'Bianca Rocha');
  await t.sql("UPDATE usuarios SET disponivel = true WHERE email = 'rafael@sinapse.demo'");
});

test('AT-005: Platform fora do ar → pré-rodada fica em retentativa, sem perder a rodada; volta e conclui', async () => {
  const tid = await t.tenant();
  const [conta] = await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'");
  await t.sql("UPDATE integracoes SET disponivel = false WHERE nome = 'platform' AND tenant_id = $1", [tid]);
  const [r] = await t.sql(`INSERT INTO rodadas (tenant_id, conta_id, id_platform, produto, agendada_para) VALUES ($1,$2,'RD-AT005','Teste', now() + interval '3 days') RETURNING id`, [tid, conta.id]);
  await t.sql(`INSERT INTO jobs (tenant_id, tipo, payload, executar_em, chave) VALUES ($1, 'rodada.pre_rodada', $2, now() - interval '1 day', 'pre:at005')`, [tid, JSON.stringify({ rodadaId: r.id })]);
  await t.processar();
  let [job] = await t.sql("SELECT estado, tentativas, ultimo_erro FROM jobs WHERE chave = 'pre:at005'");
  assert.equal(job.estado, 'pendente');
  assert.match(job.ultimo_erro, /indisponível/);
  const [integ] = await t.sql("SELECT falhas_consecutivas FROM integracoes WHERE nome = 'platform' AND tenant_id = $1", [tid]);
  assert.ok(integ.falhas_consecutivas >= 1);
  assert.equal((await t.sql('SELECT estado FROM rodadas WHERE id = $1', [r.id]))[0].estado, 'agendada');
  await t.sql("UPDATE integracoes SET disponivel = true WHERE nome = 'platform'");
  await t.avancar(1);
  [job] = await t.sql("SELECT estado FROM jobs WHERE chave = 'pre:at005'");
  assert.equal(job.estado, 'concluido');
  assert.notEqual((await t.sql('SELECT estado FROM rodadas WHERE id = $1', [r.id]))[0].estado, 'agendada');
});

test('AT-006: OMIE fora do ar → o ERP não inventa status e reconcilia quando volta', async () => {
  const tid = await t.tenant();
  await t.sql("UPDATE jobs SET executar_em = now() - interval '1 day' WHERE chave = 'recorrente:omie'");
  await t.processar();
  const antes = await t.sql("SELECT conta_id, situacao, sincronizado_em FROM status_financeiro ORDER BY conta_id");
  assert.ok(antes.length >= 4);
  await t.sql("UPDATE integracoes SET disponivel = false WHERE nome = 'omie' AND tenant_id = $1", [tid]);
  await t.sql("UPDATE demo_omie SET situacao = 'em_atraso'");
  await t.sql("UPDATE jobs SET executar_em = now() - interval '1 day' WHERE chave = 'recorrente:omie'");
  await t.processar();
  const durante = await t.sql("SELECT conta_id, situacao, sincronizado_em FROM status_financeiro ORDER BY conta_id");
  assert.deepEqual(durante, antes, 'status guardado não muda enquanto o OMIE está fora');
  const [job] = await t.sql("SELECT estado, tentativas FROM jobs WHERE chave = 'recorrente:omie'");
  assert.equal(job.estado, 'pendente');
  assert.ok(job.tentativas >= 1);
  await t.sql("UPDATE integracoes SET disponivel = true WHERE nome = 'omie'");
  await t.avancar(1);
  const depois = await t.sql("SELECT count(*)::int AS n FROM status_financeiro WHERE situacao = 'em_atraso'");
  assert.equal(depois[0].n, antes.length);
  const div = await t.sql("SELECT tipo FROM divergencias WHERE chave = 'omie:OM-999'");
  assert.equal(div[0].tipo, 'omie_cliente_nao_encontrado', 'FIN-008: cliente OMIE inexistente vira divergência');
});

test('AT-007: WhatsApp falha → retentativas registradas e canal alternativo (e-mail)', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const [o] = await t.sql("SELECT id FROM ocorrencias WHERE titulo LIKE 'Como exportar o relatório%'");
  await t.sql("UPDATE integracoes SET disponivel = false WHERE nome = 'whatsapp'");
  const r = await marina.post(`/ocorrencias/${o.id}/respostas`, { texto: 'Teste de envio com WhatsApp fora do ar' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.canal, 'whatsapp');
  for (let i = 0; i < 6; i++) await t.avancar(0.5);
  const [it] = await t.sql('SELECT canal, status_entrega FROM interacoes WHERE id = $1', [r.corpo.id]);
  assert.equal(it.status_entrega, 'enviada');
  assert.equal(it.canal, 'email');
  const aud = await t.sql("SELECT count(*)::int AS n FROM auditoria WHERE acao = 'mensagem.canal_alternativo' AND entidade_id = $1", [r.corpo.id]);
  assert.equal(aud[0].n, 1);
  await t.sql("UPDATE integracoes SET disponivel = true WHERE nome = 'whatsapp'");
});

test('AT-008: correção confirmada no D-3 cancela os contatos futuros e resolve a ocorrência com evidência', async () => {
  const pedro = await t.entrarComo('Pedro Santos');
  const [conta] = await t.sql("SELECT id FROM contas WHERE nome = 'Logística Horizonte'");
  const programados = await t.sql("SELECT marco FROM contatos_programados WHERE conta_id = $1 AND estado = 'programado'", [conta.id]);
  assert.ok(programados.length >= 1, 'há contatos futuros antes da correção');
  const pend = await t.sql("SELECT id, placa FROM pendencias WHERE conta_id = $1 AND estado <> 'corrigida'", [conta.id]);
  // Revalidar sem corrigir: continua aberta.
  const sem = await pedro.post(`/pendencias/${pend[0].id}/revalidar`);
  assert.equal(sem.corpo.corrigida, false);
  for (const p of pend) {
    await t.sql('UPDATE demo_platform_veiculos SET erro_codigo = NULL WHERE conta_id = $1 AND placa = $2', [conta.id, p.placa]);
    const r = await pedro.post(`/pendencias/${p.id}/revalidar`);
    assert.equal(r.status, 200);
    assert.equal(r.corpo.corrigida, true);
  }
  const restantes = await t.sql("SELECT count(*)::int AS n FROM contatos_programados WHERE conta_id = $1 AND estado = 'programado'", [conta.id]);
  assert.equal(restantes[0].n, 0);
  const jobs = await t.sql("SELECT count(*)::int AS n FROM jobs WHERE tipo = 'rodada.contato' AND estado = 'pendente' AND payload->>'contatoId' IN (SELECT id::text FROM contatos_programados WHERE conta_id = $1)", [conta.id]);
  assert.equal(jobs[0].n, 0);
  const [oc] = await t.sql("SELECT estado, evidencia FROM ocorrencias WHERE conta_id = $1 AND tipo = 'pre_rodada'", [conta.id]);
  assert.equal(oc.estado, 'resolvida');
  assert.match(oc.evidencia, /Platform/);
});

test('AT-009: pós-rodada sem correção após D+3 → contato sai, pendência continua visível', async () => {
  const [conta] = await t.sql("SELECT id FROM contas WHERE nome = 'TransMinas Fretes'");
  const [d3] = await t.sql("SELECT estado FROM contatos_programados WHERE conta_id = $1 AND marco = 'D+3'", [conta.id]);
  assert.equal(d3.estado, 'programado');
  await t.avancar(73);
  const [depois] = await t.sql("SELECT estado FROM contatos_programados WHERE conta_id = $1 AND marco = 'D+3'", [conta.id]);
  assert.equal(depois.estado, 'enviado');
  const pend = await t.sql("SELECT estado FROM pendencias WHERE conta_id = $1 AND estado <> 'corrigida'", [conta.id]);
  assert.ok(pend.length >= 1, 'pendência técnica continua aberta');
  assert.equal(pend[0].estado, 'persistente');
});

test('AT-010: transferência sem aceite no prazo → fila de contingência e escalonamento', async () => {
  const [o] = await t.sql("SELECT id FROM ocorrencias WHERE titulo = 'Timeout recorrente na consulta do DETRAN-SP'");
  const [h] = await t.sql("SELECT estado FROM handoffs WHERE ocorrencia_id = $1", [o.id]);
  assert.ok(['pendente', 'expirado'].includes(h.estado));
  await t.sql("UPDATE handoffs SET prazo_aceite_em = now() - interval '10 days' WHERE ocorrencia_id = $1 AND estado = 'pendente'", [o.id]);
  await t.sql("UPDATE jobs SET executar_em = now() - interval '30 days' WHERE chave = 'recorrente:supervisor'");
  await t.processar();
  const [oc] = await t.sql('SELECT o.estado, e.codigo FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id WHERE o.id = $1', [o.id]);
  assert.equal(oc.codigo, 'contingencia');
  assert.equal((await t.sql("SELECT estado FROM handoffs WHERE ocorrencia_id = $1", [o.id]))[0].estado, 'expirado');
  const tar = await t.sql("SELECT count(*)::int AS n FROM tarefas WHERE ocorrencia_id = $1 AND tipo = 'escalonamento'", [o.id]);
  assert.ok(tar[0].n >= 1);
});

test('AT-011: duas alterações simultâneas na mesma versão → uma vale, a outra recebe conflito', async () => {
  const bianca = await t.entrarComo('Bianca Rocha');
  const rafael = await t.entrarComo('Rafael Lima');
  const [o] = await t.sql(`SELECT o.id, o.version FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id
    WHERE o.estado = 'aberta' AND e.codigo = 'suporte' AND o.tenant_id = $1 LIMIT 1`, [await t.tenant('brobot')]);
  const [a, b] = await Promise.all([
    bianca.post(`/ocorrencias/${o.id}/transicoes`, { acao: 'assumir', versao: o.version }),
    rafael.post(`/ocorrencias/${o.id}/transicoes`, { acao: 'assumir', versao: o.version }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const [atual] = await t.sql('SELECT version FROM ocorrencias WHERE id = $1', [o.id]);
  assert.equal(atual.version, o.version + 1);
});

test('AT-012: mensagem nova numa conversa encerrada recentemente reabre a ocorrência', async () => {
  const [o] = await t.sql("SELECT id, reaberturas FROM ocorrencias WHERE titulo = 'Acesso para novo analista de frota'");
  const r = await webhook({ idMensagem: 'wamid.at012', de: '+5511976543210', texto: 'O acesso parou de funcionar de novo' });
  assert.equal(r.status, 202);
  await t.processar();
  const [d] = await t.sql('SELECT estado, reaberturas FROM ocorrencias WHERE id = $1', [o.id]);
  assert.equal(d.estado, 'aberta');
  assert.equal(d.reaberturas, o.reaberturas + 1);
});

test('AT-013: supervisor parado → monitor externo recebe 503', async () => {
  const ok = await fetch(`${t.base}/api/health/supervisor`);
  assert.equal(ok.status, 200);
  await t.sql("UPDATE sistema SET atualizado_em = now() - interval '10 minutes' WHERE chave = 'heartbeat'");
  const parado = await fetch(`${t.base}/api/health/supervisor`);
  assert.equal(parado.status, 503);
});

test('AT-014: organização A pedindo dado da B → negado e auditado', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const [alvo] = await t.sql("SELECT o.id FROM ocorrencias o JOIN tenants x ON x.id = o.tenant_id WHERE x.slug = 'parceiro-demo'");
  const r = await marina.get(`/ocorrencias/${alvo.id}`);
  assert.equal(r.status, 404);
  assert.equal(r.corpo.error.code, 'nao_encontrado');
  const lista = await marina.get('/ocorrencias?estado=todas&q=confidencial');
  assert.equal(lista.corpo.total, 0);
  const aud = await t.sql("SELECT tenant_id FROM auditoria WHERE acao = 'acesso.negado_ou_inexistente' AND entidade_id = $1", [alvo.id]);
  assert.equal(aud.length, 1);
  assert.equal(aud[0].tenant_id, await t.tenant('brobot'));
});

test('AT-015: bloqueio por inadimplência sem regra aprovada → nenhuma ação, pedido auditado', async () => {
  const carla = await t.entrarComo('Carla Mendes');
  const [conta] = await t.sql("SELECT id, status FROM contas WHERE nome = 'Logística Horizonte'");
  const r = await carla.post(`/contas/${conta.id}/bloqueio`, { motivo: 'Atraso de 45 dias' });
  assert.equal(r.status, 422);
  assert.equal(r.corpo.error.code, 'sem_regra_aprovada');
  assert.equal((await t.sql('SELECT status FROM contas WHERE id = $1', [conta.id]))[0].status, conta.status);
  const aud = await t.sql("SELECT count(*)::int AS n FROM auditoria WHERE acao = 'financeiro.bloqueio_recusado' AND entidade_id = $1", [conta.id]);
  assert.equal(aud[0].n, 1);
  const rafael = await t.entrarComo('Rafael Lima');
  assert.equal((await rafael.post(`/contas/${conta.id}/bloqueio`, { motivo: 'teste sem permissão' })).status, 403);
});

test('AT-016: migração desfeita e reaplicada volta íntegra; migração com erro não deixa nada pela metade', async () => {
  const { abrirBanco } = require('../server/db');
  const db = await abrirBanco({});
  await migrar(db);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM schema_migracoes')).rows[0].n, 1);
  assert.equal(await voltar(db), '001_fundacao.sql');
  assert.equal((await db.query("SELECT to_regclass('ocorrencias') AS t")).rows[0].t, null);
  await migrar(db);
  assert.ok((await db.query("SELECT to_regclass('ocorrencias') AS t")).rows[0].t);
  await assert.rejects(db.sistema(async (c) => {
    await c.exec('CREATE TABLE tabela_nova (id int)');
    await c.exec('ALTER TABLE tabela_que_nao_existe ADD COLUMN x int');
  }));
  assert.equal((await db.query("SELECT to_regclass('tabela_nova') AS t")).rows[0].t, null, 'falha desfaz a migração inteira');
  await db.fechar();
});
