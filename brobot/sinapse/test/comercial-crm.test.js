'use strict';
// F3a · Comercial como CRM (substitui o Pipedrive): catálogo com "exige teste" por produto, propostas versionadas
// com alçada de desconto, atividades, suspender/retomar/reabrir e migração de negócios abertos do Pipedrive por CSV.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { calcular } = require('../server/modulos/comercial/propostas');
const { subir } = require('./ajuda');

test('proposta: total, desconto e alçada (regra pura)', () => {
  const r = calcular([{ produto: 'multas', quantidade: 100, valorUnitario: 12.5 }, { produto: 'licenciamento', quantidade: 100, valorUnitario: 3 }], 10, 10);
  assert.deepEqual([r.valorCheio, r.valorMensal, r.exigeAprovacao], [1550, 1395, false]);
  assert.equal(calcular([{ produto: 'multas', quantidade: 1, valorUnitario: 100 }], 10.5, 10).exigeAprovacao, true);
  assert.throws(() => calcular([], 0), /pelo menos um item/);
  assert.throws(() => calcular([{ produto: 'multas', quantidade: 0, valorUnitario: 1 }], 0), /quantidade/);
  assert.throws(() => calcular([{ produto: 'multas', quantidade: 1, valorUnitario: 1 }], 120), /Desconto/);
});

let t; let pat; let gestor;
before(async () => { t = await subir(); pat = await t.entrarComo('Patrícia Gomes'); gestor = await t.entrarComo('Marina Costa'); });
after(async () => { await t.parar(); });

const novaOp = async (extra = {}) => (await pat.post('/comercial/oportunidades', { empresa: `Frota ${Math.random().toString(36).slice(2, 7)}`, contatoNome: 'Lia',
  contatoTelefone: '(11) 98888-1111', produtos: ['multas'], frota: 50, valorMensal: '1000', ...extra })).corpo;
const mover = (op, para, extra = {}) => pat.post(`/comercial/oportunidades/${op.id}/etapa`, { para, ...extra });
const ate = async (op, etapa) => { for (const e of ['qualificacao', 'demonstracao', 'proposta']) { await mover(op, e); if (e === etapa) return; } };

test('catálogo: gestão define produto sem teste; só então a proposta vai direto para a negociação (DP-04)', async () => {
  const cat = (await pat.get('/comercial/catalogo')).corpo;
  assert.ok(cat.catalogo.find((p) => p.codigo === 'multas').exige_teste, 'padrão continua exigindo teste');
  assert.equal((await pat.post('/comercial/produtos', { codigo: 'consultoria', nome: 'Consultoria de frota', exigeTeste: false })).status, 403, 'Comercial não mexe no catálogo');
  assert.equal((await gestor.post('/comercial/produtos', { codigo: 'consultoria', nome: 'Consultoria de frota', exigeTeste: false, precoReferencia: '900,00' })).status, 200);
  assert.equal((await pat.post('/comercial/oportunidades', { empresa: 'Produto inexistente', produtos: ['nao_existe'] })).status, 400);
  const comTeste = await novaOp();
  await ate(comTeste, 'proposta');
  assert.equal((await mover(comTeste, 'negociacao')).status, 422, 'produto que exige teste não pula o teste');
  const semTeste = await novaOp({ produtos: ['consultoria'], cnpj: '44.555.666/0001-77', contatoEmail: 'lia@frota.example' });
  await ate(semTeste, 'proposta');
  assert.equal((await mover(semTeste, 'negociacao')).status, 200);
  assert.equal((await mover(semTeste, 'ganha')).status, 200, 'fecha sem teste porque o catálogo dispensa');
  const [o] = await t.sql('SELECT teste_dispensado FROM oportunidades WHERE id = $1', [semTeste.id]);
  assert.equal(o.teste_dispensado, true);
  const [onb] = await t.sql("SELECT descricao FROM ocorrencias WHERE titulo LIKE 'Onboarding%' AND descricao LIKE $1", [`%${semTeste.codigo}%`]);
  assert.match(onb.descricao, /Teste: dispensado/);
  const mix = await novaOp({ produtos: ['consultoria', 'multas'] });
  await ate(mix, 'proposta');
  assert.equal((await mover(mix, 'negociacao')).status, 422, 'basta um produto que exige teste');
});

test('propostas: versões, alçada (outra pessoa da gestão aprova), envio atualiza a oportunidade, enviada é imutável', async () => {
  const op = await novaOp();
  await ate(op, 'demonstracao');
  const item = [{ produto: 'multas', quantidade: 200, valorUnitario: '9,90' }];
  const v1 = await pat.post(`/comercial/oportunidades/${op.id}/propostas`, { itens: item, descontoPct: '5', validade: '2026-11-30' });
  assert.equal(v1.status, 201);
  assert.deepEqual([v1.corpo.versao, v1.corpo.valor_mensal, v1.corpo.estado], [1, '1881.00', 'rascunho']);
  assert.equal((await pat.post(`/comercial/oportunidades/${op.id}/propostas`, { itens: item, validade: '2026-10-01' })).status, 400, 'validade no passado');
  // v2 com 20% de desconto: substitui a v1 e precisa de aprovação
  const v2 = (await pat.post(`/comercial/oportunidades/${op.id}/propostas`, { itens: item, descontoPct: '20', validade: '2026-11-30', condicoes: 'Pagamento mensal' })).corpo;
  assert.equal(v2.exige_aprovacao, true);
  assert.equal((await t.sql('SELECT estado FROM propostas WHERE id = $1', [v1.corpo.id]))[0].estado, 'substituida');
  assert.equal((await pat.post(`/comercial/propostas/${v2.id}/enviar`)).corpo.estado, 'aguardando_aprovacao');
  assert.equal((await pat.post(`/comercial/propostas/${v2.id}/aprovar`)).status, 403, 'vendedor não aprova o próprio desconto');
  assert.equal((await gestor.post(`/comercial/propostas/${v2.id}/devolver`, {})).status, 400, 'devolver exige parecer');
  assert.equal((await gestor.post(`/comercial/propostas/${v2.id}/aprovar`, { parecer: 'Cliente estratégico' })).corpo.estado, 'aprovada');
  assert.equal((await pat.post(`/comercial/propostas/${v2.id}/enviar`)).corpo.estado, 'enviada');
  const [o] = await t.sql('SELECT valor_mensal, produtos FROM oportunidades WHERE id = $1', [op.id]);
  assert.deepEqual([o.valor_mensal, o.produtos], ['1584.00', ['multas']], 'oportunidade passa a valer o da proposta enviada');
  await assert.rejects(t.sql("UPDATE propostas SET valor_mensal = 1 WHERE id = $1", [v2.id]), /já foi enviada/);
  assert.equal((await pat.post(`/comercial/propostas/${v2.id}/aceitar`, { parecer: 'Aceite por e-mail' })).corpo.estado, 'aceita');
  assert.equal((await pat.post(`/comercial/oportunidades/${op.id}/propostas`, { itens: item, validade: '2026-11-30' })).status, 422, 'com proposta aceita não sai nova versão');
  const d = (await pat.get(`/comercial/oportunidades/${op.id}`)).corpo;
  assert.deepEqual(d.propostas.map((p) => [p.versao, p.estado]), [[2, 'aceita'], [1, 'substituida']]);
  assert.equal(d.propostas[0].aprovador, 'Marina Costa');
});

test('atividades: agendada vira a próxima ação; concluir exige resultado; nota entra feita', async () => {
  const op = await novaOp();
  const r = await pat.post(`/comercial/oportunidades/${op.id}/atividades`, { tipo: 'reuniao', assunto: 'Apresentar o painel', quando: '2026-11-06T17:00:00Z' });
  assert.equal(r.status, 201);
  const [o] = await t.sql('SELECT proxima_acao, proxima_acao_em FROM oportunidades WHERE id = $1', [op.id]);
  assert.equal(o.proxima_acao, 'Reunião: Apresentar o painel');
  assert.equal(new Date(o.proxima_acao_em).toISOString(), '2026-11-06T17:00:00.000Z');
  assert.equal((await pat.post(`/comercial/oportunidades/${op.id}/atividades`, { tipo: 'ligacao', assunto: 'Retorno', feita: true })).status, 400, 'feita sem resultado');
  assert.equal((await pat.post(`/comercial/atividades/${r.corpo.id}/concluir`, {})).status, 400);
  assert.equal((await pat.post(`/comercial/atividades/${r.corpo.id}/concluir`, { resultado: 'Gostou; pediu proposta para 200 placas' })).status, 200);
  assert.equal((await pat.post(`/comercial/atividades/${r.corpo.id}/concluir`, { resultado: 'de novo' })).status, 409);
  await pat.post(`/comercial/oportunidades/${op.id}/atividades`, { tipo: 'nota', assunto: 'Decisor é o diretor de frota' });
  const lista = (await pat.get(`/comercial/oportunidades/${op.id}/atividades`)).corpo;
  assert.equal(lista.total, 2);
  assert.ok(lista.itens.every((a) => a.feita));
});

test('suspender com data para retomar; retomar volta à etapa; perdida reabre com motivo', async () => {
  const op = await novaOp();
  await ate(op, 'demonstracao');
  assert.equal((await pat.post(`/comercial/oportunidades/${op.id}/suspender`, { motivo: 'Orçamento só em janeiro', retomarEm: '2025-01-01T12:00:00Z' })).status, 400, 'data no passado');
  const s = await pat.post(`/comercial/oportunidades/${op.id}/suspender`, { motivo: 'Orçamento só em janeiro', retomarEm: '2027-01-10T12:00:00Z' });
  assert.equal(s.corpo.etapa, 'suspensa');
  assert.match(s.corpo.proxima_acao, /Retomar contato/);
  assert.equal((await mover(op, 'proposta')).status, 409, 'suspensa não anda no funil');
  assert.equal((await pat.post(`/comercial/oportunidades/${op.id}/retomar`, {})).corpo.etapa, 'demonstracao');
  assert.equal((await mover(op, 'perdida', { motivoPerda: 'preco' })).status, 200);
  assert.equal((await pat.post(`/comercial/oportunidades/${op.id}/retomar`, {})).status, 400, 'reabrir exige motivo');
  const r = await pat.post(`/comercial/oportunidades/${op.id}/retomar`, { motivo: 'Cliente voltou com novo orçamento' });
  assert.deepEqual([r.corpo.etapa, r.corpo.motivo_perda, r.corpo.fechada_em], ['qualificacao', null, null]);
  const hist = (await pat.get(`/comercial/oportunidades/${op.id}`)).corpo.historico.map((h) => h.acao);
  assert.ok(['oportunidade.suspensa', 'oportunidade.retomada', 'oportunidade.perdida', 'oportunidade.reaberta'].every((a) => hist.includes(a)));
});

const csvPost = (cookie, caminho, texto) => fetch(`${t.base}/api${caminho}`, { method: 'POST', headers: { cookie, 'content-type': 'text/csv', 'x-arquivo': 'pipedrive.csv' }, body: texto });
const cookieDe = async (nome) => {
  const ps = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas;
  const r = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: ps.find((p) => p.nome === nome).id }) });
  return r.headers.get('set-cookie').split(';')[0];
};

test('Pipedrive por CSV: só a gestão migra; negócios abertos entram uma vez; ganhos/perdidos ficam para a migração completa', async () => {
  const texto = 'id;organizacao;status;titulo;valor;etapa;responsavel_email;telefone\n'
    + 'PD-1;Transportes Alfa;open;Frota 300;4.500,00;Proposta enviada;patricia@sinapse.demo;11 97777-1234\n'
    + 'PD-2;Beta Logística;open;Renovação;;Contato feito;;\n'
    + 'PD-3;Gama;won;Fechado;1000;Ganho;;\n';
  assert.equal((await csvPost(await cookieDe('Carla Mendes'), '/integracoes/csv/pipedrive_negocios/previa', texto)).status, 403, 'Financeiro usa integrações, mas não migra o Comercial');
  const marina = await cookieDe('Marina Costa');
  const a = await (await csvPost(marina, '/integracoes/csv/pipedrive_negocios/aplicar', texto)).json();
  assert.deepEqual([a.aplicadas, a.estado], [2, 'parcial']);
  assert.match(a.erros[0].erro, /migração completa/);
  const ops = await t.sql("SELECT o.empresa, o.valor_mensal, o.contato_telefone, u.nome AS dono FROM oportunidades o LEFT JOIN usuarios u ON u.id = o.responsavel_id WHERE o.fonte = 'pipedrive' ORDER BY o.id_externo");
  assert.deepEqual(ops.map((o) => [o.empresa, o.valor_mensal, o.contato_telefone, o.dono]),
    [['Transportes Alfa', '4500.00', '+5511977771234', 'Patrícia Gomes'], ['Beta Logística', null, null, null]]);
  const nota = await t.sql("SELECT a.assunto FROM atividades_comerciais a JOIN oportunidades o ON o.id = a.oportunidade_id WHERE o.id_externo = 'PD-1'");
  assert.equal(nota[0].assunto, 'Frota 300');
  // outro arquivo com os mesmos ids (ex.: nova exportação): nada se duplica
  const b = await (await csvPost(marina, '/integracoes/csv/pipedrive_negocios/aplicar', `${texto}PD-4;Delta;open;;;;;\n`)).json();
  assert.match(b.resumo.join(' '), /1 oportunidade\(s\) criada.*2 já estavam/);
  assert.equal((await t.sql("SELECT count(*)::int AS q FROM oportunidades WHERE fonte = 'pipedrive'"))[0].q, 3);
});
