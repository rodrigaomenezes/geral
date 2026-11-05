'use strict';
// Comercial (funil com teste antes do fechamento), Meu dia/lembretes e integração por CSV.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const csv = require('../server/modulos/integracoes/csv/csv');
const { validarMudanca } = require('../server/modulos/comercial/funil');
const { proximaOcorrencia } = require('../server/modulos/agenda/servico');
const { subir } = require('./ajuda');

test('CSV: separador ";" ou ",", aspas, BOM, cabeçalho sem acento; exportação sem injeção de fórmula', () => {
  const t = csv.ler('﻿CNPJ;Situação;Obs\n12.345.678/0001-90;em_dia;"texto; com ""aspas""\nquebra"\n');
  assert.deepEqual(t.cabecalhos, ['cnpj', 'situacao', 'obs']);
  assert.equal(t.linhas[0].valores.obs, 'texto; com "aspas"\nquebra');
  assert.equal(csv.ler('a,b\n1,2').linhas[0].valores.b, '2');
  assert.equal(csv.cnpj('12.345.678/0001-90'), '12345678000190');
  assert.equal(csv.data('08/11/2026').toISOString(), '2026-11-08T15:00:00.000Z');
  const out = csv.escrever([{ titulo: 'x', campo: 'x' }], [{ x: '=HYPERLINK("mal")' }]);
  assert.match(out, /'=HYPERLINK/);
});

test('funil: não fecha sem teste aprovado; teste exige período e critério', () => {
  const base = { etapa: 'proposta', contato_nome: 'A', produtos: ['multas'], frota: 10, valor_mensal: 100 };
  assert.throws(() => validarMudanca(base, base, 'negociacao'), /fase de Teste/);
  assert.throws(() => validarMudanca(base, base, 'ganha'), /Negociação/);
  assert.throws(() => validarMudanca(base, { ...base, cnpj: '12345678000190' }, 'teste'), /início do teste/);
  assert.throws(() => validarMudanca({ ...base, etapa: 'teste' }, { ...base, etapa: 'teste', teste_resultado: 'reprovado' }, 'negociacao'), /teste aprovado/);
  assert.throws(() => validarMudanca(base, { ...base, cnpj: '12345678000190', teste_inicio: '2026-11-01', teste_fim: '2026-12-31', teste_criterio: 'x' }, 'teste'), /30 dias/);
});

test('recorrência de lembrete: dias úteis pula o fim de semana', () => {
  assert.equal(proximaOcorrencia('2026-11-06T13:00:00Z', 'dias_uteis').toISOString(), '2026-11-09T13:00:00.000Z'); // sexta → segunda
  assert.equal(proximaOcorrencia('2026-11-04T13:00:00Z', 'semanal').toISOString(), '2026-11-11T13:00:00.000Z');
});

let t;
before(async () => { t = await subir(); await t.processar(); });
after(async () => { await t.parar(); });

const csvPost = (cookie, caminho, texto, arquivo = 'teste.csv') => fetch(`${t.base}/api${caminho}`, {
  method: 'POST', headers: { cookie, 'content-type': 'text/csv', 'x-arquivo': arquivo }, body: texto });
const cookieDe = async (nome) => {
  const ps = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas;
  const r = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: ps.find((p) => p.nome === nome).id }) });
  return r.headers.get('set-cookie').split(';')[0];
};

test('comercial: proposta → teste → aprovado → negociação → ganha cria conta em onboarding, onboarding no CS e processo', async () => {
  const pat = await t.entrarComo('Patrícia Gomes');
  const rafael = await t.entrarComo('Rafael Lima');
  assert.equal((await rafael.post('/comercial/oportunidades', { empresa: 'X' })).status, 403, 'Suporte não cadastra oportunidade');
  const op = (await pat.post('/comercial/oportunidades', { empresa: 'Transportes Teste Final', contatoNome: 'Lia', contatoTelefone: '(11) 98888-1111',
    produtos: ['multas'], frota: 50, valorMensal: '1.250,50' })).corpo;
  assert.equal(op.valor_mensal, '1250.50');
  const mv = (para, extra = {}) => pat.post(`/comercial/oportunidades/${op.id}/etapa`, { para, ...extra });
  for (const e of ['qualificacao', 'demonstracao', 'proposta']) assert.equal((await mv(e)).status, 200);
  assert.equal((await mv('negociacao')).status, 422, 'sem teste não negocia');
  const semDados = await mv('teste');
  assert.equal(semDados.status, 422);
  assert.match(semDados.corpo.error.message, /CNPJ/);
  assert.equal((await mv('teste', { cnpj: '77.888.999/0001-11', testeInicio: '2026-11-04', testeFim: '2026-11-11', testeCriterio: 'Consultar a frota toda' })).status, 200);
  await t.avancar(0.01);
  const tarefaCs = await t.sql("SELECT titulo FROM tarefas WHERE titulo LIKE 'Apoiar o teste de Transportes Teste Final%'");
  assert.equal(tarefaCs.length, 1, 'processo do teste acionou o CS');
  assert.equal((await pat.post(`/comercial/oportunidades/${op.id}/teste`, { resultado: 'aprovado', parecer: 'Frota consultada sem erro' })).status, 200);
  assert.equal((await mv('negociacao')).status, 200);
  const ganha = await mv('ganha');
  assert.equal(ganha.status, 200);
  const [conta] = await t.sql("SELECT id, status, produtos FROM contas WHERE cnpj = '77888999000111'");
  assert.equal(conta.status, 'onboarding');
  const [onb] = await t.sql("SELECT o.tipo, e.codigo FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id WHERE o.conta_id = $1", [conta.id]);
  assert.deepEqual([onb.tipo, onb.codigo], ['onboarding', 'cs']);
  await t.avancar(0.01);
  const tar = await t.sql('SELECT titulo FROM tarefas t JOIN equipes e ON e.id = t.equipe_id WHERE t.titulo LIKE $1', ['%Transportes Teste Final%']);
  assert.ok(tar.some((x) => /ponto focal/.test(x.titulo)) && tar.some((x) => /Provisionar/.test(x.titulo)), 'processo de onboarding criou as tarefas');
  assert.equal((await mv('perdida', { motivoPerda: 'preco' })).status, 409, 'encerrada não muda');
});

test('meu dia e lembretes: lembrete vence, vira notificação uma vez, adia e conclui recorrente', async () => {
  const marina = await t.entrarComo('Marina Costa');
  const dia = await marina.get('/meu-dia');
  assert.equal(dia.status, 200);
  assert.ok('resumo' in dia.corpo && Array.isArray(dia.corpo.lembretes));
  const l = (await marina.post('/lembretes', { titulo: 'Teste de lembrete', quando: new Date(new Date(dia.corpo.agora).getTime() - 60e3).toISOString() })).corpo;
  await t.sql("UPDATE jobs SET executar_em = now() - interval '1 day' WHERE chave = 'recorrente:lembretes'");
  await t.processar();
  await t.sql("UPDATE jobs SET executar_em = now() - interval '1 day' WHERE chave = 'recorrente:lembretes'");
  await t.processar();
  const n = await marina.get('/notificacoes');
  assert.equal(n.corpo.itens.filter((x) => x.titulo === '⏰ Teste de lembrete').length, 1, 'avisa uma vez só');
  assert.ok(n.corpo.naoLidas >= 1);
  assert.equal((await marina.post('/notificacoes/lidas', { todas: true })).corpo.naoLidas, 0);
  assert.equal((await marina.post(`/lembretes/${l.id}/adiar`, { horas: 2 })).status, 200);
  assert.equal((await marina.post(`/lembretes/${l.id}/concluir`)).corpo.concluido, true);
  const rafael = await t.entrarComo('Rafael Lima');
  assert.equal((await rafael.post(`/lembretes/${l.id}/concluir`)).status, 404, 'lembrete de outra pessoa');
});

test('CSV OMIE: prévia não grava, aplicar grava, mesmo arquivo não entra duas vezes, CNPJ desconhecido vira divergência', async () => {
  const carla = await cookieDe('Carla Mendes');
  const texto = 'codigo_omie;cnpj;situacao\nOM-777;23.456.789/0001-01;em_dia\nOM-888;99999999000199;em_atraso\nX;123;nada\n';
  const p = await (await csvPost(carla, '/integracoes/csv/omie_clientes/previa', texto)).json();
  assert.equal(p.validas, 2);
  assert.equal(p.erros.length, 1);
  assert.equal(p.erros[0].linha, 4);
  const [antes] = await t.sql("SELECT id_omie FROM contas WHERE cnpj = '23456789000101'");
  assert.equal(antes.id_omie, 'OM-502', 'prévia não alterou');
  const a = await (await csvPost(carla, '/integracoes/csv/omie_clientes/aplicar', texto, 'omie.csv')).json();
  assert.equal(a.aplicadas, 1);
  assert.equal(a.erros.length, 2);
  const [depois] = await t.sql("SELECT c.id_omie, s.situacao FROM contas c JOIN status_financeiro s ON s.conta_id = c.id WHERE c.cnpj = '23456789000101'");
  assert.deepEqual([depois.id_omie, depois.situacao], ['OM-777', 'em_dia']);
  assert.equal((await csvPost(carla, '/integracoes/csv/omie_clientes/aplicar', texto)).status, 409);
  assert.equal((await t.sql("SELECT count(*)::int AS n FROM divergencias WHERE tipo = 'omie_sem_conta'"))[0].n, 1);
  const rafael = await cookieDe('Rafael Lima');
  assert.equal((await csvPost(rafael, '/integracoes/csv/omie_clientes/previa', texto)).status, 403);
});

test('CSV Platform: resultado de pré-rodada por veículo cria a rodada, as pendências e dispara a cadência; exportação baixa CSV', async () => {
  const pedro = await cookieDe('Pedro Santos');
  const texto = [
    'rodada;cnpj;produto;data_rodada;fase;placa;resultado;codigo_erro',
    'RD-CSV-1;67890123000145;Multas e Notificações;10/11/2026;pre;CSV1A11;erro;CERT_EXPIRADO',
    'RD-CSV-1;67890123000145;Multas e Notificações;10/11/2026;pre;CSV2B22;ok;',
  ].join('\n');
  const r = await (await csvPost(pedro, '/integracoes/csv/platform_rodada/aplicar', texto)).json();
  assert.equal(r.aplicadas, 2);
  const [rod] = await t.sql("SELECT id, estado, fonte, veiculos_total FROM rodadas WHERE id_platform = 'RD-CSV-1'");
  assert.deepEqual([rod.estado, rod.fonte, rod.veiculos_total], ['com_pendencias', 'csv', 2]);
  const pend = await t.sql("SELECT placa FROM pendencias WHERE rodada_id = $1 AND estado <> 'corrigida'", [rod.id]);
  assert.deepEqual(pend.map((p) => p.placa), ['CSV1A11']);
  await t.avancar(0.01);
  const exe = await t.sql("SELECT e.estado FROM processo_execucoes e JOIN processos p ON p.id = e.processo_id WHERE e.rodada_id = $1 AND p.nome LIKE 'Pré-rodada%'", [rod.id]);
  assert.equal(exe.length, 1, 'cadência de pré-rodada começou');
  const cred = 'cnpj;tipo;status;expira_em;senha\n67890123000145;certificado;expirada;01/11/2026;123';
  const pc = await (await csvPost(pedro, '/integracoes/csv/platform_credenciais/previa', cred)).json();
  assert.match(pc.erros[0].erro, /não guarda segredos/);
  const exp = await fetch(`${t.base}/api/integracoes/exportar/pendencias_abertas`, { headers: { cookie: pedro } });
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-type'), /text\/csv/);
  assert.match(await exp.text(), /CSV1A11/);
});

test('mensagens padrão: rascunho → revisão → aprovação por outra pessoa; o envio passa a usar o texto aprovado (e o template da Meta)', async () => {
  const rafael = await t.entrarComo('Rafael Lima');
  const marina = await t.entrarComo('Marina Costa');
  assert.equal((await rafael.post('/modelos/lembrete_cliente/rascunho', { texto: 'Oi {nome}, {inexistente}' })).status, 400, 'variável desconhecida é recusada');
  const p = await rafael.post('/modelos/lembrete_cliente/previa', { texto: 'Oi {nome}! Seguimos aguardando você sobre o {protocolo} da {conta}.' });
  assert.match(p.corpo.texto, /Oi Fernanda!/);
  assert.equal((await rafael.post('/modelos/lembrete_cliente/rascunho', { texto: 'Oi {nome}! Seguimos aguardando você sobre o {protocolo} da {conta}.' })).status, 200);
  assert.equal((await rafael.post('/modelos/lembrete_cliente/aprovar', {})).status, 403, 'Suporte não aprova');
  assert.equal((await rafael.post('/modelos/lembrete_cliente/revisao')).status, 200);
  const ap = await marina.post('/modelos/lembrete_cliente/aprovar', { parecer: 'Ok', templateNome: 'lembrete_retorno_v1', templateVariaveis: 'nome, protocolo' });
  assert.equal(ap.status, 200);
  assert.equal(ap.corpo.versoes[0].estado, 'ativa');
  await assert.rejects(t.sql("UPDATE modelos_mensagem SET texto = 'mudou' WHERE codigo = 'lembrete_cliente' AND estado = 'ativa'"), /não pode ser alterada/);
  const tid = await t.tenant();
  const { renderizarAtual } = require('../server/modulos/comunicacao/modelos-servico');
  const r = await t.app.db.comoTenant(tid, (c) => renderizarAtual(c, 'lembrete_cliente', { nome: 'Ana', protocolo: 'SIN-1', conta: 'X' }));
  assert.equal(r.texto, 'Oi Ana! Seguimos aguardando você sobre o SIN-1 da X.');
  assert.deepEqual(r.template, { nome: 'lembrete_retorno_v1', idioma: 'pt_BR', variaveis: ['Ana', 'SIN-1'] });
  const lista = (await rafael.get('/modelos')).corpo.itens.find((x) => x.codigo === 'lembrete_cliente');
  assert.match(lista.emUso, /versão 1/);
});
