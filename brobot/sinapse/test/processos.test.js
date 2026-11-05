'use strict';
// Motor de processos: validação, simulação, versões, ligação com resultado, força-tarefa, proteção contra laço.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { validarDefinicao, avaliar } = require('../server/modulos/processos/regras');
const { descrever } = require('../server/modulos/processos/catalogo');
const motor = require('../server/modulos/processos/motor');
const { ctxSistema } = require('../server/nucleo/registro');
const { subir } = require('./ajuda');

const EQUIPES = ['suporte', 'cs', 'supervisao'];

test('definição: erros apontam o passo e o campo; descrição em português', () => {
  assert.throws(() => validarDefinicao({ gatilho: 'xx', passos: [] }, { equipes: EQUIPES }), (e) => {
    const campos = e.details.map((d) => d.campo);
    return campos.includes('gatilho') && campos.includes('passos');
  });
  assert.throws(() => validarDefinicao({ gatilho: 'ocorrencia.criada', passos: [{ tipo: 'criar_tarefa', titulo: 'x', equipe: 'marte', prazoHoras: 2 }] },
    { equipes: EQUIPES }), /itens a corrigir/);
  assert.throws(() => validarDefinicao({ gatilho: 'ocorrencia.criada', passos: [{ tipo: 'esperar', ateD0Horas: -24 }] }, { equipes: EQUIPES }),
    (e) => e.details.some((d) => /só vale para processos de rodada/.test(d.problema)));
  const d = validarDefinicao({ gatilho: 'ocorrencia.criada', condicoes: [{ campo: 'ocorrencia.prioridade', operador: 'em', valor: 'alta, critica' }],
    passos: [{ tipo: 'criar_tarefa', titulo: 'Olhar {protocolo}', equipe: 'da_conta', prazoHoras: '4' }] }, { equipes: EQUIPES });
  assert.deepEqual(d.condicoes[0].valor, ['alta', 'critica']);
  assert.equal(d.passos[0].prazoHoras, 4);
  assert.match(descrever(d), /^Quando: Uma ocorrência é aberta\. Se: Prioridade é um de alta ou crítica\. 1\. Criar tarefa/);
  assert.equal(avaliar({ campo: 'x', operador: 'maior', valor: 0 }, { x: 2 }), true);
});

let t;
before(async () => { t = await subir(); await t.processar(); });
after(async () => { await t.parar(); });

const novoProcesso = {
  nome: 'Teste: dúvida gera tarefa',
  definicao: { gatilho: 'ocorrencia.criada', condicoes: [{ campo: 'ocorrencia.tipo', operador: 'igual', valor: 'duvida' }],
    passos: [{ tipo: 'criar_tarefa', titulo: 'Responder dúvida {protocolo}', equipe: 'suporte', prazoHoras: 2 }] },
};

test('permissão: Suporte vê processos mas não cria; Supervisão cria, simula, ativa', async () => {
  const rafael = await t.entrarComo('Rafael Lima');
  assert.equal((await rafael.get('/processos')).status, 200);
  assert.equal((await rafael.post('/processos', novoProcesso)).status, 403);
  const marina = await t.entrarComo('Marina Costa');
  const criado = await marina.post('/processos', novoProcesso);
  assert.equal(criado.status, 201);
  assert.equal(criado.corpo.versoes[0].estado, 'rascunho');
  const sim = await marina.post('/processos/simular', { definicao: novoProcesso.definicao });
  assert.equal(sim.status, 200);
  assert.ok(sim.corpo.linhas.length >= 1);
  const ativo = await marina.post(`/processos/${criado.corpo.id}/ativar`, { nota: 'teste' });
  assert.equal(ativo.corpo.versoes[0].estado, 'ativa');
});

test('execução: gatilho real cria a tarefa; nova versão não muda execução antiga; versão ativada é imutável', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const [proc] = await t.sql("SELECT id FROM processos WHERE nome = 'Teste: dúvida gera tarefa'");
  const [conta] = await t.sql("SELECT id FROM contas WHERE nome = 'Cargas Litoral'");
  const oc = await marina.post('/ocorrencias', { contaId: conta.id, tipo: 'duvida', prioridade: 'baixa', titulo: 'Dúvida de teste do processo' });
  assert.equal(oc.status, 201);
  await t.avancar(0.01);
  const [tarefa] = await t.sql('SELECT titulo, execucao_id FROM tarefas WHERE ocorrencia_id = $1', [oc.corpo.id]);
  assert.equal(tarefa.titulo, `Responder dúvida ${oc.corpo.protocolo}`);
  const [exe] = await t.sql('SELECT versao_id, estado FROM processo_execucoes WHERE id = $1', [tarefa.execucao_id]);
  assert.equal(exe.estado, 'concluida');
  const v2 = { ...novoProcesso.definicao, passos: [{ ...novoProcesso.definicao.passos[0], titulo: 'V2 {protocolo}' }] };
  await marina.post(`/processos/${proc.id}/rascunho`, { definicao: v2 });
  const d = await marina.post(`/processos/${proc.id}/ativar`, {});
  assert.deepEqual(d.corpo.versoes.map((v) => v.estado), ['ativa', 'substituida']);
  const [v1] = await t.sql("SELECT id FROM processo_versoes WHERE processo_id = $1 AND versao = 1", [proc.id]);
  assert.equal(exe.versao_id, v1.id, 'a execução antiga continua na versão 1');
  await assert.rejects(t.sql("UPDATE processo_versoes SET definicao = '{}' WHERE id = $1", [v1.id]), /não pode ser alterada/);
  const r = await marina.post(`/processos/${proc.id}/restaurar`, { versao: 1, motivo: 'voltar ao texto anterior' });
  assert.equal(r.corpo.versoes[0].versao, 3);
  assert.equal(r.corpo.versoes[0].definicao.passos[0].titulo, 'Responder dúvida {protocolo}');
  await marina.post(`/processos/${proc.id}/desativar`, { motivo: 'fim do teste' });
});

test('ligação com resultado: "não atendeu" formaliza no grupo e com o ponto focal', async () => {
  const [conta] = await t.sql("SELECT id, grupo_whatsapp FROM contas WHERE nome = 'Transportadora Rota Sul'");
  await t.avancar(48); // D-4 → passa o D-3 (aviso) e chega no D-2 (ligação)
  const [lig] = await t.sql("SELECT id FROM tarefas WHERE tipo = 'ligacao' AND estado = 'aberta' AND titulo LIKE '%Transportadora Rota Sul%'");
  assert.ok(lig, 'tarefa de ligação criada pelo processo');
  const juliana = await t.entrarComo('Juliana Alves');
  assert.equal((await juliana.post(`/tarefas/${lig.id}/concluir`, { resultado: 'Caixa postal' })).status, 400, 'exige atendeu/não atendeu');
  assert.equal((await juliana.post(`/tarefas/${lig.id}/concluir`, { resultado: 'Caixa postal duas vezes', resultadoCodigo: 'nao_atendeu' })).status, 200);
  await t.avancar(0.01);
  const formal = await t.sql("SELECT destinatario FROM interacoes WHERE conta_id = $1 AND modelo = 'formalizacao_ligacao@1' ORDER BY criado_em", [conta.id]);
  assert.equal(formal.length, 2);
  assert.ok(formal.some((f) => f.destinatario === conta.grupo_whatsapp));
  const [exe] = await t.sql(`SELECT e.estado FROM processo_execucoes e JOIN processos p ON p.id = e.processo_id
    WHERE e.conta_id = $1 AND p.nome LIKE 'Pré-rodada%'`, [conta.id]);
  assert.equal(exe.estado, 'aguardando', 'segue esperando o D-1');
});

test('todos os processos padrão são válidos (com todas as equipes) e cada modelo usado existe', () => {
  const { PADROES } = require('../server/modulos/processos/padroes');
  const { MODELOS } = require('../server/modulos/comunicacao/modelos');
  const { validarDefinicao } = require('../server/modulos/processos/regras');
  for (const p of PADROES) {
    assert.doesNotThrow(() => validarDefinicao(p.definicao, { equipes: ['suporte', 'cs', 'operacoes', 'dev', 'financeiro', 'comercial', 'contingencia'] }), p.nome);
    for (const passo of p.definicao.passos) if (passo.modelo && passo.modelo !== 'texto_livre') assert.ok(MODELOS[passo.modelo], `${p.nome}: modelo ${passo.modelo}`);
  }
});

test('ligação com resultado: "atendeu" formaliza o combinado no grupo (anotação da pré-rodada, confirmada em 05/11)', async () => {
  const [lig] = await t.sql(`SELECT t.id, t.rodada_id, c.id AS conta_id, c.grupo_whatsapp FROM tarefas t JOIN rodadas r ON r.id = t.rodada_id JOIN contas c ON c.id = r.conta_id
    WHERE t.tipo = 'ligacao' AND t.estado = 'aberta' AND c.nome <> 'Transportadora Rota Sul' AND c.grupo_whatsapp IS NOT NULL LIMIT 1`);
  assert.ok(lig, 'outra conta com ligação aberta na pré-rodada');
  const marina = await t.entrarComo('Marina Costa');
  assert.equal((await marina.post(`/tarefas/${lig.id}/concluir`, { resultado: 'Combinou corrigir a credencial até amanhã', resultadoCodigo: 'atendeu' })).status, 200);
  await t.avancar(0.01);
  const enviadas = await t.sql("SELECT destinatario, modelo FROM interacoes WHERE conta_id = $1 AND modelo IN ('formalizacao_combinado@1', 'formalizacao_ligacao@1')", [lig.conta_id]);
  assert.deepEqual(enviadas.map((x) => [x.modelo, x.destinatario]), [['formalizacao_combinado@1', lig.grupo_whatsapp]], 'só o combinado, no grupo');
});

test('força-tarefa por conta: "Executar agora" cria tarefa e para sozinho quando o ponto focal é cadastrado', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const [proc] = await t.sql("SELECT id FROM processos WHERE nome LIKE 'Força-tarefa%'");
  const r = await marina.post(`/processos/${proc.id}/executar`);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.iniciadas, 1, 'só a conta sem ponto focal');
  assert.equal((await marina.post(`/processos/${proc.id}/executar`)).corpo.iniciadas, 0, 'repetir no mesmo dia não duplica');
  await t.avancar(0.01);
  const [conta] = await t.sql("SELECT id FROM contas WHERE nome = 'Frota Nordeste Cargas'");
  const [tar] = await t.sql("SELECT estado, equipe_id FROM tarefas WHERE titulo LIKE 'Definir o ponto focal de Frota Nordeste%'");
  assert.equal(tar.estado, 'aberta');
  await marina.post(`/contas/${conta.id}/pontos-focais`, { papel: 'principal', nome: 'Responsável Nordeste', telefone: '(81) 99999-0000', consentimentoWhatsapp: true });
  await t.avancar(0.01);
  const [exe] = await t.sql('SELECT estado FROM processo_execucoes WHERE processo_id = $1 AND conta_id = $2', [proc.id, conta.id]);
  assert.equal(exe.estado, 'encerrada');
  assert.equal((await t.sql("SELECT estado FROM tarefas WHERE titulo LIKE 'Definir o ponto focal de Frota Nordeste%'"))[0].estado, 'cancelada');
});

test('proteção contra laço: mais de 5 inícios em 24 h no mesmo item são contidos e viram divergência', async () => {
  const tid = await t.tenant();
  const [v] = await t.sql("SELECT v.*, p.nome FROM processo_versoes v JOIN processos p ON p.id = v.processo_id WHERE p.nome LIKE 'VIP com prioridade%' AND v.estado = 'ativa' AND v.tenant_id = $1", [tid]);
  v.definicao = { ...v.definicao, condicoes: [] };
  const [conta] = await t.sql("SELECT id FROM contas WHERE nome = 'Expresso Vale Verde'");
  const res = await t.app.db.comoTenant(tid, async (c) => {
    const out = [];
    for (let i = 0; i < 6; i++) out.push((await motor.iniciar(c, ctxSistema(tid), v, { conta_id: conta.id }, `teste-laco:${i}`)).motivo || 'ok');
    return out;
  });
  assert.deepEqual(res, ['ok', 'ok', 'ok', 'ok', 'ok', 'contido: possível laço']);
  assert.equal((await t.sql("SELECT count(*)::int AS n FROM divergencias WHERE tipo = 'processo_em_laco'"))[0].n, 1);
});
