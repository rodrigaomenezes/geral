// Casca do aplicativo: sessão, menu por permissão e rotas por hash (#/ocorrencias/123).
import { h, trocar, aviso, carregando } from './dom.js';
import { api, textoErro } from './api.js';
import { telaLogin } from './telas/login.js';
import { telaPainel } from './telas/painel.js';
import { telaOcorrencias, telaOcorrencia } from './telas/ocorrencias.js';
import { telaTarefas } from './telas/tarefas.js';
import { telaContas, telaConta } from './telas/contas.js';
import { telaRodadas, telaRodada } from './telas/rodadas.js';
import { telaSupervisor } from './telas/supervisor.js';
import { telaAuditoria } from './telas/auditoria.js';
import { telaSimulador } from './telas/simulador.js';
import { telaProcessos, editorRota } from './telas/processos.js';
import { telaMeuDia, sinoNotificacoes } from './telas/meu-dia.js';
import { telaComercial } from './telas/comercial.js';
import { telaIntegracoes } from './telas/integracoes.js';
import { telaDashboards } from './telas/dashboards.js';

const MENU = [
  { rota: 'meu-dia', rotulo: 'Meu dia', perm: 'agenda.usar' },
  { rota: 'painel', rotulo: 'Painel', perm: 'ocorrencia.ver' },
  { rota: 'dashboards', rotulo: 'Dashboards', perm: 'agenda.usar' },
  { rota: 'ocorrencias', rotulo: 'Ocorrências', perm: 'ocorrencia.ver' },
  { rota: 'triagem', rotulo: 'Triagem', perm: 'ocorrencia.triar' },
  { rota: 'tarefas', rotulo: 'Tarefas', perm: 'ocorrencia.ver' },
  { rota: 'comercial', rotulo: 'Comercial', perm: 'comercial.ver' },
  { rota: 'processos', rotulo: 'Processos', perm: 'processo.ver' },
  { rota: 'rodadas', rotulo: 'Rodadas', perm: 'rodada.ver' },
  { rota: 'contas', rotulo: 'Carteira', perm: 'conta.ver' },
  { rota: 'integracoes', rotulo: 'Integrações', perm: 'integracao.usar' },
  { rota: 'supervisor', rotulo: 'Supervisor', perm: 'supervisor.ver' },
  { rota: 'auditoria', rotulo: 'Auditoria', perm: 'auditoria.ver' },
  { rota: 'simulador', rotulo: 'Simulador', perm: 'demo.simular', demo: true },
];

const ROTAS = {
  'meu-dia': telaMeuDia,
  comercial: telaComercial,
  integracoes: telaIntegracoes,
  dashboards: telaDashboards,
  painel: telaPainel,
  ocorrencias: (el, ctx, id) => (id ? telaOcorrencia(el, ctx, id) : telaOcorrencias(el, ctx)),
  triagem: (el, ctx) => telaOcorrencias(el, ctx, { estado: 'triagem', titulo: 'Triagem' }),
  tarefas: telaTarefas,
  contas: (el, ctx, id) => (id ? telaConta(el, ctx, id) : telaContas(el, ctx)),
  rodadas: (el, ctx, id) => (id ? telaRodada(el, ctx, id) : telaRodadas(el, ctx)),
  processos: (el, ctx, id, extra) => (extra === 'editar' ? editorRota(el, ctx, id) : telaProcessos(el, ctx, id)),
  supervisor: telaSupervisor,
  auditoria: telaAuditoria,
  simulador: telaSimulador,
};

const ctx = {
  usuario: null,
  catalogos: null,
  equipes: null,
  pode: (p) => !!ctx.usuario?.permissoes.includes(p),
  ir: (rota) => { location.hash = `#/${rota}`; },
  recarregar: () => rotear(),
};

const raiz = document.getElementById('app');

function aplicarMarca(m) {
  if (!m) return;
  const raizCss = document.documentElement.style;
  if (m.corPrimaria) raizCss.setProperty('--marca', m.corPrimaria);
  if (m.corDestaque) { raizCss.setProperty('--destaque', m.corDestaque); }
  if (m.nome) document.title = `${m.nome} · Sinapse`;
}

function montarCasca() {
  aplicarMarca(ctx.usuario.marca);
  const logo = ctx.usuario.marca?.logo || '/icon.svg';
  const itens = MENU.filter((m) => ctx.pode(m.perm) && (!m.demo || ctx.usuario.demo));
  const nav = h('nav', { class: 'menu', id: 'menu', 'aria-label': 'Menu principal' },
    itens.map((m) => h('a', { href: `#/${m.rota}`, dataset: { rota: m.rota } }, m.rotulo)));
  const botaoMenu = h('button', { class: 'btn-menu', type: 'button', 'aria-label': 'Abrir menu', 'aria-expanded': 'false',
    onclick: (e) => { const aberto = nav.classList.toggle('aberto'); e.currentTarget.setAttribute('aria-expanded', String(aberto)); } }, '☰');
  const topo = h('header', { class: 'topo' },
    botaoMenu,
    h('a', { class: 'marca', href: '#/', 'aria-label': 'Início' }, ctx.usuario.marca?.logo ? h('img', { src: logo, alt: '', height: 28 }) : h('span', { class: 'wordmark' }, h('b', {}, 'b'), 'robot'),
      h('small', {}, `Sinapse · ${ctx.usuario.marca?.nome || ctx.usuario.organizacao}`)),
    h('div', { class: 'quem' },
      h('span', { class: 'quem-nome' }, ctx.usuario.nome), h('small', {}, `${ctx.usuario.papelNome} · ${ctx.usuario.organizacao}`),
    ),
    ctx.pode('agenda.usar') ? sinoNotificacoes() : null,
    h('button', { class: 'btn btn-fantasma', type: 'button', onclick: sair }, 'Sair'));
  const conteudo = h('main', { id: 'conteudo', tabindex: '-1' });
  trocar(raiz, topo, h('div', { class: 'corpo' }, nav, conteudo));
  nav.addEventListener('click', () => { nav.classList.remove('aberto'); botaoMenu.setAttribute('aria-expanded', 'false'); });
}

async function sair() {
  await api.post('/sessao/sair').catch(() => {});
  ctx.usuario = null;
  iniciar();
}

async function rotear() {
  if (!ctx.usuario) return;
  const inicial = ctx.pode('agenda.usar') ? 'meu-dia' : 'painel';
  const [caminho, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  ctx.query = new URLSearchParams(qs);
  const [rotaHash, id, extra] = caminho.split('/');
  const rota = rotaHash || inicial;
  const fn = ROTAS[rota] || ROTAS[inicial];
  document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === rota));
  const el = document.getElementById('conteudo');
  trocar(el, carregando());
  try {
    await fn(el, ctx, id ? decodeURIComponent(id) : undefined, extra);
    el.focus({ preventScroll: true });
  } catch (e) {
    trocar(el, h('div', { class: 'cartao erro' }, h('h2', {}, 'Não foi possível abrir esta tela'), h('p', {}, textoErro(e)),
      h('button', { class: 'btn', onclick: () => rotear() }, 'Tentar de novo')));
  }
}

async function iniciar() {
  try {
    const s = await api.get('/sessao');
    ctx.usuario = s.usuario;
    if (!ctx.usuario) { telaLogin(raiz, { demo: s.demo, aoEntrar: (u) => { ctx.usuario = u; iniciar(); } }); return; }
    [ctx.catalogos, ctx.equipes] = await Promise.all([api.get('/catalogos'), api.get('/equipes')]);
    montarCasca();
    rotear();
  } catch (e) {
    trocar(raiz, h('div', { class: 'cartao erro centro' }, h('h2', {}, 'Sem conexão'), h('p', {}, textoErro(e)),
      h('button', { class: 'btn', onclick: iniciar }, 'Tentar de novo')));
  }
}

window.addEventListener('hashchange', rotear);
window.addEventListener('sessao-expirada', () => { if (ctx.usuario) { ctx.usuario = null; aviso('Sua sessão terminou. Entre novamente.', 'erro'); iniciar(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
iniciar();
