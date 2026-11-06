'use strict';
// F5 · Monitoramento: volumetria de consultas por CSV (erros invisíveis, robô parado, erro técnico), aviso de credencial
// perto de vencer e reincidência — cada alerta com no máximo uma ocorrência ativa.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { avaliar, diasAte } = require('../server/modulos/monitoramento/regras');
const { subir } = require('./ajuda');

const dia = (d, esperadas, geradas, extra = {}) => ({ dia: `2026-11-0${d}`, esperadas, geradas, erros_tecnicos: 0, erros_usuario: 0, indisponiveis: 0, ...extra });

test('regras: tolerância, não geradas, sem execução e erro técnico (pura)', () => {
  assert.deepEqual(avaliar([dia(1, 100, 97), dia(2, 100, 98)]).alertas, [], 'até 5% faltando é ruído');
  assert.deepEqual(avaliar([dia(1, 100, 80), dia(2, 100, 90)]).alertas.map((a) => a.motivo), ['nao_geradas']);
  assert.equal(avaliar([dia(1, 100, 40), dia(2, 100, 50)]).alertas[0].prioridade, 'alta', 'falta acima de 30% é alta');
  const parado = avaliar([dia(1, 100, 100), dia(2, 100, 0), dia(3, 100, 0), dia(4, 100, 0)]);
  assert.deepEqual(parado.alertas.map((a) => a.motivo), ['sem_execucao'], 'robô parado não abre também "não geradas"');
  assert.deepEqual(avaliar([dia(1, 100, 100, { erros_tecnicos: 6 })]).alertas.map((a) => a.motivo), ['erro_tecnico']);
  assert.deepEqual(avaliar([dia(1, 100, 100, { erros_tecnicos: 2 })]).alertas, [], 'abaixo do mínimo de 3');
  const r = avaliar([dia(3, 10, 10), dia(1, 10, 10, { indisponiveis: 4, erros_usuario: 2 })]).resumo;
  assert.deepEqual([r.de, r.ate, r.indisponiveis, r.errosUsuario], ['2026-11-01', '2026-11-03', 4, 2]);
  assert.equal(diasAte('2026-11-10', '2026-11-05'), 5);
  assert.equal(diasAte('2026-11-01', '2026-11-05'), -4);
});

let t; let pedro; let rafael;
before(async () => { t = await subir(); pedro = await t.entrarComo('Pedro Santos'); rafael = await t.entrarComo('Rafael Lima'); });
after(async () => { await t.parar(); });

const csvPost = async (caminho, texto) => {
  const ps = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas;
  const r = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: ps.find((p) => p.nome === 'Pedro Santos').id }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return (await fetch(`${t.base}/api${caminho}`, { method: 'POST', headers: { cookie, 'content-type': 'text/csv' }, body: texto })).json();
};
const linhas = (cnpj, produto, dias) => dias.map(([d, e, g, tec = 0]) => `${cnpj};${produto};0${d}/11/2026;${e};${g};${tec};0;0`).join('\n');
const CAB = 'cnpj;produto;data;esperadas;geradas;erros_tecnicos;erros_usuario;indisponiveis\n';
const alertas = (prefixo) => t.sql("SELECT o.titulo, o.tipo, e.codigo AS equipe, o.prioridade, o.descricao FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id WHERE o.alerta_chave LIKE $1 ORDER BY o.criado_em", [`${prefixo}%`]);

test('CSV de volumetria: não geradas vira ocorrência com a causa provável; reimportar não duplica; painel mostra o que falta', async () => {
  const [conta] = await t.sql("SELECT id FROM contas WHERE cnpj = '12345678000190'");
  await t.sql("UPDATE credenciais_ref SET status = 'expirada' WHERE conta_id = $1 AND tipo = (SELECT tipo FROM credenciais_ref WHERE conta_id = $1 LIMIT 1)", [conta.id]);
  const a = await csvPost('/integracoes/csv/platform_consultas/aplicar', CAB + linhas('12345678000190', 'Multas e Notificações', [[1, 600, 600], [2, 600, 450], [3, 600, 420]]));
  assert.equal(a.aplicadas, 3);
  assert.match(a.resumo.join(' '), /1 alerta\(s\) novo/);
  const [oc] = await alertas(`consultas:${conta.id}:Multas`);
  assert.match(oc.titulo, /330 consulta\(s\) esperada\(s\) não gerada\(s\)/);
  assert.equal(oc.tipo, 'erro_consulta');
  assert.equal(oc.equipe, 'cs', 'conta VIP vai para o CS');
  const cred = await t.sql("SELECT count(*)::int AS q FROM credenciais_ref WHERE conta_id = $1 AND status <> 'ok'", [conta.id]);
  if (cred[0].q) assert.match(oc.descricao, /Causa provável/);
  // nova exportação com os mesmos dias (atualização tardia) + um dia novo: atualiza a volumetria e não abre outro alerta
  const b = await csvPost('/integracoes/csv/platform_consultas/aplicar', CAB + linhas('12345678000190', 'Multas e Notificações', [[2, 600, 460], [3, 600, 430], [4, 600, 400]]));
  assert.match(b.resumo.join(' '), /0 alerta\(s\) novo.*1 alerta\(s\) que já estavam/);
  assert.equal((await alertas(`consultas:${conta.id}:Multas`)).length, 1);
  const [{ geradas }] = await t.sql("SELECT geradas FROM consultas_volume WHERE conta_id = $1 AND dia = '2026-11-02'", [conta.id]);
  assert.equal(geradas, 460, 'vale o arquivo mais recente');
  const painel = (await pedro.get('/monitoramento/consultas?dias=7')).corpo;
  const linha = painel.itens.find((x) => x.conta_id === conta.id);
  assert.deepEqual([linha.esperadas, linha.geradas, linha.faltando, linha.alertas_ativos], [2400, 1890, 510, 1]);
  assert.equal((await t.entrarComo('Patrícia Gomes').then((p) => p.get('/monitoramento/consultas'))).status, 403);
});

test('robô parado há 3 dias e erro técnico (vai para o Desenvolvimento)', async () => {
  const [conta] = await t.sql("SELECT id FROM contas WHERE cnpj = '23456789000101'");
  await csvPost('/integracoes/csv/platform_consultas/aplicar', CAB + linhas('23456789000101', 'Licenciamento', [[1, 50, 50], [2, 50, 0], [3, 50, 0], [4, 50, 0]])
    + '\n' + linhas('23456789000101', 'Indicação de Condutores', [[4, 200, 200, 15]]));
  const parado = await alertas(`consultas:${conta.id}:Licenciamento:sem_execucao`);
  assert.equal(parado.length, 1);
  assert.equal(parado[0].prioridade, 'alta');
  const tec = await alertas(`consultas:${conta.id}:Indicação de Condutores:erro_tecnico`);
  assert.deepEqual([tec[0].tipo, tec[0].equipe], ['tecnica', 'dev']);
});

test('credencial que vence em até 15 dias e reincidência viram ocorrência uma vez (supervisor)', async () => {
  const [cred] = await t.sql("SELECT cr.conta_id, cr.tipo FROM credenciais_ref cr JOIN contas c ON c.id = cr.conta_id WHERE c.status <> 'encerrada' LIMIT 1");
  await t.sql("UPDATE credenciais_ref SET status = 'ok', expira_em = '2026-11-12' WHERE conta_id = $1 AND tipo = $2", [cred.conta_id, cred.tipo]);
  const [pend] = await t.sql(`INSERT INTO pendencias (tenant_id, conta_id, placa, erro_codigo, erro_categoria, descricao, origem, estado, recorrencias)
    SELECT tenant_id, id, 'REI3A33', 'CRED_AUSENTE', 'credencial', 'Credencial ausente para a placa', 'pos_rodada', 'persistente', 3 FROM contas WHERE cnpj = '12345678000190' RETURNING id`);
  for (let n = 0; n < 2; n++) {
    await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'");
    await t.processar();
  }
  const venc = await alertas(`credencial:${cred.conta_id}:${cred.tipo}:2026-11-12`);
  assert.equal(venc.length, 1);
  assert.match(venc[0].titulo, /vence em 8 dia\(s\) \(12\/11\/2026\)/);
  assert.equal(venc[0].tipo, 'credencial');
  const rca = await alertas(`rca:${pend.id}`);
  assert.equal(rca.length, 1);
  assert.match(rca[0].titulo, /pela 3ª vez/);
  assert.ok(rafael);
});
