// Vitrine da demonstração (/demo): os modelos de acesso (um por perfil), o que cada um faz e um roteiro curto do
// que mostrar. "Entrar" abre o sistema já na primeira tela do roteiro. Só funciona com a demonstração ligada.
import { h, trocar, aviso } from '../dom.js';
import { api, textoErro } from '../api.js';

// Roteiro por perfil: [rota, o que mostrar]. A primeira rota é onde a pessoa entra.
const ROTEIROS = {
  supervisor: { resumo: 'Vê a operação inteira, decide exceções e aprova o que precisa de segunda pessoa.', passos: [
    ['painel', 'Painel: ocorrências por equipe, prazos vencidos e rodadas da semana'],
    ['quadro', 'Quadro: arrastar uma ocorrência entre estados, com a regra conferindo'],
    ['governanca', 'Governança: matriz de responsáveis, plantão do Suporte e férias delegadas'],
    ['supervisor', 'Supervisor: invariantes, filas, falhas de integração e divergências'],
    ['meu-dia', 'Meu dia: tarefa de aprovar o pedido de VIP da Logística Horizonte'],
  ] },
  suporte: { resumo: 'Atende as ocorrências do Suporte, pede dados ao cliente e transfere para o Desenvolvimento.', passos: [
    ['meu-dia', 'Meu dia: o que vence hoje, o que espera o cliente e as transferências'],
    ['ocorrencias', 'Ocorrências: assumir, responder pelo WhatsApp e resolver com evidência'],
    ['triagem', 'Triagem: mensagem de número desconhecido esperando dono'],
    ['desenvolvimento', 'Desenvolvimento: melhoria proposta a partir de erros repetidos'],
  ] },
  cs: { resumo: 'Cuida da carteira: saúde das contas, treinamentos, VIP e ligações.', passos: [
    ['contas', 'Carteira: uso da Platform, ponto focal e conta em risco'],
    ['treinamentos', 'Treinamentos: turma de novembro com três contas convidadas'],
    ['meu-dia', 'Meu dia: lembrete de revisão trimestral e ligações registradas'],
    ['ocorrencias', 'Ocorrências do CS: dúvida respondida e acesso resolvido com evidência'],
  ] },
  operacoes: { resumo: 'Prepara as rodadas, acompanha as consultas e confere o lote de placas do cliente novo.', passos: [
    ['rodadas', 'Rodadas: D-4, D-3 e D-1 com pendências por placa e erro'],
    ['consultas', 'Consultas: queda de geração na Logística Horizonte com alerta aberto'],
    ['contas', 'Carteira → Rodoviário Pioneiro: onboarding e lote de placas com rejeições'],
    ['integracoes', 'Integrações: importar e exportar CSV da Platform com prévia'],
  ] },
  dev: { resumo: 'Recebe transferências técnicas, registra incidentes e publica releases.', passos: [
    ['desenvolvimento', 'Desenvolvimento: incidente mitigado, melhoria aprovada e release 2026.11.2'],
    ['ocorrencias', 'Ocorrências: transferência do Suporte para aceitar'],
    ['meu-dia', 'Meu dia: o que chegou para a equipe'],
  ] },
  financeiro: { resumo: 'Confere a situação financeira do OMIE e trata divergências de cadastro.', passos: [
    ['contas', 'Carteira: situação no OMIE (em dia, em atraso) por conta'],
    ['integracoes', 'Integrações: importar clientes do OMIE com conferência de código'],
    ['meu-dia', 'Meu dia: tarefas e avisos do Financeiro'],
  ] },
  comercial: { resumo: 'Toca o funil do lead ao cliente ganho, que vira onboarding automaticamente.', passos: [
    ['comercial', 'Comercial: funil com teste, proposta e o cliente ganho Rodoviário Pioneiro'],
    ['dashboards', 'Dashboards: conversão por etapa e previsão do mês'],
    ['meu-dia', 'Meu dia: próximas ações de cada oportunidade'],
  ] },
  admin: { resumo: 'Configura o sistema: pessoas, processos, mensagens, canais e privacidade.', passos: [
    ['pessoas', 'Pessoas e equipes: perfis, substitutos e disponibilidade'],
    ['processos', 'Processos: o fluxo do D-4 ao pós-rodada, editável e versionado'],
    ['mensagens', 'Mensagens: modelos que o sistema envia'],
    ['auditoria', 'Auditoria: tudo o que aconteceu, sem como apagar'],
    ['simulador', 'Simulador: disparar os cenários de aceite ao vivo'],
  ] },
};
const PADRAO = { resumo: 'Veja o sistema pelo perfil desta pessoa.', passos: [['meu-dia', 'Meu dia']] };

export async function telaVitrine(raiz, { aoEntrar }) {
  const grade = h('div', { class: 'vitrine-grade' }, h('p', { class: 'suave' }, 'Carregando os perfis…'));
  trocar(raiz, h('div', { class: 'vitrine' }, h('div', { class: 'vitrine-cabeca' },
    h('header', { class: 'vitrine-topo' },
      h('div', { class: 'wordmark' }, h('b', {}, 'b'), 'robot'),
      h('span', { class: 'login-selo' }, h('i', {}), 'Sinapse · demonstração')),
    h('section', { class: 'vitrine-intro' },
      h('h1', {}, 'Conheça o Sinapse por dentro'),
      h('p', {}, 'Cada cartão é um modelo de acesso, com uma pessoa fictícia. Os dados também são fictícios e cobrem todas as áreas: ',
        'ocorrências, rodadas, consultas, carteira, onboarding, treinamentos, comercial, desenvolvimento, governança e auditoria.'),
      h('p', { class: 'suave' }, 'Entre por um perfil, siga o roteiro e, para comparar, volte aqui e entre por outro. Nada do que você fizer aqui sai do ambiente de demonstração.'))),
    grade,
    h('footer', { class: 'vitrine-rodape suave' }, h('a', { href: '/' }, 'Ir para a tela de entrada'))));

  let lista;
  try {
    const s = await api.get('/sessao');
    if (!s.demo) {
      trocar(grade, h('div', { class: 'cartao' }, h('h2', {}, 'A demonstração está desligada neste ambiente'),
        h('p', {}, 'Este endereço guarda dados reais. Peça o link do ambiente de demonstração ou entre com seu e-mail e senha.'),
        h('a', { class: 'btn btn-primario', href: '/' }, 'Entrar')));
      return;
    }
    lista = (await api.get('/demo/personas')).personas;
  } catch (err) { trocar(grade, h('div', { class: 'cartao erro' }, h('h2', {}, 'Não foi possível carregar os perfis'), h('p', {}, textoErro(err)))); return; }

  const entrar = async (p, rota) => {
    try {
      const r = await api.post('/sessao/demo', { usuarioId: p.id });
      history.replaceState(null, '', `/#/${rota}`);
      aoEntrar(r.usuario);
    } catch (err) { aviso(textoErro(err), 'erro'); }
  };

  const porOrg = {};
  for (const p of lista) (porOrg[p.tenant_nome] ||= []).push(p);
  const blocos = [];
  for (const [org, ps] of Object.entries(porOrg)) {
    const outra = ps[0].tenant_slug !== 'brobot';
    blocos.push(h('h2', { class: 'vitrine-org' }, outra ? `${org}: outra empresa no mesmo sistema` : org));
    if (outra) blocos.push(h('p', { class: 'suave' }, 'Entre por aqui para ver que uma empresa não enxerga os dados da outra.'));
    blocos.push(h('div', { class: 'vitrine-cartoes' }, ps.map((p) => {
      const r = ROTEIROS[p.papel] || PADRAO;
      return h('article', { class: 'cartao vitrine-cartao' },
        h('div', { class: 'vitrine-perfil' }, h('span', { class: 'vitrine-papel' }, p.papelNome), h('strong', {}, p.nome),
          p.equipe_nome && p.equipe_nome !== p.papelNome ? h('small', { class: 'suave' }, `Equipe ${p.equipe_nome}`) : null),
        h('p', {}, outra ? 'Supervisão de outra empresa: só vê as próprias ocorrências.' : r.resumo),
        outra ? null : h('ol', { class: 'vitrine-roteiro' }, r.passos.map(([rota, texto]) => h('li', {},
          h('a', { href: `/#/${rota}`, onclick: (e) => { e.preventDefault(); entrar(p, rota); } }, texto)))),
        h('button', { class: 'btn btn-primario', type: 'button', onclick: () => entrar(p, r.passos[0][0]) }, `Entrar como ${p.nome.split(' ')[0]}`));
    })));
  }
  trocar(grade, ...blocos);
}
