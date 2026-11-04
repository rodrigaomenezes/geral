'use strict';
// Normalização dos códigos de erro da Platform (PRE-003, REC-002): cada código vira uma categoria estável,
// uma descrição e uma instrução segura para o cliente (sem pedir senha ou certificado por mensagem — CRE-005).

const CATALOGO = {
  SNE_VINCULO_AUSENTE: { categoria: 'vinculo_sne', descricao: 'Veículo sem vínculo ativo no SNE',
    instrucao: 'faça o vínculo do veículo no SNE (Sistema de Notificação Eletrônica) pelo portal Gov.br' },
  CERT_EXPIRADO: { categoria: 'certificado', descricao: 'Certificado digital expirado',
    instrucao: 'renove o certificado digital e atualize-o na Platform Brobot' },
  GOVBR_2FA: { categoria: 'credencial', descricao: 'Conta Gov.br pedindo verificação em duas etapas',
    instrucao: 'conclua a verificação em duas etapas da conta Gov.br na Platform Brobot' },
  CRED_INVALIDA: { categoria: 'credencial', descricao: 'Credencial de acesso inválida',
    instrucao: 'atualize a credencial de acesso na Platform Brobot (nunca envie senha por mensagem)' },
  CRED_AUSENTE: { categoria: 'credencial', descricao: 'Credencial não cadastrada',
    instrucao: 'cadastre a credencial de acesso na Platform Brobot' },
  RENAVAM_DIVERGENTE: { categoria: 'cadastro', descricao: 'Renavam diferente do cadastro do órgão',
    instrucao: 'confira o Renavam da placa no cadastro da Platform Brobot' },
  DETRAN_INDISPONIVEL: { categoria: 'indisponibilidade', descricao: 'Órgão consultado fora do ar',
    instrucao: 'nenhuma ação sua é necessária; a consulta será repetida' },
  TIMEOUT_CONSULTA: { categoria: 'consulta', descricao: 'Consulta excedeu o tempo limite',
    instrucao: 'nenhuma ação sua é necessária; nossa equipe técnica está verificando' },
};

const CATEGORIAS_DO_CLIENTE = ['vinculo_sne', 'certificado', 'credencial', 'cadastro', 'usuario'];

function normalizarErro(codigo) {
  const e = CATALOGO[codigo];
  if (e) return { codigo, ...e, doCliente: CATEGORIAS_DO_CLIENTE.includes(e.categoria) };
  return { codigo: codigo || 'DESCONHECIDO', categoria: 'consulta', descricao: `Erro não catalogado (${codigo})`,
    instrucao: 'nossa equipe técnica está verificando', doCliente: false };
}

module.exports = { CATALOGO, normalizarErro };
