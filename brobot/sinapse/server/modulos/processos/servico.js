'use strict';
// Cadastro e versões dos processos (WFL-013, SUP-010, RN-012): rascunho editável → ativar (a versão anterior fica
// "substituída") → desativar ou restaurar uma versão antiga. Versão ativada é imutável (gatilho no banco).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');
const { validarDefinicao } = require('./regras');
const { descrever, descreverPasso, GATILHOS } = require('./catalogo');
const motor = require('./motor');

async function codigosEquipes(c) {
  return (await c.query('SELECT codigo FROM equipes')).rows.map((r) => r.codigo);
}

async function buscar(c, id) {
  const p = uma(await c.query('SELECT * FROM processos WHERE id = $1 AND arquivado_em IS NULL', [id]));
  if (!p) throw erro.naoEncontrado('Processo');
  return p;
}

async function criar(c, ctx, { nome, descricao, definicao, sistema = false }) {
  const def = validarDefinicao(definicao, { equipes: await codigosEquipes(c) });
  const p = uma(await c.query('INSERT INTO processos (tenant_id, nome, descricao, sistema, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [ctx.tenantId, nome, descricao || null, sistema, ctx.usuario?.id || null]));
  await c.query('INSERT INTO processo_versoes (tenant_id, processo_id, versao, definicao, criado_por, nota) VALUES ($1,$2,1,$3,$4,$5)',
    [ctx.tenantId, p.id, JSON.stringify(def), ctx.usuario?.id || null, 'Versão inicial']);
  await auditar(c, ctx, { acao: 'processo.criado', entidade: 'processo', entidadeId: p.id, depois: { nome } });
  return p;
}

/** Salva o rascunho (cria um a partir da versão ativa se ainda não houver). */
async function salvarRascunho(c, ctx, id, { nome, descricao, definicao, nota }) {
  const p = await buscar(c, id);
  const def = validarDefinicao(definicao, { equipes: await codigosEquipes(c) });
  if (nome || descricao !== undefined) {
    await c.query('UPDATE processos SET nome = coalesce($2, nome), descricao = coalesce($3, descricao) WHERE id = $1', [id, nome || null, descricao ?? null]);
  }
  const rasc = uma(await c.query("SELECT id FROM processo_versoes WHERE processo_id = $1 AND estado = 'rascunho'", [id]));
  if (rasc) {
    await c.query('UPDATE processo_versoes SET definicao = $2, nota = coalesce($3, nota), criado_por = $4, criado_em = now() WHERE id = $1',
      [rasc.id, JSON.stringify(def), nota || null, ctx.usuario?.id || null]);
  } else {
    const prox = uma(await c.query('SELECT coalesce(max(versao), 0) + 1 AS v FROM processo_versoes WHERE processo_id = $1', [id])).v;
    await c.query('INSERT INTO processo_versoes (tenant_id, processo_id, versao, definicao, criado_por, nota) VALUES ($1,$2,$3,$4,$5,$6)',
      [ctx.tenantId, id, prox, JSON.stringify(def), ctx.usuario?.id || null, nota || null]);
  }
  await auditar(c, ctx, { acao: 'processo.rascunho_salvo', entidade: 'processo', entidadeId: id, depois: { nome: nome || p.nome } });
  return detalhe(c, id);
}

/** Ativa o rascunho. Execuções em andamento continuam na versão em que começaram. */
async function ativar(c, ctx, id, nota) {
  await buscar(c, id);
  const rasc = uma(await c.query("SELECT * FROM processo_versoes WHERE processo_id = $1 AND estado = 'rascunho' FOR UPDATE", [id]));
  if (!rasc) throw erro.regra('sem_rascunho', 'Não há rascunho para ativar. Edite o processo primeiro.');
  validarDefinicao(rasc.definicao, { equipes: await codigosEquipes(c) }); // equipes podem ter mudado desde o rascunho
  const anterior = uma(await c.query("UPDATE processo_versoes SET estado = 'substituida' WHERE processo_id = $1 AND estado = 'ativa' RETURNING versao", [id]));
  await c.query("UPDATE processo_versoes SET estado = 'ativa', ativada_em = now(), ativada_por = $2, nota = coalesce($3, nota) WHERE id = $1",
    [rasc.id, ctx.usuario?.id || null, nota || null]);
  await auditar(c, ctx, { acao: 'processo.ativado', entidade: 'processo', entidadeId: id, motivo: nota || null,
    antes: anterior ? { versao: anterior.versao } : null, depois: { versao: rasc.versao } });
  await publicar(c, ctx, { tipo: 'processo.ativado', agregado: 'processo', agregadoId: id, payload: { versao: rasc.versao } });
  return detalhe(c, id);
}

async function desativar(c, ctx, id, { motivo, cancelarExecucoes = false }) {
  await buscar(c, id);
  const v = uma(await c.query("UPDATE processo_versoes SET estado = 'desativada' WHERE processo_id = $1 AND estado = 'ativa' RETURNING versao", [id]));
  if (!v) throw erro.regra('ja_inativo', 'Este processo já está desligado.');
  let canceladas = 0;
  if (cancelarExecucoes) {
    for (const e of (await c.query("SELECT * FROM processo_execucoes WHERE processo_id = $1 AND estado IN ('em_andamento','aguardando') FOR UPDATE", [id])).rows) {
      await motor.finalizar(c, ctx, e, 'cancelada', `Processo desligado: ${motivo}`); canceladas++;
    }
  }
  await auditar(c, ctx, { acao: 'processo.desativado', entidade: 'processo', entidadeId: id, motivo, depois: { versao: v.versao, canceladas } });
  return { ...(await detalhe(c, id)), canceladas };
}

/** Restaura uma versão antiga como nova versão ativa (rollback rastreável). */
async function restaurar(c, ctx, id, versao, motivo) {
  await buscar(c, id);
  const antiga = uma(await c.query('SELECT definicao FROM processo_versoes WHERE processo_id = $1 AND versao = $2', [id, versao]));
  if (!antiga) throw erro.naoEncontrado('Versão');
  await salvarRascunho(c, ctx, id, { definicao: antiga.definicao, nota: `Restaurada da versão ${versao}: ${motivo}` });
  return ativar(c, ctx, id, `Restaurada da versão ${versao}: ${motivo}`);
}

async function listar(c) {
  const r = await c.query(
    `SELECT p.id, p.nome, p.descricao, p.sistema,
       a.versao AS versao_ativa, a.definicao AS definicao_ativa, a.ativada_em,
       r.versao AS versao_rascunho, r.definicao AS definicao_rascunho,
       (SELECT count(*)::int FROM processo_execucoes e WHERE e.processo_id = p.id AND e.estado IN ('em_andamento','aguardando')) AS em_andamento,
       (SELECT count(*)::int FROM processo_execucoes e WHERE e.processo_id = p.id AND e.iniciada_em > now() - interval '30 days') AS ultimos_30_dias,
       (SELECT count(*)::int FROM processo_execucoes e WHERE e.processo_id = p.id AND e.estado = 'falhou') AS falhas
     FROM processos p
     LEFT JOIN processo_versoes a ON a.processo_id = p.id AND a.estado = 'ativa'
     LEFT JOIN processo_versoes r ON r.processo_id = p.id AND r.estado = 'rascunho'
     WHERE p.arquivado_em IS NULL ORDER BY p.sistema DESC, p.nome`);
  return r.rows.map((p) => {
    const def = p.definicao_ativa || p.definicao_rascunho;
    return { id: p.id, nome: p.nome, descricao: p.descricao, sistema: p.sistema, ativo: !!p.versao_ativa, versaoAtiva: p.versao_ativa,
      temRascunho: !!p.versao_rascunho, gatilho: def?.gatilho, gatilhoRotulo: GATILHOS[def?.gatilho]?.rotulo, porConta: GATILHOS[def?.gatilho]?.entidade === 'conta',
      resumo: def ? descrever(def) : '', emAndamento: p.em_andamento, ultimos30Dias: p.ultimos_30_dias, falhas: p.falhas, ativadaEm: p.ativada_em };
  });
}

async function detalhe(c, id) {
  const p = await buscar(c, id);
  const versoes = (await c.query(`SELECT v.id, v.versao, v.estado, v.nota, v.criado_em, v.ativada_em, v.definicao, u.nome AS ativada_por_nome
    FROM processo_versoes v LEFT JOIN usuarios u ON u.id = v.ativada_por WHERE v.processo_id = $1 ORDER BY v.versao DESC`, [id])).rows;
  const execucoes = await listarExecucoes(c, { processoId: id });
  return { ...p, versoes: versoes.map((v) => ({ ...v, resumo: descrever(v.definicao) })), execucoes };
}

async function listarExecucoes(c, { processoId, ocorrenciaId, rodadaId, contaId, oportunidadeId, limite = 30 }) {
  const onde = []; const params = [];
  for (const [col, v] of [['e.processo_id', processoId], ['e.ocorrencia_id', ocorrenciaId], ['e.rodada_id', rodadaId], ['e.conta_id', contaId], ['e.oportunidade_id', oportunidadeId]]) {
    if (v) { params.push(v); onde.push(`${col} = $${params.length}`); }
  }
  params.push(Math.min(limite, 100));
  const r = await c.query(
    `SELECT e.id, e.estado, e.passo_atual, e.espera_ate, e.motivo, e.iniciada_em, e.finalizada_em, e.ocorrencia_id, e.rodada_id,
       p.nome AS processo_nome, v.versao, v.definicao, c.nome AS conta_nome, o.protocolo
     FROM processo_execucoes e JOIN processos p ON p.id = e.processo_id JOIN processo_versoes v ON v.id = e.versao_id
     LEFT JOIN contas c ON c.id = e.conta_id LEFT JOIN ocorrencias o ON o.id = e.ocorrencia_id
     ${onde.length ? `WHERE ${onde.join(' AND ')}` : ''} ORDER BY e.iniciada_em DESC LIMIT $${params.length}`, params);
  if (!r.rows.length) return [];
  const logs = (await c.query('SELECT execucao_id, passo, tipo, resultado, detalhe, criado_em FROM processo_passos_log WHERE execucao_id = ANY($1) ORDER BY id',
    [r.rows.map((x) => x.id)])).rows;
  return r.rows.map(({ definicao, ...e }) => ({
    ...e,
    registro: logs.filter((l) => l.execucao_id === e.id),
    // Próximos passos previstos (para a pessoa ver o que ainda vai acontecer).
    proximos: ['em_andamento', 'aguardando'].includes(e.estado) ? definicao.passos.slice(e.passo_atual + (e.estado === 'aguardando' ? 1 : 0)).map(descreverPasso) : [],
  }));
}

async function cancelarExecucao(c, ctx, id, motivo) {
  const e = uma(await c.query("SELECT * FROM processo_execucoes WHERE id = $1 AND estado IN ('em_andamento','aguardando') FOR UPDATE", [id]));
  if (!e) throw erro.naoEncontrado('Execução em andamento');
  await motor.finalizar(c, ctx, e, 'cancelada', `Cancelada por ${ctx.usuario?.nome || 'sistema'}: ${motivo}`);
  await auditar(c, ctx, { acao: 'processo.execucao_cancelada', entidade: 'processo', entidadeId: e.processo_id, motivo });
  return { ok: true };
}

/** Escolhe um item real para simular, conforme o tipo de gatilho. */
async function alvoParaSimular(c, definicao, alvoId) {
  const ent = GATILHOS[definicao?.gatilho]?.entidade;
  if (ent === 'ocorrencia') {
    const o = uma(await c.query(`SELECT id, conta_id, protocolo AS rotulo FROM ocorrencias WHERE ${alvoId ? 'id = $1' : "estado NOT IN ('resolvida','encerrada_sem_resolucao') AND $1::uuid IS NULL"} ORDER BY criado_em DESC LIMIT 1`, [alvoId || null]));
    return o && { ocorrencia_id: o.id, conta_id: o.conta_id, rotulo: o.rotulo };
  }
  if (ent === 'rodada') {
    const r = uma(await c.query(`SELECT r.id, r.conta_id, c.nome || ' · ' || r.produto AS rotulo FROM rodadas r JOIN contas c ON c.id = r.conta_id
      WHERE ${alvoId ? 'r.id = $1' : '$1::uuid IS NULL'} ORDER BY (r.estado = 'com_pendencias') DESC, r.agendada_para LIMIT 1`, [alvoId || null]));
    return r && { rodada_id: r.id, conta_id: r.conta_id, rotulo: r.rotulo };
  }
  const ct = uma(await c.query(`SELECT id, nome AS rotulo FROM contas WHERE ${alvoId ? 'id = $1' : '$1::uuid IS NULL'} AND arquivada_em IS NULL ORDER BY vip DESC, nome LIMIT 1`, [alvoId || null]));
  return ct && { conta_id: ct.id, rotulo: ct.rotulo };
}

async function simular(c, { definicao, alvoId }) {
  const def = validarDefinicao(definicao, { equipes: await codigosEquipes(c) });
  const alvo = await alvoParaSimular(c, def, alvoId);
  if (!alvo) throw erro.regra('sem_item', 'Não há nenhum item para simular este gatilho ainda.');
  return { alvo: alvo.rotulo, descricao: descrever(def), ...(await motor.simular(c, def, alvo)), simuladoEm: relogio.agora() };
}

module.exports = { criar, salvarRascunho, ativar, desativar, restaurar, listar, detalhe, listarExecucoes, cancelarExecucao, simular };
