'use strict';
// Tarefas: sempre com fila (equipe) e prazo (GOV-004); responsável opcional e resolvido com substituto.
// Concluir exige resultado registrado (PRE-007: tentativa/resultado da ligação).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { publicar, auditar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');
const identidade = require('../identidade/servico');

const TIPOS = { ligacao: 'Ligação', revisar_espera: 'Revisar espera', escalonamento: 'Escalonamento', validar_correcao: 'Validar correção', geral: 'Tarefa' };

async function criar(c, ctx, d) {
  const equipe = d.equipeId || (await identidade.equipePorCodigo(c, d.equipeCodigo))?.id;
  if (!equipe) throw erro.regra('sem_fila', 'Toda tarefa precisa de uma equipe responsável (fila de contingência).');
  const responsavel = await identidade.resolverResponsavel(c, d.responsavelId);
  const t = uma(await c.query(
    `INSERT INTO tarefas (tenant_id, ocorrencia_id, rodada_id, tipo, titulo, equipe_id, responsavel_id, prazo_em, chave)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id, chave) DO NOTHING RETURNING *`,
    [ctx.tenantId, d.ocorrenciaId || null, d.rodadaId || null, d.tipo, d.titulo.slice(0, 200), equipe, responsavel, d.prazoEm, d.chave || null],
  ));
  if (t) {
    await publicar(c, ctx, { tipo: 'tarefa.criada', agregado: 'tarefa', agregadoId: t.id, chave: `tarefa.criada:${t.id}`,
      payload: { tipo: t.tipo, ocorrenciaId: t.ocorrencia_id } });
  }
  return t;
}

async function concluir(c, ctx, id, resultado) {
  const t = uma(await c.query('SELECT * FROM tarefas WHERE id = $1 FOR UPDATE', [id]));
  if (!t) throw erro.naoEncontrado('Tarefa');
  if (t.estado !== 'aberta') throw erro.conflito('Esta tarefa já foi concluída ou cancelada.');
  const r = uma(await c.query(
    "UPDATE tarefas SET estado = 'concluida', resultado = $2, concluida_por = $3, concluida_em = $4 WHERE id = $1 RETURNING *",
    [id, resultado, ctx.usuario?.id || null, relogio.agora()],
  ));
  if (t.tipo === 'ligacao') {
    await c.query("UPDATE contatos_programados SET estado = 'concluido', motivo = $2, atualizado_em = now() WHERE tarefa_id = $1", [id, resultado.slice(0, 200)]);
  }
  await auditar(c, ctx, { acao: 'tarefa.concluida', entidade: t.ocorrencia_id ? 'ocorrencia' : 'tarefa', entidadeId: t.ocorrencia_id || id,
    depois: { tarefa: t.titulo, resultado } });
  await publicar(c, ctx, { tipo: 'tarefa.concluida', agregado: 'tarefa', agregadoId: id, chave: `tarefa.concluida:${id}`, payload: { tipo: t.tipo } });
  return r;
}

async function listar(c, usuario, { minhas, pagina = 1 } = {}) {
  const params = [];
  let filtro = "t.estado = 'aberta'";
  if (minhas) { params.push(usuario.id, usuario.equipe_id); filtro += ' AND (t.responsavel_id = $1 OR (t.responsavel_id IS NULL AND t.equipe_id = $2))'; }
  params.push(30, (Math.max(1, pagina) - 1) * 30);
  const r = await c.query(
    `SELECT t.*, e.nome AS equipe_nome, u.nome AS responsavel_nome, o.protocolo, c.nome AS conta_nome, count(*) OVER()::int AS total
     FROM tarefas t JOIN equipes e ON e.id = t.equipe_id LEFT JOIN usuarios u ON u.id = t.responsavel_id
     LEFT JOIN ocorrencias o ON o.id = t.ocorrencia_id LEFT JOIN contas c ON c.id = o.conta_id
     WHERE ${filtro} ORDER BY t.prazo_em LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
  );
  return { itens: r.rows.map(({ total, ...t }) => t), total: r.rows[0]?.total || 0, pagina };
}

module.exports = { TIPOS, criar, concluir, listar };
