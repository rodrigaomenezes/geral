'use strict';
// F25 · testes de requisitos que estavam prontos sem teste próprio e busca por veículo:
// INT-010 (busca por placa e CNPJ), PRE-012/POS-010 (fórmulas das rodadas), SUP-005 (reprocessamento), SUP-012
// (automático × manual), CS-002 (saúde configurável), CS-001/BL-02/CRE-008 (carteira VIP e credenciais por conta),
// CRE-005 (instruções seguras ao ponto focal).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subir } = require('./ajuda');
const { saudeDaConta, pesosSaude, PESOS_SAUDE } = require('../server/modulos/painel/dashboards');
const { normalizarErro } = require('../server/modulos/rodadas/erros');
const { relogio } = require('../server/nucleo/relogio');

let t; let marina; let rafael; let juliana;
before(async () => {
  t = await subir();
  [marina, rafael, juliana] = await Promise.all(['Marina Costa', 'Rafael Lima', 'Juliana Alves'].map((n) => t.entrarComo(n)));
  await t.processar(); // pré-rodadas do D-4 criam pendências e ocorrências com as placas
});
after(async () => { await t.parar(); });

const bloco = (d, id) => d.blocos.find((b) => b.id === id);
const tile = (d, rotulo) => bloco(d, 'resumo').linhas.find((l) => l.rotulo.startsWith(rotulo));

test('INT-010: busca pela placa (com traço e minúscula) e pelo CNPJ com pontuação', async () => {
  const [item] = await t.sql("SELECT i.placa, i.ocorrencia_id FROM ocorrencia_itens i WHERE i.placa IS NOT NULL ORDER BY i.placa LIMIT 1");
  assert.ok(item, 'cenário: ocorrência com placa');
  const comTraco = `${item.placa.slice(0, 3)}-${item.placa.slice(3)}`.toLowerCase();
  const r = (await marina.get(`/ocorrencias?estado=todas&q=${encodeURIComponent(comTraco)}`)).corpo;
  assert.ok(r.itens.some((o) => o.id === item.ocorrencia_id), `achou pela placa ${comTraco}`);
  assert.ok(r.itens.every((o) => o.id === item.ocorrencia_id), 'só a ocorrência daquela placa');
  const q = (await marina.get(`/ocorrencias/quadro?q=${encodeURIComponent(comTraco)}`)).corpo;
  assert.ok(q.colunas.some((c) => c.cartoes.some((x) => x.id === item.ocorrencia_id)), 'o quadro usa a mesma busca');

  const cnpj = '12.345.678/0001-90'; // Transportadora Rota Sul
  const porCnpj = (await marina.get(`/ocorrencias?estado=todas&q=${encodeURIComponent(cnpj)}`)).corpo;
  assert.ok(porCnpj.itens.length >= 1);
  assert.ok(porCnpj.itens.every((o) => o.conta_nome === 'Transportadora Rota Sul'));
  assert.equal((await marina.get('/ocorrencias?estado=todas&q=ZZZ9Z99')).corpo.itens.length, 0, 'placa inexistente não acha nada');
});

test('CRE-005: toda instrução ao cliente é segura e a mensagem do D-3 leva a instrução do erro', async () => {
  for (const codigo of ['SNE_VINCULO_AUSENTE', 'CERT_EXPIRADO', 'GOVBR_2FA', 'CRED_INVALIDA', 'CRED_AUSENTE', 'RENAVAM_DIVERGENTE']) {
    const e = normalizarErro(codigo);
    assert.ok(e.instrucao && e.instrucao.length > 10, codigo);
    assert.doesNotMatch(e.instrucao.replace('nunca envie senha por mensagem', ''), /senha|envie.*certificado|mande.*certificado/i, `${codigo} não pede segredo`);
  }
  // A Logística Horizonte já está no D-3 (Gov.br pedindo verificação em duas etapas e Renavam divergente).
  const d3 = () => t.sql(`SELECT i.texto FROM interacoes i JOIN contas c ON c.id = i.conta_id
    WHERE c.nome = 'Logística Horizonte' AND i.modelo = 'pre_rodada_d3@1'`);
  let msgs = await d3();
  for (let i = 0; i < 12 && !msgs.length; i++) { await t.avancar(0.5); msgs = await d3(); } // o processo envia na janela de envio
  assert.equal(msgs.length, 1, 'aviso D-3 enviado');
  assert.match(msgs[0].texto, /conclua a verificação em duas etapas da conta Gov.br na Platform Brobot/);
  assert.match(msgs[0].texto, /confira o Renavam/);
  assert.doesNotMatch(msgs[0].texto, /informe (a|sua) senha/i);
});

test('PRE-012/POS-010: correção pré-rodada, pós-rodada e sucesso da rodada oficial com números conhecidos', async () => {
  await t.sql('UPDATE rodadas SET pendencias_detectadas = 0, pendencias_corrigidas_ate_d0 = 0, veiculos_total = NULL, veiculos_sucesso = NULL');
  const [r] = await t.sql("SELECT r.id FROM rodadas r JOIN contas c ON c.id = r.conta_id WHERE c.nome = 'Transportadora Rota Sul'");
  await t.sql("UPDATE rodadas SET pendencias_detectadas = 4, pendencias_corrigidas_ate_d0 = 3, veiculos_total = 10, veiculos_sucesso = 7, estado = 'executada' WHERE id = $1", [r.id]);
  await t.sql("UPDATE pendencias SET origem = 'pre_rodada'");
  const pend = await t.sql('SELECT id FROM pendencias ORDER BY id LIMIT 2');
  await t.sql("UPDATE pendencias SET origem = 'pos_rodada' WHERE id = ANY($1::uuid[])", [pend.map((p) => p.id)]);
  await t.sql("UPDATE pendencias SET estado = 'corrigida', evidencia_correcao = 'Revalidada pela Platform' WHERE id = $1", [pend[0].id]);
  const d = (await marina.get('/dashboards/rodadas?dias=30')).corpo;
  assert.equal(tile(d, 'Correção pré-rodada').valor, 75, '3 de 4');
  assert.equal(tile(d, 'Correção pós-rodada').valor, 50, '1 de 2');
  assert.equal(tile(d, 'Sucesso das consultas').valor, 70, '7 de 10');
  const linha = bloco(d, 'por_rodada').linhas.find((l) => l.link === `#/rodadas/${r.id}`);
  assert.deepEqual([linha.detectadas, linha.corrigidas, linha.taxa], [4, 3, 75]);
  assert.equal(bloco(d, 'sucesso_rodada').linhas.find((l) => l.link === `#/rodadas/${r.id}`).valor, 70);
});

test('SUP-005: reprocessar a fila de falhas exige permissão e motivo, vale uma vez e não alcança outra organização', async () => {
  const [brobot, parceiro] = [await t.tenant('brobot'), await t.tenant('parceiro-demo')];
  const [job] = await t.sql("INSERT INTO jobs (tenant_id, tipo, executar_em, estado, tentativas, ultimo_erro) VALUES ($1, 'teste_falha', now(), 'morto', 5, 'falhou') RETURNING id", [brobot]);
  const [alheio] = await t.sql("INSERT INTO jobs (tenant_id, tipo, executar_em, estado) VALUES ($1, 'teste_falha', now(), 'morto') RETURNING id", [parceiro]);
  assert.equal((await rafael.post(`/supervisor/jobs/${job.id}/reprocessar`, { motivo: 'Tentar de novo' })).status, 403, 'Suporte não reprocessa');
  assert.equal((await marina.post(`/supervisor/jobs/${job.id}/reprocessar`, {})).status, 400, 'sem motivo');
  const ok = await marina.post(`/supervisor/jobs/${job.id}/reprocessar`, { motivo: 'Integração voltou a responder' });
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
  const [depois] = await t.sql('SELECT estado, tentativas FROM jobs WHERE id = $1', [job.id]);
  assert.deepEqual(depois, { estado: 'pendente', tentativas: 0 });
  const [aud] = await t.sql("SELECT motivo FROM auditoria WHERE acao = 'job.reprocessado' AND entidade_id = $1", [String(job.id)]);
  assert.equal(aud.motivo, 'Integração voltou a responder');
  assert.equal((await marina.post(`/supervisor/jobs/${job.id}/reprocessar`, { motivo: 'De novo, por engano' })).status, 404, 'só item da fila de falhas');
  assert.equal((await marina.post(`/supervisor/jobs/${alheio.id}/reprocessar`, { motivo: 'Tentativa entre empresas' })).status, 404, 'outra organização');
  assert.equal((await t.sql('SELECT estado FROM jobs WHERE id = $1', [alheio.id]))[0].estado, 'morto');
});

test('SUP-012: automático × manual bate com as tarefas e mensagens do período', async () => {
  const desde = new Date(relogio.agora().getTime() - 90 * 24 * 3600 * 1000);
  const [tar] = await t.sql('SELECT count(*) FILTER (WHERE execucao_id IS NOT NULL)::int AS auto, count(*) FILTER (WHERE execucao_id IS NULL)::int AS manual FROM tarefas WHERE criado_em >= $1 AND tenant_id = $2', [desde, await t.tenant('brobot')]);
  const d = (await marina.get('/dashboards/automacao?dias=90')).corpo;
  const linhaTarefas = bloco(d, 'manual_auto').linhas.find((l) => l.rotulo === 'Tarefas');
  assert.deepEqual([linhaTarefas.auto, linhaTarefas.manual], [tar.auto, tar.manual]);
  assert.ok(tar.auto > 0, 'os processos criaram tarefas sozinhos');
  const pct = Math.round((tar.auto / (tar.auto + tar.manual)) * 1000) / 10; // uma casa decimal, como nos outros painéis
  assert.match(tile(d, 'Tarefas criadas por processo').nota, new RegExp(`^${pct}% das tarefas`));
});

test('CS-002: saúde com motivo para cada ponto perdido; pesos configuráveis por organização', async () => {
  assert.deepEqual(saudeDaConta({ dias: 3, temPontoFocal: true, pendencias: 0, ocorrencias: 0, financeiro: 'em_dia' }), { pontos: 100, motivos: [] });
  const r = saudeDaConta({ dias: 20, temPontoFocal: false, pendencias: 5, ocorrencias: 3, financeiro: 'em_atraso' });
  assert.equal(r.pontos, 0, '100 - 35 - 25 - 30 (teto) - 10 - 10');
  assert.equal(r.motivos.length, 5);
  assert.deepEqual(pesosSaude({ semPontoFocal: 40, porPendencia: 'x', emRisco: 500 }), { ...PESOS_SAUDE, semPontoFocal: 40 }, 'valor inválido volta ao padrão');

  const antes = (await juliana.get('/dashboards/carteira')).corpo;
  const formula = bloco(antes, 'formula_saude').linhas;
  assert.equal(formula.find((l) => l.rotulo === 'Sem ponto focal').valor, 25, 'a tela mostra a fórmula');
  const nordesteAntes = bloco(antes, 'saude').linhas.find((l) => l.rotulo === 'Frota Nordeste Cargas');
  assert.match(nordesteAntes.motivos, /sem ponto focal/);
  await t.sql(`UPDATE tenants SET config = config || '{"saude": {"semPontoFocal": 5, "emRisco": 100}}'::jsonb WHERE slug = 'brobot'`);
  const depois = (await juliana.get('/dashboards/carteira')).corpo;
  const nordesteDepois = bloco(depois, 'saude').linhas.find((l) => l.rotulo === 'Frota Nordeste Cargas');
  assert.equal(nordesteDepois.saude, Math.min(100, nordesteAntes.saude + 20), 'perde 5 em vez de 25');
  assert.equal(tile(depois, 'Em risco').rotulo, 'Em risco (saúde < 100)');
  assert.equal(tile(depois, 'Em risco').valor, bloco(depois, 'saude').linhas.filter((l) => l.saude < 100).length, 'o corte de risco também é da organização');
  await t.sql("UPDATE tenants SET config = config - 'saude' WHERE slug = 'brobot'");
});

test('CS-001/BL-02/CRE-008: carteira VIP filtrada e credenciais por conta só com status (sem segredo)', async () => {
  const vip = (await juliana.get('/contas?filtro=vip')).corpo;
  assert.ok(vip.itens.length >= 2 && vip.itens.every((c) => c.vip), 'só VIP');
  assert.ok(vip.itens.every((c) => c.equipe === 'cs' || c.equipe?.codigo === 'cs' || /CS|Customer/i.test(JSON.stringify(c.equipe))), 'VIP é da carteira do CS');
  const rota = vip.itens.find((c) => c.nome === 'Transportadora Rota Sul');
  assert.equal(rota.credenciais_pendentes, 2, 'vínculo SNE e certificado expirado contam como pendência');
  const d = (await juliana.get(`/contas/${rota.id}`)).corpo;
  assert.ok(d.credenciais.length >= 2);
  for (const cr of d.credenciais) {
    assert.deepEqual(Object.keys(cr).sort(), ['atualizado_em', 'expira_em', 'id', 'referencia_platform', 'status', 'tipo']);
  }
});
