'use strict';
// F2 · integração CSV (adendo CSV): mapeamento de colunas versionado, estado da importação e lote de exportação
// que só vale como aplicado no destino depois da confirmação com evidência.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mapa = require('../server/modulos/integracoes/csv/mapa');
const { subir } = require('./ajuda');

test('mapa: sugere por nome e sinônimo, sem repetir coluna; valida; renomeia', () => {
  const campos = ['codigo_omie', 'cnpj', 'situacao'];
  const cab = ['codigo_cliente', 'cpf_cnpj', 'status', 'razao'];
  assert.deepEqual(mapa.sugerir(campos, cab), { codigo_omie: 'codigo_cliente', cnpj: 'cpf_cnpj', situacao: 'status' });
  assert.deepEqual(mapa.validarMapa({ cnpj: 'nao_tem' }, campos, cab), ['a coluna "nao_tem" não está no arquivo']);
  assert.match(mapa.validarMapa({ cnpj: 'status', situacao: 'status' }, campos, cab)[0], /foi ligada a cnpj e a situacao/);
  assert.match(mapa.validarMapa({ senha: 'razao' }, campos, cab)[0], /campo desconhecido/);
  const t = mapa.aplicarMapa({ cabecalhos: cab, linhas: [{ numero: 2, valores: { codigo_cliente: 'OM-1', cpf_cnpj: '1', status: 'ok', razao: 'X' } }] }, { cnpj: 'cpf_cnpj' });
  assert.equal(t.linhas[0].valores.cnpj, '1');
  assert.ok(mapa.mesmoMapa({ a: 'x', b: '' }, { a: 'x' }));
});

let t;
before(async () => { t = await subir(); });
after(async () => { await t.parar(); });

const csvPost = (cookie, caminho, texto, { arquivo = 'teste.csv', mapa: m } = {}) => fetch(`${t.base}/api${caminho}`, {
  method: 'POST', headers: { cookie, 'content-type': 'text/csv', 'x-arquivo': arquivo, ...(m ? { 'x-mapa': encodeURIComponent(JSON.stringify(m)) } : {}) }, body: texto });
const cookieDe = async (nome) => {
  const ps = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas;
  const r = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: ps.find((p) => p.nome === nome).id }) });
  return r.headers.get('set-cookie').split(';')[0];
};

test('CSV com layout diferente: a prévia pede o mapa; aplicar salva a versão; o próximo arquivo usa o mapa salvo', async () => {
  const carla = await cookieDe('Carla Mendes');
  const real = 'Código Cliente;CPF/CNPJ;Status;Razão\nOM-901;23.456.789/0001-01;adimplente;Rota\n';
  const p1 = await (await csvPost(carla, '/integracoes/csv/omie_clientes/previa', real)).json();
  assert.equal(p1.precisaMapear, true);
  assert.deepEqual(p1.faltam.sort(), ['cnpj', 'codigo_omie', 'situacao']);
  assert.deepEqual(p1.sugestao, { codigo_omie: 'codigo_cliente', cnpj: 'cpf_cnpj', situacao: 'status' });
  assert.equal((await csvPost(carla, '/integracoes/csv/omie_clientes/aplicar', real)).status, 400, 'sem mapa não aplica');
  assert.equal((await csvPost(carla, '/integracoes/csv/omie_clientes/previa', real, { mapa: { cnpj: 'inexistente' } })).status, 400);
  const p2 = await (await csvPost(carla, '/integracoes/csv/omie_clientes/previa', real, { mapa: p1.sugestao })).json();
  assert.equal(p2.validas, 1);
  assert.equal(p2.mapa.origem, 'enviado');
  const a = await (await csvPost(carla, '/integracoes/csv/omie_clientes/aplicar', real, { mapa: p1.sugestao })).json();
  assert.deepEqual([a.aplicadas, a.estado], [1, 'concluido']);
  const [m] = await t.sql("SELECT versao, ativo FROM mapas_csv WHERE tipo = 'omie_clientes' AND tenant_id = $1", [await t.tenant()]);
  assert.deepEqual([m.versao, m.ativo], [1, true]);
  // próximo arquivo do mesmo fluxo, mesmo layout: entra sem mapear de novo; uma linha ruim deixa a importação "parcial"
  const prox = 'Código Cliente;CPF/CNPJ;Status;Razão\nOM-902;23.456.789/0001-01;inadimplente;Rota\nX;1;nada;Y\n';
  const p3 = await (await csvPost(carla, '/integracoes/csv/omie_clientes/previa', prox)).json();
  assert.deepEqual([p3.precisaMapear, p3.mapa.origem, p3.mapa.versao], [undefined, 'salvo', 1]);
  const refazer = await (await csvPost(carla, '/integracoes/csv/omie_clientes/previa', prox, { mapa: {} })).json();
  assert.equal(refazer.precisaMapear, true, 'mapa vazio = ignorar o salvo e pedir a ligação de novo');
  const a2 = await (await csvPost(carla, '/integracoes/csv/omie_clientes/aplicar', prox)).json();
  assert.equal(a2.estado, 'parcial');
  const painel = (await (await fetch(`${t.base}/api/integracoes`, { headers: { cookie: carla } })).json());
  assert.equal(painel.importacoes.omie_clientes.mapaVersao, 1);
  assert.ok(painel.importacoes.omie_clientes.ultimoArquivoEm);
  // mudar o mapa cria a versão 2 e desativa a 1 (auditado)
  const outro = 'cliente;documento;situacao\nOM-903;23.456.789/0001-01;em_dia\n';
  await csvPost(carla, '/integracoes/csv/omie_clientes/aplicar', outro, { mapa: { codigo_omie: 'cliente', cnpj: 'documento', situacao: 'situacao' } });
  const vs = await t.sql("SELECT versao, ativo FROM mapas_csv WHERE tipo = 'omie_clientes' AND tenant_id = $1 ORDER BY versao", [await t.tenant()]);
  assert.deepEqual(vs.map((v) => [v.versao, v.ativo]), [[1, false], [2, true]]);
  assert.equal((await t.sql("SELECT count(*)::int AS q FROM auditoria WHERE acao = 'integracao.mapa_salvo'"))[0].q, 2);
});

test('exportar gera lote aguardando confirmação; confirmar exige evidência; atrasado vira divergência e tarefa uma vez', async () => {
  const pedro = await cookieDe('Pedro Santos');
  const exp = await fetch(`${t.base}/api/integracoes/exportar/platform_carteira`, { headers: { cookie: pedro } });
  assert.equal(exp.status, 200);
  const lote = exp.headers.get('x-lote');
  assert.match(exp.headers.get('content-disposition'), new RegExp(`lote-${lote.slice(0, 8)}\\.csv`));
  const [l] = await t.sql('SELECT estado, linhas, hash FROM exportacoes WHERE id = $1', [lote]);
  assert.equal(l.estado, 'aguardando_confirmacao', 'baixar não é aplicar no destino');
  // venceu o prazo (2 dias) sem confirmação → divergência + tarefa, sem repetir na varredura seguinte
  await t.avancar(49);
  await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'");
  await t.processar();
  await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'");
  await t.processar();
  assert.equal((await t.sql("SELECT count(*)::int AS q FROM divergencias WHERE chave = $1 AND estado = 'aberta'", [`exportacao:${lote}`]))[0].q, 1);
  assert.equal((await t.sql('SELECT count(*)::int AS q FROM tarefas WHERE chave = $1', [`exportacao:${lote}`]))[0].q, 1);
  const post = (corpo) => fetch(`${t.base}/api/integracoes/lotes/${lote}/resolver`, { method: 'POST', headers: { cookie: pedro, 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  assert.equal((await post({ resultado: 'confirmado', evidencia: 'ok' })).status, 400, 'evidência curta');
  assert.equal((await post({ resultado: 'confirmado', evidencia: 'Importado na Platform às 10h, 12 linhas, sem rejeição' })).status, 200);
  assert.equal((await post({ resultado: 'falhou', evidencia: 'Tentativa repetida do mesmo lote' })).status, 409, 'lote já resolvido');
  assert.equal((await t.sql('SELECT estado FROM divergencias WHERE chave = $1', [`exportacao:${lote}`]))[0].estado, 'tratada');
  const rafael = await cookieDe('Rafael Lima');
  assert.equal((await fetch(`${t.base}/api/integracoes/lotes/${lote}/resolver`, { method: 'POST', headers: { cookie: rafael, 'content-type': 'application/json' }, body: JSON.stringify({ resultado: 'falhou', evidencia: 'sem permissão para isto' }) })).status, 403);
});
