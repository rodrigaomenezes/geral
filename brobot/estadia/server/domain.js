'use strict';
// Regras de negócio do Estadia BR (DEV 2.0): marcos, sequência, confirmações, status,
// apuração, conciliação financeira, deslocamento e permissões.
// Tudo aqui é puro (sem I/O) para poder ser testado isoladamente.

class DomainError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------- Permissões (RF-51/52) ----------
const PERMISSOES = {
  tac: ['visualizar', 'registrar', 'confirmar', 'registrar_pagamento'],
  destino: ['visualizar', 'registrar', 'confirmar', 'tratar_divergencia', 'gerar_dossie', 'exportar', 'relatorios'],
  transportadora: ['visualizar', 'criar', 'editar', 'registrar_pagamento', 'gerar_dossie', 'encaminhar', 'encerrar', 'exportar', 'relatorios'],
  advocacia: ['visualizar', 'registrar_juridico', 'exportar'],
  admin: ['visualizar', 'criar', 'editar', 'registrar', 'confirmar', 'tratar_divergencia', 'registrar_pagamento', 'gerar_dossie', 'encaminhar', 'encerrar', 'exportar', 'relatorios', 'administrar'],
};
const can = (user, perm) => (PERMISSOES[user.role] || []).includes(perm);

// ---------- Marcos operacionais (seção 32 do documento) ----------
const MILESTONES = {
  OPERACAO_IDENTIFICADA: { label: 'Operação identificada pelo TAC', by: ['tac'], requires: [] },
  CHEGADA: { label: 'Chegada registrada', by: ['tac'], requires: ['OPERACAO_IDENTIFICADA'], gps: 'capturar', photo: 'required' },
  INICIO: { label: 'Início registrado', by: ['tac', 'destino'], requires: ['CHEGADA'], gps: 'capturar' },
  TERMINO: { label: 'Término registrado', by: ['tac', 'destino'], requires: ['INICIO'], gps: 'capturar', photo: 'optional' },
  LIBERACAO: { label: 'Liberação para viagem registrada', by: ['destino'], requires: ['TERMINO'], photo: 'optional' },
  SAIDA: { label: 'Saída registrada', by: ['tac'], requires: ['CHEGADA'], gps: 'opcional', photo: 'required', photoLabel: 'Foto do documento/comprovante de liberação ou saída' },
};
const SEQUENCE = ['OPERACAO_IDENTIFICADA', 'CHEGADA', 'INICIO', 'TERMINO', 'LIBERACAO', 'SAIDA'];

const CONFIRMATIONS = {
  CHEGADA: { type: 'CHEGADA_CONFIRMADA', label: 'Chegada confirmada' },
  INICIO: { type: 'INICIO_CONFIRMADO', label: 'Início confirmado' },
  TERMINO: { type: 'TERMINO_CONFIRMADO', label: 'Término confirmado' },
  LIBERACAO: { type: 'LIBERACAO_CONFIRMADA', label: 'Liberação confirmada' },
};
const CONFIRMATION_OF = Object.fromEntries(Object.entries(CONFIRMATIONS).map(([k, v]) => [v.type, k]));

const OCORRENCIAS = {
  DESLOCAMENTO_FORA_DO_LIMITE: 'Deslocamento fora do limite',
  GPS_INDISPONIVEL: 'GPS indisponível',
};

const OTHER_LABELS = {
  OPERACAO_CRIADA: 'Operação criada',
  OPERACAO_RETIFICADA: 'Dados da operação retificados',
  DADOS_INFORMADOS: 'Dados informados pelo TAC (Amélia)',
  DIVERGENCIA: 'Divergência registrada',
  OCORRENCIA_TRATADA: 'Ocorrência tratada',
  LINK_GERADO: 'Link de confirmação gerado',
  LINK_ENVIADO: 'Link enviado por WhatsApp',
  LINK_VISUALIZADO: 'Link de confirmação aberto',
  LINK_EXPIRADO_ACESSO: 'Tentativa de acesso a link expirado',
  LINK_RENOVACAO_SOLICITADA: 'Novo link solicitado pelo destino',
  APURACAO: 'Apuração realizada',
  PAGAMENTO_REGISTRADO: 'Pagamento registrado',
  SITUACAO_FINANCEIRA: 'Situação financeira atualizada',
  DOSSIE_GERADO: 'Dossiê digital gerado',
  ENCAMINHADO_JURIDICO: 'Encaminhado ao jurídico',
  JURIDICO_STATUS: 'Retorno do jurídico',
  OPERACAO_ENCERRADA: 'Operação encerrada',
  USUARIO_CRIADO: 'Usuário criado',
  ...OCORRENCIAS,
};

function labelOf(type) {
  if (MILESTONES[type]) return MILESTONES[type].label;
  if (CONFIRMATION_OF[type]) return CONFIRMATIONS[CONFIRMATION_OF[type]].label;
  return OTHER_LABELS[type] || type;
}

function kindOf(type) {
  if (MILESTONES[type]) return 'registro';
  if (CONFIRMATION_OF[type]) return 'confirmacao';
  if (OCORRENCIAS[type]) return 'ocorrencia';
  if (type.startsWith('LINK_')) return 'notificacao';
  return {
    DIVERGENCIA: 'divergencia', OCORRENCIA_TRATADA: 'tratamento', APURACAO: 'apuracao',
    PAGAMENTO_REGISTRADO: 'financeiro', SITUACAO_FINANCEIRA: 'financeiro',
    DOSSIE_GERADO: 'dossie', ENCAMINHADO_JURIDICO: 'juridico', JURIDICO_STATUS: 'juridico',
    OPERACAO_CRIADA: 'cadastro', OPERACAO_RETIFICADA: 'cadastro', DADOS_INFORMADOS: 'cadastro',
    OPERACAO_ENCERRADA: 'cadastro', USUARIO_CRIADO: 'admin',
  }[type] || 'sistema';
}

// ---------- Status da operação (Épico 15) ----------
const STATUS = {
  CRIADA: 'Criada',
  AGUARDANDO_CHEGADA: 'Aguardando chegada',
  AGUARDANDO_CONFIRMACAO_CHEGADA: 'Aguardando confirmação da chegada',
  CHEGADA_CONFIRMADA: 'Chegada confirmada',
  OPERACAO_INICIADA: 'Operação iniciada',
  INICIO_CONFIRMADO: 'Início confirmado',
  OPERACAO_FINALIZADA: 'Operação finalizada',
  TERMINO_CONFIRMADO: 'Término confirmado',
  LIBERADA: 'Liberada',
  LIBERACAO_CONFIRMADA: 'Liberação confirmada',
  SAIDA_REGISTRADA: 'Saída registrada',
  APURADA: 'Apurada · sem valor devido',
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
  PAGAMENTO_PARCIAL: 'Pagamento parcial',
  PAGO: 'Pago',
  VALOR_DIVERGENTE: 'Valor divergente',
  EM_TRATATIVA: 'Em tratativa',
  ENCAMINHADA_JURIDICO: 'Encaminhada ao jurídico',
  ENCERRADA: 'Encerrada',
};

// ---------- Parâmetros versionados (RN-28) ----------
// Alterar = nova versão. Versões anteriores ficam para operações apuradas sob elas.
const RULES = [
  {
    id: 'ESTADIA-REF', versao: '0.1', vigenteDesde: '2026-01-01',
    limiteMin: 300, valorTonHora: 1.38, marcoInicial: 'CHEGADA', marcoFinal: 'LIBERACAO', formula: 'EXCEDENTE',
    descricaoFormula: 'Excedente sobre 5h × carga × valor por t·h',
    fonte: 'Versão de referência da DEV 1.0, substituída pela 2.0.',
  },
  {
    id: 'ESTADIA-BR', versao: '2.0', vigenteDesde: '2026-10-01',
    limiteMin: 300, valorTonHora: 2.5, marcoInicial: 'CHEGADA_CONFIRMADA', marcoFinal: 'LIBERACAO', formula: 'TEMPO_TOTAL',
    descricaoFormula: 'Até 5h: R$ 0,00. Acima de 5h: tempo efetivo total × capacidade do veículo × R$ 2,50 por t·h',
    fonte: 'Regra consolidada pelo cliente (DEV 2.0). Marco final, frações e parâmetros sujeitos a validação jurídica.',
  },
];
const LIMITE_DESLOCAMENTO_M = 300;

function ruleFor(iso) {
  const day = (iso || new Date().toISOString()).slice(0, 10);
  const valid = RULES.filter((r) => r.vigenteDesde <= day);
  return valid.length ? valid[valid.length - 1] : RULES[RULES.length - 1];
}

// ---------- Projeção do estado de uma operação ----------
function project(opEvents) {
  const created = opEvents.find((e) => e.type === 'OPERACAO_CRIADA');
  if (!created) return null;
  const op = { id: created.opId, ...created.payload, criadaEm: created.occurredAt, tacUserId: null };
  const st = {
    op, milestones: {}, confirmations: {}, divergences: [], treatments: {}, apuracoes: [], pagamentos: [],
    situacoes: [], dossies: [], juridico: [], ocorrencias: [], retificacoes: [], links: [], dadosInformados: null, encerramento: null,
  };
  for (const e of opEvents) {
    const t = e.type;
    if (t === 'OPERACAO_IDENTIFICADA') { op.tacUserId = e.actor.userId; op.tacNome = e.actor.name; }
    if (t === 'OPERACAO_RETIFICADA') { op[e.payload.campo] = e.payload.novo; st.retificacoes.push(e); }
    if (MILESTONES[t]) st.milestones[t] = e;
    else if (CONFIRMATION_OF[t]) st.confirmations[e.refEventId] = e;
    else if (t === 'DIVERGENCIA') st.divergences.push(e);
    else if (t === 'OCORRENCIA_TRATADA') st.treatments[e.refEventId] = e;
    else if (t === 'APURACAO') st.apuracoes.push(e);
    else if (t === 'PAGAMENTO_REGISTRADO') st.pagamentos.push(e);
    else if (t === 'SITUACAO_FINANCEIRA') st.situacoes.push(e);
    else if (t === 'DOSSIE_GERADO') st.dossies.push(e);
    else if (t === 'ENCAMINHADO_JURIDICO' || t === 'JURIDICO_STATUS') st.juridico.push(e);
    else if (OCORRENCIAS[t]) st.ocorrencias.push(e);
    else if (t.startsWith('LINK_')) st.links.push(e);
    else if (t === 'DADOS_INFORMADOS') st.dadosInformados = e;
    else if (t === 'OPERACAO_ENCERRADA') st.encerramento = e;
  }
  st.encaminhado = st.juridico.find((e) => e.type === 'ENCAMINHADO_JURIDICO') || null;
  const ultimoJur = st.juridico[st.juridico.length - 1] || null;
  st.statusJuridico = ultimoJur ? (ultimoJur.type === 'ENCAMINHADO_JURIDICO' ? 'ENVIADO' : ultimoJur.payload.status) : null;
  st.divergenciasAbertas = st.divergences.filter((d) => !st.treatments[d.id]);
  st.encerrada = !!st.encerramento;
  st.saida = !!st.milestones.SAIDA;
  st.financeiro = financeiro(st);
  st.statusCode = statusCode(st);
  st.status = STATUS[st.statusCode];
  return st;
}

function statusCode(st) {
  const ms = st.milestones, c = (t) => ms[t] && st.confirmations[ms[t].id];
  if (st.encerrada) return 'ENCERRADA';
  if (st.encaminhado) return 'ENCAMINHADA_JURIDICO';
  if (ms.SAIDA) return st.apuracoes.length ? st.financeiro.status : 'SAIDA_REGISTRADA';
  if (ms.LIBERACAO) return c('LIBERACAO') ? 'LIBERACAO_CONFIRMADA' : 'LIBERADA';
  if (ms.TERMINO) return c('TERMINO') ? 'TERMINO_CONFIRMADO' : 'OPERACAO_FINALIZADA';
  if (ms.INICIO) return c('INICIO') ? 'INICIO_CONFIRMADO' : 'OPERACAO_INICIADA';
  if (ms.CHEGADA) return c('CHEGADA') ? 'CHEGADA_CONFIRMADA' : 'AGUARDANDO_CONFIRMACAO_CHEGADA';
  if (ms.OPERACAO_IDENTIFICADA) return 'AGUARDANDO_CHEGADA';
  return 'CRIADA';
}

// ---------- Conciliação financeira (Épico 14) ----------
const round2 = (v) => Math.round(v * 100) / 100;
function financeiro(st) {
  const ultima = st.apuracoes[st.apuracoes.length - 1];
  const devido = ultima ? ultima.payload.valorDevido : null;
  const pago = round2(st.pagamentos.reduce((s, p) => s + p.payload.valor, 0));
  const saldo = devido == null ? null : round2(devido - pago);
  const situacao = st.situacoes.length ? st.situacoes[st.situacoes.length - 1].payload.situacao : 'NORMAL';
  let status = null;
  if (devido != null) {
    if (devido === 0 && pago === 0) status = 'APURADA';
    else if (pago > devido) status = 'VALOR_DIVERGENTE';
    else if (devido > 0 && pago >= devido) status = 'PAGO';
    else if (situacao === 'EM_TRATATIVA' || situacao === 'VALOR_DIVERGENTE') status = situacao;
    else if (pago === 0) status = 'AGUARDANDO_PAGAMENTO';
    else status = 'PAGAMENTO_PARCIAL';
  }
  const percentual = devido ? Math.round((Math.min(pago, devido) / devido) * 1000) / 10 : null;
  return { devido, pago, saldo, status, situacao, percentualRecebido: percentual };
}

const ORIGENS_PAGAMENTO = {
  acordo_direto: 'Acordo direto', pagamento_comercial: 'Pagamento comercial', retencao: 'Retenção',
  pagamento_administrativo: 'Pagamento administrativo', negociacao: 'Decorrente de negociação',
  processo_juridico: 'Decorrente de processo jurídico', outros: 'Outros',
};

// ---------- Validação de eventos enviados por usuários ----------
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

const isParty = (st, user) => user.role === 'admin'
  || (user.role === 'tac' && st.op.tacUserId === user.id)
  || (user.role === 'destino' && st.op.destinoOrgId === user.orgId);

function validateEvent(st, user, input, nowMs = Date.now()) {
  const type = String(input.type || '');
  const role = user.role;
  if (st.encerrada) throw new DomainError(409, 'ENCERRADA', 'Operação encerrada. Não aceita novos registros.');
  const occurredAt = parseTime(input.occurredAt, nowMs);
  const note = input.note ? String(input.note).slice(0, 1000) : undefined;
  const all = [...Object.values(st.milestones), ...Object.values(st.confirmations), ...st.divergences];
  const byId = (id) => all.find((e) => e.id === id);

  if (type === 'OPERACAO_IDENTIFICADA') throw new DomainError(400, 'USE_IDENTIFICACAO', 'Use a identificação da operação.');

  if (MILESTONES[type]) {
    const m = MILESTONES[type];
    if (!m.by.includes(role) || !isParty(st, user)) throw new DomainError(403, 'SEM_PERMISSAO', `Seu perfil não pode registrar "${m.label}".`);
    if (st.milestones[type]) throw new DomainError(409, 'JA_REGISTRADO', `"${m.label}" já foi registrado nesta operação.`);
    for (const req of m.requires) {
      const prev = st.milestones[req];
      if (!prev) throw new DomainError(409, 'FORA_DE_SEQUENCIA', `Registre antes: ${MILESTONES[req].label}.`);
      if (Date.parse(occurredAt) < Date.parse(prev.occurredAt)) throw new DomainError(409, 'ANTES_DO_ANTERIOR', `O horário não pode ser anterior a "${MILESTONES[req].label}".`);
    }
    if (m.photo === 'required' && !input.hasPhoto) throw new DomainError(400, 'FOTO_OBRIGATORIA', `${m.photoLabel || 'A foto'} é obrigatória neste registro.`);
    let gps = validGps(input.gps);
    if (m.gps === 'capturar' && !gps) gps = { erro: 'Localização não enviada' };
    return { type, occurredAt, note, gps };
  }

  if (CONFIRMATION_OF[type]) {
    const refType = CONFIRMATION_OF[type];
    const ref = st.milestones[refType];
    if (!ref || ref.id !== input.refEventId) throw new DomainError(409, 'SEM_REGISTRO', `Não há "${MILESTONES[refType].label}" para confirmar.`);
    if (!['tac', 'destino', 'admin'].includes(role) || !isParty(st, user)) throw new DomainError(403, 'SEM_PERMISSAO', 'Somente as partes da operação confirmam.');
    if (ref.actor.role === role) throw new DomainError(403, 'MESMA_PARTE', 'A confirmação deve ser feita pela outra parte da operação.');
    if (st.confirmations[ref.id]) throw new DomainError(409, 'JA_CONFIRMADO', 'Este registro já foi confirmado.');
    return { type, occurredAt, refEventId: ref.id, note };
  }

  if (type === 'DIVERGENCIA') {
    const ref = byId(input.refEventId);
    if (!ref || !MILESTONES[ref.type]) throw new DomainError(400, 'REF_INVALIDA', 'Selecione o registro contestado.');
    if (!['tac', 'destino'].includes(role) || !isParty(st, user) || ref.actor.role === role) throw new DomainError(403, 'MESMA_PARTE', 'Só a outra parte pode contestar este registro.');
    if (!note || note.trim().length < 5) throw new DomainError(400, 'DESCRICAO', 'Descreva a divergência.');
    return { type, occurredAt, refEventId: ref.id, note, alegadoEm: input.alegadoEm ? parseTime(input.alegadoEm, nowMs) : undefined };
  }

  if (type === 'OCORRENCIA_TRATADA') {
    if (!can(user, 'tratar_divergencia')) throw new DomainError(403, 'SEM_PERMISSAO', 'Seu perfil não trata ocorrências.');
    const div = st.divergences.find((d) => d.id === input.refEventId) || st.ocorrencias.find((d) => d.id === input.refEventId);
    if (!div) throw new DomainError(400, 'REF_INVALIDA', 'Ocorrência não encontrada.');
    if (st.treatments[div.id]) throw new DomainError(409, 'JA_TRATADA', 'Ocorrência já tratada.');
    if (!note || note.trim().length < 5) throw new DomainError(400, 'DESCRICAO', 'Descreva o tratamento.');
    const resolucao = ['procedente', 'improcedente', 'acordo'].includes(input.resolucao) ? input.resolucao : 'acordo';
    return { type, occurredAt, refEventId: div.id, note, resolucao };
  }

  if (type === 'PAGAMENTO_REGISTRADO') {
    if (!can(user, 'registrar_pagamento') || (role === 'tac' && st.op.tacUserId !== user.id)) throw new DomainError(403, 'SEM_PERMISSAO', 'Seu perfil não registra pagamentos.');
    if (!st.apuracoes.length) throw new DomainError(409, 'SEM_APURACAO', 'Registre pagamentos depois da apuração.');
    const valor = round2(Number(String(input.valor).replace(',', '.')));
    if (!(valor > 0)) throw new DomainError(400, 'VALOR', 'Informe o valor recebido.');
    const origem = ORIGENS_PAGAMENTO[input.origem] ? input.origem : 'outros';
    return { type, occurredAt, note, valor, origem };
  }

  if (type === 'SITUACAO_FINANCEIRA') {
    if (!can(user, 'registrar_pagamento')) throw new DomainError(403, 'SEM_PERMISSAO', 'Seu perfil não altera a situação financeira.');
    if (!st.apuracoes.length) throw new DomainError(409, 'SEM_APURACAO', 'Disponível depois da apuração.');
    const situacao = ['EM_TRATATIVA', 'VALOR_DIVERGENTE', 'NORMAL'].includes(input.situacao) ? input.situacao : null;
    if (!situacao) throw new DomainError(400, 'SITUACAO', 'Situação inválida.');
    return { type, occurredAt, note, situacao };
  }

  throw new DomainError(400, 'TIPO_INVALIDO', 'Tipo de evento não suportado.');
}

// ---------- Ações disponíveis para o usuário ----------
function nextActions(st, user) {
  const out = [];
  if (st.encerrada || !['tac', 'destino'].includes(user.role) || !isParty(st, user)) return out;
  const role = user.role, ms = st.milestones;
  for (const type of SEQUENCE) {
    const m = MILESTONES[type];
    if (type === 'OPERACAO_IDENTIFICADA' || ms[type] || !m.by.includes(role)) continue;
    if (!m.requires.every((r) => ms[r])) continue;
    if (type === 'SAIDA' && !ms.TERMINO) continue;
    out.push({ type, label: m.label.replace(' registrada', '').replace(' registrado', ''), gps: m.gps || null, photo: m.photo || null, photoLabel: m.photoLabel || null, kind: 'registro',
      aviso: type === 'SAIDA' && !ms.LIBERACAO ? 'A liberação para viagem ainda não foi registrada.' : undefined });
  }
  for (const [refType, conf] of Object.entries(CONFIRMATIONS)) {
    const ref = ms[refType];
    if (!ref || st.confirmations[ref.id] || ref.actor.role === role) continue;
    out.push({ type: conf.type, label: conf.label, refEventId: ref.id, kind: 'confirmacao' });
    if (refType !== 'LIBERACAO' && !st.divergences.some((d) => d.refEventId === ref.id)) {
      out.push({ type: 'DIVERGENCIA', label: `Contestar: ${MILESTONES[refType].label}`, refEventId: ref.id, kind: 'divergencia' });
    }
  }
  return out;
}

// ---------- Apuração (Épico 13) ----------
const minutesBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);
const fmtDur = (min) => { min = Math.max(0, Math.round(min)); return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`; };
const fmtNum = (v, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function marcoTime(st, marco) {
  if (CONFIRMATION_OF[marco]) {
    const ref = st.milestones[CONFIRMATION_OF[marco]];
    const c = ref && st.confirmations[ref.id];
    return c ? c.occurredAt : null;
  }
  return st.milestones[marco] ? st.milestones[marco].occurredAt : null;
}

function apurar(st, nowIso = new Date().toISOString(), rule) {
  const chegada = st.milestones.CHEGADA;
  rule = rule || ruleFor(chegada ? chegada.occurredAt : nowIso);
  const inicio = marcoTime(st, rule.marcoInicial);
  const base = { regra: { ...rule }, capacidadeToneladas: Number(st.op.capacidadeToneladas) || 0 };
  if (!inicio) {
    return { ...base, pendente: true, motivo: chegada ? 'Aguardando a confirmação da chegada pelo destino, que inicia o Limite de Estadia.' : 'Aguardando a chegada do veículo.' };
  }
  const fimIso = marcoTime(st, rule.marcoFinal);
  const fim = fimIso || nowIso;
  const tempoMin = Math.max(0, minutesBetween(inicio, fim));
  const horas = tempoMin / 60;
  const cap = base.capacidadeToneladas;
  const excedeu = tempoMin > rule.limiteMin;
  let valorDevido = 0, memoria;
  if (rule.formula === 'TEMPO_TOTAL') {
    valorDevido = excedeu ? round2(horas * cap * rule.valorTonHora) : 0;
    memoria = excedeu
      ? `${fmtNum(horas)} h × ${fmtNum(cap, 1)} t × R$ ${fmtNum(rule.valorTonHora)} = R$ ${fmtNum(valorDevido)}`
      : `Tempo efetivo ${fmtDur(tempoMin)} ≤ limite de ${fmtDur(rule.limiteMin)}: R$ 0,00`;
  } else {
    const exc = Math.max(0, tempoMin - rule.limiteMin) / 60;
    valorDevido = round2(exc * cap * rule.valorTonHora);
    memoria = `${fmtNum(exc)} h excedentes × ${fmtNum(cap, 1)} t × R$ ${fmtNum(rule.valorTonHora)} = R$ ${fmtNum(valorDevido)}`;
  }
  const cenarios = [];
  const add = (label, a, b, ativo = false) => { if (a && b) cenarios.push({ label, inicio: a, fim: b, minutos: Math.max(0, minutesBetween(a, b)), ativo }); };
  add('Chegada confirmada → liberação · regra ativa', inicio, fimIso, true);
  add('Chegada confirmada → saída física', inicio, marcoTime(st, 'SAIDA'));
  add('Chegada registrada pelo TAC → liberação', marcoTime(st, 'CHEGADA'), fimIso);
  return {
    ...base, pendente: false,
    marcoInicial: inicio, marcoFinal: fimIso, emCurso: !fimIso, limiteEm: new Date(Date.parse(inicio) + rule.limiteMin * 60000).toISOString(),
    tempoMin, horas: round2(horas), excedeu, valorDevido, memoria, cenarios,
    ressalva: 'Cálculo pela regra vigente. Não constitui conclusão jurídica.',
  };
}

// ---------- Deslocamento (Épico 05) ----------
function haversineM(a, b) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function pontoReferencia(st) {
  if (st.op.lat != null && st.op.lng != null) return { lat: Number(st.op.lat), lng: Number(st.op.lng), fonte: 'local cadastrado' };
  const g = st.milestones.CHEGADA && st.milestones.CHEGADA.payload.gps;
  if (g && !g.erro) return { lat: g.lat, lng: g.lng, fonte: 'posição da chegada' };
  return null;
}

/** Retorna os dados da ocorrência se a posição estiver fora do Limite de Deslocamento do Local. */
function verificarDeslocamento(st, gps) {
  if (!gps || gps.erro || !st.milestones.CHEGADA || st.milestones.SAIDA) return null;
  const ref = pontoReferencia(st);
  if (!ref) return null;
  const distanciaM = haversineM(gps, ref);
  if (distanciaM <= LIMITE_DESLOCAMENTO_M) return null;
  return { distanciaM, limiteM: LIMITE_DESLOCAMENTO_M, referencia: ref, posicao: gps };
}

// ---------- Alertas calculados (apoio à análise humana) ----------
function alertas(st) {
  const out = [];
  const ms = st.milestones;
  for (const o of st.ocorrencias) {
    if (o.type === 'DESLOCAMENTO_FORA_DO_LIMITE') out.push({ nivel: 'atencao', codigo: o.type, eventoId: o.id, texto: `Deslocamento de ${o.payload.distanciaM} m do local (limite ${o.payload.limiteM} m).${o.payload.simulado ? ' [simulado em demonstração]' : ''}` });
    if (o.type === 'GPS_INDISPONIVEL') out.push({ nivel: 'atencao', codigo: o.type, eventoId: o.id, texto: `GPS indisponível em "${o.payload.marco}": ${o.payload.motivo}.` });
  }
  for (const e of Object.values(ms)) {
    const atraso = minutesBetween(e.occurredAt, e.receivedAt);
    if (atraso >= 10) out.push({ nivel: 'info', codigo: 'SINCRONIZACAO_TARDIA', eventoId: e.id, texto: `${MILESTONES[e.type].label}: feito sem conexão e sincronizado ${atraso} min depois. Horário original preservado.` });
  }
  const after = { CHEGADA: 'INICIO', INICIO: 'TERMINO', TERMINO: 'LIBERACAO' };
  for (const [t, next] of Object.entries(after)) {
    if (ms[t] && ms[next] && !st.confirmations[ms[t].id]) out.push({ nivel: 'atencao', codigo: 'SEM_CONFIRMACAO', eventoId: ms[t].id, texto: `${MILESTONES[t].label}: sem confirmação da outra parte.` });
  }
  if (ms.SAIDA && !ms.LIBERACAO) out.push({ nivel: 'atencao', codigo: 'SAIDA_SEM_LIBERACAO', eventoId: ms.SAIDA.id, texto: 'Saída registrada sem liberação para viagem.' });
  if (ms.SAIDA && ms.LIBERACAO) {
    const gap = minutesBetween(ms.LIBERACAO.occurredAt, ms.SAIDA.occurredAt);
    out.push({ nivel: gap > 60 ? 'atencao' : 'info', codigo: 'LIBERACAO_SAIDA', eventoId: ms.SAIDA.id, texto: `Intervalo entre liberação e saída: ${fmtDur(gap)}.` });
  }
  for (const d of st.divergenciasAbertas) out.push({ nivel: 'atencao', codigo: 'DIVERGENCIA', eventoId: d.id, texto: `Divergência aberta: ${d.payload.note}` });
  return out;
}

function elegivelJuridico(st) {
  const motivos = [];
  if (!st.saida) motivos.push('A saída ainda não foi registrada.');
  if (!st.dossies.length) motivos.push('Gere o dossiê digital antes de encaminhar.');
  if (st.encaminhado) motivos.push('Esta operação já foi encaminhada.');
  if (st.encerrada) motivos.push('Operação encerrada.');
  return { apto: motivos.length === 0, motivos };
}

const CAMPOS_RETIFICAVEIS = {
  capacidadeToneladas: 'Capacidade do veículo (t)', pesoToneladas: 'Peso (t)', volume: 'Volume', mercadoria: 'Carga',
  implemento: 'Implemento', nfe: 'NF-e', cte: 'CT-e', mdfe: 'MDF-e', localNome: 'Local', responsavelNome: 'Responsável no destino',
  responsavelTelefone: 'Telefone do responsável', observacoes: 'Observações',
};

module.exports = {
  DomainError, PERMISSOES, can, MILESTONES, SEQUENCE, CONFIRMATIONS, CONFIRMATION_OF, OCORRENCIAS, STATUS, RULES, ruleFor,
  LIMITE_DESLOCAMENTO_M, ORIGENS_PAGAMENTO, CAMPOS_RETIFICAVEIS,
  labelOf, kindOf, project, validateEvent, nextActions, apurar, alertas, haversineM, verificarDeslocamento,
  pontoReferencia, fmtDur, elegivelJuridico, financeiro, round2, isParty,
};
