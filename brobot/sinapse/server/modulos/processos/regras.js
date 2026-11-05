'use strict';
// Validação da definição e avaliação de condições (regra pura). Uma definição inválida nunca é salva:
// o erro diz em qual passo e campo está o problema.

const { erro } = require('../../nucleo/erros');
const { GATILHOS, CAMPOS, OPERADORES, PASSOS } = require('./catalogo');

const MAX_PASSOS = 30;
const MAX_ESPERA_HORAS = 24 * 60;

function validarCondicoes(lista, onde, problemas) {
  if (lista === undefined) return [];
  if (!Array.isArray(lista)) { problemas.push({ campo: onde, problema: 'deve ser uma lista' }); return []; }
  return lista.map((c, i) => {
    const campo = CAMPOS[c?.campo];
    const op = OPERADORES[c?.operador];
    const aqui = `${onde}[${i + 1}]`;
    if (!campo) { problemas.push({ campo: aqui, problema: `campo desconhecido: ${c?.campo}` }); return c; }
    if (!op || !op.tipos.includes(campo.tipo)) { problemas.push({ campo: aqui, problema: `operador não serve para ${campo.rotulo}` }); return c; }
    let valor = c.valor;
    if (c.operador === 'em') valor = Array.isArray(valor) ? valor : String(valor ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (campo.tipo === 'numero') valor = Number(valor);
    else if (campo.tipo === 'booleano') valor = valor === true || valor === 'true' || valor === 'sim';
    if (campo.tipo === 'numero' && !Number.isFinite(valor)) problemas.push({ campo: aqui, problema: 'valor deve ser número' });
    if (campo.valores) {
      const vs = Array.isArray(valor) ? valor : [valor];
      if (!vs.length || vs.some((v) => !campo.valores.includes(v))) problemas.push({ campo: aqui, problema: `valor fora da lista (${campo.valores.join(', ')})` });
    }
    return { campo: c.campo, operador: c.operador, valor };
  });
}

/** Valida e normaliza. `equipes`: códigos existentes na organização. */
function validarDefinicao(d, { equipes = [] } = {}) {
  const problemas = [];
  if (!d || typeof d !== 'object') throw erro.entrada('Definição do processo ausente.');
  if (!GATILHOS[d.gatilho]) problemas.push({ campo: 'gatilho', problema: 'escolha quando o processo começa' });
  const condicoes = validarCondicoes(d.condicoes, 'condicoes', problemas);
  let agenda;
  if (GATILHOS[d.gatilho]?.agenda) {
    const dia = Number(d.agenda?.diaSemana); const hora = Number(d.agenda?.hora);
    if (!(dia >= 1 && dia <= 7) || !(hora >= 0 && hora <= 23)) problemas.push({ campo: 'agenda', problema: 'escolha o dia da semana (1 = segunda … 7 = domingo) e a hora (0 a 23)' });
    agenda = { diaSemana: dia, hora };
  }
  const encerrarSe = validarCondicoes(d.encerrarSe, 'encerrarSe', problemas);
  const passos = Array.isArray(d.passos) ? d.passos : [];
  if (!passos.length) problemas.push({ campo: 'passos', problema: 'inclua pelo menos um passo' });
  if (passos.length > MAX_PASSOS) problemas.push({ campo: 'passos', problema: `no máximo ${MAX_PASSOS} passos` });
  const normalizados = passos.map((p, i) => {
    const def = PASSOS[p?.tipo];
    const aqui = `passo ${i + 1}`;
    if (!def) { problemas.push({ campo: aqui, problema: `tipo de passo desconhecido: ${p?.tipo}` }); return p; }
    const n = { tipo: p.tipo };
    for (const [nome, pd] of Object.entries(def.params)) {
      let v = p[nome];
      if (v === '' || v === null) v = undefined;
      if (v === undefined) { if (pd.obrigatorio) problemas.push({ campo: `${aqui}.${nome}`, problema: `${pd.rotulo}: obrigatório` }); continue; }
      if (pd.tipo === 'numero') { v = Number(v); if (!Number.isFinite(v)) { problemas.push({ campo: `${aqui}.${nome}`, problema: 'deve ser número' }); continue; } }
      if (pd.tipo === 'texto') { v = String(v).trim().slice(0, 1000); }
      if (pd.tipo === 'lista' && !pd.valores.includes(v)) { problemas.push({ campo: `${aqui}.${nome}`, problema: 'valor fora da lista' }); continue; }
      if (pd.tipo === 'equipe' && v !== 'da_conta' && !equipes.includes(v)) { problemas.push({ campo: `${aqui}.${nome}`, problema: `equipe inexistente: ${v}` }); continue; }
      n[nome] = v;
    }
    if (p.tipo === 'esperar') {
      const tem = (n.horas !== undefined) !== (n.ateD0Horas !== undefined);
      if (!tem) problemas.push({ campo: aqui, problema: 'informe as horas de espera OU a referência ao D0 (uma das duas)' });
      if (n.horas !== undefined && (n.horas <= 0 || n.horas > MAX_ESPERA_HORAS)) problemas.push({ campo: aqui, problema: `espera entre 0 e ${MAX_ESPERA_HORAS} horas` });
      if (n.ateD0Horas !== undefined && GATILHOS[d.gatilho]?.entidade !== 'rodada') problemas.push({ campo: aqui, problema: 'espera pelo D0 só vale para processos de rodada' });
    }
    if (p.tipo === 'enviar_mensagem' && n.modelo === 'texto_livre' && !n.texto) problemas.push({ campo: aqui, problema: 'escreva o texto da mensagem' });
    if (['criar_tarefa', 'ligar'].includes(p.tipo) && (n.prazoHoras <= 0 || n.prazoHoras > 24 * 30)) problemas.push({ campo: aqui, problema: 'prazo entre 1 hora e 30 dias' });
    const se = validarCondicoes(p.seCondicoes, `${aqui}.seCondicoes`, problemas);
    if (se.length) n.seCondicoes = se;
    return n;
  });
  if (problemas.length) throw erro.entrada('O processo tem itens a corrigir antes de salvar.', problemas);
  return { gatilho: d.gatilho, ...(agenda ? { agenda } : {}), condicoes, encerrarSe, passos: normalizados };
}

function avaliar(c, vars) {
  const v = vars[c.campo];
  switch (c.operador) {
    case 'igual': return v === c.valor;
    case 'diferente': return v !== c.valor;
    case 'em': return Array.isArray(c.valor) && c.valor.includes(v);
    case 'maior': return Number(v) > Number(c.valor);
    case 'menor': return Number(v) < Number(c.valor);
    default: return false;
  }
}

const todas = (lista, vars) => (lista || []).every((c) => avaliar(c, vars));
const alguma = (lista, vars) => (lista || []).some((c) => avaliar(c, vars));

/** Texto com {variaveis} do contexto; variável desconhecida fica visível para não enviar texto quebrado escondido. */
const preencher = (texto, vars) => String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));

module.exports = { validarDefinicao, avaliar, todas, alguma, preencher, MAX_PASSOS };
