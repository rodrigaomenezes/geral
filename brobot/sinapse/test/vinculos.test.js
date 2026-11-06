'use strict';
// F10 · INT-006: relacionar, mesclar e dividir ocorrências sem apagar nada.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');

let t; let rafael; let carla; let conta; let outraConta;
before(async () => {
  t = await subir();
  [rafael, carla] = await Promise.all(['Rafael Lima', 'Carla Mendes'].map((n) => t.entrarComo(n)));
  conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Logística Horizonte'"))[0].id;
  outraConta = (await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'"))[0].id;
});
after(async () => { await t.parar(); });

const nova = async (titulo, contaId = conta) => (await rafael.post('/ocorrencias', { contaId, tipo: 'erro_consulta', prioridade: 'media', titulo })).corpo;
const itens = async (id, placas) => { for (const p of placas) await t.sql("INSERT INTO ocorrencia_itens (tenant_id, ocorrencia_id, placa, descricao) SELECT tenant_id, id, $2, 'erro de consulta' FROM ocorrencias WHERE id = $1", [id, p]); };

test('relacionar: nos dois sentidos, pelo protocolo; repetir é recusado; outra organização não aparece', async () => {
  const a = await nova('Erro de multa no Detran-SP (Horizonte)');
  const b = await nova('Erro de multa no Detran-SP (Litoral)', outraConta);
  assert.equal((await carla.post(`/ocorrencias/${a.id}/relacionar`, { outra: b.protocolo, motivo: 'Mesmo problema' })).status, 403, 'Financeiro não atende ocorrência');
  assert.equal((await rafael.post(`/ocorrencias/${a.id}/relacionar`, { outra: a.protocolo, motivo: 'Ela mesma' })).status, 400);
  assert.equal((await rafael.post(`/ocorrencias/${a.id}/relacionar`, { outra: 'SIN-999999', motivo: 'Não existe' })).status, 404);
  assert.equal((await rafael.post(`/ocorrencias/${a.id}/relacionar`, { outra: b.protocolo.toLowerCase(), motivo: 'Mesmo problema do portal' })).status, 200);
  assert.equal((await rafael.post(`/ocorrencias/${b.id}/relacionar`, { outra: a.protocolo, motivo: 'De novo' })).status, 409);
  const da = (await rafael.get(`/ocorrencias/${a.id}`)).corpo;
  assert.deepEqual(da.vinculos.map((v) => [v.tipo, v.protocolo]), [['relacionada', b.protocolo]]);
  assert.ok(da.linhaDoTempo.some((l) => l.acao === 'ocorrencia.relacionada'));
  // Protocolo é por organização (o parceiro também tem SIN-000001); pelo identificador, a de outra organização não existe aqui.
  const parceiro = (await t.sql("SELECT id FROM ocorrencias WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'parceiro-demo') LIMIT 1"))[0];
  assert.equal((await rafael.post(`/ocorrencias/${a.id}/relacionar`, { outra: parceiro.id, motivo: 'Outra organização' })).status, 404, 'RLS');
  assert.equal((await rafael.post(`/ocorrencias/${parceiro.id}/relacionar`, { outra: b.protocolo, motivo: 'Outra organização' })).status, 404, 'RLS');
  assert.equal((await rafael.post('/ocorrencias/nao-e-uuid/relacionar', { outra: b.protocolo, motivo: 'Id inválido' })).status, 400);
});

test('mesclar: duplicada encerrada como "duplicada", itens copiados sem repetir, conversa passa para a principal, nada some', async () => {
  const pri = await nova('Placas sem consulta (principal)');
  const dup = await nova('Placas sem consulta (duplicada)');
  await itens(pri.id, ['ABC1D23']); await itens(dup.id, ['ABC1D23', 'XYZ9K87']);
  await t.sql("UPDATE ocorrencias SET conversa_chave = 'whatsapp:+5511900000001' WHERE id = $1", [dup.id]);
  const outra = await nova('De outra conta', outraConta);
  assert.equal((await rafael.post(`/ocorrencias/${dup.id}/mesclar`, { principal: outra.protocolo, motivo: 'Conta errada' })).status, 422, 'contas diferentes');
  const r = await rafael.post(`/ocorrencias/${dup.id}/mesclar`, { principal: pri.protocolo, motivo: 'Cliente mandou o mesmo pedido duas vezes' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.itensCopiados, 1, 'só a placa que faltava');
  const d = (await rafael.get(`/ocorrencias/${dup.id}`)).corpo;
  assert.equal(d.estado, 'encerrada_sem_resolucao');
  assert.equal(d.codigo_desfecho, 'duplicada');
  assert.match(d.motivo_encerramento, new RegExp(`Mesclada em ${pri.protocolo}`));
  assert.equal(d.itens.length, 2, 'a duplicada mantém os itens (histórico)');
  assert.deepEqual(d.vinculos.map((v) => [v.tipo, v.protocolo]), [['mesclada_em', pri.protocolo]]);
  const p = (await rafael.get(`/ocorrencias/${pri.id}`)).corpo;
  assert.deepEqual(p.itens.map((i) => i.placa).sort(), ['ABC1D23', 'XYZ9K87']);
  assert.equal(p.conversa_chave, 'whatsapp:+5511900000001');
  assert.ok(p.linhaDoTempo.some((l) => l.acao === 'ocorrencia.recebeu_mescla'));
  assert.equal((await rafael.post(`/ocorrencias/${dup.id}/mesclar`, { principal: pri.protocolo, motivo: 'De novo' })).status, 422, 'já encerrada');
  assert.equal((await rafael.post(`/ocorrencias/${pri.id}/mesclar`, { principal: dup.protocolo, motivo: 'Na encerrada' })).status, 422, 'principal encerrada');
});

test('dividir: itens escolhidos vão para a nova, ligada à original; não esvazia a original; motivo obrigatório', async () => {
  const o = await nova('Três placas com erros diferentes');
  await itens(o.id, ['AAA1A11', 'BBB2B22', 'CCC3C33']);
  const its = (await rafael.get(`/ocorrencias/${o.id}`)).corpo.itens;
  const ids = its.map((i) => i.id);
  assert.equal((await rafael.post(`/ocorrencias/${o.id}/dividir`, { titulo: 'Sem motivo aqui' })).status, 400);
  assert.equal((await rafael.post(`/ocorrencias/${o.id}/dividir`, { titulo: 'Todas as placas', itemIds: ids, motivo: 'Tudo para a nova' })).status, 422);
  const r = await rafael.post(`/ocorrencias/${o.id}/dividir`, { titulo: 'Placa CCC3C33: credencial do Detran-MG', prioridade: 'alta',
    itemIds: [its.find((i) => i.placa === 'CCC3C33').id], motivo: 'Causa diferente: credencial' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.itensMovidos, 1);
  const n = (await rafael.get(`/ocorrencias/${r.corpo.id}`)).corpo;
  assert.equal(n.conta_id, conta);
  assert.equal(n.prioridade, 'alta');
  assert.deepEqual(n.itens.map((i) => i.placa), ['CCC3C33']);
  assert.deepEqual(n.vinculos.map((v) => [v.tipo, v.protocolo]), [['dividida_de', o.protocolo]]);
  const orig = (await rafael.get(`/ocorrencias/${o.id}`)).corpo;
  assert.deepEqual(orig.itens.map((i) => i.placa).sort(), ['AAA1A11', 'BBB2B22']);
  assert.ok(orig.linhaDoTempo.some((l) => l.acao === 'ocorrencia.dividida' && l.motivo === 'Causa diferente: credencial'));
  const outra = await nova('Outra para teste de item alheio');
  assert.equal((await rafael.post(`/ocorrencias/${outra.id}/dividir`, { titulo: 'Item de outra', itemIds: [ids[0]], motivo: 'Item alheio' })).status, 400);
});
