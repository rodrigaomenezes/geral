'use strict';
// F6 · Treinamentos coletivos do CS (CS-004…009).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let juliana; let pat; let tenant;
before(async () => { t = await subir(); juliana = await t.entrarComo('Juliana Alves'); pat = await t.entrarComo('Patrícia Gomes'); tenant = await t.tenant(); });
after(async () => { await t.parar(); });

const conta = async (nome) => (await t.sql('SELECT id, cnpj FROM contas WHERE nome = $1', [nome]))[0];
const supervisor = async () => {
  await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'");
  await t.processar();
};

test('sessão: roteiro padrão, link https, conta de demonstração (nunca CNPJ de cliente) e permissão', async () => {
  const lista = (await juliana.get('/treinamentos')).corpo;
  assert.equal(lista.roteiros[0].codigo, 'primeiros_passos', 'organização recebe um roteiro de partida');
  assert.ok(lista.roteiros[0].passos.length >= 3);
  const base = { titulo: 'Primeiros passos · turma de novembro', roteiro: 'primeiros_passos', inicio: '2026-11-06T17:00:00Z', link: 'https://meet.example/abc-defg', contaDemo: 'Demo Brobot' };
  assert.equal((await pat.post('/treinamentos', base)).status, 403, 'Comercial não organiza treinamento');
  const rota = await conta('Transportadora Rota Sul');
  assert.equal((await juliana.post('/treinamentos', { ...base, contaDemo: rota.cnpj })).status, 422, 'CNPJ de cliente recusado');
  assert.equal((await juliana.post('/treinamentos', { ...base, link: 'http://inseguro.example/x' })).status, 400);
  assert.equal((await juliana.post('/treinamentos', { ...base, inicio: '2026-11-01T17:00:00Z' })).status, 400, 'no passado');
  const s = await juliana.post('/treinamentos', base);
  assert.equal(s.status, 201);
});

test('convite ao ponto focal pelo canal permitido, presença, avaliação, conclusão e efetividade pelo uso', async () => {
  const [s] = await t.sql("SELECT id FROM treinamento_sessoes WHERE titulo = 'Primeiros passos · turma de novembro'");
  const rota = await conta('Transportadora Rota Sul'); const horizonte = await conta('Logística Horizonte');
  await t.sql(`INSERT INTO uso_contas (tenant_id, conta_id, ultimo_login, usuarios_ativos, consultas_30d) VALUES ($1,$2,'2026-10-20T12:00:00Z',3,100), ($1,$3,'2026-10-25T12:00:00Z',2,40)
    ON CONFLICT (tenant_id, conta_id) DO UPDATE SET consultas_30d = EXCLUDED.consultas_30d, ultimo_login = EXCLUDED.ultimo_login`, [tenant, rota.id, horizonte.id]);
  assert.equal((await juliana.post(`/treinamentos/${s.id}/participantes`, { contaIds: [rota.id, horizonte.id, rota.id] })).corpo.incluidos, 2, 'repetida não duplica');
  const conv = (await juliana.post(`/treinamentos/${s.id}/convidar`)).corpo;
  assert.equal(conv.convidados + conv.bloqueados.length + conv.semPontoFocal.length, 2);
  const convites = await t.sql("SELECT i.canal, i.texto FROM interacoes i WHERE i.modelo LIKE 'convite_treinamento@%' AND i.conta_id = $1", [rota.id]);
  assert.equal(convites.length, 1);
  assert.match(convites[0].texto, /https:\/\/meet\.example\/abc-defg/);
  assert.match(convites[0].texto, /conta de demonstração/);
  assert.equal((await juliana.post(`/treinamentos/${s.id}/convidar`)).corpo.convidados, 0, 'quem já foi convidado não recebe de novo');
  const d = (await juliana.get(`/treinamentos/${s.id}`)).corpo;
  const pRota = d.participantes.find((x) => x.conta_id === rota.id); const pHor = d.participantes.find((x) => x.conta_id === horizonte.id);
  assert.equal(pRota.consultas_30d_antes, 100, 'uso fotografado no convite');
  assert.equal((await juliana.post(`/treinamentos/participantes/${pRota.id}`, { presenca: 'presente' })).status, 422, 'antes da sessão');
  await t.avancar(53); // 04/11 13h UTC → 06/11 18h UTC: a sessão (06/11 17h UTC) já começou
  assert.equal((await juliana.post(`/treinamentos/participantes/${pHor.id}`, { presenca: 'ausente', avaliacao: 5 })).status, 400, 'ausente não avalia');
  await juliana.post(`/treinamentos/participantes/${pRota.id}`, { presenca: 'presente', avaliacao: 5, duvidas: 'Como agendar relatório por filial?', proximoPasso: 'Enviar o passo a passo do relatório' });
  assert.equal((await juliana.post(`/treinamentos/${s.id}/concluir`)).status, 422, 'falta marcar a presença da Horizonte');
  await juliana.post(`/treinamentos/participantes/${pHor.id}`, { presenca: 'ausente' });
  assert.equal((await juliana.post(`/treinamentos/${s.id}/concluir`)).corpo.estado, 'realizada');
  const reag = await t.sql("SELECT titulo FROM tarefas WHERE chave = $1", [`treino-ausente:${s.id}:${horizonte.id}`]);
  assert.match(reag[0].titulo, /Reagendar treinamento de Logística Horizonte/);
  // CS-009: depois do treino o uso da Rota Sul subiu; a Horizonte (ausente) caiu
  await t.sql('UPDATE uso_contas SET consultas_30d = 160 WHERE conta_id = $1', [rota.id]);
  await t.sql('UPDATE uso_contas SET consultas_30d = 30 WHERE conta_id = $1', [horizonte.id]);
  const ef = (await juliana.get(`/treinamentos/${s.id}`)).corpo.efetividade;
  assert.deepEqual([ef.medidos, ef.variacaoMediaPresentes, ef.variacaoMediaAusentes], [2, 60, -10]);
  const l = (await juliana.get('/treinamentos')).corpo.itens.find((x) => x.id === s.id);
  assert.deepEqual([l.presentes, l.avaliacao_media, l.estado], [1, 5, 'realizada']);
});

test('roteiro versionado: nova versão não muda a sessão antiga; passos validados', async () => {
  const [s] = await t.sql("SELECT roteiro_id FROM treinamento_sessoes WHERE titulo = 'Primeiros passos · turma de novembro'");
  assert.equal((await juliana.post('/treinamentos/roteiros', { codigo: 'primeiros_passos', titulo: 'Primeiros passos', passos: [{ tela: 'X', objetivo: 'ok' }] })).status, 400);
  const v2 = (await juliana.post('/treinamentos/roteiros', { codigo: 'primeiros_passos', titulo: 'Primeiros passos (v2)', passos: [{ tela: 'Painel', objetivo: 'Ver o resumo do dia' }] })).corpo;
  assert.equal(v2.versao, 2);
  const [antigo] = await t.sql('SELECT versao, ativo FROM treinamento_roteiros WHERE id = $1', [s.roteiro_id]);
  assert.deepEqual([antigo.versao, antigo.ativo], [1, false], 'a sessão realizada continua apontando para a v1');
});

test('conta sem uso vira alerta para o CS oferecer treinamento (uma vez), salvo se já estiver numa sessão agendada', async () => {
  const valeverde = await conta('Expresso Vale Verde'); const transminas = await conta('TransMinas Fretes');
  await t.sql(`INSERT INTO uso_contas (tenant_id, conta_id, ultimo_login, consultas_30d) VALUES ($1,$2,'2026-09-01T12:00:00Z',10), ($1,$3,'2026-09-01T12:00:00Z',0)
    ON CONFLICT (tenant_id, conta_id) DO UPDATE SET ultimo_login = EXCLUDED.ultimo_login, consultas_30d = EXCLUDED.consultas_30d`, [tenant, valeverde.id, transminas.id]);
  await t.sql("UPDATE contas SET status = 'ativa' WHERE id IN ($1, $2)", [valeverde.id, transminas.id]);
  const s = (await juliana.post('/treinamentos', { titulo: 'Turma de dezembro', roteiro: 'primeiros_passos', inicio: '2026-12-01T17:00:00Z', link: 'https://meet.example/dez', contaDemo: 'Demo Brobot' })).corpo;
  await juliana.post(`/treinamentos/${s.id}/participantes`, { contaIds: [transminas.id] });
  await supervisor(); await supervisor();
  const alertas = await t.sql("SELECT o.titulo, e.codigo FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id WHERE o.alerta_chave = $1", [`inatividade:${valeverde.id}`]);
  assert.equal(alertas.length, 1);
  assert.deepEqual([alertas[0].codigo, /oferecer treinamento/.test(alertas[0].titulo)], ['cs', true]);
  assert.equal((await t.sql('SELECT count(*)::int AS q FROM ocorrencias WHERE alerta_chave = $1', [`inatividade:${transminas.id}`]))[0].q, 0, 'já convidada para a turma de dezembro');
});
