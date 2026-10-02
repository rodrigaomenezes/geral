'use strict';
// Regras de negócio do Estadia: marcos, sequência, confirmações, apuração e alertas.
// Tudo aqui é puro (sem I/O) para poder ser testado isoladamente.

class DomainError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Marcos operacionais registráveis. `by` = perfis que podem registrar.
const MILESTONES = {
  OPERACAO_IDENTIFICADA: { label: 'Operação identificada', by: ['tac'], requires: [], status: 'Identificada · em trânsito' },
  CHEGADA: { label: 'Chegada no destino', by: ['tac'], requires: ['OPERACAO_IDENTIFICADA'], gps: true, photo: 'required', status: 'Chegada registrada' },
  INICIO: { label: 'Início da carga/descarga', by: ['tac', 'destino'], requires: ['CHEGADA'], gps: true, status: 'Em carga/descarga' },
  TERMINO: { label: 'Término da carga/descarga', by: ['tac', 'destino'], requires: ['INICIO'], photo: 'optional', status: 'Carga/descarga concluída' },
  LIBERACAO: { label: 'Liberação para viagem', by: ['destino'], requires: ['TERMINO'], status: 'Liberado para viagem' },
  SAIDA: { label: 'Saída do local', by: ['tac'], requires: ['CHEGADA'], gps: true, status: 'Saída registrada' },
};
const SEQUENCE = ['OPERACAO_IDENTIFICADA', 'CHEGADA', 'INICIO', 'TERMINO', 'LIBERACAO', 'SAIDA'];

// Confirmações: tipo do marco confirmado → tipo da confirmação.
const CONFIRMATIONS = {
  CHEGADA: { type: 'CHEGADA_CONFIRMADA', label: 'Chegada confirmada' },
  INICIO: { type: 'INICIO_CONFIRMADO', label: 'Início confirmado' },
  TERMINO: { type: 'TERMINO_CONFIRMADO', label: 'Término confirmado' },
  LIBERACAO: { type: 'LIBERACAO_CIENCIA', label: 'Ciência da liberação pelo TAC' },
};
const CONFIRMATION_OF = Object.fromEntries(Object.entries(CONFIRMATIONS).map(([k, v]) => [v.type, k]));

const OTHER_LABELS = {
  OPERACAO_CRIADA: 'Operação cadastrada',
  DIVERGENCIA: 'Divergência registrada',
  OCORRENCIA_TRATADA: 'Ocorrência tratada',
  APURACAO: 'Apuração realizada',
  DOSSIE_GERADO: 'Dossiê digital gerado',
  ENCAMINHADO_JURIDICO: 'Dossiê encaminhado à advocacia',
  JURIDICO_STATUS: 'Status do encaminhamento atualizado',
  USUARIO_CRIADO: 'Usuário criado',
};

function labelOf(type) {
  if (MILESTONES[type]) return MILESTONES[type].label;
  if (CONFIRMATION_OF[type]) return CONFIRMATIONS[CONFIRMATION_OF[type]].label;
  return OTHER_LABELS[type] || type;
}

function kindOf(type) {
  if (MILESTONES[type]) return 'registro';
  if (CONFIRMATION_OF[type]) return 'confirmacao';
  return {
    DIVERGENCIA: 'divergencia', OCORRENCIA_TRATADA: 'tratamento', APURACAO: 'apuracao',
    DOSSIE_GERADO: 'dossie', ENCAMINHADO_JURIDICO: 'juridico', JURIDICO_STATUS: 'juridico',
    OPERACAO_CRIADA: 'cadastro', USUARIO_CRIADO: 'admin',
  }[type] || 'sistema';
}

// Parâmetros normativos versionados. Alterar = nova versão, nunca editar a anterior.
const RULES = [
  {
    id: 'ESTADIA-REF',
    versao: '0.1',
    vigenteDesde: '2026-01-01',
    franquiaMin: 300,
    valorTonHora: 1.38,
    marcoInicial: 'CHEGADA',
    marcoFinal: 'LIBERACAO',
    fonte: 'Referência: Lei 11.442/2007, art. 11. Parâmetros e marcos a validar juridicamente.',
  },
];
const currentRule = () => RULES[RULES.length - 1];

// ---------- Projeção do estado de uma operação a partir dos eventos ----------

function project(opEvents) {
  const created = opEvents.find((e) => e.type === 'OPERACAO_CRIADA');
  if (!created) return null;
  const op = { id: created.opId, ...created.payload, criadaEm: created.receivedAt, tacUserId: null };
  const milestones = {};
  const confirmations = {}; // refEventId -> evento de confirmação
  const divergences = [];
  const treatments = {}; // divergenceId -> evento
  const apuracoes = [];
  const dossies = [];
  const juridico = [];
  for (const e of opEvents) {
    if (e.type === 'OPERACAO_IDENTIFICADA') {
      op.tacUserId = e.actor.userId;
      op.tacNome = e.actor.name;
    }
    if (MILESTONES[e.type]) milestones[e.type] = e;
    else if (CONFIRMATION_OF[e.type]) confirmations[e.refEventId] = e;
    else if (e.type === 'DIVERGENCIA') divergences.push(e);
    else if (e.type === 'OCORRENCIA_TRATADA') treatments[e.refEventId] = e;
    else if (e.type === 'APURACAO') apuracoes.push(e);
    else if (e.type === 'DOSSIE_GERADO') dossies.push(e);
    else if (e.type === 'ENCAMINHADO_JURIDICO' || e.type === 'JURIDICO_STATUS') juridico.push(e);
  }
  let status = 'Aguardando identificação';
  for (const t of SEQUENCE) if (milestones[t]) status = MILESTONES[t].status;
  const pendingConf = Object.keys(CONFIRMATIONS).filter((t) => milestones[t] && !confirmations[milestones[t].id]);
  if (pendingConf.length && !milestones.SAIDA) status += ' · aguardando confirmação';
  const encaminhado = juridico.find((e) => e.type === 'ENCAMINHADO_JURIDICO') || null;
  const ultimoJur = juridico[juridico.length - 1] || null;
  return {
    op, milestones, confirmations, divergences, treatments, apuracoes, dossies, juridico,
    status,
    encerrada: !!milestones.SAIDA,
    encaminhado,
    statusJuridico: ultimoJur ? (ultimoJur.type === 'ENCAMINHADO_JURIDICO' ? 'ENVIADO' : ultimoJur.payload.status) : null,
    divergenciasAbertas: divergences.filter((d) => !treatments[d.id]),
  };
}

// ---------- Validação de novos eventos ----------

const MAX_FUTURE_MS = 5 * 60 * 1000;

function parseTime(value, nowMs) {
  const t = Date.parse(value);
  if (!value || Number.isNaN(t)) throw new DomainError(400, 'HORARIO_INVALIDO', 'Horário do evento inválido.');
  if (t > nowMs + MAX_FUTURE_MS) throw new DomainError(400, 'HORARIO_FUTURO', 'O horário do evento está no futuro. Verifique o relógio do aparelho.');
  return new Date(t).toISOString();
}

function validGps(gps) {
  if (!gps || typeof gps !== 'object') return null;
  if (gps.erro) return { erro: String(gps.erro).slice(0, 200) };
  const lat = Number(gps.lat), lng = Number(gps.lng), acc = Number(gps.acc);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { erro: 'Coordenadas inválidas' };
  return { lat, lng, acc: Number.isFinite(acc) ? Math.round(acc) : null };
}

/**
 * Valida um evento enviado por um usuário e devolve os campos normalizados.
 * input: { type, occurredAt, refEventId?, note?, gps?, hasPhoto?, alegadoEm?, resolucao? }
 */
function validateEvent(state, user, input, nowMs = Date.now()) {
  const type = String(input.type || '');
  const role = user.role;
  const occurredAt = parseTime(input.occurredAt, nowMs);
  const note = input.note ? String(input.note).slice(0, 1000) : undefined;
  const allEvents = [
    ...Object.values(state.milestones), ...Object.values(state.confirmations), ...state.divergences,
  ];
  const byId = (id) => allEvents.find((e) => e.id === id);

  if (type === 'OPERACAO_IDENTIFICADA') throw new DomainError(400, 'USE_IDENTIFICACAO', 'Use a identificação por código e placa.');

  if (MILESTONES[type]) {
    const m = MILESTONES[type];
    if (!m.by.includes(role)) throw new DomainError(403, 'SEM_PERMISSAO', `Seu perfil não pode registrar "${m.label}".`);
    if (role === 'tac' && state.op.tacUserId !== user.id) throw new DomainError(403, 'SEM_PERMISSAO', 'Operação não vinculada a você.');
    if (state.milestones[type]) throw new DomainError(409, 'JA_REGISTRADO', `"${m.label}" já foi registrado para esta operação.`);
    for (const req of m.requires) {
      const prev = state.milestones[req];
      if (!prev) throw new DomainError(409, 'FORA_DE_SEQUENCIA', `Registre antes: ${MILESTONES[req].label}.`);
      if (Date.parse(occurredAt) < Date.parse(prev.occurredAt)) {
        throw new DomainError(409, 'ANTES_DO_ANTERIOR', `O horário não pode ser anterior a "${MILESTONES[req].label}" (${prev.occurredAt}).`);
      }
    }
    if (m.photo === 'required' && !input.hasPhoto) throw new DomainError(400, 'FOTO_OBRIGATORIA', 'A foto é obrigatória neste registro.');
    return { type, occurredAt, note, gps: m.gps ? validGps(input.gps) || { erro: 'Localização não enviada' } : validGps(input.gps) };
  }

  if (CONFIRMATION_OF[type]) {
    const refType = CONFIRMATION_OF[type];
    const ref = state.milestones[refType];
    if (!ref || ref.id !== input.refEventId) throw new DomainError(409, 'SEM_REGISTRO', `Não há "${MILESTONES[refType].label}" para confirmar.`);
    if (!['tac', 'destino'].includes(role) || ref.actor.role === role) {
      throw new DomainError(403, 'MESMA_PARTE', 'A confirmação deve ser feita pela outra parte da operação.');
    }
    if (role === 'tac' && state.op.tacUserId !== user.id) throw new DomainError(403, 'SEM_PERMISSAO', 'Operação não vinculada a você.');
    if (state.confirmations[ref.id]) throw new DomainError(409, 'JA_CONFIRMADO', 'Este evento já foi confirmado.');
    return { type, occurredAt, refEventId: ref.id, note };
  }

  if (type === 'DIVERGENCIA') {
    const ref = byId(input.refEventId);
    if (!ref || !MILESTONES[ref.type]) throw new DomainError(400, 'REF_INVALIDA', 'Selecione o registro contestado.');
    if (!['tac', 'destino'].includes(role) || ref.actor.role === role) throw new DomainError(403, 'MESMA_PARTE', 'Só a outra parte pode contestar este registro.');
    if (!note || note.trim().length < 5) throw new DomainError(400, 'DESCRICAO', 'Descreva a divergência.');
    let alegadoEm;
    if (input.alegadoEm) alegadoEm = parseTime(input.alegadoEm, nowMs);
    return { type, occurredAt, refEventId: ref.id, note, alegadoEm };
  }

  if (type === 'OCORRENCIA_TRATADA') {
    if (!['destino', 'admin'].includes(role)) throw new DomainError(403, 'SEM_PERMISSAO', 'Seu perfil não trata ocorrências.');
    const div = state.divergences.find((d) => d.id === input.refEventId);
    if (!div) throw new DomainError(400, 'REF_INVALIDA', 'Ocorrência não encontrada.');
    if (state.treatments[div.id]) throw new DomainError(409, 'JA_TRATADA', 'Ocorrência já tratada.');
    if (!note || note.trim().length < 5) throw new DomainError(400, 'DESCRICAO', 'Descreva o tratamento.');
    const resolucao = ['procedente', 'improcedente', 'acordo'].includes(input.resolucao) ? input.resolucao : 'acordo';
    return { type, occurredAt, refEventId: div.id, note, resolucao };
  }

  throw new DomainError(400, 'TIPO_INVALIDO', 'Tipo de evento não suportado.');
}

// ---------- Ações disponíveis para o usuário ----------

function nextActions(state, user) {
  const role = user.role;
  const out = [];
  if (!['tac', 'destino'].includes(role)) return out;
  if (role === 'tac' && state.op.tacUserId !== user.id) return out;
  const ms = state.milestones;
  for (const type of SEQUENCE) {
    const m = MILESTONES[type];
    if (type === 'OPERACAO_IDENTIFICADA' || ms[type] || !m.by.includes(role)) continue;
    if (!m.requires.every((r) => ms[r])) continue;
    if (type === 'SAIDA' && !ms.TERMINO) continue;
    out.push({ type, label: m.label, gps: !!m.gps, photo: m.photo || null, kind: 'registro',
      aviso: type === 'SAIDA' && !ms.LIBERACAO ? 'A liberação para viagem ainda não foi registrada.' : undefined });
  }
  for (const [refType, conf] of Object.entries(CONFIRMATIONS)) {
    const ref = ms[refType];
    if (!ref || state.confirmations[ref.id] || ref.actor.role === role) continue;
    out.push({ type: conf.type, label: conf.label, refEventId: ref.id, kind: 'confirmacao' });
    const contested = state.divergences.some((d) => d.refEventId === ref.id);
    if (!contested && refType !== 'LIBERACAO') out.push({ type: 'DIVERGENCIA', label: `Contestar: ${MILESTONES[refType].label}`, refEventId: ref.id, kind: 'divergencia' });
  }
  return out;
}

// ---------- Apuração ----------

const minutesBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);

function apurar(state, rule = currentRule(), nowIso = new Date().toISOString()) {
  const ms = state.milestones;
  const ini = ms[rule.marcoInicial];
  if (!ini) return null;
  const fim = ms[rule.marcoFinal];
  const fimIso = fim ? fim.occurredAt : nowIso;
  const permanenciaMin = Math.max(0, minutesBetween(ini.occurredAt, fimIso));
  const excedenteMin = Math.max(0, permanenciaMin - rule.franquiaMin);
  const carga = Number(state.op.cargaToneladas) || 0;
  const valorEstimado = Math.round((excedenteMin / 60) * carga * rule.valorTonHora * 100) / 100;

  const cenarios = [];
  const add = (label, a, b, ativo = false) => {
    if (a && b) cenarios.push({ label, inicio: a, fim: b, minutos: Math.max(0, minutesBetween(a, b)), ativo });
  };
  add('Chegada (TAC) → liberação · regra ativa', ini.occurredAt, fim && fim.occurredAt, true);
  add('Chegada (TAC) → saída física', ini.occurredAt, ms.SAIDA && ms.SAIDA.occurredAt);
  const confCheg = state.confirmations[ini.id];
  add('Chegada confirmada → liberação', confCheg && confCheg.occurredAt, fim && fim.occurredAt);
  for (const d of state.divergences) {
    if (d.refEventId === ini.id && d.payload && d.payload.alegadoEm) {
      add(`Horário alegado pela contestação → liberação`, d.payload.alegadoEm, fim && fim.occurredAt);
    }
  }
  return {
    regra: { id: rule.id, versao: rule.versao, franquiaMin: rule.franquiaMin, valorTonHora: rule.valorTonHora, fonte: rule.fonte },
    marcoInicial: ini.occurredAt,
    marcoFinal: fim ? fim.occurredAt : null,
    emCurso: !fim,
    permanenciaMin, excedenteMin, cargaToneladas: carga, valorEstimado,
    cenarios,
    ressalva: 'Estimativa baseada em parâmetros de referência. Não constitui conclusão jurídica.',
  };
}

// ---------- Alertas automáticos (ocorrências para análise humana) ----------

function haversineM(a, b) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function alertas(state) {
  const out = [];
  const ms = state.milestones, op = state.op;
  for (const t of ['CHEGADA', 'INICIO', 'SAIDA']) {
    const e = ms[t];
    if (!e || !e.payload) continue;
    const g = e.payload.gps;
    if (!g || g.erro) out.push({ nivel: 'atencao', eventoId: e.id, texto: `${MILESTONES[t].label}: localização indisponível (${(g && g.erro) || 'não enviada'}).` });
    else if (op.lat != null && op.lng != null && t !== 'SAIDA') {
      const d = haversineM(g, { lat: op.lat, lng: op.lng });
      const raio = Number(op.raioM) || 300;
      if (d > raio) out.push({ nivel: 'atencao', eventoId: e.id, texto: `${MILESTONES[t].label}: registro feito a ${d >= 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' km' : d + ' m'} do destino (cerca de ${raio} m).` });
    }
  }
  for (const e of Object.values(ms)) {
    const atraso = minutesBetween(e.occurredAt, e.receivedAt);
    if (atraso >= 10) out.push({ nivel: 'info', eventoId: e.id, texto: `${MILESTONES[e.type].label}: registro feito sem conexão e sincronizado ${atraso} min depois. Horário original preservado.` });
  }
  const after = { CHEGADA: 'INICIO', INICIO: 'TERMINO', TERMINO: 'LIBERACAO' };
  for (const [t, next] of Object.entries(after)) {
    if (ms[t] && ms[next] && !state.confirmations[ms[t].id]) out.push({ nivel: 'atencao', eventoId: ms[t].id, texto: `${MILESTONES[t].label}: sem confirmação da outra parte.` });
  }
  if (ms.SAIDA && !ms.LIBERACAO) out.push({ nivel: 'atencao', eventoId: ms.SAIDA.id, texto: 'Saída registrada sem liberação para viagem.' });
  if (ms.SAIDA && ms.LIBERACAO) {
    const gap = minutesBetween(ms.LIBERACAO.occurredAt, ms.SAIDA.occurredAt);
    out.push({ nivel: gap > 60 ? 'atencao' : 'info', eventoId: ms.SAIDA.id, texto: `Intervalo entre liberação e saída: ${fmtDur(gap)}.` });
  }
  for (const d of state.divergenciasAbertas) out.push({ nivel: 'atencao', eventoId: d.id, texto: `Divergência aberta: ${d.payload.note}` });
  return out;
}

function fmtDur(min) {
  min = Math.max(0, Math.round(min));
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

// ---------- Encaminhamento jurídico ----------

function elegivelJuridico(state) {
  const motivos = [];
  if (!state.encerrada) motivos.push('A saída ainda não foi registrada.');
  if (!state.dossies.length) motivos.push('Gere o dossiê digital antes de encaminhar.');
  if (state.encaminhado) motivos.push('Esta operação já foi encaminhada.');
  return { apto: motivos.length === 0, motivos };
}

module.exports = {
  DomainError, MILESTONES, SEQUENCE, CONFIRMATIONS, CONFIRMATION_OF, RULES, currentRule,
  labelOf, kindOf, project, validateEvent, nextActions, apurar, alertas, haversineM, fmtDur, elegivelJuridico,
};
