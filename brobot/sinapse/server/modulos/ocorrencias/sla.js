'use strict';
// Cálculo de prazos por calendário (GOV-008, WFL-005, WFL-006). Regra pura, sem banco.
// Expediente e feriados vêm da configuração da organização; crítica conta em horas corridas (24x7).

const { HORA } = require('../../nucleo/relogio');

const PADRAO = {
  fusoMinutos: -180, // America/Sao_Paulo (sem horário de verão desde 2019)
  expediente: { inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5] },
  sla: {
    critica: { resposta: 1, resolucao: 4, corrido: true },
    alta: { resposta: 2, resolucao: 8 },
    media: { resposta: 4, resolucao: 24 },
    baixa: { resposta: 8, resolucao: 40 },
  },
  slaTriagemHoras: 1,
  fatorVip: 0.5,
  handoffAceiteHoras: 2,
  reaberturaDias: 7,
  revisaoEsperaMaxDias: 3,
};

function calendario(configTenant = {}, feriados = []) {
  return {
    ...PADRAO,
    ...configTenant,
    expediente: { ...PADRAO.expediente, ...(configTenant.expediente || {}) },
    sla: { ...PADRAO.sla, ...(configTenant.sla || {}) },
    feriados: new Set(feriados.map((f) => (typeof f === 'string' ? f : f.toISOString().slice(0, 10)))),
  };
}

/** Soma `horas` úteis a partir de `inicio` respeitando expediente, dias da semana e feriados. */
function somarHorasUteis(inicio, horas, cal) {
  const off = cal.fusoMinutos * 60e3;
  let local = new Date(inicio.getTime() + off); // relógio "de parede" no fuso, lido com getUTC*
  let restante = horas * HORA;
  for (let guarda = 0; guarda < 3660 && restante > 0; guarda++) {
    const dia = local.toISOString().slice(0, 10);
    const util = cal.expediente.dias.includes(local.getUTCDay()) && !cal.feriados.has(dia);
    const abre = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), cal.expediente.inicio);
    const fecha = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), cal.expediente.fim);
    const proximoDia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 0);
    if (!util || local.getTime() >= fecha) { local = new Date(proximoDia); continue; }
    const desde = Math.max(local.getTime(), abre);
    const disponivel = fecha - desde;
    if (restante <= disponivel) { local = new Date(desde + restante); restante = 0; break; }
    restante -= disponivel;
    local = new Date(proximoDia);
  }
  return new Date(local.getTime() - off);
}

/** Horas úteis entre `inicio` e `fim` (mesmo calendário de `somarHorasUteis`). */
function horasUteisEntre(inicio, fim, cal) {
  if (!(fim > inicio)) return 0;
  const off = cal.fusoMinutos * 60e3;
  let local = inicio.getTime() + off;
  const ate = fim.getTime() + off;
  let total = 0;
  for (let guarda = 0; guarda < 3660 && local < ate; guarda++) {
    const d = new Date(local);
    const dia = d.toISOString().slice(0, 10);
    const util = cal.expediente.dias.includes(d.getUTCDay()) && !cal.feriados.has(dia);
    const abre = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), cal.expediente.inicio);
    const fecha = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), cal.expediente.fim);
    const proximoDia = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0);
    if (util) total += Math.max(0, Math.min(fecha, ate) - Math.max(abre, local));
    local = proximoDia;
  }
  return total / HORA;
}

/**
 * WFL-006: tempo esperando cliente ou terceiro não conta no prazo de resolução. Ao sair da espera, o prazo anda
 * o mesmo tanto (horas úteis; crítica em horas corridas).
 */
function prazoDepoisDaEspera(prazo, inicioEspera, fimEspera, { corrido = false, cal }) {
  if (corrido) return new Date(prazo.getTime() + Math.max(0, fimEspera - inicioEspera));
  const horas = horasUteisEntre(inicioEspera, fimEspera, cal);
  return horas > 0 ? somarHorasUteis(prazo, horas, cal) : prazo;
}

/**
 * Prazos de resposta e resolução por prioridade; VIP tem prazo reduzido pelo fator configurado. SLA de contrato
 * (GOV-008, `contas.sla_contrato`) substitui as horas da prioridade e vale como acordado (sem o fator VIP).
 */
function prazos(prioridade, { agora, vip = false, cal, contrato = null }) {
  const doContrato = contrato && contrato[prioridade];
  const regra = { ...(cal.sla[prioridade] || cal.sla.media), ...(doContrato || {}) };
  const fator = vip && !doContrato ? cal.fatorVip : 1;
  const somar = (h) => (regra.corrido ? new Date(agora.getTime() + h * fator * HORA) : somarHorasUteis(agora, h * fator, cal));
  return { respostaEm: somar(regra.resposta), resolucaoEm: somar(regra.resolucao) };
}

/** Valida o SLA de contrato: só as prioridades conhecidas, horas entre 0,25 e 720, resolução ≥ resposta. */
function validarSlaContrato(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { erro: 'Informe as horas por prioridade.' };
  const saida = {};
  for (const [prio, r] of Object.entries(v)) {
    if (!PADRAO.sla[prio]) return { erro: `Prioridade desconhecida: ${String(prio).slice(0, 20)}.` };
    if (!r || typeof r !== 'object') return { erro: `Informe resposta e resolução para "${prio}".` };
    const resposta = Number(r.resposta); const resolucao = Number(r.resolucao);
    const ok = (n) => Number.isFinite(n) && n >= 0.25 && n <= 720;
    if (!ok(resposta) || !ok(resolucao)) return { erro: `As horas de "${prio}" vão de 0,25 a 720.` };
    if (resolucao < resposta) return { erro: `Em "${prio}", a resolução não pode vir antes da resposta.` };
    saida[prio] = { resposta, resolucao };
  }
  return Object.keys(saida).length ? saida : null;
}

module.exports = { calendario, somarHorasUteis, horasUteisEntre, prazoDepoisDaEspera, prazos, validarSlaContrato, PADRAO };
