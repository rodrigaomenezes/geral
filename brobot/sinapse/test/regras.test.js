'use strict';
// Regras puras e garantias do banco que não dependem do fluxo completo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarTelefone } = require('../server/nucleo/telefone');
const { calendario, somarHorasUteis, prazos } = require('../server/modulos/ocorrencias/sla');
const { planejar, acoesPermitidas } = require('../server/modulos/ocorrencias/maquina');
const { classificar } = require('../server/modulos/entrada/classificador');
const { equipeDaConta, situacaoVisivel } = require('../server/modulos/clientes/servico');
const { escolherCanal, proximaJanela } = require('../server/modulos/comunicacao/servico');
const { normalizarErro } = require('../server/modulos/rodadas/erros');
const { subir } = require('./ajuda');

test('telefone: E.164 com nono dígito', () => {
  assert.equal(normalizarTelefone('(11) 98765-4321'), '+5511987654321');
  assert.equal(normalizarTelefone('11 8765-4321'), '+5511987654321');
  assert.equal(normalizarTelefone('+55 (21) 3333-4444'), '+552133334444');
  assert.equal(normalizarTelefone('0055 11 98765 4321'), '+5511987654321');
  assert.equal(normalizarTelefone('123'), null);
});

test('SLA: horas úteis pulam noite, fim de semana e feriado', () => {
  const cal = calendario({}, ['2026-11-20']);
  // Qui 19/11 17h BRT + 4h úteis → sex 20/11 é feriado → seg 23/11 11h BRT (14h UTC)
  assert.equal(somarHorasUteis(new Date('2026-11-19T20:00:00Z'), 4, cal).toISOString(), '2026-11-23T14:00:00.000Z');
  // Sáb → começa seg 8h
  assert.equal(somarHorasUteis(new Date('2026-11-07T15:00:00Z'), 1, cal).toISOString(), '2026-11-09T12:00:00.000Z');
  const p = prazos('critica', { agora: new Date('2026-11-07T15:00:00Z'), cal });
  assert.equal(p.respostaEm.toISOString(), '2026-11-07T16:00:00.000Z', 'crítica conta horas corridas');
  const vip = prazos('media', { agora: new Date('2026-11-04T13:00:00Z'), vip: true, cal });
  assert.equal(vip.respostaEm.toISOString(), '2026-11-04T15:00:00.000Z', 'VIP tem metade do prazo');
});

const usuario = (papel, equipe = 'e1') => ({ id: 'u1', papel, equipe_id: equipe });
const ctxM = (u) => ({ usuario: u, agora: new Date('2026-11-04T13:00:00Z'), cal: calendario() });

test('máquina: resolver exige evidência; encerrar sem resolução exige motivo (RN-009)', () => {
  const oc = { estado: 'em_atendimento', equipe_id: 'e1', tipo: 'duvida' };
  assert.throws(() => planejar(oc, 'resolver', { codigoDesfecho: 'orientado' }, ctxM(usuario('suporte'))), /obrigatórios/);
  assert.throws(() => planejar(oc, 'resolver', { codigoDesfecho: 'orientado', evidencia: 'ok' }, ctxM(usuario('suporte'))), /evidência/);
  const r = planejar(oc, 'resolver', { codigoDesfecho: 'orientado', evidencia: 'Cliente confirmou por WhatsApp' }, ctxM(usuario('suporte')));
  assert.equal(r.para, 'resolvida');
  assert.throws(() => planejar(oc, 'encerrar_sem_resolucao', { codigoDesfecho: 'duplicada' }, ctxM(usuario('suporte'))), /obrigatórios/);
});

test('máquina: espera exige revisão em até 3 dias (WFL-010); transição inválida dá conflito', () => {
  const oc = { estado: 'em_atendimento', equipe_id: 'e1' };
  assert.throws(() => planejar(oc, 'aguardar_cliente', { motivo: 'x', revisaoEm: '2026-11-20T10:00:00Z' }, ctxM(usuario('suporte'))), /no máximo 3 dias/);
  const ok = planejar(oc, 'aguardar_cliente', { motivo: 'planilha', revisaoEm: '2026-11-05T10:00:00Z' }, ctxM(usuario('suporte')));
  assert.equal(ok.colunas.proxima_acao_em.toISOString(), '2026-11-05T10:00:00.000Z');
  assert.throws(() => planejar({ estado: 'resolvida' }, 'assumir', {}, ctxM(usuario('suporte'))), (e) => e.status === 409);
});

test('máquina: fora da equipe não assume; Desenvolvimento não resolve demanda técnica (DEV-005)', () => {
  assert.throws(() => planejar({ estado: 'aberta', equipe_id: 'outra' }, 'assumir', {}, ctxM(usuario('suporte'))), /outra equipe/);
  assert.ok(planejar({ estado: 'aberta', equipe_id: 'outra' }, 'assumir', {}, ctxM(usuario('supervisor'))));
  assert.throws(() => planejar({ estado: 'em_atendimento', equipe_id: 'e1', tipo: 'tecnica' }, 'resolver',
    { codigoDesfecho: 'corrigido_tecnico', evidencia: 'deploy feito e testado' }, ctxM(usuario('dev'))), /validada/);
  assert.equal(acoesPermitidas({ estado: 'triagem' }, usuario('financeiro')).length, 0, 'Financeiro não atende');
});

test('classificação: um assunto = certa; nenhum ou vários = triagem (INT-005)', () => {
  assert.deepEqual(classificar('Meu certificado venceu').tipo, 'credencial');
  assert.equal(classificar('Bom dia').certa, false);
  assert.equal(classificar('Erro na senha e dúvida de como funciona').certa, false);
});

test('roteamento RN-001, canal COM-004, financeiro mínimo FIN-010, erros normalizados', () => {
  assert.equal(equipeDaConta({ vip: true }), 'cs');
  assert.equal(equipeDaConta({ vip: false }), 'suporte');
  assert.equal(equipeDaConta({ vip: false, roteamento_excecao: 'cs' }), 'cs');
  assert.equal(escolherCanal({ opt_out: true, telefone: '+5511987654321' }).canal, null);
  assert.equal(escolherCanal({ canal_preferido: 'whatsapp', telefone: '+5511987654321', consentimento_whatsapp: false, email: 'a@b.c' }).canal, 'email');
  assert.equal(situacaoVisivel('em_atraso', null, { papel: 'suporte' }).rotulo, 'Atenção: consulte o Financeiro');
  assert.equal(situacaoVisivel('em_atraso', null, { papel: 'financeiro' }).rotulo, 'Em atraso');
  assert.equal(normalizarErro('SNE_VINCULO_AUSENTE').doCliente, true);
  assert.equal(normalizarErro('TIMEOUT_CONSULTA').doCliente, false);
  assert.equal(proximaJanela(new Date('2026-11-04T13:00:00Z')), null);
  assert.equal(proximaJanela(new Date('2026-11-05T01:00:00Z')).toISOString(), '2026-11-05T11:00:00.000Z');
});

let t;
before(async () => { t = await subir(); });
after(async () => { await t.parar(); });

test('banco: ocorrência ativa sem próxima ação é recusada (RN-008) e auditoria é imutável', async () => {
  await assert.rejects(t.sql("UPDATE ocorrencias SET proxima_acao_em = NULL WHERE estado = 'aberta'"), /ativa_completa/);
  await assert.rejects(t.sql('UPDATE auditoria SET acao = acao'), /só de anexação/);
  await assert.rejects(t.sql('DELETE FROM auditoria'), /só de anexação/);
});

test('API: sem sessão → 401; sem permissão → 403; erro no formato padrão; outra origem → 403', async () => {
  const r = await fetch(`${t.base}/api/ocorrencias`);
  assert.equal(r.status, 401);
  assert.deepEqual(Object.keys((await r.json()).error), ['code', 'message', 'details']);
  const lucas = await t.entrarComo('Lucas Ferreira');
  assert.equal((await lucas.get('/supervisor')).status, 403);
  const carla = await t.entrarComo('Carla Mendes');
  const [o] = await t.sql("SELECT id FROM ocorrencias WHERE estado = 'aberta' AND tenant_id = $1 LIMIT 1", [await t.tenant('brobot')]);
  assert.equal((await carla.post(`/ocorrencias/${o.id}/transicoes`, { acao: 'assumir' })).status, 403);
  const csrf = await fetch(`${t.base}/api/sessao/sair`, { method: 'POST', headers: { origin: 'https://malicioso.example', 'content-type': 'application/json' } });
  assert.equal(csrf.status, 403);
});

test('API: ponto focal trocado vai para o histórico, telefone normalizado', async () => {
  const juliana = await t.entrarComo('Juliana Alves');
  const [conta] = await t.sql("SELECT id FROM contas WHERE nome = 'Frota Nordeste Cargas'");
  const r = await juliana.post(`/contas/${conta.id}/pontos-focais`, { papel: 'principal', nome: 'Marcos Teixeira', telefone: '(81) 8888-7777', consentimentoWhatsapp: true });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.telefone, '+5581988887777');
  await juliana.post(`/contas/${conta.id}/pontos-focais`, { papel: 'principal', nome: 'Nova Pessoa', email: 'nova@nordeste.example' });
  const pfs = await t.sql('SELECT nome, vigente FROM pontos_focais WHERE conta_id = $1 ORDER BY criado_em', [conta.id]);
  assert.deepEqual(pfs.map((p) => p.vigente), [false, true]);
  const d = await juliana.get(`/contas/${conta.id}`);
  assert.equal(d.corpo.alertas.some((a) => a.codigo === 'sem_ponto_focal'), false);
});

test('API: listagens são paginadas e o painel não tem órfãs nem ocorrência sem próxima ação', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const l = await marina.get('/ocorrencias?estado=todas');
  assert.ok(l.corpo.porPagina <= 30);
  const p = await marina.get('/painel');
  assert.equal(p.corpo.ocorrencias.orfas, 0);
  assert.equal(p.corpo.ocorrencias.sem_proxima_acao, 0);
});
