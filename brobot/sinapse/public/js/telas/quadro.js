// Quadro (Kanban) de ocorrências com tarefas e responsáveis. Arrastar um cartão (ou "Mover para…", pelo teclado e no
// celular) executa a mesma transição da tela de detalhe: a máquina de estados do servidor decide, pede evidência ou
// motivo quando a regra exige, e uma ação inválida devolve o cartão ao lugar com a mensagem do que fazer.
import { h, trocar, relativo, selo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { seloSla, executarAcao } from './ocorrencias.js';

const COR_PRIO = { baixa: 'neutro', media: 'info', alta: 'alerta', critica: 'perigo' };
const iniciais = (nome) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

export async function telaQuadro(el, ctx) {
  const q = ctx.query || new URLSearchParams();
  const filtros = { equipe: q.get('equipe') || '', responsavel: q.get('responsavel') || '', vip: q.get('vip') === '1', vencidas: q.get('vencidas') === '1', q: '' };
  const quadro = h('div', { class: 'kquadro', role: 'list', 'aria-label': 'Colunas por situação' });
  const resumo = h('p', { class: 'suave quadro-resumo', 'aria-live': 'polite' });
  let arrastando = null; // cartão em arraste: { o, el }

  const equipe = opcoes(h('select', { 'aria-label': 'Equipe' }), Object.fromEntries(ctx.equipes.equipes.map((e) => [e.codigo, e.nome])), 'Todas as equipes');
  equipe.value = filtros.equipe;
  const resp = opcoes(h('select', { 'aria-label': 'Responsável' }), { eu: 'Só as minhas', ninguem: 'Sem responsável (na fila)' }, 'Todos os responsáveis');
  resp.value = filtros.responsavel;
  const vip = h('input', { type: 'checkbox', checked: filtros.vip });
  const vencidas = h('input', { type: 'checkbox', checked: filtros.vencidas });
  const busca = h('input', { type: 'search', placeholder: 'Protocolo, título, cliente ou CNPJ', 'aria-label': 'Buscar' });
  const aplicar = () => { Object.assign(filtros, { equipe: equipe.value, responsavel: resp.value, vip: vip.checked, vencidas: vencidas.checked, q: busca.value.trim() }); carregar(); };
  equipe.onchange = aplicar; resp.onchange = aplicar; vip.onchange = aplicar; vencidas.onchange = aplicar;
  let t; busca.oninput = () => { clearTimeout(t); t = setTimeout(aplicar, 350); };

  async function carregar() {
    const qs = new URLSearchParams();
    if (filtros.equipe) qs.set('equipe', filtros.equipe);
    if (filtros.responsavel) qs.set('responsavel', filtros.responsavel);
    if (filtros.vip) qs.set('vip', '1');
    if (filtros.vencidas) qs.set('vencidas', '1');
    if (filtros.q) qs.set('q', filtros.q);
    try {
      const r = await api.get(`/ocorrencias/quadro?${qs}`);
      const ativas = r.colunas.filter((c) => !['resolvida', 'encerrada_sem_resolucao'].includes(c.estado)).reduce((s, c) => s + c.total, 0);
      const semDono = r.colunas.flatMap((c) => c.cartoes).filter((o) => !o.responsavel_nome && !['resolvida', 'encerrada_sem_resolucao', 'triagem'].includes(o.estado)).length;
      trocar(resumo, `${ativas} ocorrência(s) ativa(s)${semDono ? ` · ${semDono} na fila sem responsável` : ''}. Arraste o cartão para a próxima situação ou use "Mover para…".`);
      trocar(quadro, r.colunas.map((c) => coluna(c, r.porColuna)));
    } catch (e) { trocar(quadro, vazio(textoErro(e))); }
  }

  /** Para onde este cartão pode ir agora (ações da máquina que levam a outra coluna). */
  const destinos = (o) => o.acoes.filter((a) => a.para && a.para !== o.estado);

  async function mover(o, para, cartaoEl) {
    const opcoesAcao = destinos(o).filter((a) => a.para === para);
    if (!opcoesAcao.length) { aviso('Esta ocorrência não pode ir para essa coluna agora. Abra o cartão para ver o que falta.', 'erro'); return; }
    if (cartaoEl) cartaoEl.classList.add('movendo');
    const voltar = () => { if (cartaoEl) cartaoEl.classList.remove('movendo'); carregar(); };
    const rodar = (a) => executarAcao(ctx, o, a.acao, a.rotulo, carregar, voltar);
    if (opcoesAcao.length === 1) return rodar(opcoesAcao[0]);
    let escolhido = false;
    modal('Como mover?', (fechar) => h('div', { class: 'acoes' }, opcoesAcao.map((a) => h('button', { class: 'btn', type: 'button', onclick: () => { escolhido = true; fechar(); rodar(a); } }, a.rotulo))),
      () => { if (!escolhido) voltar(); });
  }

  function menuMover(o) {
    const lista = destinos(o);
    modal(`Mover ${o.protocolo}`, (fechar) => lista.length
      ? h('ul', { class: 'itens' }, lista.map((a) => h('li', {}, h('button', { class: 'btn btn-bloco', type: 'button', onclick: () => { fechar(); executarAcao(ctx, o, a.acao, a.rotulo, carregar); } },
        `${a.rotulo} → ${ctx.catalogos.estados[a.para] || a.para}`))))
      : h('p', {}, 'Você não tem ações disponíveis para esta ocorrência agora (outra equipe, sem permissão ou situação final).'));
  }

  function cartao(o) {
    const podeMover = destinos(o).length > 0;
    const final = ['resolvida', 'encerrada_sem_resolucao'].includes(o.estado);
    const tarefas = o.tarefas_total ? h('div', { class: `cartao-tarefas${o.tarefas_abertas ? '' : ' feitas'}` },
      h('span', { 'aria-label': `${o.tarefas_total - o.tarefas_abertas} de ${o.tarefas_total} tarefas concluídas` }, `☑ ${o.tarefas_total - o.tarefas_abertas}/${o.tarefas_total} tarefas`),
      o.proxima_tarefa_em ? h('span', {}, ` · próxima ${relativo(o.proxima_tarefa_em)}`) : null,
      o.responsaveis_tarefas.length ? h('span', { class: 'suave' }, ` · ${o.responsaveis_tarefas.join(', ')}`) : null) : null;
    const elCartao = h('article', { class: `kcartao linha-${o.sla || 'final'}`, role: 'listitem', draggable: podeMover ? 'true' : 'false', dataset: { id: o.id },
      ondragstart: (e) => { arrastando = { o, el: elCartao }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id);
        quadro.querySelectorAll('.kcoluna').forEach((c) => c.classList.toggle('pode-soltar', destinos(o).some((a) => a.para === c.dataset.estado))); },
      ondragend: () => { quadro.querySelectorAll('.kcoluna').forEach((c) => c.classList.remove('pode-soltar', 'sobre')); } },
    h('div', { class: 'linha-topo' }, h('strong', {}, o.protocolo), selo(ctx.catalogos.prioridades[o.prioridade], COR_PRIO[o.prioridade]),
      o.vip ? selo('VIP', 'vip') : null, final ? null : seloSla(o.sla), o.nivel_escalonamento ? selo(`N${o.nivel_escalonamento}`, 'perigo') : null),
    h('a', { class: 'kcartao-titulo', href: `#/ocorrencias/${o.id}` }, o.titulo),
    h('div', { class: 'linha-meta' }, h('span', {}, o.conta_nome || 'Cliente não identificado')),
    h('div', { class: 'kcartao-dono' },
      o.responsavel_nome ? h('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciais(o.responsavel_nome)) : h('span', { class: 'avatar avatar-fila', 'aria-hidden': 'true' }, '?'),
      h('span', {}, o.responsavel_nome || `Na fila · ${o.equipe_nome}`)),
    tarefas,
    !final && o.proxima_acao ? h('div', { class: 'kcartao-proxima' }, `Próxima: ${o.proxima_acao} (${relativo(o.proxima_acao_em)})`) : null,
    podeMover ? h('button', { class: 'btn btn-pequeno btn-fantasma kmover', type: 'button', onclick: () => menuMover(o) }, 'Mover para…') : null);
    return elCartao;
  }

  function coluna(c, porColuna) {
    const corpo = h('div', { class: 'kcoluna-corpo' }, c.cartoes.length ? c.cartoes.map(cartao) : h('p', { class: 'vazio' }, 'Nada aqui.'));
    return h('section', { class: `kcoluna kcoluna-${c.estado}`, role: 'listitem', 'aria-label': `${c.nome}: ${c.total}`, dataset: { estado: c.estado },
      ondragover: (e) => { if (arrastando && destinos(arrastando.o).some((a) => a.para === c.estado)) { e.preventDefault(); e.currentTarget.classList.add('sobre'); } },
      ondragleave: (e) => e.currentTarget.classList.remove('sobre'),
      ondrop: (e) => { e.preventDefault(); const a = arrastando; arrastando = null; if (!a) return; corpo.prepend(a.el); mover(a.o, c.estado, a.el); } },
    h('header', { class: 'kcoluna-topo' }, h('h2', {}, c.nome), selo(String(c.total), 'neutro')),
    ['resolvida', 'encerrada_sem_resolucao'].includes(c.estado) ? h('p', { class: 'suave kcoluna-nota' }, 'Últimos 7 dias') : null,
    corpo,
    c.total > porColuna ? h('a', { class: 'kcoluna-mais', href: `#/ocorrencias?estado=${c.estado}` }, `Ver as ${c.total} na lista`) : null);
  }

  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, 'Quadro de ocorrências'), h('a', { class: 'btn btn-fantasma', href: '#/ocorrencias' }, 'Ver em lista')),
    h('div', { class: 'filtros' }, equipe, resp, busca, h('label', { class: 'check' }, vip, 'Só VIP'), h('label', { class: 'check' }, vencidas, 'Só vencidas')),
    resumo, quadro);
  carregar();
}
