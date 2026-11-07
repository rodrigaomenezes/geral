'use strict';
// Vitrine da demonstração (/demo): completa os dados fictícios para que TODA área abra com exemplo real de uso
// (onboarding de cliente ganho, lote de placas, treinamento, VIP, incidente, melhoria e release, consultas,
// ligações, delegação e plantão). Usa os mesmos serviços da operação: nada é gravado por fora das regras.
// Só roda dentro do seed de demonstração (organização marcada como demonstração).

const { relogio, DIA, HORA } = require('../../nucleo/relogio');
const comercial = require('../comercial/servico');
const placas = require('../onboarding/placas');
const treinamentos = require('../treinamentos/servico');
const vip = require('../clientes/vip');
const dev = require('../desenvolvimento/servico');
const monitoramento = require('../monitoramento/servico');
const telefonia = require('../telefonia/servico');
const governanca = require('../governanca/servico');
const tarefas = require('../ocorrencias/tarefas');

const PODE_GESTAO = () => true; // a decisão é tomada pela supervisora (Marina), que tem a permissão

async function semearVitrine(c, tenantId, ids) {
  const ctxDe = (k) => ({ tenantId, usuario: ids.u[k], correlacao: null });
  const agora = relogio.agora();
  const em = (dias, hora = 0) => new Date(agora.getTime() + dias * DIA + hora * HORA).toISOString();
  const dia = (n) => new Date(agora.getTime() + n * DIA).toISOString().slice(0, 10);

  // Comercial → Onboarding: um cliente ganho abre a conta, a ocorrência e o checklist de implantação.
  const patricia = ctxDe('patricia');
  const op = await comercial.criar(c, patricia, { empresa: 'Rodoviário Pioneiro', cnpj: '66777888000136', contatoNome: 'Mariana Teixeira',
    contatoTelefone: '(41) 99221-3344', contatoEmail: 'mariana@pioneiro.example', origem: 'indicacao', produtos: ['multas', 'indicacao_condutores'],
    frota: 230, valorMensal: 5200 });
  for (const etapa of ['qualificacao', 'demonstracao', 'proposta']) await comercial.mover(c, patricia, op.id, etapa, {});
  await comercial.mover(c, patricia, op.id, 'teste', { testeInicio: dia(-12), testeFim: dia(-5), testeCriterio: 'Consultar a frota inteira sem erro de credencial' });
  await comercial.registrarTeste(c, patricia, op.id, { resultado: 'aprovado', parecer: 'Frota consultada; o cliente aprovou o painel de multas.' });
  await comercial.mover(c, patricia, op.id, 'negociacao', {});
  await comercial.mover(c, patricia, op.id, 'ganha', {});
  const novaConta = (await c.query('SELECT conta_id FROM oportunidades WHERE id = $1', [op.id])).rows[0].conta_id;
  await placas.importar(c, ctxDe('pedro'), novaConta, { arquivo: 'frota-pioneiro.csv',
    texto: 'placa;renavam\nPNR1A23;10000000008\nPNR2B34;10000000016\nPNR3C45;123\nPNR2B34;10000000016\n' });

  // CS: treinamento coletivo agendado com duas contas e pedido de VIP aguardando a aprovação da gestão.
  await treinamentos.roteiros(c, ctxDe('juliana')); // garante o roteiro padrão, como a tela faz ao abrir
  const sessao = await treinamentos.criarSessao(c, ctxDe('juliana'), { titulo: 'Primeiros passos · turma de novembro', roteiro: 'primeiros_passos',
    inicio: em(3, 4), duracaoMin: 60, link: 'https://meet.example/brobot-primeiros-passos', contaDemo: 'Conta de demonstração Brobot', vagas: 30 });
  await treinamentos.adicionarParticipantes(c, ctxDe('juliana'), sessao.id, [ids.conta.rotasul.id, ids.conta.valeverde.id, novaConta]);
  await vip.pedir(c, ctxDe('juliana'), ids.conta.horizonte.id, { tipo: 'conceder', criterio: 'Contrato anual com 3 produtos',
    validade: dia(180), motivo: 'Cliente renovou o contrato e ampliou os produtos' });

  // Desenvolvimento: incidente em andamento, melhoria aprovada e release planejada.
  const lucas = ctxDe('lucas');
  const inc = await dev.abrirIncidente(c, lucas, { titulo: 'Lentidão na consulta do DETRAN-SP', severidade: 'sev2', produto: 'Multas e Notificações',
    impacto: 'Consultas do DETRAN-SP demorando mais de 5 minutos para parte das contas', contaIds: [ids.conta.litoral.id, ids.conta.rotasul.id] });
  await dev.atualizarIncidente(c, lucas, inc.id, { texto: 'Causa isolada no provedor do DETRAN-SP; fila reduzida e consultas voltando ao normal.', estado: 'mitigado' });
  const melhoria = await dev.proporMelhoria(c, ctxDe('rafael'), { titulo: 'Avisar o cliente quando o certificado estiver para vencer',
    descricao: 'Três ocorrências do mês foram certificado vencido. Um aviso 15 dias antes evitaria a parada das consultas.',
    tipo: 'preventiva', origem: 'reincidencia', prioridade: 'alta' });
  await dev.agirMelhoria(c, ctxDe('marina'), melhoria.id, 'aprovar', {}, PODE_GESTAO);
  const release = await dev.criarRelease(c, lucas, { versao: '2026.11.2', previstoPara: dia(10), notas: 'Aviso de certificado a vencer.' });
  await dev.incluirNaRelease(c, lucas, release.id, melhoria.id);

  // Operações: 10 dias de volume de consultas; a Horizonte cai e o monitoramento abre o alerta.
  const linhas = [];
  for (let i = 10; i >= 1; i--) {
    linhas.push({ contaId: ids.conta.rotasul.id, produto: 'multas', dia: dia(-i), esperadas: 620, geradas: 615, errosTecnicos: 2, errosUsuario: 3, indisponiveis: 0 });
    const queda = i <= 4;
    linhas.push({ contaId: ids.conta.horizonte.id, produto: 'multas', dia: dia(-i), esperadas: 85, geradas: queda ? 40 : 84,
      errosTecnicos: queda ? 30 : 0, errosUsuario: queda ? 15 : 1, indisponiveis: 0 });
  }
  const ctxOp = ctxDe('pedro');
  await monitoramento.registrarVolumes(c, ctxOp, linhas, null);
  await monitoramento.avaliarConsultas(c, ctxOp, [{ contaId: ids.conta.rotasul.id, produto: 'multas' }, { contaId: ids.conta.horizonte.id, produto: 'multas' }]);

  // Telefonia em modo de treino: uma ligação atendida e uma não atendida, com anotação.
  await telefonia.salvarConfig(c, ctxDe('admin'), { provedor: 'treino', celular: true });
  const juliana = ctxDe('juliana');
  const l1 = await telefonia.criar(c, juliana, { canal: 'computador', contaId: ids.conta.rotasul.id });
  await telefonia.evento(c, juliana, l1.id, 'atendida');
  await telefonia.evento(c, juliana, l1.id, 'encerrada', { anotacao: 'Revisão trimestral combinada para a próxima semana.' });
  const l2 = await telefonia.criar(c, juliana, { canal: 'computador', contaId: ids.conta.transminas.id });
  await telefonia.evento(c, juliana, l2.id, 'encerrada', { resultado: 'nao_atendida', anotacao: 'Tentar de novo à tarde.' });

  // Governança: plantão do Suporte nesta semana e férias da Juliana já delegadas para a Marina.
  await governanca.criarPlantao(c, ctxDe('marina'), { equipeId: ids.u.bianca.equipe_id, usuarioId: ids.u.bianca.id, inicio: em(0), fim: em(7) });
  await governanca.delegar(c, juliana, { paraId: ids.u.marina.id, inicio: em(5), fim: em(12), motivo: 'Férias: carteira do CS com a supervisão' }, false);

  // Uma tarefa manual da Supervisão para o "Meu dia".
  await tarefas.criar(c, ctxDe('marina'), { titulo: 'Revisar o pedido de VIP da Logística Horizonte', tipo: 'geral', responsavelId: ids.u.marina.id,
    equipeId: ids.u.marina.equipe_id, prazoEm: em(1) });
}

module.exports = { semearVitrine };
