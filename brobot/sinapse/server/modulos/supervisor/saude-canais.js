'use strict';
// SUP-002: o supervisor detecta o que para em silêncio.
// - Canal em silêncio: WhatsApp ou e-mail que já recebeu mensagens e está sem nada há mais que o limite (horas úteis;
//   padrão 4 h para WhatsApp e 24 h para e-mail; `tenants.config.canais_silencio_horas` muda). Webhook interrompido,
//   número desconectado ou caixa de e-mail parada aparecem assim.
// - Fila de entrada parada: mensagem gravada e não processada há mais de 15 min.
// - Rotina parada: rotina recorrente (lembretes, OMIE, processos…) que foi para a fila de falhas.
// Cada caso vira divergência + tarefa da Supervisão, uma vez por episódio (chave); quando o canal volta, a divergência
// de silêncio é dada como tratada sozinha.

const { uma } = require('../../db');
const { auditar } = require('../../nucleo/registro');
const { relogio, HORA } = require('../../nucleo/relogio');
const { horasUteisEntre } = require('../ocorrencias/sla');

const SILENCIO_PADRAO = { whatsapp: 4, email: 24 };
const NOME = { whatsapp: 'WhatsApp', email: 'e-mail' };
const ENTRADA_PARADA_MIN = 15;

async function divergir(c, ctx, { tipo, descricao, entidadeId, chave }) {
  const d = uma(await c.query(`INSERT INTO divergencias (tenant_id, tipo, descricao, entidade_id, chave) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (tenant_id, chave) DO NOTHING RETURNING id`, [ctx.tenantId, tipo, descricao.slice(0, 500), entidadeId, chave]));
  if (d) await auditar(c, ctx, { acao: 'supervisor.divergencia', entidade: 'divergencia', entidadeId: d.id, depois: { tipo, chave } });
  return !!d;
}

async function verificarCanais(c, ctx, { carregarCalendario, criarTarefa }) {
  const agora = relogio.agora();
  const t = uma(await c.query('SELECT config FROM tenants'));
  const limites = { ...SILENCIO_PADRAO, ...(t?.config?.canais_silencio_horas || {}) };
  const cal = await carregarCalendario(c);
  const resumo = { canaisEmSilencio: 0, entradasParadas: 0, rotinasParadas: 0 };
  const ultimas = (await c.query('SELECT origem, max(recebida_em) AS ultima FROM entradas WHERE origem = ANY($1::text[]) GROUP BY origem',
    [Object.keys(limites)])).rows;
  for (const { origem, ultima } of ultimas) {
    const horas = horasUteisEntre(new Date(ultima), agora, cal);
    if (horas > Number(limites[origem])) {
      const chave = `canal_silencio:${origem}:${new Date(ultima).toISOString()}`;
      if (await divergir(c, ctx, { tipo: 'canal_silencio', entidadeId: origem, chave,
        descricao: `Nenhuma mensagem de ${NOME[origem] || origem} há ${Math.floor(horas)} h úteis (limite ${limites[origem]} h). Confira a conexão do canal e o webhook.` })) {
        await criarTarefa({ tipo: 'geral', equipeCodigo: 'supervisao', chave, prazoEm: new Date(agora.getTime() + HORA),
          titulo: `${NOME[origem] || origem} sem mensagens há ${Math.floor(horas)} h úteis: conferir conexão e webhook` });
        resumo.canaisEmSilencio++;
      }
    } else {
      await c.query("UPDATE divergencias SET estado = 'tratada' WHERE tipo = 'canal_silencio' AND entidade_id = $1 AND estado = 'aberta'", [origem]);
    }
  }
  const parada = uma(await c.query(`SELECT count(*)::int AS n, min(recebida_em) AS desde, (array_agg(id ORDER BY recebida_em))[1] AS primeira
    FROM entradas WHERE estado = 'recebida' AND recebida_em < $1`, [new Date(agora.getTime() - ENTRADA_PARADA_MIN * 60e3)]));
  if (parada.n && await divergir(c, ctx, { tipo: 'entrada_parada', entidadeId: String(parada.primeira), chave: `entrada_parada:${parada.primeira}`,
    descricao: `${parada.n} mensagem(ns) recebida(s) e não processada(s) desde ${new Date(parada.desde).toISOString()}. Veja a fila de falhas no Supervisor.` })) {
    await criarTarefa({ tipo: 'geral', equipeCodigo: 'supervisao', chave: `entrada_parada:${parada.primeira}`, prazoEm: new Date(agora.getTime() + HORA),
      titulo: `${parada.n} mensagem(ns) parada(s) na entrada: conferir o Supervisor` });
    resumo.entradasParadas++;
  }
  for (const j of (await c.query("SELECT id, chave, tipo, concluido_em, ultimo_erro FROM jobs WHERE estado = 'morto' AND chave LIKE 'recorrente:%' LIMIT 20")).rows) {
    const chave = `rotina_parada:${j.chave}:${new Date(j.concluido_em || agora).toISOString()}`;
    if (await divergir(c, ctx, { tipo: 'rotina_parada', entidadeId: j.id, chave,
      descricao: `A rotina ${j.tipo} parou (fila de falhas)${j.ultimo_erro ? `: ${String(j.ultimo_erro).slice(0, 200)}` : ''}. Reprocesse no Supervisor depois de corrigir.` })) {
      await criarTarefa({ tipo: 'geral', equipeCodigo: 'supervisao', chave, prazoEm: new Date(agora.getTime() + HORA), titulo: `Rotina ${j.tipo} parada: reprocessar no Supervisor` });
      resumo.rotinasParadas++;
    }
  }
  return resumo;
}

module.exports = { verificarCanais, SILENCIO_PADRAO };
