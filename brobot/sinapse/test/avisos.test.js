'use strict';
// F27 · COM-009: sem alertas incessantes. Teto de avisos não críticos por pessoa por hora com aviso de resumo; o que
// passa do teto é adiado (não perdido); aviso urgente nunca espera e aparece primeiro.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { relogio } = require('../server/nucleo/relogio');

let t; let rafael; let rafaelId;
before(async () => {
  t = await subir();
  rafael = await t.entrarComo('Rafael Lima');
  rafaelId = (await t.sql("SELECT id FROM usuarios WHERE nome = 'Rafael Lima'"))[0].id;
});
after(async () => { await t.parar(); });

const avisar = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:lembretes'"); await t.processar(); };
const meus = (filtro = '') => t.sql(`SELECT titulo, gravidade, chave FROM notificacoes WHERE usuario_id = $1 ${filtro}`, [rafaelId]);

test('COM-009: passou de 10 avisos na hora, vem um resumo; os demais esperam e chegam depois, sem repetir', async () => {
  await t.sql('DELETE FROM notificacoes WHERE usuario_id = $1', [rafaelId]);
  const quando = new Date(relogio.agora().getTime() - 60e3).toISOString();
  for (let i = 1; i <= 13; i++) assert.equal((await rafael.post('/lembretes', { titulo: `Retornar cliente ${i}`, quando })).status, 201);
  await avisar();
  const naoCriticos = await meus("AND gravidade <> 'critica' AND chave NOT LIKE 'resumo:%'");
  assert.equal(naoCriticos.length, 10, 'no máximo 10 avisos não críticos na hora');
  const lembretes = await meus("AND titulo LIKE '%Retornar cliente%'");
  const resumo = await meus("AND chave LIKE 'resumo:%'");
  assert.equal(resumo.length, 1, 'um aviso de resumo');
  assert.match(resumo[0].titulo, /Muitos avisos/);
  const [{ n: esperando }] = await t.sql("SELECT count(*)::int AS n FROM lembretes WHERE usuario_id = $1 AND estado = 'ativo' AND avisado_para IS NULL", [rafaelId]);
  assert.equal(esperando, 13 - lembretes.length, 'os que passaram do teto ficam para o próximo ciclo');

  await avisar(); // mesma hora: nada novo, nem outro resumo
  assert.equal((await meus("AND titulo LIKE '%Retornar cliente%'")).length, lembretes.length);
  assert.equal((await meus("AND chave LIKE 'resumo:%'")).length, 1);

  await t.sql("UPDATE notificacoes SET criado_em = now() - interval '2 hours' WHERE usuario_id = $1", [rafaelId]); // a hora passou
  await avisar();
  assert.equal((await meus("AND titulo LIKE '%Retornar cliente%'")).length, 13, 'adiados, não perdidos');
  const [{ n: semAviso }] = await t.sql("SELECT count(*)::int AS n FROM lembretes WHERE usuario_id = $1 AND estado = 'ativo' AND avisado_para IS NULL", [rafaelId]);
  assert.equal(semAviso, 0);
});

test('COM-009: aviso urgente passa do teto e aparece primeiro, com a gravidade escrita para a tela', async () => {
  await t.sql('DELETE FROM notificacoes WHERE usuario_id = $1', [rafaelId]);
  const [tenant] = await t.sql("SELECT id FROM tenants WHERE slug = 'brobot'");
  for (let i = 0; i < 10; i++) {
    await t.sql("INSERT INTO notificacoes (tenant_id, usuario_id, titulo, gravidade, chave) VALUES ($1,$2,$3,'alerta',$4)", [tenant.id, rafaelId, `Aviso ${i}`, `teste:${i}`]);
  }
  const [eq] = await t.sql("SELECT id FROM equipes WHERE codigo = 'suporte'");
  await t.sql("INSERT INTO tarefas (tenant_id, tipo, titulo, equipe_id, prazo_em) VALUES ($1, 'escalonamento', 'Escalonamento de teste', $2, now() + interval '1 hour')", [tenant.id, eq.id]);
  await avisar();
  const lista = (await rafael.get('/notificacoes')).corpo.itens;
  assert.equal(lista[0].gravidade, 'critica', 'urgente não lido em primeiro');
  assert.match(lista[0].titulo, /Escalonamento/);
});
