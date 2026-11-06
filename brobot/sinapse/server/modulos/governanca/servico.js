'use strict';
// Governança (F9): delegação temporária (GOV-009), matriz RACI por processo com responsáveis vigentes (GOV-010,
// GOV-003), plantões por equipe e SLA por contrato (GOV-008). Toda mudança grava auditoria e evento.
// Delegação: a própria pessoa delega o que é dela; a gestão (`governanca.gerir`) delega por quem faltou.
// Uma delegação por vez e sem corrente (quem recebe não pode estar delegando no mesmo período).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio, HORA } = require('../../nucleo/relogio');
const vigencia = require('./vigencia');

const DIA = 24 * HORA;

/** Processos da Brobot que a matriz cobre (a chave liga ao módulo do Sinapse que executa). */
const PROCESSOS = {
  triagem: 'Triagem de mensagens sem cliente identificado',
  atendimento_suporte: 'Atendimento de Suporte',
  atendimento_cs: 'Atendimento de clientes VIP (CS)',
  rodadas: 'Rodadas (pré e pós-rodada)',
  onboarding: 'Onboarding e ativação de cliente',
  offboarding: 'Cancelamento e offboarding',
  monitoramento: 'Monitoramento de consultas e credenciais',
  treinamentos: 'Treinamentos de clientes',
  comercial: 'Funil comercial',
  descontos: 'Aprovação de desconto acima da alçada',
  cobranca: 'Inadimplência e bloqueio',
  incidentes: 'Incidentes e comunicação aos clientes',
  melhorias: 'Melhorias e releases',
  mensagens_padrao: 'Mensagens padrão (redação e aprovação)',
  lgpd: 'Pedidos de titulares (LGPD)',
};
/** Sugestão inicial por código de equipe (R = executa, A = responde). Só preenche processo vazio. */
const SUGESTAO = {
  triagem: { R: 'triagem', A: 'supervisao', I: 'contingencia' }, atendimento_suporte: { R: 'suporte', A: 'supervisao', C: 'operacoes' },
  atendimento_cs: { R: 'cs', A: 'supervisao', C: 'suporte' }, rodadas: { R: 'operacoes', A: 'supervisao', I: 'cs' },
  onboarding: { R: 'cs', A: 'supervisao', C: 'operacoes', I: 'financeiro' }, offboarding: { R: 'cs', A: 'supervisao', I: 'financeiro' },
  monitoramento: { R: 'operacoes', A: 'supervisao', I: 'cs' }, treinamentos: { R: 'cs', A: 'supervisao' },
  comercial: { R: 'comercial', A: 'supervisao', I: 'cs' }, descontos: { R: 'comercial', A: 'supervisao', C: 'financeiro' },
  cobranca: { R: 'financeiro', A: 'supervisao', I: 'cs' }, incidentes: { R: 'dev', A: 'supervisao', I: 'suporte' },
  melhorias: { R: 'dev', A: 'supervisao', C: 'operacoes' }, mensagens_padrao: { R: 'suporte', A: 'supervisao', C: 'cs' },
  lgpd: { R: 'supervisao', A: 'supervisao' },
};
const PAPEIS_RACI = { R: 'Responsável (executa)', A: 'Aprovador (responde pelo resultado)', C: 'Consultado', I: 'Informado' };

const iso = (d) => (d instanceof Date ? d : new Date(d));

async function usuarioAtivo(c, id, nome = 'Pessoa') {
  const u = uma(await c.query('SELECT id, nome, disponivel FROM usuarios WHERE id = $1 AND ativo', [id]));
  if (!u) throw erro.naoEncontrado(nome);
  return u;
}

// ---------- Delegação temporária (GOV-009) ----------

async function delegar(c, ctx, d, podeGerir) {
  const agora = relogio.agora();
  const deId = d.deId || ctx.usuario.id;
  if (deId !== ctx.usuario.id && !podeGerir) throw erro.semPermissao('delegar por outra pessoa (só a gestão)');
  const inicio = d.inicio ? iso(d.inicio) : agora;
  const fim = iso(d.fim);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) throw erro.entrada('Datas inválidas.');
  if (fim <= inicio) throw erro.entrada('O fim da delegação precisa ser depois do início.');
  if (fim <= agora) throw erro.entrada('O fim da delegação já passou.');
  if (fim - inicio > 90 * DIA) throw erro.entrada('Delegação vale no máximo 90 dias. Para mais tempo, troque o responsável.');
  if (deId === d.paraId) throw erro.entrada('Escolha outra pessoa para receber a delegação.');
  const de = await usuarioAtivo(c, deId);
  const para = await usuarioAtivo(c, d.paraId, 'Pessoa que recebe');
  const sobrepoe = `revogada_em IS NULL AND inicio < $3 AND fim > $2`;
  if (uma(await c.query(`SELECT 1 FROM delegacoes WHERE de_id = $1 AND ${sobrepoe}`, [deId, inicio, fim]))) {
    throw erro.conflito(`${de.nome} já tem uma delegação nesse período. Revogue a atual antes de criar outra.`);
  }
  if (uma(await c.query(`SELECT 1 FROM delegacoes WHERE de_id = $1 AND ${sobrepoe}`, [para.id, inicio, fim]))) {
    throw erro.regra('delegado_ausente', `${para.nome} também está delegando nesse período. Escolha quem vai estar presente.`);
  }
  if (uma(await c.query(`SELECT 1 FROM delegacoes WHERE para_id = $1 AND ${sobrepoe}`, [deId, inicio, fim]))) {
    throw erro.regra('delegacao_em_corrente', `${de.nome} está recebendo a delegação de outra pessoa nesse período. Revogue aquela antes.`);
  }
  const reg = uma(await c.query(`INSERT INTO delegacoes (tenant_id, de_id, para_id, inicio, fim, motivo, criado_por)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [ctx.tenantId, deId, para.id, inicio, fim, d.motivo, ctx.usuario.id]));
  await auditar(c, ctx, { acao: 'delegacao.criada', entidade: 'delegacao', entidadeId: reg.id, motivo: d.motivo,
    depois: { de: de.nome, para: para.nome, inicio, fim } });
  await publicar(c, ctx, { tipo: 'delegacao.criada', agregado: 'usuario', agregadoId: deId, payload: { delegacaoId: reg.id, paraId: para.id, inicio, fim } });
  return reg;
}

async function revogar(c, ctx, id, motivo, podeGerir) {
  const reg = uma(await c.query('SELECT * FROM delegacoes WHERE id = $1 FOR UPDATE', [id]));
  if (!reg) throw erro.naoEncontrado('Delegação');
  if (reg.de_id !== ctx.usuario.id && !podeGerir) throw erro.semPermissao('revogar a delegação de outra pessoa');
  if (reg.revogada_em) throw erro.conflito('Esta delegação já foi revogada.');
  if (new Date(reg.fim) <= relogio.agora()) throw erro.conflito('Esta delegação já terminou.');
  const r = uma(await c.query('UPDATE delegacoes SET revogada_em = $2, revogada_por = $3 WHERE id = $1 RETURNING *', [id, relogio.agora(), ctx.usuario.id]));
  await auditar(c, ctx, { acao: 'delegacao.revogada', entidade: 'delegacao', entidadeId: id, motivo, antes: { fim: reg.fim }, depois: { revogadaEm: r.revogada_em } });
  await publicar(c, ctx, { tipo: 'delegacao.revogada', agregado: 'usuario', agregadoId: reg.de_id, payload: { delegacaoId: id } });
  return r;
}

async function listarDelegacoes(c, { usuarioId = null } = {}) {
  const agora = relogio.agora();
  return (await c.query(`SELECT d.id, d.de_id, de.nome AS de_nome, d.para_id, pa.nome AS para_nome, d.inicio, d.fim, d.motivo, d.revogada_em,
      (d.revogada_em IS NULL AND d.inicio <= $1 AND d.fim > $1) AS vigente, (d.revogada_em IS NULL AND d.inicio > $1) AS futura
    FROM delegacoes d JOIN usuarios de ON de.id = d.de_id JOIN usuarios pa ON pa.id = d.para_id
    WHERE ($2::uuid IS NULL OR d.de_id = $2 OR d.para_id = $2) AND (d.revogada_em IS NULL AND d.fim > $1 - interval '30 days' OR d.revogada_em > $1 - interval '30 days')
    ORDER BY (d.revogada_em IS NULL AND d.fim > $1) DESC, d.inicio DESC LIMIT 100`, [agora, usuarioId])).rows;
}

/** Supervisor: a delegação que venceu fica registrada (auditoria e evento), uma vez. */
async function registrarExpiracoes(c, ctx) {
  const agora = relogio.agora();
  const vencidas = (await c.query(`UPDATE delegacoes SET expiracao_registrada_em = $1
    WHERE revogada_em IS NULL AND expiracao_registrada_em IS NULL AND fim <= $1 RETURNING id, de_id, para_id, fim`, [agora])).rows;
  for (const v of vencidas) {
    await auditar(c, ctx, { acao: 'delegacao.expirada', entidade: 'delegacao', entidadeId: v.id, motivo: 'Fim do período da delegação', depois: { fim: v.fim } });
    await publicar(c, ctx, { tipo: 'delegacao.expirada', agregado: 'usuario', agregadoId: v.de_id, chave: `delegacao.expirada:${v.id}`, payload: { delegacaoId: v.id, paraId: v.para_id } });
  }
  return vencidas.length;
}

// ---------- Matriz RACI (GOV-010, GOV-003) ----------

async function definirRaci(c, ctx, d) {
  if (!PROCESSOS[d.processo]) throw erro.entrada('Processo desconhecido.');
  if (!PAPEIS_RACI[d.papel]) throw erro.entrada('Papel deve ser R, A, C ou I.');
  if (!!d.usuarioId === !!d.equipeId) throw erro.entrada('Escolha uma pessoa ou uma equipe.');
  if (d.usuarioId) await usuarioAtivo(c, d.usuarioId);
  if (d.equipeId && !uma(await c.query('SELECT 1 FROM equipes WHERE id = $1', [d.equipeId]))) throw erro.naoEncontrado('Equipe');
  if (d.papel === 'A') {
    // Um só aprovador: o novo substitui (o índice único `raci_um_aprovador` segura a corrida).
    const saiu = uma(await c.query("DELETE FROM raci WHERE processo = $1 AND papel = 'A' RETURNING *", [d.processo]));
    if (saiu) await auditar(c, ctx, { acao: 'raci.removido', entidade: 'raci', entidadeId: saiu.id, motivo: 'Substituído por novo aprovador',
      antes: { processo: saiu.processo, papel: 'A', usuarioId: saiu.usuario_id, equipeId: saiu.equipe_id } });
  }
  const r = uma(await c.query(`INSERT INTO raci (tenant_id, processo, papel, usuario_id, equipe_id, criado_por) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT DO NOTHING RETURNING *`, [ctx.tenantId, d.processo, d.papel, d.usuarioId || null, d.equipeId || null, ctx.usuario.id]));
  if (!r) throw erro.conflito('Essa pessoa ou equipe já tem esse papel neste processo.');
  await auditar(c, ctx, { acao: 'raci.definido', entidade: 'raci', entidadeId: r.id, depois: { processo: d.processo, papel: d.papel, usuarioId: r.usuario_id, equipeId: r.equipe_id } });
  await publicar(c, ctx, { tipo: 'raci.alterado', agregado: 'tenant', agregadoId: ctx.tenantId, payload: { processo: d.processo } });
  return r;
}

/** Aplica a sugestão nos processos ainda sem ninguém (não mexe no que a gestão já definiu). */
async function aplicarSugestao(c, ctx) {
  const eq = Object.fromEntries((await c.query('SELECT codigo, id FROM equipes')).rows.map((r) => [r.codigo, r.id]));
  const usados = new Set((await c.query('SELECT DISTINCT processo FROM raci')).rows.map((r) => r.processo));
  let incluidas = 0;
  for (const [processo, papeis] of Object.entries(SUGESTAO)) {
    if (usados.has(processo)) continue;
    for (const [papel, codigo] of Object.entries(papeis)) {
      if (!eq[codigo]) continue;
      const r = await c.query(`INSERT INTO raci (tenant_id, processo, papel, equipe_id, criado_por) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [ctx.tenantId, processo, papel, eq[codigo], ctx.usuario?.id || null]);
      incluidas += r.rowCount;
    }
  }
  if (incluidas) {
    await auditar(c, ctx, { acao: 'raci.sugestao_aplicada', entidade: 'tenant', entidadeId: ctx.tenantId, depois: { linhas: incluidas } });
    await publicar(c, ctx, { tipo: 'raci.alterado', agregado: 'tenant', agregadoId: ctx.tenantId, payload: { sugestao: true } });
  }
  return { incluidas };
}

async function removerRaci(c, ctx, id) {
  const r = uma(await c.query('DELETE FROM raci WHERE id = $1 RETURNING *', [id]));
  if (!r) throw erro.naoEncontrado('Linha da matriz');
  await auditar(c, ctx, { acao: 'raci.removido', entidade: 'raci', entidadeId: id, antes: { processo: r.processo, papel: r.papel, usuarioId: r.usuario_id, equipeId: r.equipe_id } });
  await publicar(c, ctx, { tipo: 'raci.alterado', agregado: 'tenant', agregadoId: ctx.tenantId, payload: { processo: r.processo } });
  return { ok: true };
}

/**
 * A matriz com quem responde **agora** em cada linha: pessoa ausente mostra o delegado ou o substituto; equipe mostra
 * o plantonista vigente. Consultas em lote (sem uma por linha).
 */
async function matriz(c) {
  const agora = relogio.agora();
  const linhas = (await c.query(`SELECT r.id, r.processo, r.papel, r.usuario_id, u.nome AS usuario_nome, u.disponivel, r.equipe_id, e.nome AS equipe_nome,
      dl.para_nome AS delegado_nome, dl.para_disponivel AS delegado_disponivel, dl.fim AS delegado_ate, sb.nome AS substituto_nome, sb.disponivel AS substituto_disponivel, pl.nome AS plantonista_nome, pl.fim AS plantao_ate
    FROM raci r LEFT JOIN usuarios u ON u.id = r.usuario_id LEFT JOIN equipes e ON e.id = r.equipe_id
    LEFT JOIN usuarios sb ON sb.id = u.substituto_id AND sb.ativo
    LEFT JOIN LATERAL (SELECT p.nome AS para_nome, p.disponivel AS para_disponivel, d.fim FROM delegacoes d JOIN usuarios p ON p.id = d.para_id AND p.ativo
      WHERE d.de_id = r.usuario_id AND d.revogada_em IS NULL AND d.inicio <= $1 AND d.fim > $1 ORDER BY d.criado_em DESC LIMIT 1) dl ON true
    LEFT JOIN LATERAL (SELECT x.nome, pl.fim FROM plantoes pl JOIN usuarios x ON x.id = pl.usuario_id AND x.ativo
      WHERE pl.equipe_id = r.equipe_id AND pl.cancelado_em IS NULL AND pl.inicio <= $1 AND pl.fim > $1 ORDER BY pl.inicio DESC LIMIT 1) pl ON true
    ORDER BY r.processo, r.papel, coalesce(u.nome, e.nome)`, [agora])).rows;
  const porProcesso = Object.entries(PROCESSOS).map(([chave, nome]) => {
    const minhas = linhas.filter((l) => l.processo === chave).map((l) => ({
      id: l.id, papel: l.papel, tipo: l.usuario_id ? 'pessoa' : 'equipe', nome: l.usuario_nome || l.equipe_nome,
      vigente: l.usuario_id ? vigenteDaPessoa(l) : (l.plantonista_nome ? { nome: l.plantonista_nome, por: 'plantao', ate: l.plantao_ate } : null),
      ausente: !!l.usuario_id && (!l.disponivel || !!l.delegado_nome),
    }));
    const faltando = ['R', 'A'].filter((p) => !minhas.some((m) => m.papel === p));
    return { chave, nome, linhas: minhas, faltando };
  });
  return { processos: porProcesso, papeis: PAPEIS_RACI };
}

/** Mesma ordem de `identidade.resolverResponsavel`: delegado disponível → a pessoa → substituto → fila. */
function vigenteDaPessoa(l) {
  if (l.delegado_nome && l.delegado_disponivel) return { nome: l.delegado_nome, por: 'delegacao', ate: l.delegado_ate };
  if (l.disponivel) return null; // a própria pessoa
  if (l.substituto_nome && l.substituto_disponivel) return { nome: l.substituto_nome, por: 'substituto' };
  return { nome: null, por: 'fila' };
}

// ---------- Plantões (GOV-008) ----------

async function criarPlantao(c, ctx, d) {
  const inicio = iso(d.inicio); const fim = iso(d.fim);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) throw erro.entrada('Datas inválidas.');
  if (fim <= inicio) throw erro.entrada('O fim do plantão precisa ser depois do início.');
  if (fim - inicio > 7 * DIA) throw erro.entrada('Um plantão dura no máximo 7 dias. Cadastre a escala em partes.');
  if (fim <= relogio.agora()) throw erro.entrada('Esse plantão já terminou.');
  const u = await usuarioAtivo(c, d.usuarioId);
  const eq = uma(await c.query('SELECT id, nome FROM equipes WHERE id = $1', [d.equipeId]));
  if (!eq) throw erro.naoEncontrado('Equipe');
  const choque = uma(await c.query(`SELECT u.nome FROM plantoes p JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.equipe_id = $1 AND p.cancelado_em IS NULL AND p.inicio < $3 AND p.fim > $2 LIMIT 1`, [eq.id, inicio, fim]));
  if (choque) throw erro.conflito(`${eq.nome} já tem plantão de ${choque.nome} nesse período.`);
  const p = uma(await c.query(`INSERT INTO plantoes (tenant_id, equipe_id, usuario_id, inicio, fim, criado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [ctx.tenantId, eq.id, u.id, inicio, fim, ctx.usuario.id]));
  await auditar(c, ctx, { acao: 'plantao.criado', entidade: 'plantao', entidadeId: p.id, depois: { equipe: eq.nome, pessoa: u.nome, inicio, fim } });
  await publicar(c, ctx, { tipo: 'plantao.criado', agregado: 'equipe', agregadoId: eq.id, payload: { plantaoId: p.id, usuarioId: u.id, inicio, fim } });
  return p;
}

async function cancelarPlantao(c, ctx, id, motivo) {
  const p = uma(await c.query('UPDATE plantoes SET cancelado_em = $2 WHERE id = $1 AND cancelado_em IS NULL RETURNING *', [id, relogio.agora()]));
  if (!p) throw erro.naoEncontrado('Plantão ativo');
  await auditar(c, ctx, { acao: 'plantao.cancelado', entidade: 'plantao', entidadeId: id, motivo });
  await publicar(c, ctx, { tipo: 'plantao.cancelado', agregado: 'equipe', agregadoId: p.equipe_id, payload: { plantaoId: id } });
  return p;
}

async function listarPlantoes(c) {
  const agora = relogio.agora();
  return (await c.query(`SELECT p.id, p.equipe_id, e.nome AS equipe_nome, p.usuario_id, u.nome AS usuario_nome, p.inicio, p.fim,
      (p.inicio <= $1 AND p.fim > $1) AS vigente
    FROM plantoes p JOIN equipes e ON e.id = p.equipe_id JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.cancelado_em IS NULL AND p.fim > $1 ORDER BY p.inicio LIMIT 100`, [agora])).rows;
}

// ---------- SLA por contrato (GOV-008) ----------

async function definirSlaContrato(c, ctx, contaId, sla, motivo) {
  const antes = uma(await c.query('SELECT id, nome, sla_contrato FROM contas WHERE id = $1 AND arquivada_em IS NULL FOR UPDATE', [contaId]));
  if (!antes) throw erro.naoEncontrado('Conta');
  await c.query('UPDATE contas SET sla_contrato = $2 WHERE id = $1', [contaId, sla ? JSON.stringify(sla) : null]);
  await auditar(c, ctx, { acao: 'conta.sla_contrato', entidade: 'conta', entidadeId: contaId, motivo, antes: { sla: antes.sla_contrato }, depois: { sla } });
  await publicar(c, ctx, { tipo: 'conta.sla_contrato_alterado', agregado: 'conta', agregadoId: contaId, payload: { sla } });
  return { contaId, sla };
}

module.exports = {
  PROCESSOS, PAPEIS_RACI, delegar, revogar, listarDelegacoes, registrarExpiracoes, definirRaci, removerRaci, aplicarSugestao, matriz,
  criarPlantao, cancelarPlantao, listarPlantoes, definirSlaContrato, plantonista: vigencia.plantonista,
};
