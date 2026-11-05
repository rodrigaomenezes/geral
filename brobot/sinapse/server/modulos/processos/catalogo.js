'use strict';
// Vocabulário do motor de processos (regra pura, sem banco). Um processo é:
//   { gatilho, condicoes[], encerrarSe[], passos[] }
// Gatilho = evento do sistema; condições = filtro para começar; encerrarSe = quando parar no meio
// (checado antes de cada passo e sempre que algo muda na conta/ocorrência); passos = o que fazer, em ordem.

const GATILHOS = {
  'ocorrencia.criada': { rotulo: 'Uma ocorrência é aberta', entidade: 'ocorrencia', eventos: ['ocorrencia.criada'] },
  'ocorrencia.estado': { rotulo: 'Uma ocorrência muda de situação', entidade: 'ocorrencia', eventos: ['*ocorrencia'] },
  'ocorrencia.espera': { rotulo: 'Uma ocorrência passa a aguardar cliente ou terceiro', entidade: 'ocorrencia', eventos: ['ocorrencia.em_espera'] },
  'ocorrencia.escalonada': { rotulo: 'Uma ocorrência é escalonada por prazo vencido', entidade: 'ocorrencia', eventos: ['ocorrencia.escalonada'] },
  'ocorrencia.reaberta': { rotulo: 'Uma ocorrência é reaberta', entidade: 'ocorrencia', eventos: ['ocorrencia.reaberta'] },
  'rodada.pendencias': { rotulo: 'A pré-rodada (D-4) encontra pendências do cliente', entidade: 'rodada', eventos: ['rodada.pendencias_detectadas'] },
  'rodada.executada': { rotulo: 'A rodada oficial (D0) é executada', entidade: 'rodada', eventos: ['rodada.executada'] },
  'oportunidade.etapa': { rotulo: 'Uma oportunidade do Comercial muda de etapa', entidade: 'oportunidade', eventos: ['oportunidade.etapa'] },
  'oportunidade.ganha': { rotulo: 'Uma venda é fechada (oportunidade ganha)', entidade: 'oportunidade', eventos: ['oportunidade.ganha'] },
  'contas.manual': { rotulo: 'Ao clicar em "Executar agora", para cada conta que atende às condições', entidade: 'conta', eventos: [] },
  'contas.semanal': { rotulo: 'Toda semana, para cada conta que atende às condições', entidade: 'conta', eventos: [], agenda: true },
};

// Campos que condições e textos podem usar. `tipo` define os operadores permitidos.
const CAMPOS = {
  'ocorrencia.tipo': { rotulo: 'Tipo da ocorrência', tipo: 'lista', valores: ['duvida', 'erro_consulta', 'credencial', 'pre_rodada', 'pos_rodada', 'onboarding', 'tecnica', 'incidente', 'solicitacao', 'nao_classificada'] },
  'ocorrencia.prioridade': { rotulo: 'Prioridade', tipo: 'lista', valores: ['baixa', 'media', 'alta', 'critica'] },
  'ocorrencia.estado': { rotulo: 'Situação da ocorrência', tipo: 'lista', valores: ['triagem', 'aberta', 'em_atendimento', 'aguardando_cliente', 'aguardando_terceiro', 'em_handoff', 'resolvida', 'encerrada_sem_resolucao'] },
  'ocorrencia.origem': { rotulo: 'Canal de origem', tipo: 'lista', valores: ['whatsapp', 'email', 'portal', 'api', 'platform', 'interna'] },
  'ocorrencia.equipe': { rotulo: 'Equipe dona', tipo: 'texto' },
  'ocorrencia.encerrada': { rotulo: 'Ocorrência encerrada', tipo: 'booleano' },
  'ocorrencia.nivel_escalonamento': { rotulo: 'Nível de escalonamento', tipo: 'numero' },
  'conta.vip': { rotulo: 'Cliente VIP', tipo: 'booleano' },
  'conta.tem_ponto_focal': { rotulo: 'Cliente tem ponto focal', tipo: 'booleano' },
  'conta.status': { rotulo: 'Situação da conta', tipo: 'lista', valores: ['onboarding', 'ativa', 'suspensa', 'encerrada'] },
  'conta.tem_grupo': { rotulo: 'Cliente tem grupo de WhatsApp', tipo: 'booleano' },
  'ligacao.atendeu': { rotulo: 'A última ligação do processo foi atendida', tipo: 'booleano' },
  'oportunidade.etapa': { rotulo: 'Etapa da oportunidade', tipo: 'lista', valores: ['novo', 'qualificacao', 'demonstracao', 'proposta', 'teste', 'negociacao', 'suspensa', 'ganha', 'perdida'] },
  'oportunidade.teste_resultado': { rotulo: 'Resultado do teste', tipo: 'lista', valores: ['pendente', 'aprovado', 'reprovado'] },
  'oportunidade.valor_mensal': { rotulo: 'Valor mensal da oportunidade (R$)', tipo: 'numero' },
  'oportunidade.dias_na_etapa': { rotulo: 'Dias na etapa atual', tipo: 'numero' },
  'cliente.respondeu': { rotulo: 'Cliente respondeu depois do início', tipo: 'booleano' },
  'pendencias.abertas': { rotulo: 'Pendências do cliente em aberto', tipo: 'numero' },
  'rodada.executada': { rotulo: 'Rodada oficial já executada', tipo: 'booleano' },
  'rodada.produto': { rotulo: 'Produto da rodada', tipo: 'texto' },
  'rodada.falhas': { rotulo: 'Veículos com falha na rodada', tipo: 'numero' },
};

const OPERADORES = {
  igual: { rotulo: 'é', tipos: ['lista', 'texto', 'numero', 'booleano'] },
  diferente: { rotulo: 'não é', tipos: ['lista', 'texto', 'numero', 'booleano'] },
  em: { rotulo: 'é um de', tipos: ['lista', 'texto'] },
  maior: { rotulo: 'é maior que', tipos: ['numero'] },
  menor: { rotulo: 'é menor que', tipos: ['numero'] },
};

// Passos. `params`: nome → { tipo, obrigatorio, valores?, rotulo }.
const PASSOS = {
  esperar: { rotulo: 'Esperar', params: {
    horas: { tipo: 'numero', rotulo: 'Horas de espera (a partir de agora)' },
    ateD0Horas: { tipo: 'numero', rotulo: 'Ou até X horas antes(-)/depois(+) do D0 da rodada' },
  } },
  enviar_mensagem: { rotulo: 'Enviar mensagem', params: {
    destino: { tipo: 'lista', rotulo: 'Para quem', valores: ['ponto_focal', 'grupo', 'grupo_e_ponto_focal'], obrigatorio: true },
    modelo: { tipo: 'lista', rotulo: 'Modelo', valores: ['pre_rodada_d3', 'pre_rodada_d1', 'formalizacao_ligacao', 'formalizacao_combinado', 'comunicado_rodada', 'pos_rodada_d3', 'lembrete_cliente', 'insights_caca_condutores', 'texto_livre'], obrigatorio: true },
    texto: { tipo: 'texto', rotulo: 'Texto (para texto livre; use {conta}, {protocolo}, {nome}, {qtd_pendencias})' },
  } },
  ligar: { rotulo: 'Ligar para o ponto focal e esperar o resultado', params: {
    equipe: { tipo: 'equipe', rotulo: 'Quem liga (equipe; "da conta" = VIP→CS, demais→Suporte)', obrigatorio: true },
    prazoHoras: { tipo: 'numero', rotulo: 'Prazo para ligar (horas)', obrigatorio: true },
    roteiro: { tipo: 'texto', rotulo: 'Roteiro da ligação' },
  } },
  criar_tarefa: { rotulo: 'Criar tarefa', params: {
    titulo: { tipo: 'texto', rotulo: 'Título (aceita {conta}, {protocolo}, {qtd_pendencias})', obrigatorio: true },
    equipe: { tipo: 'equipe', rotulo: 'Equipe (ou "da conta" = VIP→CS, demais→Suporte)', obrigatorio: true },
    tipoTarefa: { tipo: 'lista', rotulo: 'Tipo de tarefa', valores: ['geral', 'ligacao', 'validar_correcao', 'revisar_espera'] },
    prazoHoras: { tipo: 'numero', rotulo: 'Prazo em horas', obrigatorio: true },
  } },
  lembrete: { rotulo: 'Criar lembrete', params: {
    para: { tipo: 'equipe', rotulo: 'Para quem ("responsável" = dono da oportunidade/ocorrência; "da conta" = VIP→CS, demais→Suporte)', obrigatorio: true },
    texto: { tipo: 'texto', rotulo: 'Texto do lembrete (aceita {conta}, {empresa}, {protocolo})', obrigatorio: true },
    emHoras: { tipo: 'numero', rotulo: 'Lembrar daqui a quantas horas', obrigatorio: true },
  } },
  mudar_prioridade: { rotulo: 'Mudar a prioridade da ocorrência', params: {
    prioridade: { tipo: 'lista', rotulo: 'Nova prioridade', valores: ['baixa', 'media', 'alta', 'critica'], obrigatorio: true },
  } },
  transferir: { rotulo: 'Mudar a equipe dona da ocorrência', params: {
    equipe: { tipo: 'equipe', rotulo: 'Equipe', obrigatorio: true },
  } },
  nota: { rotulo: 'Registrar nota interna na ocorrência', params: {
    texto: { tipo: 'texto', rotulo: 'Texto da nota', obrigatorio: true },
  } },
  escalar: { rotulo: 'Escalar para a Supervisão', params: {
    motivo: { tipo: 'texto', rotulo: 'Motivo', obrigatorio: true },
  } },
};

const ROTULO_VALOR = {
  duvida: 'dúvida', erro_consulta: 'erro de consulta', credencial: 'credencial', pre_rodada: 'pré-rodada', pos_rodada: 'pós-rodada',
  tecnica: 'técnica', solicitacao: 'solicitação', nao_classificada: 'não classificada', media: 'média', critica: 'crítica',
  aguardando_cliente: 'aguardando cliente', aguardando_terceiro: 'aguardando terceiro', em_atendimento: 'em atendimento',
  em_handoff: 'em transferência', encerrada_sem_resolucao: 'encerrada sem resolução', da_conta: 'da conta (VIP→CS, demais→Suporte)',
  responsavel: 'o responsável', novo: 'novo lead', qualificacao: 'qualificação', demonstracao: 'demonstração', negociacao: 'negociação', pendente: 'pendente',
  ponto_focal: 'o ponto focal', grupo: 'o grupo do cliente', grupo_e_ponto_focal: 'o grupo e o ponto focal',
};
const rv = (v) => (Array.isArray(v) ? v.map(rv).join(' ou ') : typeof v === 'boolean' ? (v ? 'sim' : 'não') : ROTULO_VALOR[v] || String(v));

const NOMES_MODELO = {
  pre_rodada_d3: 'Pré-rodada · aviso D-3', pre_rodada_d1: 'Pré-rodada · lembrete D-1', formalizacao_ligacao: 'Formalização: tentamos ligar',
  formalizacao_combinado: 'Formalização: combinado por telefone',
  comunicado_rodada: 'Comunicado da rodada (sucesso e falha por veículo)', pos_rodada_d3: 'Pós-rodada · follow-up D+3',
  lembrete_cliente: 'Lembrete: aguardamos seu retorno', insights_caca_condutores: 'Insights do CaçaCondutores',
};

const descreverCondicao = (c) => `${CAMPOS[c.campo]?.rotulo || c.campo} ${OPERADORES[c.operador]?.rotulo || c.operador} ${rv(c.valor)}`;

function descreverPasso(p) {
  switch (p.tipo) {
    case 'esperar': return p.ateD0Horas !== undefined && p.ateD0Horas !== null
      ? `Esperar até ${Math.abs(p.ateD0Horas / 24) >= 1 && p.ateD0Horas % 24 === 0 ? `D${p.ateD0Horas >= 0 ? '+' : ''}${p.ateD0Horas / 24}` : `${p.ateD0Horas} h do D0`}`
      : `Esperar ${p.horas >= 24 && p.horas % 24 === 0 ? `${p.horas / 24} dia(s)` : `${p.horas} hora(s)`}`;
    case 'enviar_mensagem': return p.modelo === 'texto_livre' ? `Enviar para ${rv(p.destino)}: "${p.texto}"` : `Enviar para ${rv(p.destino)} a mensagem "${NOMES_MODELO[p.modelo] || p.modelo}"`;
    case 'ligar': return `Ligar para o ponto focal (${rv(p.equipe)}, prazo ${p.prazoHoras} h) e esperar o resultado`;
    case 'criar_tarefa': return `Criar tarefa "${p.titulo}" para ${rv(p.equipe)} com prazo de ${p.prazoHoras} h`;
    case 'lembrete': return `Lembrar ${rv(p.para)} em ${p.emHoras} h: "${p.texto}"`;
    case 'mudar_prioridade': return `Mudar prioridade para ${rv(p.prioridade)}`;
    case 'transferir': return `Passar a ocorrência para a equipe ${rv(p.equipe)}`;
    case 'nota': return `Registrar nota: "${p.texto}"`;
    case 'escalar': return `Escalar para a Supervisão: ${p.motivo}`;
    default: return p.tipo;
  }
}

/** Frase em português do processo inteiro (para a lista e para revisar antes de ativar). */
function descrever(d) {
  const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  const quando = GATILHOS[d.gatilho]?.agenda && d.agenda ? `Toda ${DIAS[d.agenda.diaSemana]}, às ${d.agenda.hora}h, para cada conta que atende às condições` : GATILHOS[d.gatilho]?.rotulo || d.gatilho;
  const partes = [`Quando: ${quando}.`];
  if (d.condicoes?.length) partes.push(`Se: ${d.condicoes.map(descreverCondicao).join(' e ')}.`);
  partes.push(...(d.passos || []).map((p, i) => `${i + 1}. ${p.seCondicoes?.length ? `(se ${p.seCondicoes.map(descreverCondicao).join(' e ')}) ` : ''}${descreverPasso(p)}.`));
  if (d.encerrarSe?.length) partes.push(`Para sozinho se: ${d.encerrarSe.map(descreverCondicao).join(' ou ')}.`);
  return partes.join(' ');
}

module.exports = { GATILHOS, CAMPOS, OPERADORES, PASSOS, NOMES_MODELO, descrever, descreverPasso, descreverCondicao };
