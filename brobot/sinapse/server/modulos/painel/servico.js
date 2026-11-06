'use strict';
// Indicadores (seção 13 da especificação, SUP-006): calculados direto das tabelas, sem cópia ou cache.

const { uma } = require('../../db');
const { relogio } = require('../../nucleo/relogio');

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

async function indicadores(c) {
  const agora = relogio.agora();
  const oc = uma(await c.query(
    `SELECT
       count(*) FILTER (WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao'))::int AS ativas,
       count(*) FILTER (WHERE estado = 'triagem')::int AS triagem,
       count(*) FILTER (WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao') AND equipe_id IS NULL)::int AS orfas,
       count(*) FILTER (WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao') AND proxima_acao_em IS NULL)::int AS sem_proxima_acao,
       count(*) FILTER (WHERE estado NOT IN ('resolvida','encerrada_sem_resolucao','aguardando_cliente','aguardando_terceiro') AND prazo_em < $1)::int AS vencidas,
       count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL)::int AS respondidas,
       count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL AND primeira_resposta_em <= sla_resposta_em)::int AS respondidas_no_prazo,
       count(*) FILTER (WHERE estado = 'resolvida')::int AS resolvidas,
       count(*) FILTER (WHERE estado = 'encerrada_sem_resolucao')::int AS encerradas_sem_resolucao
     FROM ocorrencias`, [agora]));
  const porEquipe = (await c.query(
    `SELECT e.nome, count(o.id)::int AS ativas, count(o.id) FILTER (WHERE o.prazo_em < $1 AND o.estado NOT IN ('aguardando_cliente','aguardando_terceiro'))::int AS vencidas
     FROM equipes e LEFT JOIN ocorrencias o ON o.equipe_id = e.id AND o.estado NOT IN ('resolvida','encerrada_sem_resolucao')
     GROUP BY e.nome ORDER BY ativas DESC, e.nome`, [agora])).rows;
  const rod = uma(await c.query(
    `SELECT coalesce(sum(pendencias_detectadas) FILTER (WHERE estado IN ('executada','concluida')),0)::int AS detectadas,
       coalesce(sum(pendencias_corrigidas_ate_d0),0)::int AS corrigidas_d0,
       coalesce(sum(veiculos_total) FILTER (WHERE estado IN ('executada','concluida')),0)::int AS veiculos,
       coalesce(sum(veiculos_sucesso),0)::int AS sucesso,
       count(*) FILTER (WHERE agendada_para > $1)::int AS proximas
     FROM rodadas`, [agora]));
  const pend = uma(await c.query(
    `SELECT count(*) FILTER (WHERE estado IN ('aberta','persistente'))::int AS abertas,
       count(*) FILTER (WHERE estado = 'persistente')::int AS persistentes FROM pendencias`));
  const hand = uma(await c.query(
    `SELECT count(*) FILTER (WHERE estado <> 'pendente')::int AS decididos,
       count(*) FILTER (WHERE estado = 'aceito' AND resolvido_em <= prazo_aceite_em)::int AS aceitos_no_prazo FROM handoffs`));
  const qual = uma(await c.query(
    `SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM pontos_focais p WHERE p.conta_id = c.id AND p.vigente AND p.papel = 'principal'))::int AS sem_ponto_focal,
       count(*)::int AS contas FROM contas c WHERE arquivada_em IS NULL`));
  const integ = uma(await c.query(`SELECT count(*) FILTER (WHERE estado = 'morto')::int AS fila_falhas,
       count(*) FILTER (WHERE estado = 'pendente' AND tentativas > 0)::int AS em_retentativa FROM jobs`));
  const tar = uma(await c.query(
    `SELECT count(*) FILTER (WHERE estado = 'aberta')::int AS abertas, count(*) FILTER (WHERE estado = 'aberta' AND prazo_em < $1)::int AS vencidas FROM tarefas`, [agora]));
  return {
    geradoEm: agora,
    ocorrencias: { ...oc, slaPrimeiraResposta: pct(oc.respondidas_no_prazo, oc.respondidas) },
    porEquipe,
    rodadas: { ...rod, correcaoPreRodada: pct(rod.corrigidas_d0, rod.detectadas), sucessoConsultas: pct(rod.sucesso, rod.veiculos) },
    pendencias: pend,
    handoff: { ...hand, noPrazo: pct(hand.aceitos_no_prazo, hand.decididos) },
    qualidade: qual,
    integracoes: integ,
    tarefas: tar,
  };
}

module.exports = { indicadores };
