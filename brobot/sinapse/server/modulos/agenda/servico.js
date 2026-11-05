'use strict';
// "Meu dia", lembretes e central de notificações.
// Lembrete é de uma pessoa ou de uma equipe, pode repetir (diária, dias úteis, semanal, mensal) e ser adiado.
// O job `lembretes.avisar` (a cada minuto) transforma lembrete vencido, escalonamento e transferência pendente
// em notificação — uma por pessoa e por fato (chave única), sem repetir a cada minuto.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar } = require('../../nucleo/registro');
const { relogio, HORA, DIA } = require('../../nucleo/relogio');

const RECORRENCIAS = { diaria: 'Todo dia', dias_uteis: 'Dias úteis', semanal: 'Toda semana', mensal: 'Todo mês' };

function proximaOcorrencia(quando, recorrencia) {
  const d = new Date(quando);
  if (recorrencia === 'diaria') return new Date(d.getTime() + DIA);
  if (recorrencia === 'semanal') return new Date(d.getTime() + 7 * DIA);
  if (recorrencia === 'mensal') { const m = new Date(d); m.setUTCMonth(m.getUTCMonth() + 1); return m; }
  if (recorrencia === 'dias_uteis') {
    let n = new Date(d.getTime() + DIA);
    while ([0, 6].includes(new Date(n.getTime() - 3 * HORA).getUTCDay())) n = new Date(n.getTime() + DIA);
    return n;
  }
  return null;
}

async function criarLembrete(c, ctx, d) {
  if (!d.titulo || String(d.titulo).trim().length < 2) throw erro.entrada('Escreva o lembrete.', [{ campo: 'titulo', problema: 'obrigatório' }]);
  if (!d.quando) throw erro.entrada('Informe quando lembrar.', [{ campo: 'quando', problema: 'obrigatório' }]);
  let equipeId = null;
  if (d.equipeCodigo) {
    equipeId = uma(await c.query('SELECT id FROM equipes WHERE codigo = $1', [d.equipeCodigo]))?.id;
    if (!equipeId) throw erro.entrada('Equipe inexistente.');
  }
  const usuarioId = equipeId ? null : d.usuarioId || ctx.usuario?.id;
  if (!usuarioId && !equipeId) throw erro.entrada('O lembrete precisa de uma pessoa ou equipe.');
  const l = uma(await c.query(
    `INSERT INTO lembretes (tenant_id, usuario_id, equipe_id, titulo, detalhe, quando, recorrencia, ocorrencia_id, conta_id, oportunidade_id, execucao_id, chave, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (tenant_id, chave) DO NOTHING RETURNING *`,
    [ctx.tenantId, usuarioId, equipeId, String(d.titulo).trim().slice(0, 200), d.detalhe || null, d.quando, d.recorrencia || null, d.ocorrenciaId || null,
      d.contaId || null, d.oportunidadeId || null, d.execucaoId || null, d.chave || null, ctx.usuario?.id || null]));
  return l;
}

/** O lembrete é da pessoa ou da equipe dela (ou ela é gestora). */
async function meuLembrete(c, usuario, id) {
  const l = uma(await c.query('SELECT * FROM lembretes WHERE id = $1 FOR UPDATE', [id]));
  const gestor = ['supervisor', 'admin'].includes(usuario.papel);
  if (!l || (!gestor && l.usuario_id !== usuario.id && l.equipe_id !== usuario.equipe_id)) throw erro.naoEncontrado('Lembrete');
  if (l.estado !== 'ativo') throw erro.conflito('Este lembrete já foi concluído ou cancelado.');
  return l;
}

/** Concluir: recorrente avança para a próxima data; simples encerra. */
async function concluirLembrete(c, ctx, id) {
  const l = await meuLembrete(c, ctx.usuario, id);
  const prox = proximaOcorrencia(l.quando, l.recorrencia);
  if (prox) {
    let p = prox; const agora = relogio.agora();
    while (p < agora) p = proximaOcorrencia(p, l.recorrencia);
    await c.query('UPDATE lembretes SET quando = $2, avisado_para = NULL, adiamentos = 0 WHERE id = $1', [id, p]);
    return { proximo: p };
  }
  await c.query("UPDATE lembretes SET estado = 'concluido', concluido_em = $2 WHERE id = $1", [id, relogio.agora()]);
  return { concluido: true };
}

async function adiarLembrete(c, ctx, id, horas) {
  const l = await meuLembrete(c, ctx.usuario, id);
  if (!(horas > 0 && horas <= 24 * 14)) throw erro.entrada('Adie entre 1 hora e 14 dias.');
  const novo = new Date(Math.max(relogio.agora().getTime(), new Date(l.quando).getTime()) + horas * HORA);
  await c.query('UPDATE lembretes SET quando = $2, avisado_para = NULL, adiamentos = adiamentos + 1 WHERE id = $1', [id, novo]);
  if (l.adiamentos + 1 >= 3) {
    await auditar(c, ctx, { acao: 'lembrete.adiado_varias_vezes', entidade: 'lembrete', entidadeId: id, depois: { vezes: l.adiamentos + 1, titulo: l.titulo } });
  }
  return { quando: novo };
}

async function cancelarLembrete(c, ctx, id) {
  await meuLembrete(c, ctx.usuario, id);
  await c.query("UPDATE lembretes SET estado = 'cancelado', concluido_em = $2 WHERE id = $1", [id, relogio.agora()]);
  return { ok: true };
}

async function notificar(c, ctx, usuarioIds, { titulo, texto, link, gravidade = 'info', chave }) {
  for (const u of [...new Set(usuarioIds)]) {
    await c.query(`INSERT INTO notificacoes (tenant_id, usuario_id, titulo, texto, link, gravidade, chave) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (tenant_id, usuario_id, chave) DO NOTHING`, [ctx.tenantId, u, titulo.slice(0, 200), texto ? texto.slice(0, 500) : null, link || null, gravidade, chave]);
  }
}

const membros = async (c, equipeId) => (await c.query('SELECT id FROM usuarios WHERE equipe_id = $1 AND ativo', [equipeId])).rows.map((r) => r.id);

/** Job a cada minuto. */
async function jobAvisar(c, ctx) {
  const agora = relogio.agora();
  for (const l of (await c.query(`SELECT * FROM lembretes WHERE estado = 'ativo' AND quando <= $1 AND (avisado_para IS NULL OR avisado_para < quando) LIMIT 200`, [agora])).rows) {
    const para = l.usuario_id ? [l.usuario_id] : await membros(c, l.equipe_id);
    const link = l.ocorrencia_id ? `#/ocorrencias/${l.ocorrencia_id}` : l.oportunidade_id ? `#/comercial/${l.oportunidade_id}` : l.conta_id ? `#/contas/${l.conta_id}` : '#/meu-dia';
    await notificar(c, ctx, para, { titulo: `⏰ ${l.titulo}`, texto: l.detalhe, link, gravidade: 'alerta', chave: `lembrete:${l.id}:${new Date(l.quando).toISOString()}` });
    await c.query('UPDATE lembretes SET avisado_para = quando WHERE id = $1', [l.id]);
  }
  for (const t of (await c.query(`SELECT id, titulo, equipe_id, ocorrencia_id FROM tarefas WHERE tipo = 'escalonamento' AND estado = 'aberta'
      AND criado_em > now() - interval '2 days' LIMIT 100`)).rows) {
    await notificar(c, ctx, await membros(c, t.equipe_id), { titulo: '🚨 Escalonamento', texto: t.titulo, gravidade: 'critica',
      link: t.ocorrencia_id ? `#/ocorrencias/${t.ocorrencia_id}` : '#/tarefas', chave: `esc:${t.id}` });
  }
  for (const h of (await c.query(`SELECT h.id, h.para_equipe_id, o.id AS oc, o.protocolo, o.titulo FROM handoffs h JOIN ocorrencias o ON o.id = h.ocorrencia_id
      WHERE h.estado = 'pendente' LIMIT 100`)).rows) {
    await notificar(c, ctx, await membros(c, h.para_equipe_id), { titulo: '↪ Transferência para sua equipe', texto: `${h.protocolo} · ${h.titulo}`,
      gravidade: 'alerta', link: `#/ocorrencias/${h.oc}`, chave: `handoff:${h.id}` });
  }
  return { proximaEm: new Date(agora.getTime() + 60e3) };
}

async function notificacoes(c, usuario) {
  const itens = (await c.query('SELECT id, titulo, texto, link, gravidade, lida_em, criado_em FROM notificacoes WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 30', [usuario.id])).rows;
  const naoLidas = uma(await c.query('SELECT count(*)::int AS n FROM notificacoes WHERE usuario_id = $1 AND lida_em IS NULL', [usuario.id])).n;
  return { itens, naoLidas };
}

async function marcarLidas(c, usuario, ids) {
  if (ids === 'todas') await c.query('UPDATE notificacoes SET lida_em = now() WHERE usuario_id = $1 AND lida_em IS NULL', [usuario.id]);
  else await c.query('UPDATE notificacoes SET lida_em = now() WHERE usuario_id = $1 AND id = ANY($2) AND lida_em IS NULL', [usuario.id, ids]);
  return notificacoes(c, usuario);
}

/** Tudo o que pede a atenção da pessoa hoje, numa chamada. */
async function meuDia(c, usuario) {
  const agora = relogio.agora();
  const fimDoDia = (() => { const l = new Date(agora.getTime() - 3 * HORA); return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + 1, 3)); })();
  const tarefas = (await c.query(
    `SELECT t.id, t.tipo, t.titulo, t.prazo_em, t.ocorrencia_id, t.oportunidade_id, o.protocolo, ct.nome AS conta_nome, (t.responsavel_id = $1) AS minha
     FROM tarefas t LEFT JOIN ocorrencias o ON o.id = t.ocorrencia_id LEFT JOIN contas ct ON ct.id = o.conta_id
     WHERE t.estado = 'aberta' AND (t.responsavel_id = $1 OR (t.responsavel_id IS NULL AND t.equipe_id = $2)) AND t.prazo_em < $3
     ORDER BY t.prazo_em LIMIT 50`, [usuario.id, usuario.equipe_id, new Date(fimDoDia.getTime() + 2 * DIA)])).rows;
  const ocorrencias = (await c.query(
    `SELECT o.id, o.protocolo, o.titulo, o.estado, o.prioridade, o.proxima_acao, o.proxima_acao_em, o.prazo_em, ct.nome AS conta_nome, ct.vip, (o.responsavel_id = $1) AS minha
     FROM ocorrencias o LEFT JOIN contas ct ON ct.id = o.conta_id
     WHERE o.estado NOT IN ('resolvida','encerrada_sem_resolucao') AND (o.responsavel_id = $1 OR (o.responsavel_id IS NULL AND o.equipe_id = $2))
       AND o.proxima_acao_em < $3 ORDER BY o.proxima_acao_em LIMIT 50`, [usuario.id, usuario.equipe_id, fimDoDia])).rows;
  const aguardando = (await c.query(
    `SELECT o.id, o.protocolo, o.titulo, o.estado, o.proxima_acao_em, ct.nome AS conta_nome FROM ocorrencias o LEFT JOIN contas ct ON ct.id = o.conta_id
     WHERE o.estado IN ('aguardando_cliente','aguardando_terceiro') AND o.responsavel_id = $1 ORDER BY o.proxima_acao_em LIMIT 30`, [usuario.id])).rows;
  const transferencias = (await c.query(
    `SELECT h.id, h.prazo_aceite_em, h.motivo, o.id AS ocorrencia_id, o.protocolo, o.titulo, de.nome AS de_nome FROM handoffs h
     JOIN ocorrencias o ON o.id = h.ocorrencia_id JOIN equipes de ON de.id = h.de_equipe_id
     WHERE h.estado = 'pendente' AND h.para_equipe_id = $1 ORDER BY h.prazo_aceite_em LIMIT 30`, [usuario.equipe_id])).rows;
  const lembretes = (await c.query(
    `SELECT id, titulo, detalhe, quando, recorrencia, adiamentos, ocorrencia_id, conta_id, oportunidade_id, (usuario_id IS NULL) AS da_equipe
     FROM lembretes WHERE estado = 'ativo' AND (usuario_id = $1 OR equipe_id = $2) AND quando < $3 ORDER BY quando LIMIT 50`,
    [usuario.id, usuario.equipe_id, new Date(fimDoDia.getTime() + 7 * DIA)])).rows;
  const oportunidades = (await c.query(
    `SELECT id, codigo, empresa, etapa, proxima_acao, proxima_acao_em, teste_fim FROM oportunidades
     WHERE etapa NOT IN ('ganha','perdida') AND responsavel_id = $1 AND proxima_acao_em < $2 ORDER BY proxima_acao_em LIMIT 30`, [usuario.id, fimDoDia])).rows;
  const atrasado = (x) => new Date(x) < agora;
  return {
    agora, fimDoDia,
    resumo: {
      atrasados: tarefas.filter((t) => atrasado(t.prazo_em)).length + ocorrencias.filter((o) => atrasado(o.proxima_acao_em)).length
        + lembretes.filter((l) => atrasado(l.quando)).length + oportunidades.filter((o) => atrasado(o.proxima_acao_em)).length,
      hoje: tarefas.filter((t) => !atrasado(t.prazo_em) && new Date(t.prazo_em) < fimDoDia).length + ocorrencias.filter((o) => !atrasado(o.proxima_acao_em)).length,
      transferencias: transferencias.length, aguardando: aguardando.length,
    },
    tarefas, ocorrencias, aguardando, transferencias, lembretes, oportunidades,
  };
}

module.exports = { RECORRENCIAS, proximaOcorrencia, criarLembrete, concluirLembrete, adiarLembrete, cancelarLembrete, notificar, jobAvisar,
  notificacoes, marcarLidas, meuDia };
