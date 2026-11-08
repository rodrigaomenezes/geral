'use strict';
// CRM-003 · funil padrão, configurável depois por organização (decisão da Brobot, 08/11/2026), sempre com o teste
// antes do fechamento: só Qualificação e Demonstração podem sair; nomes e campos exigidos mudam; o servidor confere.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { configFunil, ABERTAS } = require('../server/modulos/comercial/funil');

let t; let patricia;
before(async () => { t = await subir(); patricia = await t.entrarComo('Patrícia Gomes'); });
after(async () => { await t.parar(); });

test('regra pura: sem configuração = padrão; só as opcionais saem; teste nunca sai; inválido é listado', () => {
  const padrao = configFunil(undefined);
  assert.deepEqual(padrao.etapas, ABERTAS);
  assert.equal(padrao.rotulos.teste, 'Teste');
  const c = configFunil({ versao: 2, omitir: ['demonstracao', 'teste'], rotulos: { qualificacao: 'Descoberta', x: 'Nada' }, exigir: { proposta: ['cnpj', 'senha'] } });
  assert.deepEqual(c.etapas, ['novo', 'qualificacao', 'proposta', 'teste', 'negociacao'], 'teste continua');
  assert.equal(c.versao, 2);
  assert.equal(c.rotulos.qualificacao, 'Descoberta');
  assert.deepEqual(c.exigeExtra.proposta, ['cnpj']);
  assert.equal(c.problemas.length, 3, 'teste não sai; etapa desconhecida; campo não permitido');
});

test('organização configura: a etapa omitida é recusada, o nome novo aparece e o campo extra é exigido', async () => {
  await t.sql(`UPDATE tenants SET config = config || '{"comercial": {"funis": {"aquisicao": {"versao": 1, "omitir": ["demonstracao"],
    "rotulos": {"qualificacao": "Descoberta"}, "exigir": {"proposta": ["cnpj"]}}}}}'::jsonb WHERE slug = 'brobot'`);
  const cat = (await patricia.get('/comercial/catalogo')).corpo;
  assert.deepEqual(cat.funisConfig.aquisicao.etapas, ['novo', 'qualificacao', 'proposta', 'teste', 'negociacao']);
  assert.equal(cat.funisConfig.aquisicao.rotulos.qualificacao, 'Descoberta');
  assert.deepEqual(cat.funisConfig.expansao.etapas, ABERTAS, 'os outros funis seguem o padrão');

  const op = (await patricia.post('/comercial/oportunidades', { empresa: 'Transportes Configura', contatoNome: 'Lia', contatoTelefone: '(41) 99000-1234',
    produtos: ['multas'], frota: '50', valorMensal: '900' })).corpo;
  const q = await patricia.post(`/comercial/oportunidades/${op.id}/etapa`, { para: 'qualificacao' });
  assert.equal(q.status, 200, JSON.stringify(q.corpo) + JSON.stringify(op));
  const dem = await patricia.post(`/comercial/oportunidades/${op.id}/etapa`, { para: 'demonstracao' });
  assert.equal(dem.status, 422);
  assert.equal(dem.corpo.error.code, 'etapa_fora_do_funil');
  const sem = await patricia.post(`/comercial/oportunidades/${op.id}/etapa`, { para: 'proposta' });
  assert.equal(sem.status, 422, 'proposta exige CNPJ nesta organização');
  assert.match(sem.corpo.error.message, /Proposta.*CNPJ/);
  assert.equal((await patricia.post(`/comercial/oportunidades/${op.id}/etapa`, { para: 'proposta', cnpj: '12.987.654/0001-10' })).status, 200);
  const neg = await patricia.post(`/comercial/oportunidades/${op.id}/etapa`, { para: 'negociacao' });
  assert.equal(neg.status, 422, 'o teste continua antes do fechamento');
  assert.equal(neg.corpo.error.code, 'negociacao_sem_teste');
  await t.sql("UPDATE tenants SET config = config - 'comercial' WHERE slug = 'brobot'");
});
