'use strict';
// Exportações por CSV: o que a Platform e o OMIE precisam receber do Sinapse.

const EXPORTS = {
  omie_novos_clientes: {
    nome: 'Para o OMIE: clientes vendidos que ainda não têm código OMIE (cadastro financeiro)',
    destino: 'omie', permissao: 'integracao.exportar',
    colunas: [{ titulo: 'cnpj', campo: 'cnpj' }, { titulo: 'razao_social', campo: 'nome' }, { titulo: 'produtos', campo: 'produtos' },
      { titulo: 'valor_mensal', valor: (l) => (l.valor_mensal === null ? '' : String(l.valor_mensal).replace('.', ',')) },
      { titulo: 'contato_comercial', campo: 'contato_nome' }, { titulo: 'email', campo: 'contato_email' }, { titulo: 'telefone', campo: 'contato_telefone' },
      { titulo: 'venda', campo: 'codigo' }, { titulo: 'fechada_em', valor: (l) => (l.fechada_em ? new Date(l.fechada_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '') }],
    sql: `SELECT c.cnpj, c.nome, c.produtos, c.valor_mensal, o.contato_nome, o.contato_email, o.contato_telefone, o.codigo, o.fechada_em
          FROM contas c LEFT JOIN oportunidades o ON o.id = c.oportunidade_id WHERE c.id_omie IS NULL AND c.arquivada_em IS NULL ORDER BY c.criado_em`,
  },
  platform_provisionamento: {
    nome: 'Para a Platform: clientes em onboarding a provisionar (conta, módulos e ponto focal)',
    destino: 'platform', permissao: 'integracao.exportar',
    colunas: [{ titulo: 'cnpj', campo: 'cnpj' }, { titulo: 'nome', campo: 'nome' }, { titulo: 'modulos', campo: 'produtos' }, { titulo: 'vip', valor: (l) => (l.vip ? 'sim' : 'não') },
      { titulo: 'ponto_focal', campo: 'pf_nome' }, { titulo: 'telefone', campo: 'pf_telefone' }, { titulo: 'email', campo: 'pf_email' }],
    sql: `SELECT c.cnpj, c.nome, c.produtos, c.vip, p.nome AS pf_nome, p.telefone AS pf_telefone, p.email AS pf_email
          FROM contas c LEFT JOIN pontos_focais p ON p.conta_id = c.id AND p.vigente AND p.papel = 'principal'
          WHERE c.status = 'onboarding' AND c.arquivada_em IS NULL ORDER BY c.nome`,
  },
  platform_carteira: {
    nome: 'Para a Platform: carteira com VIP, equipe responsável e ponto focal (coluna VIP em Consultas e Credenciais)',
    destino: 'platform', permissao: 'integracao.exportar',
    colunas: [{ titulo: 'cnpj', campo: 'cnpj' }, { titulo: 'nome', campo: 'nome' }, { titulo: 'vip', valor: (l) => (l.vip ? 'sim' : 'não') },
      { titulo: 'atendimento', valor: (l) => (l.roteamento_excecao || (l.vip ? 'cs' : 'suporte')) }, { titulo: 'ponto_focal', campo: 'pf_nome' },
      { titulo: 'telefone_ponto_focal', campo: 'pf_telefone' }, { titulo: 'status', campo: 'status' }],
    sql: `SELECT c.cnpj, c.nome, c.vip, c.roteamento_excecao, c.status, p.nome AS pf_nome, p.telefone AS pf_telefone
          FROM contas c LEFT JOIN pontos_focais p ON p.conta_id = c.id AND p.vigente AND p.papel = 'principal'
          WHERE c.arquivada_em IS NULL ORDER BY c.vip DESC, c.nome`,
  },
  pendencias_abertas: {
    nome: 'Para a Platform: pendências do cliente em aberto (central de pendências do cliente)',
    destino: 'platform', permissao: 'integracao.exportar',
    colunas: [{ titulo: 'cnpj', campo: 'cnpj' }, { titulo: 'cliente', campo: 'nome' }, { titulo: 'placa', campo: 'placa' }, { titulo: 'codigo_erro', campo: 'erro_codigo' },
      { titulo: 'descricao', campo: 'descricao' }, { titulo: 'situacao', campo: 'estado' }, { titulo: 'recorrencias', campo: 'recorrencias' },
      { titulo: 'detectada_em', valor: (l) => new Date(l.detectada_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }],
    sql: `SELECT c.cnpj, c.nome, p.placa, p.erro_codigo, p.descricao, p.estado, p.recorrencias, p.detectada_em
          FROM pendencias p JOIN contas c ON c.id = p.conta_id WHERE p.estado <> 'corrigida' ORDER BY c.nome, p.placa`,
  },
};

module.exports = { EXPORTS };
