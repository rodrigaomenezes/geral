'use strict';
// Motor de processos. Três rotinas da fila de jobs:
//   processos.despachar (a cada 5 s): lê o outbox de eventos, inicia execuções dos processos ativos cujo gatilho
//     casa com o evento, reavalia o "para sozinho se" das execuções da mesma conta/ocorrência e acorda as que
//     esperavam uma ligação concluída. Marca o evento como publicado.
//   processos.agenda (de hora em hora): dispara os processos semanais.
//   processo.avancar: executa os passos de uma execução até uma espera, uma ligação ou o fim.
// Cada execução fica presa à versão em que começou (WFL-013). Proteção contra laço (WFL-015): evento causado por
// uma execução não dispara o mesmo processo, e o mesmo processo não começa mais de 5 vezes em 24 h no mesmo alvo.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { publicar, auditar } = require('../../nucleo/registro');
const { relogio, HORA } = require('../../nucleo/relogio');
const { enfileirar } = require('../../jobs/fila');
const { GATILHOS, descreverPasso, descreverCondicao } = require('./catalogo');
const { todas, alguma, preencher } = require('./regras');
const contexto = require('./contexto');
const ocorrencias = require('../ocorrencias/servico');
const tarefas = require('../ocorrencias/tarefas');
const comunicacao = require('../comunicacao/servico');

const INTERVALO_DESPACHO_MS = 5e3;
const LIMITE_POR_ALVO_24H = 5;
const MAX_PASSOS_POR_RODADA = 50;
const VIVAS = "estado IN ('em_andamento','aguardando')";

async function registrar(c, ctx, exe, passo, tipo, resultado, detalhe) {
  await c.query('INSERT INTO processo_passos_log (tenant_id, execucao_id, passo, tipo, resultado, detalhe) VALUES ($1,$2,$3,$4,$5,$6)',
    [ctx.tenantId, exe.id, passo, tipo, resultado, String(detalhe).slice(0, 1000)]);
}

/** Alvo (ocorrência, rodada, conta) de um evento do outbox. */
async function alvoDoEvento(c, ev) {
  const p = ev.payload || {};
  const alvo = { ocorrencia_id: null, rodada_id: null, conta_id: p.contaId || null, execucao_id: p.execucaoId || null };
  if (ev.aggregate_type === 'ocorrencia') alvo.ocorrencia_id = ev.aggregate_id;
  if (ev.aggregate_type === 'rodada') alvo.rodada_id = ev.aggregate_id;
  if (ev.aggregate_type === 'conta') alvo.conta_id = alvo.conta_id || ev.aggregate_id;
  if (p.ocorrenciaId) alvo.ocorrencia_id = alvo.ocorrencia_id || p.ocorrenciaId;
  if (p.rodadaId) alvo.rodada_id = alvo.rodada_id || p.rodadaId;
  if (!alvo.conta_id && alvo.ocorrencia_id) alvo.conta_id = uma(await c.query('SELECT conta_id FROM ocorrencias WHERE id = $1', [alvo.ocorrencia_id]))?.conta_id || null;
  if (!alvo.conta_id && alvo.rodada_id) alvo.conta_id = uma(await c.query('SELECT conta_id FROM rodadas WHERE id = $1', [alvo.rodada_id]))?.conta_id || null;
  return alvo;
}

function casa(gatilho, ev) {
  const g = GATILHOS[gatilho];
  if (!g) return false;
  if (g.eventos.includes(ev.event_type)) return true;
  // "mudou de situação": qualquer evento de ocorrência que troque o estado.
  return g.eventos.includes('*ocorrencia') && ev.aggregate_type === 'ocorrencia' && ev.payload?.para && ev.payload.para !== ev.payload.de;
}

async function versoesAtivas(c) {
  return (await c.query(`SELECT v.*, p.nome FROM processo_versoes v JOIN processos p ON p.id = v.processo_id
    WHERE v.estado = 'ativa' AND p.arquivado_em IS NULL`)).rows;
}

/** Inicia uma execução se as condições valem. Devolve a execução criada ou null (com o motivo). */
async function iniciar(c, ctx, versao, alvo, chave, eventoId = null) {
  const def = versao.definicao;
  const { vars, contaId } = await contexto.carregar(c, alvo);
  if (!todas(def.condicoes, vars)) return { execucao: null, motivo: 'condições não atendidas' };
  const recentes = uma(await c.query(
    `SELECT count(*)::int AS n FROM processo_execucoes WHERE processo_id = $1 AND iniciada_em > now() - interval '24 hours'
     AND coalesce(ocorrencia_id::text, rodada_id::text, conta_id::text) = coalesce($2::text, $3::text, $4::text)`,
    [versao.processo_id, alvo.ocorrencia_id, alvo.rodada_id, contaId]));
  if (recentes.n >= LIMITE_POR_ALVO_24H) {
    await c.query(`INSERT INTO divergencias (tenant_id, tipo, descricao, entidade_id, chave) VALUES ($1, 'processo_em_laco', $2, $3, $4)
      ON CONFLICT (tenant_id, chave) DO NOTHING`, [ctx.tenantId,
      `O processo "${versao.nome}" tentou começar ${recentes.n + 1} vezes em 24 h para o mesmo item e foi contido. Revise o gatilho.`,
      versao.processo_id, `laco:${versao.processo_id}:${new Date().toISOString().slice(0, 13)}`]);
    return { execucao: null, motivo: 'contido: possível laço' };
  }
  const exe = uma(await c.query(
    `INSERT INTO processo_execucoes (tenant_id, processo_id, versao_id, evento_id, chave, ocorrencia_id, rodada_id, conta_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, chave) DO NOTHING RETURNING *`,
    [ctx.tenantId, versao.processo_id, versao.id, eventoId, chave, alvo.ocorrencia_id, alvo.rodada_id, contaId]));
  if (!exe) return { execucao: null, motivo: 'já iniciado para este gatilho' };
  await enfileirar(c, ctx, { tipo: 'processo.avancar', chave: `proc:${exe.id}:inicio`, payload: { execucaoId: exe.id } });
  return { execucao: exe };
}

/** Job recorrente: outbox → processos. */
async function jobDespachar(c, ctx) {
  const eventos = (await c.query(
    'SELECT * FROM eventos WHERE publicado_em IS NULL ORDER BY received_at, event_id LIMIT 200 FOR UPDATE SKIP LOCKED')).rows;
  if (eventos.length) {
    const versoes = await versoesAtivas(c);
    const origemDe = new Map();
    const causas = [...new Set(eventos.map((e) => e.causation_id).filter(Boolean))];
    if (causas.length) {
      for (const r of (await c.query('SELECT id, processo_id FROM processo_execucoes WHERE id = ANY($1)', [causas])).rows) origemDe.set(r.id, r.processo_id);
    }
    for (const ev of eventos) {
      const alvo = await alvoDoEvento(c, ev);
      for (const v of versoes) {
        if (!casa(v.definicao.gatilho, ev) || new Date(ev.received_at) < new Date(v.ativada_em)) continue;
        if (ev.causation_id && origemDe.get(ev.causation_id) === v.processo_id) continue; // não dispara a si mesmo
        await iniciar(c, ctx, v, alvo, `ev:${ev.event_id}:${v.processo_id}`, ev.event_id);
      }
      if (ev.event_type === 'tarefa.concluida' && alvo.execucao_id) {
        await enfileirar(c, ctx, { tipo: 'processo.avancar', chave: `proc:${alvo.execucao_id}:tarefa:${ev.aggregate_id}`, payload: { execucaoId: alvo.execucao_id } });
      }
      if (alvo.conta_id || alvo.ocorrencia_id) await reavaliar(c, ctx, alvo);
    }
    await c.query('UPDATE eventos SET publicado_em = now() WHERE event_id = ANY($1)', [eventos.map((e) => e.event_id)]);
  }
  return { proximaEm: new Date(relogio.agora().getTime() + INTERVALO_DESPACHO_MS) };
}

/** Encerra as execuções vivas do alvo cujo "para sozinho se" passou a valer (ex.: pendências corrigidas — RN-005). */
async function reavaliar(c, ctx, alvo) {
  const vivas = (await c.query(
    `SELECT e.*, v.definicao FROM processo_execucoes e JOIN processo_versoes v ON v.id = e.versao_id
     WHERE e.${VIVAS} AND (e.conta_id = $1 OR e.ocorrencia_id = $2) FOR UPDATE OF e`, [alvo.conta_id || null, alvo.ocorrencia_id || null])).rows;
  let encerradas = 0;
  for (const e of vivas) {
    if (!e.definicao.encerrarSe?.length) continue;
    const { vars } = await contexto.carregar(c, e);
    const motivo = e.definicao.encerrarSe.find((cond) => alguma([cond], vars));
    if (motivo) { await finalizar(c, ctx, e, 'encerrada', `Parou sozinho: ${descreverCondicao(motivo)}`); encerradas++; }
  }
  return encerradas;
}

async function finalizar(c, ctx, e, estado, motivo) {
  await c.query(`UPDATE processo_execucoes SET estado = $2, motivo = $3, finalizada_em = $4, espera_ate = NULL, tarefa_aguardada = NULL,
    atualizada_em = now() WHERE id = $1`, [e.id, estado, motivo, relogio.agora()]);
  await c.query("UPDATE jobs SET estado = 'cancelado', concluido_em = now() WHERE chave LIKE $1 AND estado = 'pendente'", [`proc:${e.id}:%`]);
  const canc = await c.query("UPDATE tarefas SET estado = 'cancelada' WHERE execucao_id = $1 AND estado = 'aberta'", [e.id]);
  await registrar(c, ctx, e, e.passo_atual, 'fim', estado === 'concluida' ? 'executado' : 'encerrado',
    `${motivo}${canc.rowCount ? ` · ${canc.rowCount} tarefa(s) em aberto cancelada(s)` : ''}`);
}

async function ocorrenciaDoAlvo(c, e) {
  if (e.ocorrencia_id) return uma(await c.query('SELECT * FROM ocorrencias WHERE id = $1', [e.ocorrencia_id]));
  if (!e.rodada_id && !e.conta_id) return null;
  return uma(await c.query(
    `SELECT * FROM ocorrencias WHERE ${e.rodada_id ? 'rodada_id = $1' : 'conta_id = $1'} AND estado NOT IN ('resolvida','encerrada_sem_resolucao')
     ORDER BY criado_em DESC LIMIT 1`, [e.rodada_id || e.conta_id]));
}

const ATIVA = (o) => o && !['resolvida', 'encerrada_sem_resolucao'].includes(o.estado);

/** Executa um passo de efeito. Devolve o texto do que foi feito (ou lança ErroPasso para "pulado"). */
async function efeito(c, ctx, e, i, p, cx) {
  const { vars } = cx;
  const oc = await ocorrenciaDoAlvo(c, e);
  const pular = (motivo) => { const x = new Error(motivo); x.pulado = true; throw x; };
  switch (p.tipo) {
    case 'enviar_mensagem': {
      if (!cx.contaId) pular('sem cliente identificado');
      const modelo = p.modelo === 'texto_livre' ? 'resposta_atendimento' : p.modelo;
      const variaveis = p.modelo === 'texto_livre' ? { texto: preencher(p.texto, vars) } : vars;
      const feitos = [];
      const querGrupo = ['grupo', 'grupo_e_ponto_focal'].includes(p.destino);
      const grupo = cx.conta?.grupo_whatsapp;
      if (querGrupo && grupo) {
        await comunicacao.programarEnvio(c, ctx, { contaId: cx.contaId, ocorrenciaId: oc?.id, grupo, modelo, variaveis });
        feitos.push('grupo do cliente');
      }
      if (p.destino !== 'grupo' || (querGrupo && !grupo)) {
        const pfs = (await c.query("SELECT * FROM pontos_focais WHERE conta_id = $1 AND vigente ORDER BY papel = 'principal' DESC", [cx.contaId])).rows;
        const it = await comunicacao.programarEnvio(c, ctx, { contaId: cx.contaId, ocorrenciaId: oc?.id, pontoFocal: pfs[0], modelo, variaveis });
        feitos.push(it.status_entrega === 'bloqueada' ? `ponto focal BLOQUEADO (${it.motivoBloqueio})` : `ponto focal (${it.canal})`);
        if (querGrupo && !grupo) feitos.push('sem grupo cadastrado: foi só ao ponto focal');
      }
      return `Mensagem "${modelo}" enfileirada para: ${feitos.join(', ')}`;
    }
    case 'criar_tarefa': {
      const equipe = p.equipe === 'da_conta' ? vars.equipe_da_conta || 'suporte' : p.equipe;
      const t = await tarefas.criar(c, ctx, { tipo: p.tipoTarefa || 'geral', equipeCodigo: equipe, ocorrenciaId: oc?.id, rodadaId: e.rodada_id,
        titulo: preencher(p.titulo, vars), prazoEm: new Date(relogio.agora().getTime() + p.prazoHoras * HORA), chave: `proc:${e.id}:${i}`, execucaoId: e.id });
      return t ? `Tarefa criada para ${equipe}: ${t.titulo}` : 'Tarefa já existia (repetição ignorada)';
    }
    case 'mudar_prioridade':
      if (!ATIVA(oc)) pular('sem ocorrência ativa');
      await ocorrencias.alterarComMotivo(c, ctx, oc.id, null, { prioridade: p.prioridade }, 'ocorrencia.prioridade_alterada', `Processo: prioridade ${p.prioridade}`);
      return `Prioridade da ${oc.protocolo} mudou para ${p.prioridade}`;
    case 'transferir': {
      if (!ATIVA(oc)) pular('sem ocorrência ativa');
      const equipe = p.equipe === 'da_conta' ? vars.equipe_da_conta : p.equipe;
      await ocorrencias.alterarComMotivo(c, ctx, oc.id, oc.estado === 'em_atendimento' ? 'aberta' : null,
        { equipe_id: await ocorrencias.idEquipe(c, equipe), responsavel_id: null }, 'ocorrencia.transferida_por_processo', `Processo: passou para ${equipe}`);
      return `${oc.protocolo} passou para a equipe ${equipe}`;
    }
    case 'nota':
      if (!oc) pular('sem ocorrência');
      await c.query(`INSERT INTO interacoes (tenant_id, ocorrencia_id, conta_id, canal, direcao, texto, remetente) VALUES ($1,$2,$3,'interno','nota',$4,$5)`,
        [ctx.tenantId, oc.id, oc.conta_id, preencher(p.texto, vars).slice(0, 4000), ctx.ator]);
      return `Nota registrada na ${oc.protocolo}`;
    case 'escalar': {
      if (ATIVA(oc)) {
        await ocorrencias.alterarComMotivo(c, ctx, oc.id, null, { nivel_escalonamento: Math.min(oc.nivel_escalonamento + 1, 3) }, 'ocorrencia.escalonada_por_processo', preencher(p.motivo, vars));
      }
      await tarefas.criar(c, ctx, { tipo: 'escalonamento', equipeCodigo: 'supervisao', ocorrenciaId: oc?.id, rodadaId: e.rodada_id, chave: `proc:${e.id}:${i}`,
        execucaoId: e.id, titulo: `${vars.conta || ''}${oc ? ` ${oc.protocolo}` : ''}: ${preencher(p.motivo, vars)}`.trim(), prazoEm: new Date(relogio.agora().getTime() + 2 * HORA) });
      return 'Escalado para a Supervisão';
    }
    default:
      throw new Error(`Passo desconhecido: ${p.tipo}`);
  }
}

/** Job: avança uma execução. Tudo numa transação: se algo falhar, nada do passo fica pela metade e o job é repetido. */
async function jobAvancar(c, ctxBase, { execucaoId }) {
  const e = uma(await c.query(`SELECT e.*, v.definicao, v.versao, p.nome FROM processo_execucoes e JOIN processo_versoes v ON v.id = e.versao_id
    JOIN processos p ON p.id = e.processo_id WHERE e.id = $1 FOR UPDATE OF e`, [execucaoId]));
  if (!e || !['em_andamento', 'aguardando'].includes(e.estado)) return {};
  const ctx = { ...ctxBase, ator: `processo "${e.nome}" v${e.versao}`, causacao: e.id };
  const def = e.definicao;
  const agora = relogio.agora();
  let i = e.passo_atual;

  if (e.estado === 'aguardando') {
    if (e.tarefa_aguardada) {
      const t = uma(await c.query('SELECT estado, resultado_codigo, resultado FROM tarefas WHERE id = $1', [e.tarefa_aguardada]));
      if (t && t.estado === 'aberta' && agora < new Date(e.espera_ate)) return {};
      await registrar(c, ctx, e, i, 'ligar', 'executado', !t || t.estado !== 'concluida' ? 'Ligação não registrada no prazo: segue como "não atendeu"'
        : `Ligação ${t.resultado_codigo === 'atendeu' ? 'atendida' : 'não atendida'}: ${t.resultado}`);
    } else if (agora < new Date(e.espera_ate)) {
      return {};
    }
    i++;
  }

  for (let n = 0; n < MAX_PASSOS_POR_RODADA; n++) {
    const cx = await contexto.carregar(c, e);
    const parar = (def.encerrarSe || []).find((cond) => alguma([cond], cx.vars));
    if (parar) { await finalizar(c, ctx, { ...e, passo_atual: i }, 'encerrada', `Parou sozinho: ${descreverCondicao(parar)}`); return {}; }
    const p = def.passos[i];
    if (!p) { await finalizar(c, ctx, { ...e, passo_atual: i }, 'concluida', 'Todos os passos concluídos'); return {}; }
    if (p.seCondicoes?.length && !todas(p.seCondicoes, cx.vars)) {
      await registrar(c, ctx, e, i, p.tipo, 'pulado', `${descreverPasso(p)} — pulado: ${p.seCondicoes.map(descreverCondicao).join(' e ')} não vale`);
      i++; continue;
    }
    if (p.tipo === 'esperar' || p.tipo === 'ligar') {
      let ate; let tarefaId = null; let detalhe;
      if (p.tipo === 'esperar') {
        ate = p.horas !== undefined ? new Date(agora.getTime() + p.horas * HORA) : new Date(new Date(cx.vars.d0).getTime() + p.ateD0Horas * HORA);
        if (Number.isNaN(ate.getTime())) throw new Error('Espera pelo D0 sem rodada no alvo.');
        if (ate <= agora) { await registrar(c, ctx, e, i, p.tipo, 'executado', `${descreverPasso(p)}: o momento já passou, seguindo`); i++; continue; }
        detalhe = `${descreverPasso(p)}: até ${ate.toISOString()}`;
      } else {
        const equipe = p.equipe === 'da_conta' ? cx.vars.equipe_da_conta || 'suporte' : p.equipe;
        ate = new Date(agora.getTime() + p.prazoHoras * HORA);
        const t = await tarefas.criar(c, ctx, { tipo: 'ligacao', equipeCodigo: equipe, ocorrenciaId: (await ocorrenciaDoAlvo(c, e))?.id, rodadaId: e.rodada_id,
          chave: `proc:${e.id}:${i}`, execucaoId: e.id, prazoEm: ate,
          titulo: `Ligar para ${cx.vars.nome} (${cx.vars.conta}): ${cx.vars.qtd_pendencias ?? 0} pendência(s)${p.roteiro ? ` · ${preencher(p.roteiro, cx.vars)}` : ''}` });
        tarefaId = t?.id || uma(await c.query('SELECT id FROM tarefas WHERE chave = $1', [`proc:${e.id}:${i}`]))?.id;
        detalhe = `Tarefa de ligação criada para ${equipe}; o processo espera o resultado até ${ate.toISOString()}`;
      }
      await c.query(`UPDATE processo_execucoes SET estado = 'aguardando', passo_atual = $2, espera_ate = $3, tarefa_aguardada = $4, atualizada_em = now()
        WHERE id = $1`, [e.id, i, ate, tarefaId]);
      await enfileirar(c, ctx, { tipo: 'processo.avancar', chave: `proc:${e.id}:${i}:prazo`, executarEm: ate, payload: { execucaoId: e.id } });
      await registrar(c, ctx, e, i, p.tipo, 'aguardando', detalhe);
      return {};
    }
    try {
      const feito = await efeito(c, ctx, e, i, p, cx);
      await registrar(c, ctx, e, i, p.tipo, 'executado', feito);
    } catch (err) {
      if (!err.pulado) throw err;
      await registrar(c, ctx, e, i, p.tipo, 'pulado', `${descreverPasso(p)} — pulado: ${err.message}`);
    }
    i++;
    await c.query("UPDATE processo_execucoes SET estado = 'em_andamento', passo_atual = $2, espera_ate = NULL, tarefa_aguardada = NULL, atualizada_em = now() WHERE id = $1", [e.id, i]);
  }
  throw new Error('Execução passou do limite de passos numa rodada (possível laço).');
}

/** Gatilhos por conta: "Executar agora" e o semanal. Idempotente por dia (manual) ou semana (semanal). */
async function iniciarParaContas(c, ctx, versao, rotuloChave) {
  const contas = (await c.query("SELECT id FROM contas WHERE arquivada_em IS NULL AND status <> 'encerrada' ORDER BY nome")).rows;
  let iniciadas = 0;
  for (const conta of contas) {
    const r = await iniciar(c, ctx, versao, { conta_id: conta.id }, `${rotuloChave}:${versao.id}:${conta.id}`);
    if (r.execucao) iniciadas++;
  }
  return { contas: contas.length, iniciadas };
}

async function executarAgora(c, ctx, processoId) {
  const v = uma(await c.query(`SELECT v.*, p.nome FROM processo_versoes v JOIN processos p ON p.id = v.processo_id
    WHERE v.processo_id = $1 AND v.estado = 'ativa'`, [processoId]));
  if (!v) throw erro.regra('processo_inativo', 'Ative o processo antes de executá-lo.');
  if (GATILHOS[v.definicao.gatilho]?.entidade !== 'conta') throw erro.regra('gatilho_automatico', 'Este processo começa sozinho pelo gatilho; "Executar agora" vale para processos por conta.');
  const r = await iniciarParaContas(c, ctx, v, `manual:${relogio.agora().toISOString().slice(0, 10)}`);
  await auditar(c, ctx, { acao: 'processo.executado_manualmente', entidade: 'processo', entidadeId: processoId, depois: r });
  return r;
}

const semanaIso = (d) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dia = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dia); const ano = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-S${Math.ceil(((t - ano) / 864e5 + 1) / 7)}`; };

/** Job de hora em hora: processos semanais no dia/hora configurados (horário de Brasília). */
async function jobAgenda(c, ctx) {
  const agora = relogio.agora();
  const local = new Date(agora.getTime() - 3 * HORA);
  const dia = local.getUTCDay() || 7;
  for (const v of await versoesAtivas(c)) {
    if (v.definicao.gatilho !== 'contas.semanal') continue;
    if (v.definicao.agenda?.diaSemana === dia && v.definicao.agenda?.hora <= local.getUTCHours()) await iniciarParaContas(c, ctx, v, `semana:${semanaIso(local)}`);
  }
  const proxima = new Date(agora); proxima.setUTCMinutes(0, 0, 0); proxima.setUTCHours(proxima.getUTCHours() + 1);
  return { proximaEm: proxima };
}

/**
 * Simulação (SUP-010): mostra o que o processo faria num item real, sem gravar nada. Supõe que nada mude durante
 * as esperas e que as ligações não sejam atendidas.
 */
async function simular(c, def, alvo) {
  const { vars } = await contexto.carregar(c, alvo);
  const linhas = [];
  const comeca = todas(def.condicoes, vars);
  linhas.push({ resultado: comeca ? 'começaria' : 'não começaria', texto: comeca ? 'As condições valem para este item.' : `As condições não valem: ${(def.condicoes || []).filter((x) => !todas([x], vars)).map(descreverCondicao).join('; ')}` });
  if (!comeca) return { vars: resumoVars(vars), linhas };
  const parar = (def.encerrarSe || []).find((cond) => alguma([cond], vars));
  if (parar) { linhas.push({ resultado: 'pararia', texto: `Pararia logo no início: ${descreverCondicao(parar)}` }); return { vars: resumoVars(vars), linhas }; }
  let quando = relogio.agora();
  for (const p of def.passos) {
    if (p.seCondicoes?.length && !todas(p.seCondicoes, { ...vars, 'ligacao.atendeu': false })) { linhas.push({ resultado: 'pularia', texto: `${descreverPasso(p)} (condição não vale)` }); continue; }
    if (p.tipo === 'esperar') {
      const ate = p.horas !== undefined ? new Date(quando.getTime() + p.horas * HORA) : vars.d0 ? new Date(new Date(vars.d0).getTime() + p.ateD0Horas * HORA) : null;
      if (ate && ate > quando) quando = ate;
      linhas.push({ resultado: 'esperaria', texto: `${descreverPasso(p)} → ${ate ? ate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'sem D0'}` });
      continue;
    }
    linhas.push({ resultado: 'faria', texto: p.tipo === 'enviar_mensagem' && p.modelo === 'texto_livre' ? `Enviaria: "${preencher(p.texto, vars)}"` : descreverPasso(p), quando });
  }
  return { vars: resumoVars(vars), linhas };
}
const resumoVars = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !['lista', 'd0'].includes(k)));

module.exports = { jobDespachar, jobAvancar, jobAgenda, reavaliar, iniciar, executarAgora, simular, finalizar, INTERVALO_DESPACHO_MS };
