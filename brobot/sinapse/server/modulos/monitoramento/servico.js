'use strict';
// Monitoramento: volumetria de consultas (CSV da Platform), consultas não geradas, robô parado, erro técnico,
// credencial perto de vencer e reincidência. Cada alerta vira no máximo uma ocorrência ativa (alerta_chave, índice
// único no banco); enquanto ela estiver aberta, o alerta repetido não abre outra nem manda aviso de novo (COM-009).

const { uma } = require('../../db');
const { auditar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');
const ocorrencias = require('../ocorrencias/servico');
const { LIMITES, avaliar, diasAte } = require('./regras');

const hojeBrasilia = () => new Date(relogio.agora().getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const AVISO_CREDENCIAL_PADRAO = 15;
const NOME_CRED = { certificado: 'Certificado digital', govbr: 'Conta gov.br', sne: 'Vínculo SNE', portal_detran: 'Portal do Detran' };

/** Abre a ocorrência do alerta, se ainda não houver uma ativa com a mesma chave. Devolve { ocorrencia, nova }. */
async function alertar(c, ctx, d) {
  const ativa = uma(await c.query("SELECT id, protocolo FROM ocorrencias WHERE alerta_chave = $1 AND estado NOT IN ('resolvida','encerrada_sem_resolucao')", [d.chave]));
  if (ativa) return { ocorrencia: ativa, nova: false };
  const equipes = (await c.query('SELECT codigo FROM equipes')).rows.map((r) => r.codigo);
  const oc = await ocorrencias.criar(c, ctx, { origem: 'platform', contaId: d.contaId, tipo: d.tipo, prioridade: d.prioridade || 'media',
    equipeCodigo: d.equipeCodigo && equipes.includes(d.equipeCodigo) ? d.equipeCodigo : undefined, titulo: d.titulo, descricao: d.descricao,
    proximaAcao: d.proximaAcao, alertaChave: d.chave });
  await auditar(c, ctx, { acao: 'monitoramento.alerta', entidade: 'ocorrencia', entidadeId: oc.id, depois: { chave: d.chave, motivo: d.motivo } });
  return { ocorrencia: oc, nova: true };
}

/** Grava a volumetria do arquivo (o mesmo dia reimportado é atualizado: vale o arquivo mais recente). */
async function registrarVolumes(c, ctx, linhas, importacaoId) {
  for (const l of linhas) {
    await c.query(`INSERT INTO consultas_volume (tenant_id, conta_id, produto, dia, esperadas, geradas, erros_tecnicos, erros_usuario, indisponiveis, importacao_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tenant_id, conta_id, produto, dia) DO UPDATE SET esperadas = EXCLUDED.esperadas,
      geradas = EXCLUDED.geradas, erros_tecnicos = EXCLUDED.erros_tecnicos, erros_usuario = EXCLUDED.erros_usuario, indisponiveis = EXCLUDED.indisponiveis,
      importacao_id = EXCLUDED.importacao_id, atualizado_em = now()`,
    [ctx.tenantId, l.contaId, l.produto, l.dia, l.esperadas, l.geradas, l.errosTecnicos, l.errosUsuario, l.indisponiveis, importacaoId || null]);
  }
}

/** Avalia as janelas (conta × produto) tocadas pelo arquivo e abre os alertas que valem. */
async function avaliarConsultas(c, ctx, pares) {
  const resultado = { avaliados: 0, alertasNovos: 0, jaAbertos: 0 };
  for (const { contaId, produto } of pares) {
    const dias = (await c.query(`SELECT dia, esperadas, geradas, erros_tecnicos, erros_usuario, indisponiveis FROM consultas_volume
      WHERE conta_id = $1 AND produto = $2 AND dia > (SELECT max(dia) FROM consultas_volume WHERE conta_id = $1 AND produto = $2) - $3::int
      ORDER BY dia`, [contaId, produto, LIMITES.janelaDias])).rows;
    if (!dias.length) continue;
    resultado.avaliados++;
    const { resumo: r, alertas } = avaliar(dias);
    const conta = uma(await c.query('SELECT nome FROM contas WHERE id = $1', [contaId]));
    const credRuins = (await c.query("SELECT tipo, status FROM credenciais_ref WHERE conta_id = $1 AND status <> 'ok'", [contaId])).rows;
    const causa = credRuins.length ? ` Causa provável: ${credRuins.map((x) => `${NOME_CRED[x.tipo] || x.tipo} (${x.status})`).join(', ')}.` : '';
    const periodo = `de ${r.de.split('-').reverse().join('/')} a ${r.ate.split('-').reverse().join('/')}`;
    for (const a of alertas) {
      const d = {
        sem_execucao: { tipo: 'erro_consulta', titulo: `${produto}: nenhuma consulta gerada há ${LIMITES.diasSemExecucao} dias (${conta.nome})`,
          descricao: `Esperadas ${r.esperadas}, geradas ${r.geradas} ${periodo}. O robô pode ter parado ou perdido o acesso.${causa}`,
          proximaAcao: 'Conferir agendamento e credenciais na Platform' },
        nao_geradas: { tipo: 'erro_consulta', titulo: `${produto}: ${r.faltando} consulta(s) esperada(s) não gerada(s) (${conta.nome})`,
          descricao: `Esperadas ${r.esperadas}, geradas ${r.geradas} ${periodo} (erro invisível: o cliente não vê erro, só deixa de receber).${causa}`,
          proximaAcao: credRuins.length ? 'Pedir a regularização da credencial ao ponto focal' : 'Investigar por que as consultas não foram geradas' },
        erro_tecnico: { tipo: 'tecnica', equipeCodigo: 'dev', titulo: `${produto}: ${r.errosTecnicos} erro(s) técnico(s) de consulta (${conta.nome})`,
          descricao: `${r.errosTecnicos} de ${r.geradas} consultas geradas ${periodo} com erro técnico. Desenvolvimento analisa; o Suporte acompanha o cliente.`,
          proximaAcao: 'Analisar o erro técnico (Desenvolvimento)' },
      }[a.motivo];
      const { nova } = await alertar(c, ctx, { ...d, contaId, prioridade: a.prioridade, motivo: a.motivo, chave: `consultas:${contaId}:${produto}:${a.motivo}` });
      if (nova) resultado.alertasNovos++; else resultado.jaAbertos++;
    }
  }
  return resultado;
}

/** CRE-004: credencial que vence dentro da antecedência configurada vira ocorrência (uma por vencimento). */
async function verificarExpiracoes(c, ctx) {
  const t = uma(await c.query("SELECT config -> 'credenciais' ->> 'avisoDias' AS v FROM tenants WHERE id = $1", [ctx.tenantId]));
  const aviso = Number.isInteger(Number(t?.v)) && Number(t.v) >= 1 && Number(t.v) <= 90 ? Number(t.v) : AVISO_CREDENCIAL_PADRAO;
  const hoje = hojeBrasilia();
  const lista = (await c.query(`SELECT cr.conta_id, cr.tipo, cr.status, cr.expira_em, ct.nome FROM credenciais_ref cr JOIN contas ct ON ct.id = cr.conta_id
    WHERE cr.expira_em IS NOT NULL AND cr.expira_em <= $1::date + $2::int AND ct.status NOT IN ('encerrada') AND ct.arquivada_em IS NULL LIMIT 200`, [hoje, aviso])).rows;
  let novas = 0;
  for (const x of lista) {
    const n = diasAte(x.expira_em, hoje);
    const quando = n < 0 ? `venceu em ${x.expira_em.split('-').reverse().join('/')}` : n === 0 ? 'vence hoje' : `vence em ${n} dia(s) (${x.expira_em.split('-').reverse().join('/')})`;
    const { nova } = await alertar(c, ctx, { chave: `credencial:${x.conta_id}:${x.tipo}:${x.expira_em}`, contaId: x.conta_id, tipo: 'credencial', motivo: 'expiracao',
      prioridade: n <= 3 ? 'alta' : 'media', titulo: `${NOME_CRED[x.tipo] || x.tipo} ${quando} (${x.nome})`,
      descricao: `Aviso antecipado (${aviso} dias). Sem a renovação, as consultas deixam de ser geradas. O Sinapse não guarda a credencial: o cliente renova na Platform.`,
      proximaAcao: 'Avisar o ponto focal com as instruções de renovação' });
    if (nova) novas++;
  }
  return novas;
}

/** POS-009: a mesma placa com o mesmo erro pela N-ésima vez recomenda análise de causa raiz (uma vez por pendência). */
async function verificarReincidencia(c, ctx) {
  const lista = (await c.query(`SELECT p.id, p.conta_id, p.placa, p.erro_codigo, p.descricao, p.recorrencias, ct.nome FROM pendencias p JOIN contas ct ON ct.id = p.conta_id
    WHERE p.estado <> 'corrigida' AND p.recorrencias >= $1 LIMIT 100`, [LIMITES.reincidencia])).rows;
  let novas = 0;
  for (const p of lista) {
    const { nova } = await alertar(c, ctx, { chave: `rca:${p.id}`, contaId: p.conta_id, tipo: 'erro_consulta', motivo: 'reincidencia', prioridade: 'media',
      titulo: `Reincidência: ${p.placa} com "${p.erro_codigo}" pela ${p.recorrencias}ª vez (${p.nome})`,
      descricao: `${p.descricao}. O erro volta a cada rodada: corrigir só o caso não resolve. Analisar a causa raiz com o cliente (cadastro, credencial, processo) e registrar a ação preventiva.`,
      proximaAcao: 'Analisar a causa raiz com o cliente' });
    if (nova) novas++;
  }
  return novas;
}

/** Visão de consultas (REC-008, BL-03): por conta e produto na janela, com o que falta e os alertas ativos. */
async function painelConsultas(c, { dias = 7, pagina = 1 } = {}) {
  const por = 30; const p = Math.max(1, Number(pagina) || 1);
  const ate = uma(await c.query('SELECT max(dia) AS d FROM consultas_volume'))?.d;
  if (!ate) return { itens: [], total: 0, pagina: p, porPagina: por, ate: null, limites: LIMITES };
  const r = await c.query(`SELECT v.conta_id, ct.nome, ct.vip, v.produto, sum(v.esperadas)::int AS esperadas, sum(v.geradas)::int AS geradas,
      sum(v.erros_tecnicos)::int AS erros_tecnicos, sum(v.erros_usuario)::int AS erros_usuario, sum(v.indisponiveis)::int AS indisponiveis, max(v.dia) AS ultimo_dia,
      (SELECT count(*)::int FROM ocorrencias o WHERE o.alerta_chave LIKE 'consultas:' || v.conta_id || ':' || v.produto || ':%'
        AND o.estado NOT IN ('resolvida','encerrada_sem_resolucao')) AS alertas_ativos,
      count(*) OVER()::int AS total
    FROM consultas_volume v JOIN contas ct ON ct.id = v.conta_id WHERE v.dia > $1::date - $2::int
    GROUP BY v.conta_id, ct.nome, ct.vip, v.produto ORDER BY (sum(v.esperadas) - sum(v.geradas)) DESC, ct.nome LIMIT $3 OFFSET $4`, [ate, dias, por, (p - 1) * por]);
  return { itens: r.rows.map(({ total, ...x }) => ({ ...x, faltando: Math.max(0, x.esperadas - x.geradas) })), total: r.rows[0]?.total || 0, pagina: p, porPagina: por, ate, dias, limites: LIMITES };
}

module.exports = { alertar, registrarVolumes, avaliarConsultas, verificarExpiracoes, verificarReincidencia, painelConsultas };
