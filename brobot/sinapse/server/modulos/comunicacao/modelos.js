'use strict';
// Modelos de mensagem versionados (COM-001, COM-003). Mudar o texto = nova versão; a interação guarda
// `codigo@versao` usado. Variáveis obrigatórias são validadas antes de enviar.

const MODELOS = {
  resposta_atendimento: {
    versao: 1, nome: 'Resposta do atendimento', variaveis: ['texto'],
    texto: '{texto}',
  },
  pre_rodada_d3: {
    versao: 1, nome: 'Pré-rodada · aviso D-3', variaveis: ['nome', 'conta', 'produto', 'data', 'qtd', 'lista', 'protocolo'],
    texto: 'Olá, {nome}! Na conferência da rodada {produto} de {data} da {conta}, encontramos {qtd} pendência(s) que '
      + 'impedem a consulta:\n{lista}\nAssim que corrigir, nós revalidamos automaticamente. Protocolo {protocolo}.',
  },
  pre_rodada_d1: {
    versao: 1, nome: 'Pré-rodada · lembrete D-1', variaveis: ['nome', 'conta', 'produto', 'data', 'qtd', 'lista', 'protocolo'],
    texto: 'Olá, {nome}. Lembrete: a rodada {produto} da {conta} é amanhã ({data}) e ainda há {qtd} pendência(s):\n{lista}\n'
      + 'Sem a correção, esses veículos não serão consultados. Protocolo {protocolo}.',
  },
  pos_rodada_inicial: {
    versao: 1, nome: 'Pós-rodada · resultado', variaveis: ['nome', 'conta', 'produto', 'sucesso', 'total', 'lista', 'protocolo'],
    texto: 'Olá, {nome}. A rodada {produto} da {conta} foi concluída: {sucesso} de {total} veículos consultados com sucesso.\n'
      + 'Veículos com pendência:\n{lista}\nProtocolo {protocolo}.',
  },
  formalizacao_ligacao: {
    versao: 1, nome: 'Formalização: tentamos ligar', variaveis: ['nome', 'conta', 'qtd', 'lista', 'protocolo'],
    texto: 'Olá, {nome}. Tentamos falar com você por telefone sobre {qtd} pendência(s) da {conta} que impedem a consulta:\n{lista}\n'
      + 'Pode nos responder por aqui? Assim que corrigir, avise e nós revalidamos. Protocolo {protocolo}.',
  },
  comunicado_rodada: {
    versao: 1, nome: 'Comunicado da rodada (sucesso e falha por veículo)', variaveis: ['nome', 'conta', 'produto', 'sucesso', 'total', 'lista_sucesso', 'lista', 'protocolo'],
    texto: 'Olá, {nome}. A rodada {produto} da {conta} foi concluída: {sucesso} de {total} veículos consultados com sucesso.\n'
      + 'Consultados com sucesso: {lista_sucesso}\nNão consultados (pendência do cadastro):\n{lista}\n'
      + 'Quando corrigir, por favor nos avise por aqui para revalidarmos. Protocolo {protocolo}.',
  },
  lembrete_cliente: {
    versao: 1, nome: 'Lembrete: aguardamos seu retorno', variaveis: ['nome', 'conta', 'protocolo'],
    texto: 'Olá, {nome}. Ainda aguardamos o seu retorno sobre o atendimento {protocolo} da {conta}. Se já resolveu, é só nos avisar por aqui.',
  },
  insights_caca_condutores: {
    versao: 1, nome: 'Insights do CaçaCondutores', variaveis: ['nome', 'conta'],
    texto: 'Olá, {nome}! Dica da semana para a {conta}: com o CaçaCondutores você identifica o condutor de cada multa e faz a indicação '
      + 'dentro do prazo, sem perder pontos nem pagar a mais. Quer que a gente mostre em 10 minutos? Responda SAIR para não receber estas dicas.',
  },
  pos_rodada_d3: {
    versao: 1, nome: 'Pós-rodada · acompanhamento D+3', variaveis: ['nome', 'conta', 'qtd', 'lista', 'protocolo'],
    texto: 'Olá, {nome}. Seguimos acompanhando {qtd} pendência(s) da {conta}:\n{lista}\n'
      + 'Precisa de ajuda para corrigir? Responda esta mensagem. Protocolo {protocolo}.',
  },
};

function renderizar(codigo, variaveis) {
  const m = MODELOS[codigo];
  if (!m) throw new Error(`Modelo de mensagem desconhecido: ${codigo}.`);
  const faltam = m.variaveis.filter((v) => variaveis[v] === undefined || variaveis[v] === null || variaveis[v] === '');
  if (faltam.length) throw new Error(`Modelo ${codigo} sem as variáveis: ${faltam.join(', ')}.`);
  const texto = m.texto.replace(/\{(\w+)\}/g, (_, k) => String(variaveis[k]));
  return { texto: texto.slice(0, 4000), modelo: `${codigo}@${m.versao}` };
}

module.exports = { MODELOS, renderizar };
