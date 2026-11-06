'use strict';
// Treinamentos coletivos do CS (CS-004…009). Roteiro versionado por tela (a sessão guarda a versão usada); sessão por
// link numa conta de demonstração da Platform (nunca de cliente: CS-007); convite ao ponto focal pelo canal permitido
// (consentimento e opt-out da comunicação valem); presença, avaliação, dúvidas e próximo passo; efetividade pelo uso
// da Platform antes (fotografado no convite) e agora. Conta sem uso vira alerta para o CS oferecer treinamento.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio, DIA } = require('../../nucleo/relogio');
const comunicacao = require('../comunicacao/servico');
const monitoramento = require('../monitoramento/servico');

const ROTEIRO_PADRAO = {
  codigo: 'primeiros_passos', titulo: 'Primeiros passos na Platform Brobot', produto: null,
  passos: [
    { tela: 'Entrada e visão geral', objetivo: 'Achar as consultas do dia e o resumo da frota' },
    { tela: 'Consultas', objetivo: 'Filtrar por placa, ver o resultado e baixar o comprovante' },
    { tela: 'Credenciais', objetivo: 'Cadastrar e renovar credencial sem compartilhar senha com ninguém' },
    { tela: 'Pendências', objetivo: 'Entender o que falta para a consulta acontecer e como avisar a Brobot' },
    { tela: 'Relatórios', objetivo: 'Exportar o relatório por filial e agendar o envio' },
  ],
};
const INATIVIDADE_DIAS = 30;

function validarPassos(passos) {
  if (!Array.isArray(passos) || !passos.length || passos.length > 40) throw erro.entrada('O roteiro precisa de 1 a 40 passos.');
  return passos.map((p, i) => {
    const tela = String(p?.tela || '').trim(); const objetivo = String(p?.objetivo || '').trim();
    if (tela.length < 2 || tela.length > 80) throw erro.entrada(`Passo ${i + 1}: nome da tela de 2 a 80 caracteres.`);
    if (objetivo.length < 3 || objetivo.length > 300) throw erro.entrada(`Passo ${i + 1}: objetivo de 3 a 300 caracteres.`);
    return { tela, objetivo };
  });
}

async function roteiros(c, ctx) {
  let r = (await c.query('SELECT id, codigo, versao, titulo, produto, passos, criado_em FROM treinamento_roteiros WHERE ativo ORDER BY titulo')).rows;
  if (!r.length) {
    await c.query('INSERT INTO treinamento_roteiros (tenant_id, codigo, versao, titulo, produto, passos) VALUES ($1,$2,1,$3,$4,$5) ON CONFLICT DO NOTHING',
      [ctx.tenantId, ROTEIRO_PADRAO.codigo, ROTEIRO_PADRAO.titulo, ROTEIRO_PADRAO.produto, JSON.stringify(ROTEIRO_PADRAO.passos)]);
    r = (await c.query('SELECT id, codigo, versao, titulo, produto, passos, criado_em FROM treinamento_roteiros WHERE ativo ORDER BY titulo')).rows;
  }
  return r;
}

/** Nova versão do roteiro (CS-006): a anterior deixa de ser a ativa, mas as sessões que a usaram continuam apontando para ela. */
async function salvarRoteiro(c, ctx, { codigo, titulo, produto, passos }) {
  if (!/^[a-z0-9_]{2,40}$/.test(codigo || '')) throw erro.entrada('Código do roteiro: letras minúsculas, números e _ (ex.: primeiros_passos).');
  const p = validarPassos(passos);
  const atual = uma(await c.query('SELECT id, versao FROM treinamento_roteiros WHERE codigo = $1 AND ativo FOR UPDATE', [codigo]));
  if (atual) await c.query('UPDATE treinamento_roteiros SET ativo = false WHERE id = $1', [atual.id]);
  const versao = (uma(await c.query('SELECT coalesce(max(versao), 0) + 1 AS v FROM treinamento_roteiros WHERE codigo = $1', [codigo]))).v;
  const r = uma(await c.query('INSERT INTO treinamento_roteiros (tenant_id, codigo, versao, titulo, produto, passos, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [ctx.tenantId, codigo, versao, titulo, produto || null, JSON.stringify(p), ctx.usuario?.id || null]));
  await auditar(c, ctx, { acao: 'treinamento.roteiro_salvo', entidade: 'treinamento_roteiro', entidadeId: r.id, depois: { codigo, versao, passos: p.length } });
  return r;
}

async function criarSessao(c, ctx, d) {
  const roteiro = uma(await c.query('SELECT id FROM treinamento_roteiros WHERE codigo = $1 AND ativo', [d.roteiro]));
  if (!roteiro) throw erro.entrada('Roteiro não encontrado.', [{ campo: 'roteiro', problema: 'inválido' }]);
  const inicio = new Date(d.inicio);
  if (!(inicio > relogio.agora())) throw erro.entrada('A sessão precisa ser marcada no futuro.', [{ campo: 'inicio', problema: 'inválido' }]);
  if (!/^https:\/\/\S{4,300}$/.test(d.link || '')) throw erro.entrada('Informe o link da chamada (começando com https://).', [{ campo: 'link', problema: 'inválido' }]);
  // CS-007: a conta usada na tela é de demonstração. Se for o CNPJ de um cliente, recusa (dados reais na tela de todos).
  const digitos = String(d.contaDemo || '').replace(/\D/g, '');
  if (digitos.length === 14 && uma(await c.query('SELECT 1 FROM contas WHERE cnpj = $1', [digitos]))) {
    throw erro.regra('conta_real', 'Esse CNPJ é de um cliente. Use a conta de demonstração da Platform: no treinamento coletivo ninguém pode ver dados de outro cliente.');
  }
  const s = uma(await c.query(`INSERT INTO treinamento_sessoes (tenant_id, titulo, roteiro_id, inicio, duracao_min, link, conta_demo, vagas, instrutor_id, observacoes, criado_por)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
  [ctx.tenantId, d.titulo, roteiro.id, inicio, d.duracaoMin || 60, d.link, d.contaDemo, d.vagas || null, d.instrutorId || ctx.usuario?.id || null, d.observacoes || null, ctx.usuario?.id || null]));
  await auditar(c, ctx, { acao: 'treinamento.sessao_criada', entidade: 'treinamento_sessao', entidadeId: s.id, depois: { titulo: s.titulo, inicio } });
  return s;
}

async function sessao(c, id, trava = false) {
  const s = uma(await c.query(`SELECT * FROM treinamento_sessoes WHERE id = $1 ${trava ? 'FOR UPDATE' : ''}`, [id]));
  if (!s) throw erro.naoEncontrado('Sessão de treinamento');
  return s;
}

async function listarSessoes(c, { pagina = 1 } = {}) {
  const por = 20; const p = Math.max(1, Number(pagina) || 1);
  const r = await c.query(`SELECT s.id, s.titulo, s.inicio, s.duracao_min, s.estado, s.vagas, r.titulo AS roteiro, r.versao AS roteiro_versao, u.nome AS instrutor,
      count(tp.id)::int AS participantes, count(tp.id) FILTER (WHERE tp.presenca = 'presente')::int AS presentes,
      count(tp.id) FILTER (WHERE tp.convidado_em IS NOT NULL)::int AS convidados, round(avg(tp.avaliacao), 1)::float AS avaliacao_media,
      count(*) OVER()::int AS total
    FROM treinamento_sessoes s JOIN treinamento_roteiros r ON r.id = s.roteiro_id LEFT JOIN usuarios u ON u.id = s.instrutor_id
    LEFT JOIN treinamento_participantes tp ON tp.sessao_id = s.id
    GROUP BY s.id, r.titulo, r.versao, u.nome ORDER BY (s.estado = 'agendada') DESC, s.inicio DESC LIMIT $1 OFFSET $2`, [por, (p - 1) * por]);
  return { itens: r.rows.map(({ total, ...x }) => x), total: r.rows[0]?.total || 0, pagina: p, porPagina: por };
}

async function detalhe(c, id) {
  const s = uma(await c.query(`SELECT s.*, r.codigo AS roteiro_codigo, r.titulo AS roteiro_titulo, r.versao AS roteiro_versao, r.passos, u.nome AS instrutor
    FROM treinamento_sessoes s JOIN treinamento_roteiros r ON r.id = s.roteiro_id LEFT JOIN usuarios u ON u.id = s.instrutor_id WHERE s.id = $1`, [id]));
  if (!s) throw erro.naoEncontrado('Sessão de treinamento');
  const participantes = (await c.query(`SELECT tp.*, ct.nome AS conta, ct.vip, pf.nome AS ponto_focal, i.status_entrega AS convite_status,
      uc.consultas_30d AS consultas_30d_agora, uc.ultimo_login AS ultimo_login_agora
    FROM treinamento_participantes tp JOIN contas ct ON ct.id = tp.conta_id LEFT JOIN pontos_focais pf ON pf.id = tp.ponto_focal_id
    LEFT JOIN interacoes i ON i.id = tp.convite_interacao_id LEFT JOIN uso_contas uc ON uc.conta_id = tp.conta_id
    WHERE tp.sessao_id = $1 ORDER BY ct.nome`, [id])).rows;
  // CS-009: evolução do uso desde o convite (só com dado antes e agora).
  const com = participantes.filter((x) => x.consultas_30d_antes !== null && x.consultas_30d_agora !== null);
  const efetividade = { medidos: com.length, presentesComUso: com.filter((x) => x.presenca === 'presente').length,
    variacaoMediaPresentes: media(com.filter((x) => x.presenca === 'presente').map((x) => x.consultas_30d_agora - x.consultas_30d_antes)),
    variacaoMediaAusentes: media(com.filter((x) => x.presenca === 'ausente').map((x) => x.consultas_30d_agora - x.consultas_30d_antes)) };
  return { ...s, participantes, efetividade };
}
const media = (v) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null);

async function adicionarParticipantes(c, ctx, id, contaIds) {
  const s = await sessao(c, id, true);
  if (s.estado !== 'agendada') throw erro.conflito('Só dá para incluir participantes em sessão agendada.');
  const ja = (uma(await c.query('SELECT count(*)::int AS n FROM treinamento_participantes WHERE sessao_id = $1', [id]))).n;
  const novos = [...new Set(contaIds)].slice(0, 100);
  if (s.vagas && ja + novos.length > s.vagas) throw erro.regra('sem_vagas', `A sessão tem ${s.vagas} vagas e já há ${ja} participante(s).`);
  let n = 0;
  for (const contaId of novos) {
    const r = await c.query(`INSERT INTO treinamento_participantes (tenant_id, sessao_id, conta_id) SELECT $1, $2, id FROM contas
      WHERE id = $3 AND arquivada_em IS NULL AND status <> 'encerrada' ON CONFLICT (tenant_id, sessao_id, conta_id) DO NOTHING`, [ctx.tenantId, id, contaId]);
    n += r.rowCount;
  }
  await auditar(c, ctx, { acao: 'treinamento.participantes', entidade: 'treinamento_sessao', entidadeId: id, depois: { incluidos: n } });
  return { incluidos: n };
}

/** Convida quem ainda não foi convidado: mensagem ao ponto focal pelo canal permitido; fotografa o uso de agora. */
async function convidar(c, ctx, id) {
  const s = await sessao(c, id, true);
  if (s.estado !== 'agendada') throw erro.conflito('Sessão não está agendada.');
  const pendentes = (await c.query(`SELECT tp.id, tp.conta_id, ct.nome AS conta FROM treinamento_participantes tp JOIN contas ct ON ct.id = tp.conta_id
    WHERE tp.sessao_id = $1 AND tp.convidado_em IS NULL`, [id])).rows;
  const data = new Date(s.inicio).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const r = { convidados: 0, semPontoFocal: [], bloqueados: [] };
  for (const p of pendentes) {
    const pf = uma(await c.query("SELECT * FROM pontos_focais WHERE conta_id = $1 AND vigente ORDER BY (papel = 'principal') DESC LIMIT 1", [p.conta_id]));
    if (!pf) { r.semPontoFocal.push(p.conta); continue; }
    const it = await comunicacao.programarEnvio(c, ctx, { contaId: p.conta_id, pontoFocal: pf, modelo: 'convite_treinamento',
      variaveis: { nome: pf.nome.split(' ')[0], conta: p.conta, titulo: s.titulo, data, link: s.link } });
    if (it.motivoBloqueio) r.bloqueados.push(`${p.conta}: ${it.motivoBloqueio}`);
    const uso = uma(await c.query('SELECT consultas_30d, ultimo_login FROM uso_contas WHERE conta_id = $1', [p.conta_id]));
    await c.query(`UPDATE treinamento_participantes SET ponto_focal_id = $2, convite_interacao_id = $3, convidado_em = $4, consultas_30d_antes = $5, ultimo_login_antes = $6
      WHERE id = $1`, [p.id, pf.id, it.id, relogio.agora(), uso?.consultas_30d ?? null, uso?.ultimo_login ?? null]);
    if (!it.motivoBloqueio) r.convidados++;
  }
  await auditar(c, ctx, { acao: 'treinamento.convites', entidade: 'treinamento_sessao', entidadeId: id, depois: r });
  return r;
}

/** Registra presença, avaliação, dúvidas e próximo passo (CS-008), a partir do início da sessão. */
async function registrar(c, ctx, participanteId, d) {
  const p = uma(await c.query('SELECT tp.*, s.inicio, s.estado FROM treinamento_participantes tp JOIN treinamento_sessoes s ON s.id = tp.sessao_id WHERE tp.id = $1 FOR UPDATE OF tp', [participanteId]));
  if (!p) throw erro.naoEncontrado('Participante');
  if (p.estado === 'cancelada') throw erro.conflito('Sessão cancelada.');
  if (new Date(p.inicio) > relogio.agora()) throw erro.regra('antes_da_sessao', 'Presença e avaliação só depois do início da sessão.');
  if (d.avaliacao !== undefined && d.presenca !== 'presente' && p.presenca !== 'presente') throw erro.entrada('Só quem esteve presente avalia o treinamento.');
  const r = uma(await c.query(`UPDATE treinamento_participantes SET presenca = coalesce($2, presenca), avaliacao = coalesce($3, avaliacao),
    duvidas = coalesce($4, duvidas), proximo_passo = coalesce($5, proximo_passo) WHERE id = $1 RETURNING *`,
  [participanteId, d.presenca || null, d.avaliacao ?? null, d.duvidas || null, d.proximoPasso || null]));
  await auditar(c, ctx, { acao: 'treinamento.participante', entidade: 'treinamento_sessao', entidadeId: p.sessao_id, depois: { conta: p.conta_id, presenca: r.presenca, avaliacao: r.avaliacao } });
  return r;
}

/** Fecha a sessão como realizada: toda presença marcada; ausente vira tarefa do CS para reagendar (uma por conta). */
async function concluir(c, ctx, id, criarTarefa) {
  const s = await sessao(c, id, true);
  if (s.estado !== 'agendada') throw erro.conflito('Sessão já encerrada.');
  if (new Date(s.inicio) > relogio.agora()) throw erro.regra('antes_da_sessao', 'A sessão ainda não começou.');
  const ps = (await c.query('SELECT tp.id, tp.conta_id, tp.presenca, ct.nome FROM treinamento_participantes tp JOIN contas ct ON ct.id = tp.conta_id WHERE tp.sessao_id = $1', [id])).rows;
  const sem = ps.filter((x) => x.presenca === 'pendente');
  if (sem.length) throw erro.regra('presenca_pendente', `Marque a presença de: ${sem.map((x) => x.nome).join(', ')}.`);
  const agora = relogio.agora();
  await c.query("UPDATE treinamento_sessoes SET estado = 'realizada', realizada_em = $2 WHERE id = $1", [id, agora]);
  for (const a of ps.filter((x) => x.presenca === 'ausente')) {
    await criarTarefa({ tipo: 'geral', equipeCodigo: 'cs', chave: `treino-ausente:${id}:${a.conta_id}`, prazoEm: new Date(agora.getTime() + 2 * DIA),
      titulo: `Reagendar treinamento de ${a.nome} (faltou em "${s.titulo}")` });
  }
  await auditar(c, ctx, { acao: 'treinamento.sessao_realizada', entidade: 'treinamento_sessao', entidadeId: id, depois: { presentes: ps.filter((x) => x.presenca === 'presente').length, ausentes: ps.length - ps.filter((x) => x.presenca === 'presente').length } });
  await publicar(c, ctx, { tipo: 'treinamento.realizado', agregado: 'treinamento_sessao', agregadoId: id, chave: `treino:${id}:realizado`, payload: { participantes: ps.length } });
  return { id, estado: 'realizada' };
}

async function cancelar(c, ctx, id, motivo) {
  const s = await sessao(c, id, true);
  if (s.estado !== 'agendada') throw erro.conflito('Sessão já encerrada.');
  await c.query("UPDATE treinamento_sessoes SET estado = 'cancelada', motivo_cancelamento = $2 WHERE id = $1", [id, motivo]);
  await auditar(c, ctx, { acao: 'treinamento.sessao_cancelada', entidade: 'treinamento_sessao', entidadeId: id, motivo });
  return { id, estado: 'cancelada' };
}

/** CS-004: conta ativa sem acesso há 30 dias ou sem consulta no mês vira alerta para o CS (um por conta enquanto aberto),
 *  salvo se ela já estiver numa sessão agendada. */
async function verificarInatividade(c, ctx) {
  const agora = relogio.agora();
  const contas = (await c.query(`SELECT ct.id, ct.nome, uc.ultimo_login, uc.consultas_30d FROM contas ct JOIN uso_contas uc ON uc.conta_id = ct.id
    WHERE ct.status = 'ativa' AND ct.arquivada_em IS NULL AND (uc.ultimo_login < $1 OR uc.consultas_30d = 0)
      AND NOT EXISTS (SELECT 1 FROM treinamento_participantes tp JOIN treinamento_sessoes s ON s.id = tp.sessao_id WHERE tp.conta_id = ct.id AND s.estado = 'agendada' AND s.inicio > $2)
    LIMIT 100`, [new Date(agora.getTime() - INATIVIDADE_DIAS * DIA), agora])).rows;
  let novas = 0;
  for (const x of contas) {
    const motivo = x.consultas_30d === 0 ? 'nenhuma consulta nos últimos 30 dias' : `último acesso em ${new Date(x.ultimo_login).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
    const { nova } = await monitoramento.alertar(c, ctx, { chave: `inatividade:${x.id}`, contaId: x.id, tipo: 'solicitacao', equipeCodigo: 'cs', motivo: 'inatividade',
      prioridade: 'media', titulo: `Conta sem uso: oferecer treinamento (${x.nome})`, descricao: `Adoção baixa: ${motivo}. Convidar o ponto focal para o próximo treinamento coletivo ou marcar uma conversa.`,
      proximaAcao: 'Convidar para o treinamento coletivo' });
    if (nova) novas++;
  }
  return novas;
}

module.exports = { roteiros, salvarRoteiro, criarSessao, listarSessoes, detalhe, adicionarParticipantes, convidar, registrar, concluir, cancelar, verificarInatividade };
