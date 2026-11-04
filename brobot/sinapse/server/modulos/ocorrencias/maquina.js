'use strict';
// Máquina de estados das ocorrências (WFL-001, WFL-002, WFL-010, WFL-011, RN-007, RN-008, RN-009). Regra pura:
// recebe a ocorrência, a ação e os dados e devolve as colunas que mudam — ou um erro que diz o que falta.

const { erro } = require('../../nucleo/erros');
const { pode } = require('../identidade/permissoes');
const { somarHorasUteis } = require('./sla');
const { HORA, DIA } = require('../../nucleo/relogio');

const ESTADOS = {
  triagem: 'Triagem',
  aberta: 'Na fila',
  em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando cliente',
  aguardando_terceiro: 'Aguardando terceiro',
  em_handoff: 'Em transferência',
  resolvida: 'Resolvida',
  encerrada_sem_resolucao: 'Encerrada sem resolução',
};
const FINAIS = ['resolvida', 'encerrada_sem_resolucao'];
const ATIVOS = Object.keys(ESTADOS).filter((e) => !FINAIS.includes(e));

const DESFECHOS_RESOLVIDA = {
  corrigido_cliente: 'Cliente corrigiu (confirmado tecnicamente)',
  corrigido_tecnico: 'Correção técnica aplicada e validada',
  orientado: 'Dúvida respondida',
  configurado: 'Configuração concluída',
};
const DESFECHOS_SEM_RESOLUCAO = {
  sem_retorno_cliente: 'Cliente não retornou',
  duplicada: 'Duplicada de outra ocorrência',
  fora_escopo: 'Fora do escopo do atendimento',
  improcedente: 'Improcedente',
  cancelada_cliente: 'Cancelada pelo cliente',
};

const TRANSICOES = {
  classificar: { rotulo: 'Classificar', de: ['triagem'], permissao: 'ocorrencia.triar' },
  assumir: { rotulo: 'Assumir', de: ['aberta'], permissao: 'ocorrencia.atender' },
  devolver_fila: { rotulo: 'Devolver à fila', de: ['em_atendimento'], permissao: 'ocorrencia.atender' },
  aguardar_cliente: { rotulo: 'Aguardar cliente', de: ['em_atendimento'], permissao: 'ocorrencia.atender' },
  aguardar_terceiro: { rotulo: 'Aguardar terceiro', de: ['em_atendimento'], permissao: 'ocorrencia.atender' },
  retomar: { rotulo: 'Retomar', de: ['aguardando_cliente', 'aguardando_terceiro'], permissao: 'ocorrencia.atender' },
  solicitar_handoff: { rotulo: 'Transferir', de: ['aberta', 'em_atendimento', 'aguardando_terceiro'], permissao: 'ocorrencia.atender' },
  aceitar_handoff: { rotulo: 'Aceitar transferência', de: ['em_handoff'], permissao: 'ocorrencia.atender' },
  resolver: { rotulo: 'Resolver', de: ['em_atendimento'], permissao: 'ocorrencia.atender' },
  encerrar_sem_resolucao: { rotulo: 'Encerrar sem resolução', de: ATIVOS, permissao: 'ocorrencia.atender' },
  reabrir: { rotulo: 'Reabrir', de: FINAIS, permissao: 'ocorrencia.atender' },
};

const ehGestor = (u) => u && (u.papel === 'supervisor' || u.papel === 'admin');

function exigir(dados, campos) {
  const faltam = campos.filter((c) => dados[c] === undefined || dados[c] === null || String(dados[c]).trim() === '');
  if (faltam.length) {
    throw erro.entrada('Preencha os campos obrigatórios desta ação.', faltam.map((campo) => ({ campo, problema: 'obrigatório' })));
  }
}

/** Ações que o usuário pode executar agora (para a tela mostrar só os botões válidos). */
function acoesPermitidas(oc, usuario) {
  return Object.entries(TRANSICOES)
    .filter(([, t]) => t.de.includes(oc.estado) && pode(usuario, t.permissao))
    .map(([acao, t]) => ({ acao, rotulo: t.rotulo }));
}

/**
 * Planeja a transição. `ctx`: { usuario, agora, cal, vip, equipeDestino, handoff }.
 * Devolve { para, colunas, evento } — as colunas a gravar e o nome do evento.
 */
function planejar(oc, acao, dados, ctx) {
  const t = TRANSICOES[acao];
  if (!t) throw erro.entrada(`Ação desconhecida: ${acao}.`);
  const { usuario, agora, cal } = ctx;
  if (!pode(usuario, t.permissao)) throw erro.semPermissao(t.rotulo.toLowerCase());
  if (!t.de.includes(oc.estado)) {
    throw erro.conflito(`Não é possível "${t.rotulo}" uma ocorrência em "${ESTADOS[oc.estado]}". Atualize a tela.`,
      { estado: oc.estado });
  }
  const daEquipe = usuario.equipe_id === oc.equipe_id || ehGestor(usuario);
  const passo = (h) => {
    const p = somarHorasUteis(agora, h, cal);
    return oc.prazo_em && p > new Date(oc.prazo_em) ? new Date(oc.prazo_em) : p;
  };
  const c = {};

  switch (acao) {
    case 'classificar': {
      exigir(dados, ['contaId', 'tipo', 'prioridade']);
      c.conta_id = dados.contaId;
      c.tipo = dados.tipo;
      c.prioridade = dados.prioridade;
      c.equipe_id = ctx.equipeDestino;
      c.sla_resposta_em = ctx.prazos.respostaEm;
      c.prazo_em = ctx.prazos.resolucaoEm;
      c.proxima_acao = 'Assumir e responder o cliente';
      c.proxima_acao_em = ctx.prazos.respostaEm;
      return { para: 'aberta', colunas: c, evento: 'ocorrencia.classificada' };
    }
    case 'assumir': {
      if (!daEquipe) throw erro.regra('fora_da_equipe', 'Esta ocorrência está na fila de outra equipe. Peça a transferência.');
      c.responsavel_id = usuario.id;
      c.proxima_acao = oc.primeira_resposta_em ? 'Dar andamento' : 'Responder o cliente';
      c.proxima_acao_em = oc.primeira_resposta_em ? passo(4) : new Date(oc.sla_resposta_em || passo(2));
      return { para: 'em_atendimento', colunas: c, evento: 'ocorrencia.assumida' };
    }
    case 'devolver_fila': {
      exigir(dados, ['motivo']);
      c.responsavel_id = null;
      c.proxima_acao = 'Assumir (devolvida à fila)';
      c.proxima_acao_em = passo(1);
      return { para: 'aberta', colunas: c, evento: 'ocorrencia.devolvida', motivo: dados.motivo };
    }
    case 'aguardar_cliente':
    case 'aguardar_terceiro': {
      // WFL-010: espera não é abandono — exige motivo e data de revisão, no máximo em N dias.
      exigir(dados, ['motivo', 'revisaoEm']);
      const revisao = new Date(dados.revisaoEm);
      if (!(revisao > agora)) throw erro.regra('revisao_no_passado', 'A data de revisão precisa ser no futuro.');
      if (revisao - agora > cal.revisaoEsperaMaxDias * DIA) {
        throw erro.regra('revisao_longa', `A revisão da espera pode ser marcada para no máximo ${cal.revisaoEsperaMaxDias} dias.`);
      }
      c.proxima_acao = `Revisar espera: ${dados.motivo}`.slice(0, 200);
      c.proxima_acao_em = revisao;
      return { para: acao === 'aguardar_cliente' ? 'aguardando_cliente' : 'aguardando_terceiro', colunas: c,
        evento: 'ocorrencia.em_espera', motivo: dados.motivo };
    }
    case 'retomar': {
      c.proxima_acao = 'Dar andamento';
      c.proxima_acao_em = passo(2);
      return { para: 'em_atendimento', colunas: c, evento: 'ocorrencia.retomada' };
    }
    case 'solicitar_handoff': {
      exigir(dados, ['paraEquipe', 'motivo']);
      if (!daEquipe) throw erro.regra('fora_da_equipe', 'Só a equipe dona da ocorrência pode transferi-la.');
      if (ctx.equipeDestino === oc.equipe_id) throw erro.regra('mesma_equipe', 'A ocorrência já está nesta equipe.');
      // RN-007: a equipe de origem continua dona até o aceite (nunca fica sem dono).
      const prazoAceite = new Date(agora.getTime() + cal.handoffAceiteHoras * HORA);
      c.proxima_acao = 'Aguardando aceite da transferência';
      c.proxima_acao_em = prazoAceite;
      return { para: 'em_handoff', colunas: c, evento: 'ocorrencia.handoff_solicitado', motivo: dados.motivo, prazoAceite };
    }
    case 'aceitar_handoff': {
      const h = ctx.handoff;
      if (!h) throw erro.conflito('Não há transferência pendente para esta ocorrência.');
      if (usuario.equipe_id !== h.para_equipe_id && !ehGestor(usuario)) {
        throw erro.regra('fora_da_equipe', 'Só a equipe de destino pode aceitar a transferência.');
      }
      c.equipe_id = h.para_equipe_id;
      c.responsavel_id = usuario.id;
      c.proxima_acao = 'Dar andamento (transferência aceita)';
      c.proxima_acao_em = passo(2);
      return { para: 'em_atendimento', colunas: c, evento: 'ocorrencia.handoff_aceito' };
    }
    case 'resolver': {
      exigir(dados, ['evidencia', 'codigoDesfecho']);
      if (!DESFECHOS_RESOLVIDA[dados.codigoDesfecho]) throw erro.entrada('Escolha um desfecho de resolução válido.');
      if (String(dados.evidencia).trim().length < 10) {
        throw erro.regra('evidencia_curta', 'Descreva a evidência da resolução (o que foi verificado e onde).');
      }
      // DEV-005: demanda técnica só é resolvida após validação operacional (não pelo próprio Desenvolvimento).
      if (oc.tipo === 'tecnica' && usuario.papel === 'dev') {
        throw erro.regra('validacao_operacional', 'Correção técnica precisa ser validada por Operações, Suporte ou CS antes de resolver.');
      }
      Object.assign(c, { evidencia: dados.evidencia, codigo_desfecho: dados.codigoDesfecho, encerrada_em: agora });
      return { para: 'resolvida', colunas: c, evento: 'ocorrencia.resolvida' };
    }
    case 'encerrar_sem_resolucao': {
      exigir(dados, ['motivo', 'codigoDesfecho']);
      if (!DESFECHOS_SEM_RESOLUCAO[dados.codigoDesfecho]) throw erro.entrada('Escolha um motivo de encerramento válido.');
      if (oc.estado === 'triagem' && !ehGestor(usuario) && !pode(usuario, 'ocorrencia.triar')) throw erro.semPermissao('encerrar');
      Object.assign(c, { motivo_encerramento: dados.motivo, codigo_desfecho: dados.codigoDesfecho, encerrada_em: agora });
      return { para: 'encerrada_sem_resolucao', colunas: c, evento: 'ocorrencia.encerrada_sem_resolucao', motivo: dados.motivo };
    }
    case 'reabrir': {
      exigir(dados, ['motivo']);
      Object.assign(c, {
        responsavel_id: null, encerrada_em: null, evidencia: null, motivo_encerramento: null, codigo_desfecho: null,
        reaberturas: (oc.reaberturas || 0) + 1, proxima_acao: 'Assumir (reaberta)', proxima_acao_em: somarHorasUteis(agora, 2, cal),
        prazo_em: somarHorasUteis(agora, 24, cal),
      });
      return { para: 'aberta', colunas: c, evento: 'ocorrencia.reaberta', motivo: dados.motivo };
    }
    default:
      throw erro.entrada(`Ação desconhecida: ${acao}.`);
  }
}

module.exports = { ESTADOS, ATIVOS, FINAIS, TRANSICOES, DESFECHOS_RESOLVIDA, DESFECHOS_SEM_RESOLUCAO, planejar, acoesPermitidas };
