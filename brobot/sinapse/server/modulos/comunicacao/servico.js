'use strict';
// Envio de mensagens (COM-004 a COM-007, AT-007): canal escolhido pelo consentimento, opt-out respeitado,
// janela de horário, envio assíncrono pela fila de jobs com retentativa e canal alternativo (e-mail) quando o
// WhatsApp falha repetidamente. Toda mensagem vira uma interação com status de entrega.

const { uma } = require('../../db');
const { enfileirar } = require('../../jobs/fila');
const { publicar, auditar } = require('../../nucleo/registro');
const { relogio, HORA } = require('../../nucleo/relogio');
const modelosServico = require('./modelos-servico');
const mensageria = require('../integracoes/mensageria');

const JANELA = { inicio: 8, fim: 20, fusoMinutos: -180 };
const TENTATIVAS_ANTES_DO_FALLBACK = 3;

/** COM-004: canal permitido para o ponto focal, ou null com o motivo. */
function escolherCanal(pf, preferido) {
  if (!pf) return { canal: null, motivo: 'Conta sem ponto focal vigente.' };
  if (pf.opt_out) return { canal: null, motivo: 'Ponto focal pediu para não receber mensagens (opt-out).' };
  const querWhats = (preferido || pf.canal_preferido) === 'whatsapp';
  if (querWhats && pf.telefone && pf.consentimento_whatsapp) return { canal: 'whatsapp', para: pf.telefone };
  if (pf.email) return { canal: 'email', para: pf.email };
  if (pf.telefone && pf.consentimento_whatsapp) return { canal: 'whatsapp', para: pf.telefone };
  return { canal: null, motivo: 'Ponto focal sem canal autorizado (sem e-mail e sem consentimento de WhatsApp).' };
}

/** Próximo horário dentro da janela de envio (8h–20h, horário de Brasília). */
function proximaJanela(agora) {
  const off = JANELA.fusoMinutos * 60e3;
  const local = new Date(agora.getTime() + off);
  const h = local.getUTCHours();
  if (h >= JANELA.inicio && h < JANELA.fim) return null;
  const alvo = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + (h >= JANELA.fim ? 1 : 0), JANELA.inicio));
  return new Date(alvo.getTime() - off);
}

/**
 * Programa uma mensagem. `modelo` + `variaveis` (ou texto livre em resposta_atendimento).
 * Devolve a interação criada (status enfileirada ou bloqueada).
 */
async function programarEnvio(c, ctx, { contaId, ocorrenciaId = null, pontoFocal, grupo = null, modelo, variaveis, canalPreferido,
  contatoProgramadoId = null, executarEm, fallback = true }) {
  const { texto, modelo: mv, template } = await modelosServico.renderizarAtual(c, modelo, variaveis);
  // Grupo do cliente (WhatsApp): canal operacional combinado com o cliente; sem canal alternativo.
  const escolha = grupo ? { canal: 'whatsapp', para: grupo } : escolherCanal(pontoFocal, canalPreferido);
  const status = escolha.canal ? 'enfileirada' : 'bloqueada';
  const it = uma(await c.query(
    `INSERT INTO interacoes (tenant_id, ocorrencia_id, conta_id, canal, direcao, destinatario, texto, modelo, status_entrega, autor_id, variaveis)
     VALUES ($1, $2, $3, $4, 'saida', $5, $6, $7, $8, $9, $10) RETURNING *`,
    [ctx.tenantId, ocorrenciaId, contaId, escolha.canal || 'interno', escolha.para || null, texto, mv, status, ctx.usuario?.id || null,
      template ? JSON.stringify({ template }) : null],
  ));
  if (!escolha.canal) {
    await auditar(c, ctx, { acao: 'mensagem.bloqueada', entidade: 'interacao', entidadeId: it.id, motivo: escolha.motivo });
    return { ...it, motivoBloqueio: escolha.motivo };
  }
  await enfileirar(c, ctx, {
    tipo: 'comunicacao.enviar', chave: `enviar:${it.id}`, executarEm, maxTentativas: 6,
    payload: { interacaoId: it.id, pontoFocalId: grupo ? null : pontoFocal.id, fallback: fallback && !grupo, contatoProgramadoId },
  });
  return it;
}

/** Handler do job `comunicacao.enviar`. Envio em duas fases (R-20): nesta transação a interação passa a "enviando"
 *  (confirmada antes de qualquer chamada ao provedor); o envio e a confirmação "enviada" rodam depois, em transação
 *  própria. Provedor recusou (erro) → volta a "enfileirada" e o job tenta de novo. Processo caiu entre o envio e a
 *  confirmação → fica "enviando" e o supervisor marca "incerta" (nunca reenvia sozinho: o cliente receberia duas vezes). */
async function jobEnviar(c, ctx, { interacaoId, pontoFocalId, fallback, contatoProgramadoId }, job, { db } = {}) {
  const it = uma(await c.query('SELECT * FROM interacoes WHERE id = $1 FOR UPDATE', [interacaoId]));
  if (!it || it.status_entrega !== 'enfileirada') return {}; // já enviada, em envio, incerta ou cancelada: idempotente
  const adiar = proximaJanela(relogio.agora());
  if (adiar) return { adiarPara: adiar };
  let { canal, destinatario } = it;
  if (canal === 'whatsapp' && fallback && job.tentativas > TENTATIVAS_ANTES_DO_FALLBACK) {
    // COM-006: WhatsApp falhou repetidamente → canal alternativo autorizado.
    const pf = uma(await c.query('SELECT email, opt_out FROM pontos_focais WHERE id = $1', [pontoFocalId]));
    if (pf && pf.email && !pf.opt_out) {
      canal = 'email';
      destinatario = pf.email;
      await auditar(c, ctx, { acao: 'mensagem.canal_alternativo', entidade: 'interacao', entidadeId: it.id,
        antes: { canal: 'whatsapp' }, depois: { canal: 'email' }, motivo: `WhatsApp falhou ${job.tentativas - 1} vezes` });
    }
  }
  await c.query("UPDATE interacoes SET status_entrega = 'enviando', envio_iniciado_em = $2, canal = $3, destinatario = $4 WHERE id = $1",
    [it.id, relogio.agora(), canal, destinatario]);
  if (!db) throw new Error('Envio sem acesso ao banco para a segunda fase.');
  return { depois: () => enviarAgora(db, ctx, { it, canal, destinatario, contatoProgramadoId }) };
}

/** Segunda fase: chama o provedor e, na mesma transação, confirma "enviada". Erro do provedor = não saiu. */
async function enviarAgora(db, ctx, { it, canal, destinatario, contatoProgramadoId }) {
  try {
    await db.comoTenant(ctx.tenantId, async (c) => {
      const r = await mensageria.enviar(c, canal, { para: destinatario, texto: it.texto, template: canal === 'whatsapp' ? it.variaveis?.template : undefined });
      await c.query("UPDATE interacoes SET status_entrega = 'enviada', id_externo = $2 WHERE id = $1 AND status_entrega = 'enviando'", [it.id, r.idExterno]);
      if (contatoProgramadoId) {
        await c.query("UPDATE contatos_programados SET estado = 'enviado', interacao_id = $2, atualizado_em = now() WHERE id = $1 AND estado = 'programado'",
          [contatoProgramadoId, it.id]);
      }
      await publicar(c, ctx, { tipo: 'mensagem.enviada', agregado: 'interacao', agregadoId: it.id, chave: `mensagem.enviada:${it.id}`,
        payload: { canal, modelo: it.modelo, ocorrenciaId: it.ocorrencia_id } });
    });
  } catch (e) {
    if (e && e.envioIncerto) throw e; // o provedor pode ter recebido: fica "enviando" para o supervisor tratar
    await db.comoTenant(ctx.tenantId, (c) => c.query(
      "UPDATE interacoes SET status_entrega = 'enfileirada', envio_iniciado_em = NULL, erro_entrega = $2 WHERE id = $1 AND status_entrega = 'enviando'",
      [it.id, String(e && e.message ? e.message : e).slice(0, 300)]));
    throw e; // o worker reprograma o job (com backoff, canal alternativo e fila de falhas)
  }
}

const ENVIO_INCERTO_MINUTOS = 10;

/** Supervisor (R-20): envio que começou e não foi confirmado vira "incerta" e uma tarefa para alguém conferir no canal.
 *  Nada é reenviado sozinho. */
async function verificarEnviosIncertos(c, ctx, { criarTarefa }) {
  const presos = (await c.query(`SELECT i.id, i.canal, i.destinatario, i.ocorrencia_id, i.modelo, ct.nome AS conta FROM interacoes i
    LEFT JOIN contas ct ON ct.id = i.conta_id
    WHERE i.status_entrega = 'enviando' AND i.envio_iniciado_em < $1::timestamptz - make_interval(mins => $2) LIMIT 100`,
  [relogio.agora(), ENVIO_INCERTO_MINUTOS])).rows;
  for (const p of presos) {
    await c.query("UPDATE interacoes SET status_entrega = 'incerta', erro_entrega = 'Envio iniciado sem confirmação do provedor' WHERE id = $1 AND status_entrega = 'enviando'", [p.id]);
    await auditar(c, ctx, { acao: 'mensagem.envio_incerto', entidade: 'interacao', entidadeId: p.id, motivo: 'O envio começou e não foi confirmado (queda ou falha no meio)',
      depois: { canal: p.canal, modelo: p.modelo } });
    await criarTarefa({ tipo: 'geral', equipeCodigo: 'supervisao', ocorrenciaId: p.ocorrencia_id || null, chave: `msg-incerta:${p.id}`,
      titulo: `Conferir se a mensagem (${p.canal}) para ${p.conta || p.destinatario} chegou; reenviar só se não chegou`,
      prazoEm: new Date(relogio.agora().getTime() + 2 * HORA) });
  }
  return presos.length;
}

/** Quando o envio esgota as tentativas (fila de falhas): marca a interação e o contato como falhos. */
async function aoFalharEnvio(c, payload) {
  await c.query("UPDATE interacoes SET status_entrega = 'falhou' WHERE id = $1 AND status_entrega = 'enfileirada'", [payload.interacaoId]);
  if (payload.contatoProgramadoId) {
    await c.query("UPDATE contatos_programados SET estado = 'falhou', motivo = 'Envio esgotou as tentativas', atualizado_em = now() WHERE id = $1",
      [payload.contatoProgramadoId]);
  }
}

module.exports = { escolherCanal, proximaJanela, programarEnvio, jobEnviar, enviarAgora, verificarEnviosIncertos, aoFalharEnvio, ENVIO_INCERTO_MINUTOS, HORA };
