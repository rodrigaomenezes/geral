'use strict';
// Processos que toda organização recebe prontos (editáveis), escritos a partir da reunião de reestruturação de
// Suporte e Operações de 03/11/2026. Pontos ainda em aberto na reunião ficam anotados na descrição.

const PADROES = [
  {
    nome: 'Pré-rodada: cadência de credenciais (D-3, ligação, D-1)',
    descricao: 'Reunião 03/11: D-3 WhatsApp; ligação ao ponto focal e, se não atender, formaliza no grupo e com o ponto focal; '
      + 'D-1 nova ligação + mensagem. VIP com o CS, demais com o Suporte. Para sozinho quando todas as pendências forem corrigidas. '
      + 'Em aberto: o horário exato da ligação intermediária e se o combinado por telefone também é formalizado no grupo.',
    definicao: {
      gatilho: 'rodada.pendencias',
      condicoes: [],
      encerrarSe: [{ campo: 'pendencias.abertas', operador: 'igual', valor: 0 }, { campo: 'rodada.executada', operador: 'igual', valor: true }],
      passos: [
        { tipo: 'esperar', ateD0Horas: -72 },
        { tipo: 'enviar_mensagem', destino: 'ponto_focal', modelo: 'pre_rodada_d3' },
        { tipo: 'esperar', ateD0Horas: -48 },
        { tipo: 'ligar', equipe: 'da_conta', prazoHoras: 8, roteiro: 'explicar cada pendência e combinar a correção até o D-1' },
        { tipo: 'enviar_mensagem', destino: 'grupo_e_ponto_focal', modelo: 'formalizacao_ligacao',
          seCondicoes: [{ campo: 'ligacao.atendeu', operador: 'igual', valor: false }] },
        { tipo: 'esperar', ateD0Horas: -24 },
        { tipo: 'ligar', equipe: 'da_conta', prazoHoras: 6, roteiro: 'último aviso antes da rodada oficial' },
        { tipo: 'enviar_mensagem', destino: 'ponto_focal', modelo: 'pre_rodada_d1' },
      ],
    },
  },
  {
    nome: 'Pós-rodada: comunicado no grupo + follow-up D+3',
    descricao: 'Reunião 03/11: após a rodada oficial, envia no grupo o comunicado de quais veículos tiveram sucesso e quais falharam, '
      + 'pedindo para o cliente avisar quando corrigir; após 3 dias, um único follow-up com o ponto focal e o processo se encerra '
      + '(a pendência técnica continua visível até ser corrigida). Em aberto: quem autoriza o comunicado final.',
    definicao: {
      gatilho: 'rodada.executada',
      condicoes: [{ campo: 'pendencias.abertas', operador: 'maior', valor: 0 }],
      encerrarSe: [{ campo: 'pendencias.abertas', operador: 'igual', valor: 0 }],
      passos: [
        { tipo: 'enviar_mensagem', destino: 'grupo', modelo: 'comunicado_rodada' },
        { tipo: 'esperar', horas: 72 },
        { tipo: 'enviar_mensagem', destino: 'ponto_focal', modelo: 'pos_rodada_d3' },
        { tipo: 'nota', texto: 'Follow-up D+3 enviado; processo de contato encerrado. Pendência segue em acompanhamento: {qtd_pendencias} em aberto.' },
      ],
    },
  },
  {
    nome: 'Força-tarefa: ponto focal de cada cliente',
    descricao: 'Reunião 03/11: cada cliente tem 1 nome + 1 contato para erros de consulta e de usuário. O CS levanta os VIP; '
      + 'o Suporte levanta os demais. Use "Executar agora" para gerar as tarefas da base atual; para sozinho quando o ponto focal for cadastrado.',
    definicao: {
      gatilho: 'contas.manual',
      condicoes: [{ campo: 'conta.tem_ponto_focal', operador: 'igual', valor: false }],
      encerrarSe: [{ campo: 'conta.tem_ponto_focal', operador: 'igual', valor: true }],
      passos: [
        { tipo: 'criar_tarefa', equipe: 'da_conta', tipoTarefa: 'geral', prazoHoras: 48, titulo: 'Definir o ponto focal de {conta} (1 nome + 1 contato)' },
        { tipo: 'esperar', horas: 48 },
        { tipo: 'escalar', motivo: '{conta} continua sem ponto focal depois de 48 h' },
      ],
    },
  },
  {
    nome: 'Erro de consulta: Desenvolvimento aciona o Suporte (sem e-mail)',
    descricao: 'Reunião 03/11 (Placas Recorrentes): o Desenvolvimento identifica erros de consulta e o Suporte precisa abrir o atendimento. '
      + 'Em vez de e-mail, toda demanda técnica nova gera tarefa para a equipe da conta avisar o cliente.',
    definicao: {
      gatilho: 'ocorrencia.criada',
      condicoes: [{ campo: 'ocorrencia.tipo', operador: 'igual', valor: 'tecnica' }],
      encerrarSe: [{ campo: 'ocorrencia.encerrada', operador: 'igual', valor: true }],
      passos: [
        { tipo: 'criar_tarefa', equipe: 'da_conta', tipoTarefa: 'geral', prazoHoras: 4, titulo: 'Avisar {conta}: erro de consulta em análise pelo Desenvolvimento ({protocolo})' },
        { tipo: 'nota', texto: 'Suporte/CS acionado automaticamente pelo processo (substitui o e-mail do Desenvolvimento).' },
      ],
    },
  },
  {
    nome: 'Cliente sem retorno durante a espera',
    descricao: 'Quando uma ocorrência passa a aguardar o cliente: depois de 24 h sem resposta manda um lembrete; mais 24 h, cria uma ligação. Para se o cliente responder.',
    definicao: {
      gatilho: 'ocorrencia.espera',
      condicoes: [{ campo: 'ocorrencia.estado', operador: 'igual', valor: 'aguardando_cliente' }],
      encerrarSe: [{ campo: 'cliente.respondeu', operador: 'igual', valor: true }, { campo: 'ocorrencia.encerrada', operador: 'igual', valor: true }],
      passos: [
        { tipo: 'esperar', horas: 24 },
        { tipo: 'enviar_mensagem', destino: 'ponto_focal', modelo: 'lembrete_cliente' },
        { tipo: 'esperar', horas: 24 },
        { tipo: 'ligar', equipe: 'da_conta', prazoHoras: 8, roteiro: 'cliente sem retorno há 48 h' },
      ],
    },
  },
  {
    nome: 'VIP com prioridade alta: avisar a Supervisão',
    descricao: 'Ocorrência de cliente VIP aberta com prioridade alta ou crítica gera alerta para a Supervisão acompanhar.',
    definicao: {
      gatilho: 'ocorrencia.criada',
      condicoes: [{ campo: 'conta.vip', operador: 'igual', valor: true }, { campo: 'ocorrencia.prioridade', operador: 'em', valor: ['alta', 'critica'] }],
      encerrarSe: [],
      passos: [{ tipo: 'escalar', motivo: 'VIP com prioridade alta: acompanhar de perto' }],
    },
  },
  {
    nome: 'Comercial: acompanhar a fase de teste',
    descricao: 'Fase de teste antes do fechamento: o CS apoia o primeiro acesso, o Comercial é lembrado de acompanhar e de registrar o resultado. Para quando a oportunidade sai do Teste.',
    definicao: {
      gatilho: 'oportunidade.etapa',
      condicoes: [{ campo: 'oportunidade.etapa', operador: 'igual', valor: 'teste' }],
      encerrarSe: [{ campo: 'oportunidade.etapa', operador: 'diferente', valor: 'teste' }],
      passos: [
        { tipo: 'criar_tarefa', equipe: 'cs', tipoTarefa: 'geral', prazoHoras: 24, titulo: 'Apoiar o teste de {empresa}: acesso, primeira consulta e dúvidas' },
        { tipo: 'esperar', horas: 72 },
        { tipo: 'lembrete', para: 'responsavel', emHoras: 0.1, texto: 'Como está o teste de {empresa}? Converse com o cliente sobre o critério combinado.' },
        { tipo: 'esperar', horas: 96 },
        { tipo: 'lembrete', para: 'responsavel', emHoras: 0.1, texto: 'Registre o resultado do teste de {empresa} (aprovado ou reprovado).' },
      ],
    },
  },
  {
    nome: 'Comercial: venda fechada → onboarding',
    descricao: 'Reunião 03/11 (onboarding): o CS define o ponto focal (1 nome + 1 contato) e repassa ao Suporte; Operações provisiona a conta na Platform (exportação CSV de provisionamento).',
    definicao: {
      gatilho: 'oportunidade.ganha',
      condicoes: [],
      encerrarSe: [],
      passos: [
        { tipo: 'criar_tarefa', equipe: 'cs', tipoTarefa: 'geral', prazoHoras: 24, titulo: 'Definir o ponto focal de {conta} (1 nome + 1 contato) e repassar ao Suporte' },
        { tipo: 'criar_tarefa', equipe: 'operacoes', tipoTarefa: 'geral', prazoHoras: 24, titulo: 'Provisionar {conta} na Platform (Integrações → exportar provisionamento)' },
        { tipo: 'esperar', horas: 48 },
        { tipo: 'escalar', motivo: '{conta}: onboarding sem ponto focal 48 h depois da venda', seCondicoes: [{ campo: 'conta.tem_ponto_focal', operador: 'igual', valor: false }] },
      ],
    },
  },
  {
    nome: 'Insights do CaçaCondutores (1x por semana)',
    descricao: 'Reunião 03/11 (melhoria 5): incentivar o uso do módulo com uma comunicação por semana. Respeita o opt-out do ponto focal. '
      + 'Começa desligado: ative quando o texto for revisado pelo Meira.',
    ativo: false,
    definicao: {
      gatilho: 'contas.semanal',
      agenda: { diaSemana: 2, hora: 10 },
      condicoes: [{ campo: 'conta.status', operador: 'igual', valor: 'ativa' }, { campo: 'conta.tem_ponto_focal', operador: 'igual', valor: true }],
      encerrarSe: [],
      passos: [{ tipo: 'enviar_mensagem', destino: 'ponto_focal', modelo: 'insights_caca_condutores' }],
    },
  },
];

/** Cria os processos padrão ainda inexistentes na organização (idempotente pelo nome). */
async function garantir(c, ctx, servico) {
  const existentes = new Set((await c.query('SELECT nome FROM processos')).rows.map((r) => r.nome));
  for (const p of PADROES) {
    if (existentes.has(p.nome)) continue;
    let criado;
    try {
      criado = await servico.criar(c, ctx, { nome: p.nome, descricao: p.descricao, definicao: p.definicao, sistema: true });
    } catch (e) {
      if (e.code === 'entrada_invalida') continue; // organização sem as equipes que o processo usa (ex.: parceiro sem CS)
      throw e;
    }
    if (p.ativo !== false) await servico.ativar(c, ctx, criado.id, 'Processo padrão (reunião de 03/11/2026)');
  }
}

module.exports = { PADROES, garantir };
