'use strict';
// Modelos padrão de checklist (ONB-002…012, CS-012) e regras puras de progresso e conclusão.
// O modelo é por organização e versionado (tabela checklist_modelos); estes são os itens de partida, escritos a partir
// da especificação e da reunião de 03/11. `verificacao` = o sistema confere sozinho quando tem o dado (o item fica
// "feito" com a evidência gerada); sem verificação, a equipe marca com evidência. Prazo em dias corridos da abertura.

const GRUPOS = { administrativa: 'Ativação administrativa', relacionamento: 'Relacionamento', tecnica: 'Ativação técnica (Platform)',
  financeira: 'Sinalização financeira (OMIE)', encerramento: 'Encerramento' };

const PADRAO = {
  onboarding: [
    { codigo: 'dados_cadastrais', titulo: 'Conferir dados cadastrais (razão social, CNPJ, endereço)', grupo: 'administrativa', equipe: 'cs', dias: 2 },
    { codigo: 'contrato', titulo: 'Contrato assinado e arquivado', grupo: 'administrativa', equipe: 'cs', dias: 3, pedidoCliente: 'Enviar o contrato assinado' },
    { codigo: 'produtos', titulo: 'Produtos e módulos contratados conferidos', grupo: 'administrativa', equipe: 'cs', dias: 2, verificacao: 'conta_com_produtos' },
    { codigo: 'vip', titulo: 'Classificação VIP decidida (sim ou não, com critério)', grupo: 'administrativa', equipe: 'cs', dias: 2 },
    { codigo: 'ponto_focal', titulo: 'Ponto focal definido (1 nome + 1 contato)', grupo: 'relacionamento', equipe: 'cs', dias: 2, verificacao: 'ponto_focal' },
    { codigo: 'grupo_whatsapp', titulo: 'Grupo do WhatsApp do cliente cadastrado', grupo: 'relacionamento', equipe: 'suporte', dias: 3, verificacao: 'grupo_whatsapp', obrigatorio: false },
    { codigo: 'provisionamento', titulo: 'Conta e módulos provisionados na Platform (arquivo exportado e confirmado)', grupo: 'tecnica', equipe: 'operacoes', dias: 3, verificacao: 'provisionamento_confirmado' },
    { codigo: 'credenciais', titulo: 'Credenciais e certificados com status OK na Platform (sem copiar segredo)', grupo: 'tecnica', equipe: 'suporte', dias: 5, verificacao: 'credenciais_ok',
      pedidoCliente: 'Cadastrar as credenciais e o certificado direto na Platform (nunca envie senha por mensagem)' },
    { codigo: 'placas', titulo: 'Placas e Renavam importados (lote conferido, rejeições tratadas)', grupo: 'tecnica', equipe: 'operacoes', dias: 5, verificacao: 'placas_conferidas',
      pedidoCliente: 'Enviar a planilha da frota com placa e Renavam' },
    { codigo: 'sne', titulo: 'Vínculo SNE conferido', grupo: 'tecnica', equipe: 'suporte', dias: 5, pedidoCliente: 'Fazer a adesão ao SNE (Sistema de Notificação Eletrônica) com o CNPJ da empresa' },
    { codigo: 'robos', titulo: 'Robôs e agendamentos configurados na Platform', grupo: 'tecnica', equipe: 'operacoes', dias: 5 },
    { codigo: 'primeira_rodada', titulo: 'Primeira rodada executada com sucesso', grupo: 'tecnica', equipe: 'operacoes', dias: 10, verificacao: 'primeira_rodada' },
    { codigo: 'omie', titulo: 'Cliente cadastrado no OMIE (código vinculado no Sinapse)', grupo: 'financeira', equipe: 'financeiro', dias: 3, verificacao: 'omie_vinculado' },
    { codigo: 'treinamento', titulo: 'Treinamento inicial agendado com o cliente', grupo: 'relacionamento', equipe: 'cs', dias: 10, obrigatorio: false },
  ],
  offboarding: [
    { codigo: 'comunicacao', titulo: 'Cliente informado do encerramento e da data', grupo: 'encerramento', equipe: 'cs', dias: 2 },
    { codigo: 'pendencias', titulo: 'Ocorrências e pendências em aberto tratadas', grupo: 'encerramento', equipe: 'suporte', dias: 3, verificacao: 'sem_pendencias' },
    { codigo: 'acesso_platform', titulo: 'Acessos e robôs desligados na Platform', grupo: 'tecnica', equipe: 'operacoes', dias: 2 },
    { codigo: 'financeiro', titulo: 'Financeiro avisado (o encerramento no OMIE é do Financeiro)', grupo: 'financeira', equipe: 'financeiro', dias: 2 },
    { codigo: 'dados', titulo: 'Dados do cliente: exportação entregue ou prazo de retenção definido (LGPD)', grupo: 'encerramento', equipe: 'cs', dias: 5 },
    { codigo: 'aprendizado', titulo: 'Motivo do cancelamento repassado ao CS e ao Comercial', grupo: 'relacionamento', equipe: 'cs', dias: 3, obrigatorio: false },
  ],
};

/** Valida um modelo (itens) antes de salvar uma versão nova. */
function validarItens(itens, equipes) {
  const erros = [];
  if (!Array.isArray(itens) || !itens.length || itens.length > 40) return ['de 1 a 40 itens'];
  const codigos = new Set();
  itens.forEach((i, n) => {
    const aqui = `item ${n + 1}`;
    if (!/^[a-z0-9_]{2,40}$/.test(i.codigo || '')) erros.push(`${aqui}: código inválido`);
    if (codigos.has(i.codigo)) erros.push(`${aqui}: código repetido`);
    codigos.add(i.codigo);
    if (!i.titulo || i.titulo.length < 3 || i.titulo.length > 200) erros.push(`${aqui}: título de 3 a 200 caracteres`);
    if (!GRUPOS[i.grupo]) erros.push(`${aqui}: grupo desconhecido`);
    if (!equipes.includes(i.equipe)) erros.push(`${aqui}: equipe inexistente (${i.equipe})`);
    if (!(Number.isInteger(i.dias) && i.dias >= 0 && i.dias <= 90)) erros.push(`${aqui}: prazo de 0 a 90 dias`);
    if (i.pedidoCliente !== undefined && i.pedidoCliente !== null && (typeof i.pedidoCliente !== 'string' || i.pedidoCliente.length < 5 || i.pedidoCliente.length > 200)) {
      erros.push(`${aqui}: pedido ao cliente de 5 a 200 caracteres`);
    }
  });
  return erros;
}

/** Progresso por grupo e o que ainda impede a conclusão (obrigatório sem feito/dispensado). */
function progresso(itens) {
  const porGrupo = {};
  for (const i of itens) {
    const g = (porGrupo[i.grupo] ||= { grupo: i.grupo, nome: GRUPOS[i.grupo], total: 0, prontos: 0 });
    g.total++; if (['feito', 'dispensado'].includes(i.estado)) g.prontos++;
  }
  const faltam = itens.filter((i) => i.obrigatorio && !['feito', 'dispensado'].includes(i.estado));
  return { grupos: Object.values(porGrupo), faltam: faltam.map((i) => ({ codigo: i.codigo, titulo: i.titulo, estado: i.estado })), podeConcluir: !faltam.length };
}

module.exports = { GRUPOS, PADRAO, validarItens, progresso };
