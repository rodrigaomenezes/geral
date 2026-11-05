'use strict';
// F4 · Onboarding com checklist e offboarding (ONB-001…012, CS-012).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { progresso, validarItens, PADRAO } = require('../server/modulos/onboarding/modelos');
const { subir } = require('./ajuda');

test('regras puras: progresso por grupo, o que impede a conclusão e validação do modelo', () => {
  const p = progresso([
    { codigo: 'a', titulo: 'A', grupo: 'administrativa', obrigatorio: true, estado: 'feito' },
    { codigo: 'b', titulo: 'B', grupo: 'administrativa', obrigatorio: true, estado: 'dispensa_pedida' },
    { codigo: 'c', titulo: 'C', grupo: 'tecnica', obrigatorio: false, estado: 'pendente' },
    { codigo: 'd', titulo: 'D', grupo: 'tecnica', obrigatorio: true, estado: 'dispensado' },
  ]);
  assert.deepEqual(p.grupos.map((g) => [g.grupo, g.prontos, g.total]), [['administrativa', 1, 2], ['tecnica', 1, 2]]);
  assert.deepEqual(p.faltam.map((f) => f.codigo), ['b'], 'dispensa só pedida ainda impede; opcional não impede');
  assert.equal(p.podeConcluir, false);
  const eq = ['cs', 'suporte', 'operacoes', 'financeiro'];
  assert.deepEqual(validarItens(PADRAO.onboarding, eq), []);
  assert.match(validarItens([{ codigo: 'x', titulo: 'ok', grupo: 'nada', equipe: 'marte', dias: 200 }], eq).join(' '), /código inválido.*título.*grupo.*equipe.*prazo/);
});

let t; let pat; let juliana; let marina; let carla; let pedro;
before(async () => {
  t = await subir();
  [pat, juliana, marina, carla, pedro] = await Promise.all(['Patrícia Gomes', 'Juliana Alves', 'Marina Costa', 'Carla Mendes', 'Pedro Santos'].map((n) => t.entrarComo(n)));
});
after(async () => { await t.parar(); });

/** Venda nova pelo funil completo (com teste aprovado). */
async function vender(empresa, cnpj) {
  const op = (await pat.post('/comercial/oportunidades', { empresa, contatoNome: 'Ana', contatoTelefone: '11 97777-0001', produtos: ['multas'], frota: 30, valorMensal: '900' })).corpo;
  const mv = (para, extra = {}) => pat.post(`/comercial/oportunidades/${op.id}/etapa`, { para, ...extra });
  for (const e of ['qualificacao', 'demonstracao', 'proposta']) await mv(e);
  await mv('teste', { cnpj, testeInicio: '2026-11-04', testeFim: '2026-11-10', testeCriterio: 'Consultar a frota sem erro' });
  await pat.post(`/comercial/oportunidades/${op.id}/teste`, { resultado: 'aprovado', parecer: 'Frota consultada' });
  await mv('negociacao');
  const g = await mv('ganha');
  assert.equal(g.status, 200);
  return g.corpo.conta_id;
}

test('venda ganha abre o onboarding; o sistema confere sozinho o que tem dado; concluir exige tudo e ativa a conta', async () => {
  const contaId = await vender('Onboarding Teste Ltda', '55.444.333/0001-22');
  const r = (await juliana.get(`/contas/${contaId}/checklists`)).corpo;
  assert.equal(r.checklists.length, 1);
  const ck = r.checklists[0];
  assert.deepEqual([ck.tipo, ck.estado, ck.modelo_versao], ['onboarding', 'aberto', 1]);
  assert.ok(ck.ocorrencia_id && ck.oportunidade_id, 'ligado à ocorrência de onboarding do CS e à venda');
  const item = (cod) => ck.itens.find((i) => i.codigo === cod);
  assert.equal(item('produtos').estado, 'feito', 'produtos vieram da venda');
  assert.match(item('produtos').evidencia, /Verificado pelo sistema/);
  assert.equal(item('ponto_focal').estado, 'pendente');
  assert.equal((await juliana.post(`/checklists/${ck.id}/concluir`)).status, 422, 'faltam itens obrigatórios');
  // ponto focal cadastrado: o item se marca sozinho na próxima leitura
  await juliana.post(`/contas/${contaId}/pontos-focais`, { papel: 'principal', nome: 'Ana Lima', telefone: '(11) 97777-0001', consentimentoWhatsapp: true });
  const r2 = (await juliana.get(`/contas/${contaId}/checklists`)).corpo.checklists[0];
  assert.equal(r2.itens.find((i) => i.codigo === 'ponto_focal').estado, 'feito');
  // feito exige evidência; Financeiro marca o item dele mesmo sem editar contas; Comercial não mexe
  const contrato = r2.itens.find((i) => i.codigo === 'contrato');
  assert.equal((await juliana.post(`/checklists/itens/${contrato.id}/feito`, {})).status, 400);
  assert.equal((await juliana.post(`/checklists/itens/${contrato.id}/feito`, { evidencia: 'Contrato assinado no DocuSign, pasta Clientes/2026' })).status, 200);
  const omie = r2.itens.find((i) => i.codigo === 'omie');
  assert.equal((await pat.post(`/checklists/itens/${omie.id}/feito`, { evidencia: 'Cadastrado no OMIE' })).status, 403);
  assert.equal((await carla.post(`/checklists/itens/${omie.id}/feito`, { evidencia: 'Cliente cadastrado no OMIE, código 9001' })).status, 200);
  // dispensa: pedida por quem cuida, aprovada por OUTRA pessoa da gestão
  const sne = r2.itens.find((i) => i.codigo === 'sne');
  assert.equal((await pedro.post(`/checklists/itens/${sne.id}/pedir_dispensa`, { motivo: 'Produto contratado não usa SNE' })).corpo.estado, 'dispensa_pedida');
  assert.equal((await pedro.post(`/checklists/itens/${sne.id}/aprovar_dispensa`)).status, 403, 'Operações não aprova exceção');
  assert.equal((await marina.post(`/checklists/itens/${sne.id}/aprovar_dispensa`)).corpo.estado, 'dispensado');
  const opcional = r2.itens.find((i) => i.codigo === 'treinamento');
  assert.equal((await juliana.post(`/checklists/itens/${opcional.id}/pedir_dispensa`, { motivo: 'não precisa' })).status, 422, 'opcional não precisa de dispensa');
  // o resto, com evidência
  for (const i of r2.itens.filter((x) => x.obrigatorio && x.estado === 'pendente' && !['contrato', 'omie', 'sne'].includes(x.codigo))) {
    assert.equal((await marina.post(`/checklists/itens/${i.id}/feito`, { evidencia: `Conferido: ${i.titulo}` })).status, 200, i.codigo);
  }
  const fim = await juliana.post(`/checklists/${ck.id}/concluir`);
  assert.equal(fim.status, 200);
  assert.equal(fim.corpo.contaStatus, 'ativa');
  assert.equal((await t.sql('SELECT status FROM contas WHERE id = $1', [contaId]))[0].status, 'ativa');
  assert.equal((await juliana.post(`/checklists/${ck.id}/concluir`)).status, 409);
  const ev = await t.sql("SELECT count(*)::int AS q FROM eventos WHERE event_type = 'conta.onboarding_concluido' AND aggregate_id = $1", [contaId]);
  assert.equal(ev[0].q, 1);
});

test('modelo versionado: mudar o modelo não mexe no checklist já aberto', async () => {
  const contaId = await vender('Modelo Versao SA', '66.555.444/0001-33');
  const antes = (await juliana.get(`/contas/${contaId}/checklists`)).corpo.checklists[0];
  const m = (await marina.get('/checklists/modelos/onboarding')).corpo;
  assert.equal((await juliana.post('/checklists/modelos/onboarding', { itens: m.itens })).status, 403, 'CS não edita o modelo');
  const novo = await marina.post('/checklists/modelos/onboarding', { itens: [...m.itens, { codigo: 'kickoff', titulo: 'Reunião de kickoff feita', grupo: 'relacionamento', equipe: 'cs', dias: 1 }] });
  assert.equal(novo.corpo.versao, 2);
  assert.equal((await marina.post('/checklists/modelos/onboarding', { itens: [{ codigo: 'x1', titulo: 'Xis', grupo: 'tecnica', equipe: 'cs', dias: 1, verificacao: 'magica' }] })).status, 400);
  const depois = (await juliana.get(`/contas/${contaId}/checklists`)).corpo.checklists[0];
  assert.equal(depois.itens.length, antes.itens.length, 'aberto antes continua com os itens da v1');
  const outra = await vender('Modelo Versao Dois', '77.666.555/0001-44');
  const ck2 = (await juliana.get(`/contas/${outra}/checklists`)).corpo.checklists[0];
  assert.deepEqual([ck2.modelo_versao, ck2.itens.some((i) => i.codigo === 'kickoff')], [2, true]);
});

test('item obrigatório vencido vira tarefa da equipe dele, uma vez', async () => {
  const contaId = await vender('Prazo Vencido ME', '88.777.666/0001-55');
  await t.avancar(24 * 4);
  for (let n = 0; n < 2; n++) {
    await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'");
    await t.processar();
  }
  const tarefas = await t.sql(`SELECT t.titulo, e.codigo FROM tarefas t JOIN equipes e ON e.id = t.equipe_id WHERE t.titulo LIKE 'Onboarding de Prazo Vencido ME%'`);
  assert.ok(tarefas.some((x) => /Contrato assinado/.test(x.titulo) && x.codigo === 'cs'));
  assert.ok(tarefas.some((x) => /Cliente cadastrado no OMIE/.test(x.titulo) && x.codigo === 'financeiro'));
  assert.equal(new Set(tarefas.map((x) => x.titulo)).size, tarefas.length, 'sem tarefa repetida');
  assert.ok(contaId);
});

test('offboarding: exige motivo; confere pendências; concluir encerra a conta sem apagar nada', async () => {
  const [c] = await t.sql("SELECT id FROM contas WHERE nome = 'Frota Nordeste Cargas'");
  assert.equal((await juliana.post(`/contas/${c.id}/checklists`, { tipo: 'offboarding' })).status, 400, 'sem motivo');
  assert.equal((await pat.post(`/contas/${c.id}/checklists`, { tipo: 'offboarding', motivo: 'Cancelamento pedido pelo cliente' })).status, 403);
  const ab = await juliana.post(`/contas/${c.id}/checklists`, { tipo: 'offboarding', motivo: 'Cancelamento pedido pelo cliente (troca de fornecedor)' });
  assert.equal(ab.status, 201);
  assert.equal((await juliana.post(`/contas/${c.id}/checklists`, { tipo: 'offboarding', motivo: 'de novo, mesmo motivo' })).corpo.id, ab.corpo.id, 'idempotente: um aberto por tipo');
  const ck = (await juliana.get(`/contas/${c.id}/checklists`)).corpo.checklists.find((x) => x.tipo === 'offboarding');
  for (const i of ck.itens.filter((x) => x.obrigatorio && x.estado === 'pendente' && x.codigo !== 'pendencias')) {
    await marina.post(`/checklists/itens/${i.id}/feito`, { evidencia: `Feito: ${i.titulo}` });
  }
  const pend = ck.itens.find((i) => i.codigo === 'pendencias');
  const ativas = (await t.sql("SELECT count(*)::int AS q FROM ocorrencias WHERE conta_id = $1 AND estado NOT IN ('resolvida','encerrada_sem_resolucao')", [c.id]))[0].q;
  if (ativas) {
    assert.equal(pend.estado, 'pendente', 'ocorrência ativa impede o item automático');
    await marina.post(`/checklists/itens/${pend.id}/feito`, { evidencia: 'Ocorrências tratadas e encerradas com o cliente' });
  }
  const fim = await juliana.post(`/checklists/${ck.id}/concluir`);
  assert.equal(fim.status, 200);
  const [depois] = await t.sql('SELECT status, arquivada_em FROM contas WHERE id = $1', [c.id]);
  assert.deepEqual([depois.status, depois.arquivada_em], ['encerrada', null], 'encerrada, não apagada nem arquivada');
  assert.equal((await juliana.post(`/contas/${c.id}/checklists`, { tipo: 'offboarding', motivo: 'tentar encerrar de novo' })).status, 409);
});
