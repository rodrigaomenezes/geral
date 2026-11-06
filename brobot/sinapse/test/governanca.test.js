'use strict';
// F9 · Governança: delegação temporária (GOV-009), matriz RACI com responsáveis vigentes (GOV-010), plantão por
// equipe e SLA por contrato (GOV-008).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { prazos, calendario, validarSlaContrato } = require('../server/modulos/ocorrencias/sla');
const { relogio } = require('../server/nucleo/relogio');
const { subir } = require('./ajuda');

test('SLA de contrato substitui a prioridade e não sofre o fator VIP; validação recusa horas fora da faixa', () => {
  const cal = calendario();
  const agora = new Date('2026-11-04T13:00:00Z'); // quarta, 10h em São Paulo
  const padraoVip = prazos('alta', { agora, vip: true, cal });
  assert.equal(padraoVip.respostaEm.toISOString(), '2026-11-04T14:00:00.000Z', 'VIP: 2 h × 0,5');
  const contrato = prazos('alta', { agora, vip: true, cal, contrato: { alta: { resposta: 3, resolucao: 6 } } });
  assert.equal(contrato.respostaEm.toISOString(), '2026-11-04T16:00:00.000Z', 'contrato: 3 h úteis, sem fator');
  assert.equal(prazos('media', { agora, cal, contrato: { alta: { resposta: 3, resolucao: 6 } } }).respostaEm.toISOString(), '2026-11-04T17:00:00.000Z', 'outra prioridade segue o padrão');
  assert.deepEqual(validarSlaContrato({ alta: { resposta: '3', resolucao: 6 } }), { alta: { resposta: 3, resolucao: 6 } });
  assert.match(validarSlaContrato({ urgente: { resposta: 1, resolucao: 2 } }).erro, /desconhecida/);
  assert.match(validarSlaContrato({ alta: { resposta: 0, resolucao: 2 } }).erro, /0,25 a 720/);
  assert.match(validarSlaContrato({ alta: { resposta: 5, resolucao: 2 } }).erro, /antes da resposta/);
  assert.equal(validarSlaContrato(null), null);
});

let t; let marina; let rafael; let bianca; let juliana; let pedro;
const ids = {};
before(async () => {
  t = await subir();
  [marina, rafael, bianca, juliana, pedro] = await Promise.all(['Marina Costa', 'Rafael Lima', 'Bianca Rocha', 'Juliana Alves', 'Pedro Santos'].map((n) => t.entrarComo(n)));
  for (const u of await t.sql("SELECT id, nome FROM usuarios WHERE nome IN ('Rafael Lima', 'Bianca Rocha', 'Juliana Alves', 'Pedro Santos', 'Marina Costa')")) ids[u.nome.split(' ')[0]] = u.id;
  for (const e of await t.sql("SELECT id, codigo FROM equipes WHERE codigo IN ('suporte', 'cs') AND tenant_id = (SELECT tenant_id FROM usuarios WHERE nome = 'Marina Costa')")) ids[e.codigo] = e.id;
});
after(async () => { await t.parar(); });

const forcarVarredura = () => t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'");

test('delegação: própria pessoa delega, novas atribuições e as abertas vão ao delegado; sem corrente; expira e fica na auditoria', async () => {
  const fim = '2026-11-06T13:00:00Z';
  assert.equal((await rafael.post('/delegacoes', { deId: ids.Bianca, paraId: ids.Juliana, fim, motivo: 'Férias da Bianca' })).status, 403, 'só a gestão delega por outra pessoa');
  assert.equal((await rafael.post('/delegacoes', { paraId: ids.Rafael, fim, motivo: 'Para mim mesmo' })).status, 400);
  assert.equal((await rafael.post('/delegacoes', { paraId: ids.Bianca, inicio: '2026-11-01T00:00:00Z', fim: '2027-03-01T00:00:00Z', motivo: 'Licença longa' })).status, 400, 'no máximo 90 dias');

  // Ocorrência aberta com o Rafael antes da delegação.
  const conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Logística Horizonte'"))[0];
  const oc = (await rafael.post('/ocorrencias', { contaId: conta.id, tipo: 'duvida', prioridade: 'baixa', titulo: 'Dúvida antes da delegação' })).corpo;
  await t.sql('UPDATE ocorrencias SET responsavel_id = $1, estado = $2 WHERE id = $3', [ids.Rafael, 'em_atendimento', oc.id]);

  const d = await rafael.post('/delegacoes', { paraId: ids.Bianca, fim, motivo: 'Treinamento externo de dois dias' });
  assert.equal(d.status, 201);
  assert.equal((await rafael.post('/delegacoes', { paraId: ids.Juliana, fim, motivo: 'Outra no mesmo período' })).status, 409, 'uma delegação por vez');
  assert.equal((await bianca.post('/delegacoes', { paraId: ids.Juliana, fim, motivo: 'Corrente de delegação' })).status, 422, 'quem recebe não delega no período');
  assert.equal((await marina.post('/delegacoes', { deId: ids.Juliana, paraId: ids.Rafael, fim, motivo: 'Para quem está fora' })).status, 422, 'não delega para quem está ausente');

  await forcarVarredura(); await t.processar();
  const depois = (await t.sql('SELECT responsavel_id FROM ocorrencias WHERE id = $1', [oc.id]))[0];
  assert.equal(depois.responsavel_id, ids.Bianca, 'a aberta foi repassada ao delegado pelo supervisor');
  const motivo = await t.sql("SELECT motivo FROM auditoria WHERE entidade_id = $1 AND acao = 'ocorrencia.reatribuida'", [oc.id]);
  assert.match(motivo[0].motivo, /delegação vigente/);

  const g = (await bianca.get('/governanca')).corpo;
  assert.equal(g.podeGerir, false);
  assert.ok(g.delegacoes.some((x) => x.id === d.corpo.id && x.vigente), 'quem recebe vê a delegação');
  assert.equal((await juliana.get('/governanca')).corpo.delegacoes.length, 0, 'quem não participa não vê delegação alheia');

  // Passa o fim: a delegação expira e fica registrada uma vez.
  await t.avancar(49); await forcarVarredura(); await t.processar();
  await forcarVarredura(); await t.processar();
  const exp = await t.sql("SELECT 1 FROM auditoria WHERE acao = 'delegacao.expirada' AND entidade_id = $1", [d.corpo.id]);
  assert.equal(exp.length, 1);
  assert.equal((await rafael.post(`/delegacoes/${d.corpo.id}/revogar`, {})).status, 409, 'terminada não se revoga');
});

test('revogação: só o dono ou a gestão, uma vez, com o motivo na auditoria', async () => {
  const fim = new Date(relogio.agora().getTime() + 30 * 864e5).toISOString();
  const d = (await pedro.post('/delegacoes', { paraId: ids.Rafael, fim, motivo: 'Consulta médica' })).corpo;
  assert.equal((await rafael.post(`/delegacoes/${d.id}/revogar`, {})).status, 403, 'quem recebe não revoga');
  const r = await marina.post(`/delegacoes/${d.id}/revogar`, { motivo: 'Voltou antes' });
  assert.equal(r.status, 200);
  assert.ok(r.corpo.revogada_em);
  assert.equal((await marina.post(`/delegacoes/${d.id}/revogar`, {})).status, 409);
  const aud = await t.sql("SELECT motivo FROM auditoria WHERE acao = 'delegacao.revogada' AND entidade_id = $1", [d.id]);
  assert.equal(aud[0].motivo, 'Voltou antes');
});

test('RACI: gestão monta a matriz, um aprovador por processo, vigente mostra substituto e plantão; faltando R/A aparece', async () => {
  const inicial = (await marina.get('/governanca')).corpo.processos;
  assert.ok(inicial.every((p) => !p.faltando.length), 'organização nova já vem com a sugestão (R e A em todo processo)');
  await t.sql('DELETE FROM raci');
  assert.equal((await rafael.post('/raci', { processo: 'atendimento_suporte', papel: 'R', equipeId: ids.suporte })).status, 403);
  assert.equal((await marina.post('/raci', { processo: 'inventado', papel: 'R', equipeId: ids.suporte })).status, 400);
  assert.equal((await marina.post('/raci', { processo: 'atendimento_suporte', papel: 'R', equipeId: ids.suporte, usuarioId: ids.Rafael })).status, 400, 'pessoa ou equipe, não os dois');
  assert.equal((await marina.post('/raci', { processo: 'atendimento_suporte', papel: 'R', equipeId: ids.suporte })).status, 201);
  assert.equal((await marina.post('/raci', { processo: 'atendimento_suporte', papel: 'R', equipeId: ids.suporte })).status, 409, 'sem duplicar');
  assert.equal((await marina.post('/raci', { processo: 'atendimento_suporte', papel: 'A', usuarioId: ids.Pedro })).status, 201);
  assert.equal((await marina.post('/raci', { processo: 'atendimento_suporte', papel: 'A', usuarioId: ids.Marina })).status, 201, 'novo aprovador substitui');
  assert.equal((await marina.post('/raci', { processo: 'atendimento_suporte', papel: 'C', usuarioId: ids.Rafael })).status, 201);

  await t.sql('UPDATE usuarios SET disponivel = false, substituto_id = $1 WHERE id = $2', [ids.Bianca, ids.Rafael]);
  const m = (await marina.get('/governanca')).corpo;
  const p = m.processos.find((x) => x.chave === 'atendimento_suporte');
  assert.deepEqual(p.linhas.filter((l) => l.papel === 'A').map((l) => l.nome), ['Marina Costa']);
  const c = p.linhas.find((l) => l.papel === 'C');
  assert.equal(c.ausente, true);
  assert.deepEqual(c.vigente, { nome: 'Bianca Rocha', por: 'substituto' });
  assert.deepEqual(p.faltando, []);
  assert.deepEqual(m.processos.find((x) => x.chave === 'lgpd').faltando, ['R', 'A']);
  await t.sql('UPDATE usuarios SET disponivel = true, substituto_id = NULL WHERE id = $1', [ids.Rafael]);

  const linhaC = c.id;
  assert.equal((await marina.post(`/raci/${linhaC}/remover`, {})).status, 200);
  assert.equal((await marina.post(`/raci/${linhaC}/remover`, {})).status, 404);
  assert.ok((await t.sql("SELECT 1 FROM auditoria WHERE acao = 'raci.removido' AND entidade_id = $1", [linhaC])).length);

  // A sugestão só preenche processo vazio: o que a gestão definiu fica.
  assert.equal((await rafael.post('/raci/sugestao', {})).status, 403);
  const sug = await marina.post('/raci/sugestao', {});
  assert.ok(sug.corpo.incluidas > 10);
  const depois = (await marina.get('/governanca')).corpo.processos;
  assert.deepEqual(depois.find((x) => x.chave === 'atendimento_suporte').linhas.filter((l) => l.papel === 'A').map((l) => l.nome), ['Marina Costa']);
  assert.deepEqual(depois.find((x) => x.chave === 'lgpd').faltando, []);
  assert.equal((await marina.post('/raci/sugestao', {})).corpo.incluidas, 0, 'repetir não duplica');
});

test('plantão: escala sem choque; ocorrência nova da equipe vai direto para o plantonista; aparece na RACI', async () => {
  const ag = relogio.agora();
  const inicio = new Date(ag.getTime() - 3600e3).toISOString(); const fim = new Date(ag.getTime() + 12 * 3600e3).toISOString();
  assert.equal((await rafael.post('/plantoes', { equipeId: ids.suporte, usuarioId: ids.Rafael, inicio, fim })).status, 403);
  assert.equal((await marina.post('/plantoes', { equipeId: ids.suporte, usuarioId: ids.Rafael, inicio, fim: new Date(ag.getTime() + 8 * 864e5).toISOString() })).status, 400, 'até 7 dias');
  const p = await marina.post('/plantoes', { equipeId: ids.suporte, usuarioId: ids.Rafael, inicio, fim });
  assert.equal(p.status, 201);
  assert.equal((await marina.post('/plantoes', { equipeId: ids.suporte, usuarioId: ids.Bianca, inicio, fim })).status, 409, 'equipe já tem plantão');

  const conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Logística Horizonte'"))[0];
  const oc = (await bianca.post('/ocorrencias', { contaId: conta.id, tipo: 'duvida', prioridade: 'media', titulo: 'Chegou durante o plantão' })).corpo;
  assert.equal(oc.responsavel_id, ids.Rafael);
  assert.equal(oc.estado, 'em_atendimento');

  const m = (await marina.get('/governanca')).corpo;
  const linha = m.processos.find((x) => x.chave === 'atendimento_suporte').linhas.find((l) => l.papel === 'R');
  assert.equal(linha.vigente.nome, 'Rafael Lima');
  assert.equal(linha.vigente.por, 'plantao');
  assert.ok(m.plantoes.some((x) => x.id === p.corpo.id && x.vigente));

  assert.equal((await marina.post(`/plantoes/${p.corpo.id}/cancelar`, { motivo: 'Escala trocada' })).status, 200);
  const oc2 = (await bianca.post('/ocorrencias', { contaId: conta.id, tipo: 'duvida', prioridade: 'media', titulo: 'Depois do plantão cancelado' })).corpo;
  assert.equal(oc2.responsavel_id, null, 'sem plantão, fica na fila');
});

test('SLA de contrato na conta: gestão define com motivo; a ocorrência usa o prazo do contrato; isolado por organização', async () => {
  const conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'"))[0];
  assert.equal((await juliana.post(`/contas/${conta.id}/sla`, { sla: { alta: { resposta: 1, resolucao: 3 } }, motivo: 'Contrato 2026' })).status, 403);
  assert.equal((await marina.post(`/contas/${conta.id}/sla`, { sla: { alta: { resposta: 9, resolucao: 3 } }, motivo: 'Contrato 2026' })).status, 400);
  const r = await marina.post(`/contas/${conta.id}/sla`, { sla: { alta: { resposta: 1, resolucao: 3 } }, motivo: 'Contrato 2026 assinado' });
  assert.equal(r.status, 200);
  const antes = relogio.agora();
  const oc = (await rafael.post('/ocorrencias', { contaId: conta.id, tipo: 'duvida', prioridade: 'alta', titulo: 'Prazo de contrato' })).corpo;
  const esperado = prazos('alta', { agora: antes, cal: calendario(), contrato: { alta: { resposta: 1, resolucao: 3 } } });
  const perto = (a, b) => Math.abs(new Date(a).getTime() - b.getTime()) < 5000;
  assert.ok(perto(oc.sla_resposta_em, esperado.respostaEm), 'prazo de resposta do contrato (1 h útil)');
  assert.ok(perto(oc.prazo_em, esperado.resolucaoEm), 'prazo de resolução do contrato (3 h úteis)');
  assert.ok((await t.sql("SELECT 1 FROM auditoria WHERE acao = 'conta.sla_contrato' AND entidade_id = $1", [conta.id])).length);
  // Remover volta ao padrão.
  assert.equal((await marina.post(`/contas/${conta.id}/sla`, { sla: null, motivo: 'Contrato encerrado' })).status, 200);
  assert.equal((await t.sql('SELECT sla_contrato FROM contas WHERE id = $1', [conta.id]))[0].sla_contrato, null);
  // Outra organização não enxerga a conta.
  const outra = (await t.sql("SELECT id FROM contas WHERE tenant_id <> (SELECT tenant_id FROM contas WHERE id = $1) LIMIT 1", [conta.id]))[0];
  if (outra) assert.equal((await marina.post(`/contas/${outra.id}/sla`, { sla: null, motivo: 'Tentativa cruzada' })).status, 404);
});
