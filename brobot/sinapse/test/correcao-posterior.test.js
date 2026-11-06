'use strict';
// POS-008: correção feita depois da rodada oficial fica ligada ao histórico original — a mesma pendência (rodada,
// placa, erro, data em que foi detectada) passa a corrigida com evidência da Platform, e a ocorrência original é
// resolvida com essa evidência. Nada é recriado nem apagado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let pedro; let rafael;
before(async () => {
  t = await subir();
  [pedro, rafael] = await Promise.all(['Pedro Santos', 'Rafael Lima'].map((n) => t.entrarComo(n)));
});
after(async () => { await t.parar(); });

test('pendência persistente corrigida dias depois: mesma linha, evidência, ocorrência original resolvida', async () => {
  const conta = (await t.sql("SELECT id, tenant_id FROM contas WHERE nome = 'Logística Horizonte'"))[0];
  const oc = (await rafael.post('/ocorrencias', { contaId: conta.id, tipo: 'pos_rodada', prioridade: 'media', titulo: 'Pós-rodada: placa sem consulta' })).corpo;
  const placa = 'POS8A88';
  await t.sql("INSERT INTO demo_platform_veiculos (tenant_id, conta_id, placa, erro_codigo) VALUES ($1, $2, $3, 'CRED_EXPIRADA')", [conta.tenant_id, conta.id, placa]);
  const [p] = await t.sql(`INSERT INTO pendencias (tenant_id, conta_id, ocorrencia_id, placa, erro_codigo, erro_categoria, descricao, origem, estado, detectada_em)
    VALUES ($1, $2, $3, $4, 'CRED_EXPIRADA', 'credencial', 'Credencial expirada no órgão', 'pos_rodada', 'persistente', '2026-10-30T13:00:00Z') RETURNING id`,
  [conta.tenant_id, conta.id, oc.id, placa]);

  // Ainda com erro na Platform: continua persistente e a tentativa fica auditada.
  const sem = await pedro.post(`/pendencias/${p.id}/revalidar`, {});
  assert.equal(sem.status, 200);
  assert.equal(sem.corpo.corrigida, false);
  assert.equal((await t.sql('SELECT estado FROM pendencias WHERE id = $1', [p.id]))[0].estado, 'persistente');

  await t.avancar(3 * 24); // o cliente corrige três dias depois
  await t.sql('UPDATE demo_platform_veiculos SET erro_codigo = NULL WHERE conta_id = $1 AND placa = $2', [conta.id, placa]);
  const ok = await pedro.post(`/pendencias/${p.id}/revalidar`, {});
  assert.equal(ok.corpo.corrigida, true);

  const depois = (await t.sql('SELECT estado, ocorrencia_id, detectada_em, evidencia_correcao FROM pendencias WHERE id = $1', [p.id]))[0];
  assert.equal(depois.estado, 'corrigida');
  assert.equal(depois.ocorrencia_id, oc.id, 'continua ligada à ocorrência original');
  assert.equal(new Date(depois.detectada_em).toISOString(), '2026-10-30T13:00:00.000Z', 'histórico preservado');
  assert.match(depois.evidencia_correcao, /sem erro na Platform/);
  assert.equal((await t.sql("SELECT count(*)::int AS n FROM pendencias WHERE conta_id = $1 AND placa = $2", [conta.id, placa]))[0].n, 1, 'nada recriado');
  const d = (await rafael.get(`/ocorrencias/${oc.id}`)).corpo;
  assert.equal(d.estado, 'resolvida');
  assert.match(d.evidencia, /Todas as pendências confirmadas pela Platform/);
  const aud = await t.sql("SELECT acao FROM auditoria WHERE entidade_id = $1 ORDER BY id", [p.id]);
  assert.deepEqual(aud.map((a) => a.acao).filter((a) => a.startsWith('pendencia.')), ['pendencia.revalidacao_sem_correcao', 'pendencia.corrigida']);
});
