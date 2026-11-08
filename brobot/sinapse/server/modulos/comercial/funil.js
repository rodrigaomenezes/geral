'use strict';
// Funil padrão de aquisição da Brobot (regra pura): o fechamento só acontece depois de um TESTE aprovado — salvo
// quando nenhum produto da oportunidade exige teste no catálogo (DP-04, decidido por produto).
//   novo → qualificação → demonstração → proposta → teste → negociação → ganha  (perdida a qualquer momento)
//   suspensa: sai do funil ativo com data para retomar; reabrir devolve perdida/suspensa à qualificação.
// Cada etapa diz o que precisa estar preenchido para entrar nela; o banco confere as regras críticas de novo.

const { erro } = require('../../nucleo/erros');

const ETAPAS = {
  novo: { rotulo: 'Novo lead', ordem: 1, exige: [] },
  qualificacao: { rotulo: 'Qualificação', ordem: 2, exige: ['contato_nome'] },
  demonstracao: { rotulo: 'Demonstração', ordem: 3, exige: ['contato_nome', 'produtos'] },
  proposta: { rotulo: 'Proposta', ordem: 4, exige: ['produtos', 'frota', 'valor_mensal'] },
  teste: { rotulo: 'Teste', ordem: 5, exige: ['cnpj', 'teste_inicio', 'teste_fim', 'teste_criterio'] },
  negociacao: { rotulo: 'Negociação', ordem: 6, exige: ['teste_resultado_aprovado'] },
  ganha: { rotulo: 'Ganha', ordem: 7, exige: ['cnpj', 'contato_nome', 'contato_contato', 'produtos', 'valor_mensal', 'teste_resultado_aprovado'] },
  suspensa: { rotulo: 'Suspensa', ordem: 8, exige: [] },
  perdida: { rotulo: 'Perdida', ordem: 9, exige: ['motivo_perda'] },
};
const ABERTAS = ['novo', 'qualificacao', 'demonstracao', 'proposta', 'teste', 'negociacao'];

const PRODUTOS = { multas: 'Multas e Notificações', indicacao_condutores: 'Indicação de Condutores', licenciamento: 'Licenciamento',
  caca_condutores: 'CaçaCondutores' };
const ORIGENS = { indicacao: 'Indicação', site: 'Site', evento: 'Evento', outbound: 'Prospecção ativa', parceiro: 'Parceiro', base: 'Base de clientes (expansão)' };
const MOTIVOS_PERDA = { preco: 'Preço', sem_retorno: 'Sem retorno', concorrente: 'Fechou com concorrente', teste_reprovado: 'Teste reprovado',
  sem_fit: 'Sem aderência ao produto', timing: 'Momento (voltar depois)' };

const NOMES_CAMPOS = {
  contato_nome: 'nome do contato', produtos: 'produtos de interesse', frota: 'tamanho da frota', valor_mensal: 'valor mensal',
  cnpj: 'CNPJ', teste_inicio: 'início do teste', teste_fim: 'fim do teste', teste_criterio: 'critério de sucesso do teste',
  teste_resultado_aprovado: 'resultado do teste aprovado', contato_contato: 'telefone ou e-mail do contato', motivo_perda: 'motivo da perda',
};

// CRM-003: funil configurável por organização (decisão da Brobot, 08/11/2026: começa com o padrão e pode ser configurado
// depois, sempre com o teste antes do fechamento). Em `tenants.config.comercial.funis.<funil>`:
//   { versao, omitir: ['qualificacao'|'demonstracao'], rotulos: { etapa: 'Nome' }, exigir: { etapa: ['campo', …] } }
// Só as etapas opcionais podem sair; Novo, Proposta, Teste, Negociação e Ganha ficam sempre (o teste continua
// exigido antes da negociação, salvo o que o catálogo dispensa e a renovação). O que não vale é ignorado e listado.
const OPCIONAIS = ['qualificacao', 'demonstracao'];
const CAMPOS_EXTRAS = ['contato_nome', 'contato_contato', 'produtos', 'frota', 'valor_mensal', 'cnpj'];

function configFunil(config) {
  const cfg = { versao: 0, etapas: [...ABERTAS], rotulos: Object.fromEntries(Object.entries(ETAPAS).map(([k, v]) => [k, v.rotulo])), exigeExtra: {}, problemas: [] };
  if (!config || typeof config !== 'object') return cfg;
  if (Number.isInteger(config.versao) && config.versao > 0) cfg.versao = config.versao;
  for (const e of Array.isArray(config.omitir) ? config.omitir : []) {
    if (OPCIONAIS.includes(e)) cfg.etapas = cfg.etapas.filter((x) => x !== e);
    else cfg.problemas.push(`A etapa "${e}" não pode sair do funil (só ${OPCIONAIS.join(' e ')}).`);
  }
  for (const [e, r] of Object.entries(config.rotulos && typeof config.rotulos === 'object' ? config.rotulos : {})) {
    if (ETAPAS[e] && typeof r === 'string' && r.trim().length >= 2 && r.trim().length <= 40) cfg.rotulos[e] = r.trim();
    else cfg.problemas.push(`Nome inválido para a etapa "${e}" (2 a 40 caracteres, etapa conhecida).`);
  }
  for (const [e, campos] of Object.entries(config.exigir && typeof config.exigir === 'object' ? config.exigir : {})) {
    if (!cfg.etapas.includes(e) && e !== 'ganha') { cfg.problemas.push(`"${e}" não é etapa deste funil.`); continue; }
    const ok = (Array.isArray(campos) ? campos : []).filter((x) => CAMPOS_EXTRAS.includes(x));
    if (ok.length !== (Array.isArray(campos) ? campos.length : 0)) cfg.problemas.push(`Campo não permitido em "${e}" (use: ${CAMPOS_EXTRAS.join(', ')}).`);
    if (ok.length) cfg.exigeExtra[e] = ok;
  }
  return cfg;
}

function faltando(o, etapa, cfg) {
  return [...new Set([...ETAPAS[etapa].exige, ...((cfg && cfg.exigeExtra[etapa]) || [])])].filter((campo) => {
    if (campo === 'teste_resultado_aprovado') return o.teste_resultado !== 'aprovado' && !o.teste_dispensado;
    if (campo === 'contato_contato') return !o.contato_telefone && !o.contato_email;
    if (campo === 'produtos') return !o.produtos || !o.produtos.length;
    return o[campo] === null || o[campo] === undefined || o[campo] === '';
  });
}

/** Valida a mudança de etapa sobre a oportunidade já com os dados novos aplicados.
 *  `proposta.teste_dispensado` = nenhum produto exige teste (o serviço calcula pelo catálogo). */
function validarMudanca(atual, proposta, para, cfg) {
  if (!ETAPAS[para] || para === 'suspensa') throw erro.entrada(`Etapa desconhecida: ${para}.`);
  if (cfg && ABERTAS.includes(para) && !cfg.etapas.includes(para)) {
    throw erro.regra('etapa_fora_do_funil', `A etapa "${ETAPAS[para].rotulo}" não faz parte deste funil. Avance para a próxima etapa do funil.`);
  }
  if (!ABERTAS.includes(atual.etapa)) throw erro.conflito('Esta oportunidade já foi encerrada (ganha ou perdida).');
  if (para === 'ganha' && atual.etapa !== 'negociacao') {
    throw erro.regra('fechamento_sem_negociacao', 'Só se fecha a partir da Negociação, depois do teste aprovado.');
  }
  if (para === 'negociacao' && !['teste', 'negociacao'].includes(atual.etapa) && !(proposta.teste_dispensado && atual.etapa === 'proposta')) {
    throw erro.regra('negociacao_sem_teste', 'Antes da negociação o cliente precisa passar pela fase de Teste.');
  }
  const falta = faltando(proposta, para, cfg);
  if (falta.length) {
    throw erro.regra('etapa_incompleta', `Para ir para "${cfg ? cfg.rotulos[para] : ETAPAS[para].rotulo}" preencha: ${falta.map((c) => NOMES_CAMPOS[c]).join(', ')}.`,
      falta.map((campo) => ({ campo, problema: 'obrigatório nesta etapa' })));
  }
  if (para === 'teste') {
    const ini = new Date(proposta.teste_inicio); const fim = new Date(proposta.teste_fim);
    if (!(fim >= ini)) throw erro.regra('teste_periodo', 'O fim do teste precisa ser depois do início.');
    if ((fim - ini) / 864e5 > 30) throw erro.regra('teste_longo', 'O teste pode durar no máximo 30 dias.');
  }
}

// Funis (CRM-003/014): as mesmas etapas, regras diferentes. Expansão (upsell/cross-sell) e renovação são de cliente
// da carteira; a renovação dispensa o teste (o cliente já usa) e, ao ganhar, troca o valor do contrato.
const FUNIS = { aquisicao: 'Aquisição', expansao: 'Expansão (upsell e cross-sell)', renovacao: 'Renovação' };

// Previsão (CRM-015): probabilidade de fechamento por etapa. Padrão abaixo; cada organização pode ter a sua em
// tenants.config.comercial.probabilidades ({ etapa: 0 a 100 }, definida na implantação). A fórmula em vigor vai para a tela.
const PROBABILIDADE = { novo: 0.1, qualificacao: 0.2, demonstracao: 0.35, proposta: 0.5, teste: 0.65, negociacao: 0.8 };

/** Regra pura: probabilidades da organização sobre o padrão; valor fora de 0–100 (inteiro) é ignorado. */
function probabilidades(config) {
  const p = { ...PROBABILIDADE };
  if (config && typeof config === 'object') {
    for (const etapa of Object.keys(PROBABILIDADE)) {
      const v = Number(config[etapa]);
      if (config[etapa] !== undefined && config[etapa] !== null && Number.isInteger(v) && v >= 0 && v <= 100) p[etapa] = v / 100;
    }
  }
  return p;
}

const formulaPrevisao = (prob) => `Soma, por mês de fechamento previsto, de valor mensal × probabilidade da etapa (${
  Object.entries(prob).map(([e, v]) => `${ETAPAS[e].rotulo} ${Math.round(v * 100)}%`).join(', ')}). Só oportunidades em andamento com data de fechamento prevista.`;

/** Regra pura: previsão ponderada por mês (AAAA-MM), a partir de linhas { etapa, valor_mensal, fechamento_previsto }. */
function previsao(linhas, meses = 3, hoje = new Date(), prob = PROBABILIDADE) {
  const chaves = [];
  for (let i = 0; i < meses; i++) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + i, 1));
    chaves.push(d.toISOString().slice(0, 7));
  }
  const porMes = Object.fromEntries(chaves.map((k) => [k, { mes: k, ponderado: 0, bruto: 0, oportunidades: 0 }]));
  let atrasadas = 0; let semData = 0;
  for (const l of linhas) {
    if (prob[l.etapa] === undefined) continue;
    if (!l.fechamento_previsto) { semData++; continue; }
    const mes = String(l.fechamento_previsto).slice(0, 7);
    if (mes < chaves[0]) { atrasadas++; continue; }
    const alvo = porMes[mes];
    if (!alvo) continue;
    const v = Number(l.valor_mensal || 0);
    alvo.bruto += v; alvo.ponderado += v * prob[l.etapa]; alvo.oportunidades++;
  }
  for (const m of Object.values(porMes)) { m.ponderado = Math.round(m.ponderado * 100) / 100; m.bruto = Math.round(m.bruto * 100) / 100; }
  return { meses: chaves.map((k) => porMes[k]), semData, atrasadas, formula: formulaPrevisao(prob), probabilidade: prob };
}

module.exports = { ETAPAS, ABERTAS, PRODUTOS, ORIGENS, MOTIVOS_PERDA, FUNIS, PROBABILIDADE, OPCIONAIS, CAMPOS_EXTRAS, configFunil, probabilidades, faltando, validarMudanca, previsao };
