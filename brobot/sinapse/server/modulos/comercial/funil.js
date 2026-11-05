'use strict';
// Funil padrão de aquisição da Brobot (regra pura): o fechamento só acontece depois de um TESTE aprovado.
//   novo → qualificação → demonstração → proposta → teste → negociação → ganha  (perdida a qualquer momento)
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
  perdida: { rotulo: 'Perdida', ordem: 8, exige: ['motivo_perda'] },
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

function faltando(o, etapa) {
  return ETAPAS[etapa].exige.filter((campo) => {
    if (campo === 'teste_resultado_aprovado') return o.teste_resultado !== 'aprovado';
    if (campo === 'contato_contato') return !o.contato_telefone && !o.contato_email;
    if (campo === 'produtos') return !o.produtos || !o.produtos.length;
    return o[campo] === null || o[campo] === undefined || o[campo] === '';
  });
}

/** Valida a mudança de etapa sobre a oportunidade já com os dados novos aplicados. */
function validarMudanca(atual, proposta, para) {
  if (!ETAPAS[para]) throw erro.entrada(`Etapa desconhecida: ${para}.`);
  if (!ABERTAS.includes(atual.etapa)) throw erro.conflito('Esta oportunidade já foi encerrada (ganha ou perdida).');
  if (para === 'ganha' && atual.etapa !== 'negociacao') {
    throw erro.regra('fechamento_sem_negociacao', 'Só se fecha a partir da Negociação, depois do teste aprovado.');
  }
  if (para === 'negociacao' && !['teste', 'negociacao'].includes(atual.etapa)) {
    throw erro.regra('negociacao_sem_teste', 'Antes da negociação o cliente precisa passar pela fase de Teste.');
  }
  const falta = faltando(proposta, para);
  if (falta.length) {
    throw erro.regra('etapa_incompleta', `Para ir para "${ETAPAS[para].rotulo}" preencha: ${falta.map((c) => NOMES_CAMPOS[c]).join(', ')}.`,
      falta.map((campo) => ({ campo, problema: 'obrigatório nesta etapa' })));
  }
  if (para === 'teste') {
    const ini = new Date(proposta.teste_inicio); const fim = new Date(proposta.teste_fim);
    if (!(fim >= ini)) throw erro.regra('teste_periodo', 'O fim do teste precisa ser depois do início.');
    if ((fim - ini) / 864e5 > 30) throw erro.regra('teste_longo', 'O teste pode durar no máximo 30 dias.');
  }
}

module.exports = { ETAPAS, ABERTAS, PRODUTOS, ORIGENS, MOTIVOS_PERDA, faltando, validarMudanca };
