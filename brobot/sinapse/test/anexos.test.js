'use strict';
// F16 · INT-009 / R-12: anexos com tipo conferido pelo conteúdo, limite, sem repetição, download seguro, arquivar sem
// apagar e retenção configurável.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { reconhecer, nomeSeguro } = require('../server/modulos/ocorrencias/anexos');
const { subir } = require('./ajuda');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1');

test('tipo pelo conteúdo: aceita PDF, PNG, texto e XLSX real; recusa executável, ZIP solto, HTML disfarçado e vazio', () => {
  assert.equal(reconhecer(PDF, 'boleto.pdf').mime, 'application/pdf');
  assert.equal(reconhecer(PDF, 'disfarce.exe').mime, 'application/pdf', 'vale o conteúdo, não a extensão');
  assert.equal(reconhecer(PNG, 'tela.png').mime, 'image/png');
  assert.equal(reconhecer(Buffer.from('placa;erro\nABC1D23;credencial'), 'placas.csv').mime, 'text/csv');
  const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....[Content_Types].xml....xl/workbook.xml')]);
  assert.equal(reconhecer(xlsx, 'frota.xlsx').mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(reconhecer(xlsx, 'frota.zip').erro, /compactado/);
  assert.match(reconhecer(EXE, 'nota.pdf').erro, /não aceito/);
  assert.match(reconhecer(Buffer.from('<html><script>alert(1)</script>'), 'leia.txt').erro, /HTML ou script/);
  assert.match(reconhecer(Buffer.from('abc\u0000def'), 'x.txt').erro, /binário/);
  assert.match(reconhecer(Buffer.alloc(0), 'x.pdf').erro, /vazio/);
  assert.equal(nomeSeguro('C:\\Users\\x\\..\\"relatório"<1>.pdf'), 'relatório1.pdf');
});

let t; let rafael; let carla; let marina; let oc;
before(async () => {
  t = await subir();
  [rafael, carla, marina] = await Promise.all(['Rafael Lima', 'Carla Mendes', 'Marina Costa'].map((n) => t.entrarComo(n)));
  const conta = (await t.sql("SELECT id FROM contas WHERE nome = 'Logística Horizonte'"))[0].id;
  oc = (await rafael.post('/ocorrencias', { contaId: conta, tipo: 'duvida', prioridade: 'baixa', titulo: 'Ocorrência com anexos' })).corpo;
});
after(async () => { await t.parar(); });

async function cookieDe(nome) {
  const p = (await (await fetch(`${t.base}/api/demo/personas`)).json()).personas.find((x) => x.nome === nome);
  const r = await fetch(`${t.base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: p.id }) });
  return r.headers.get('set-cookie').split(';')[0];
}
const enviar = async (cookie, id, buf, nome, tipo = 'application/octet-stream') => {
  const r = await fetch(`${t.base}/api/ocorrencias/${id}/anexos`, { method: 'POST', headers: { cookie, 'content-type': tipo, 'x-nome-arquivo': encodeURIComponent(nome) }, body: buf });
  return { status: r.status, corpo: await r.json() };
};

test('anexar: só quem atende; tipo conferido; mesmo arquivo não repete; aparece na ocorrência; auditado', async () => {
  const ck = await cookieDe('Rafael Lima');
  assert.equal((await enviar(await cookieDe('Carla Mendes'), oc.id, PDF, 'a.pdf')).status, 403);
  assert.equal((await enviar(ck, oc.id, PDF, 'a.pdf', 'application/json')).status, 415, 'só octet-stream');
  assert.equal((await enviar(ck, oc.id, EXE, 'virus.pdf')).status, 400);
  const r = await enviar(ck, oc.id, PDF, 'comprovante de pagamento.pdf');
  assert.equal(r.status, 201);
  assert.equal(r.corpo.tipo_mime, 'application/pdf');
  assert.equal((await enviar(ck, oc.id, PDF, 'outro nome.pdf')).status, 409, 'mesmo conteúdo');
  const grande = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
  assert.equal((await enviar(ck, oc.id, grande, 'grande.pdf')).status, 413);
  const d = (await rafael.get(`/ocorrencias/${oc.id}`)).corpo;
  assert.deepEqual(d.anexos.map((a) => a.nome), ['comprovante de pagamento.pdf']);
  assert.ok(d.linhaDoTempo.some((l) => l.acao === 'ocorrencia.anexo'));
  assert.equal(carla && (await carla.get(`/ocorrencias/${oc.id}`)).status, 200, 'quem vê a ocorrência vê a lista');
});

test('download: o mesmo conteúdo, sempre como anexo, com cabeçalhos de proteção; outra organização não acessa', async () => {
  const id = (await rafael.get(`/ocorrencias/${oc.id}`)).corpo.anexos[0].id;
  const r = await fetch(`${t.base}/api/anexos/${id}`, { headers: { cookie: await cookieDe('Rafael Lima') } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="comprovante de pagamento.pdf"/);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PDF);
  const parceiro = await cookieDe('Ana Parceira');
  assert.equal((await fetch(`${t.base}/api/anexos/${id}`, { headers: { cookie: parceiro } })).status, 404, 'RLS');
});

test('arquivar: só quem enviou ou a gestão, com motivo; some da lista sem apagar; retenção só com política', async () => {
  const id = (await rafael.get(`/ocorrencias/${oc.id}`)).corpo.anexos[0].id;
  const bianca = await t.entrarComo('Bianca Rocha');
  assert.equal((await bianca.post(`/anexos/${id}/arquivar`, { motivo: 'Não é meu' })).status, 403);
  assert.equal((await rafael.post(`/anexos/${id}/arquivar`, {})).status, 400);
  assert.equal((await rafael.post(`/anexos/${id}/arquivar`, { motivo: 'Enviado na ocorrência errada' })).status, 200);
  assert.equal((await rafael.get(`/ocorrencias/${oc.id}`)).corpo.anexos.length, 0);
  assert.equal((await t.sql('SELECT count(*)::int AS n FROM anexos WHERE id = $1 AND conteudo IS NOT NULL', [id]))[0].n, 1, 'nada some');

  const ck = await cookieDe('Rafael Lima');
  await enviar(ck, oc.id, PNG, 'tela.png');
  await marina.post(`/ocorrencias/${oc.id}/transicoes`, { acao: 'encerrar_sem_resolucao', dados: { motivo: 'Cliente desistiu', codigoDesfecho: 'sem_retorno_cliente' } });
  assert.equal((await enviar(ck, oc.id, Buffer.from('nota'), 'n.txt')).status, 422, 'encerrada não recebe anexo');
  const varrer = async () => { await t.sql("UPDATE jobs SET executar_em = '2026-11-01T00:00:00Z' WHERE chave = 'recorrente:supervisor'"); await t.processar(); };
  await t.sql("UPDATE ocorrencias SET encerrada_em = '2026-01-01T00:00:00Z' WHERE id = $1", [oc.id]);
  await varrer();
  assert.equal((await t.sql('SELECT count(*)::int AS n FROM anexos WHERE ocorrencia_id = $1 AND expurgado_em IS NOT NULL', [oc.id]))[0].n, 0, 'sem política, nada expurgado');
  await t.sql(`UPDATE tenants SET config = config || '{"retencao_anexos_dias": 180}' WHERE slug = 'brobot'`);
  await varrer();
  const restos = await t.sql('SELECT nome, tamanho, sha256, conteudo, expurgado_em FROM anexos WHERE ocorrencia_id = $1 ORDER BY criado_em', [oc.id]);
  assert.ok(restos.every((a) => a.conteudo === null && a.expurgado_em && a.sha256 && a.tamanho), 'conteúdo expurgado, registro fica');
  const png = (await rafael.get(`/ocorrencias/${oc.id}`)).corpo.anexos.find((a) => a.nome === 'tela.png');
  assert.equal(png.expurgado, true);
  assert.equal((await fetch(`${t.base}/api/anexos/${png.id}`, { headers: { cookie: ck } })).status, 422);
});
