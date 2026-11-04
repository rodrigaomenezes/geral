'use strict';
// Envio de mensagens (COM-004 a COM-007, AT-007): canal escolhido pelo consentimento, opt-out respeitado,
// janela de horário, envio assíncrono pela fila de jobs com retentativa e canal alternativo (e-mail) quando o
// WhatsApp falha repetidamente. Toda mensagem vira uma interação com status de entrega.

const { uma } = require('../../db');
const { enfileirar } = require('../../jobs/fila');
const { publicar, auditar } = require('../../nucleo/registro');
const { relogio, HORA } = require('../../nucleo/relogio');
const { renderizar } = require('./modelos');
const mensageria = require('../integracoes/mensageria-demo');

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
async function programarEnvio(c, ctx, { contaId, ocorrenciaId = null, pontoFocal, modelo, variaveis, canalPreferido,
  contatoProgramadoId = null, executarEm, fallback = true }) {
  const { texto, modelo: mv } = renderizar(modelo, variaveis);
  const escolha = escolherCanal(pontoFocal, canalPreferido);
  const status = escolha.canal ? 'enfileirada' : 'bloqueada';
  const it = uma(await c.query(
    `INSERT INTO interacoes (tenant_id, ocorrencia_id, conta_id, canal, direcao, destinatario, texto, modelo, status_entrega, autor_id)
     VALUES ($1, $2, $3, $4, 'saida', $5, $6, $7, $8, $9) RETURNING *`,
    [ctx.tenantId, ocorrenciaId, contaId, escolha.canal || 'interno', escolha.para || null, texto, mv, status, ctx.usuario?.id || null],
  ));
  if (!escolha.canal) {
    await auditar(c, ctx, { acao: 'mensagem.bloqueada', entidade: 'interacao', entidadeId: it.id, motivo: escolha.motivo });
    return { ...it, motivoBloqueio: escolha.motivo };
  }
  await enfileirar(c, ctx, {
    tipo: 'comunicacao.enviar', chave: `enviar:${it.id}`, executarEm, maxTentativas: 6,
    payload: { interacaoId: it.id, pontoFocalId: pontoFocal.id, fallback, contatoProgramadoId },
  });
  return it;
}

/** Handler do job `comunicacao.enviar`. */
async function jobEnviar(c, ctx, { interacaoId, pontoFocalId, fallback, contatoProgramadoId }, job) {
  const it = uma(await c.query('SELECT * FROM interacoes WHERE id = $1', [interacaoId]));
  if (!it || it.status_entrega !== 'enfileirada') return {}; // já enviada ou cancelada: idempotente
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
  const r = await mensageria.enviar(c, canal, { para: destinatario, texto: it.texto });
  await c.query("UPDATE interacoes SET status_entrega = 'enviada', id_externo = $2, canal = $3, destinatario = $4 WHERE id = $1",
    [it.id, r.idExterno, canal, destinatario]);
  if (contatoProgramadoId) {
    await c.query("UPDATE contatos_programados SET estado = 'enviado', interacao_id = $2, atualizado_em = now() WHERE id = $1 AND estado = 'programado'",
      [contatoProgramadoId, it.id]);
  }
  await publicar(c, ctx, { tipo: 'mensagem.enviada', agregado: 'interacao', agregadoId: it.id, chave: `mensagem.enviada:${it.id}`,
    payload: { canal, modelo: it.modelo, ocorrenciaId: it.ocorrencia_id } });
  return {};
}

/** Quando o envio esgota as tentativas (fila de falhas): marca a interação e o contato como falhos. */
async function aoFalharEnvio(c, payload) {
  await c.query("UPDATE interacoes SET status_entrega = 'falhou' WHERE id = $1 AND status_entrega = 'enfileirada'", [payload.interacaoId]);
  if (payload.contatoProgramadoId) {
    await c.query("UPDATE contatos_programados SET estado = 'falhou', motivo = 'Envio esgotou as tentativas', atualizado_em = now() WHERE id = $1",
      [payload.contatoProgramadoId]);
  }
}

module.exports = { escolherCanal, proximaJanela, programarEnvio, jobEnviar, aoFalharEnvio, HORA };
