// Dashboards interativos: abas por área, filtros numa linha, cada bloco com gráfico ⇄ tabela, CSV e clique até a lista.
import { h, trocar, dataHora, opcoes, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { barras, agrupado, empilhado, funil, linha, tiles, tabela } from '../graficos.js';

const lerPref = (k, p) => { try { return localStorage.getItem(`sinapse.dash.${k}`) || p; } catch { return p; } };
const gravarPref = (k, v) => { try { localStorage.setItem(`sinapse.dash.${k}`, v); } catch { /* sem armazenamento */ } };

function bloco(b, base) {
  const corpo = h('div', { class: 'bloco-corpo' });
  let modo = 'grafico';
  const desenhar = () => {
    if (!b.linhas.length) { trocar(corpo, vazio('Sem dados neste período.')); return; }
    if (b.tipo === 'tiles') { trocar(corpo, tiles(b.linhas)); return; }
    if (modo === 'tabela') { trocar(corpo, tabela(b.linhas, b.colunas)); return; }
    const g = { barras: () => barras(b.linhas, { unidade: b.unidade, sequencial: b.sequencial }), agrupado: () => agrupado(b.linhas, b.series),
      empilhado: () => empilhado(b.linhas, b.series), funil: () => funil(b.linhas, { unidade: b.unidade }), linha: () => linha(b.linhas, b.series) }[b.tipo];
    trocar(corpo, g ? g() : tabela(b.linhas, b.colunas));
  };
  const alternar = h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => { modo = modo === 'grafico' ? 'tabela' : 'grafico'; alternar.textContent = modo === 'grafico' ? 'Ver tabela' : 'Ver gráfico'; desenhar(); } }, 'Ver tabela');
  desenhar();
  return h('section', { class: `cartao bloco bloco-${b.tipo}` },
    h('div', { class: 'bloco-topo' }, h('h2', {}, b.titulo),
      b.tipo === 'tiles' ? null : h('div', { class: 'bloco-acoes' }, alternar,
        h('a', { class: 'btn btn-pequeno', href: `${base.url}/csv?${new URLSearchParams({ ...base.filtros, bloco: b.id })}`, download: '' }, 'CSV'))),
    corpo);
}

export async function telaDashboards(el, ctx, nomeAba) {
  const { itens } = await api.get('/dashboards');
  if (!itens.length) { trocar(el, vazio('Nenhum dashboard disponível para o seu perfil.')); return; }
  const aba = itens.some((x) => x.nome === nomeAba) ? nomeAba : lerPref('aba', itens[0].nome);
  const atual = itens.some((x) => x.nome === aba) ? aba : itens[0].nome;
  gravarPref('aba', atual);
  const f = { dias: lerPref('dias', '30'), equipe: '', carteira: '' };
  const conteudo = h('div', {});
  const dias = opcoes(h('select', { 'aria-label': 'Período' }), { 7: 'Últimos 7 dias', 30: 'Últimos 30 dias', 90: 'Últimos 90 dias' });
  dias.value = f.dias;
  const equipe = opcoes(h('select', { 'aria-label': 'Equipe' }), Object.fromEntries(ctx.equipes.equipes.map((e) => [e.codigo, e.nome])), 'Todas as equipes');
  const carteira = opcoes(h('select', { 'aria-label': 'Carteira' }), { vip: 'Só VIP (CS)', demais: 'Demais (Suporte)' }, 'Toda a carteira');
  const carimbo = h('span', { class: 'suave' });

  async function carregar() {
    Object.assign(f, { dias: dias.value, equipe: equipe.value, carteira: carteira.value });
    gravarPref('dias', f.dias);
    const filtros = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
    trocar(conteudo, h('p', { class: 'carregando' }, 'Calculando…'));
    try {
      const d = await api.get(`/dashboards/${atual}?${new URLSearchParams(filtros)}`);
      const base = { url: `/api/dashboards/${atual}`, filtros };
      carimbo.textContent = `Atualizado ${dataHora(d.geradoEm)}`;
      trocar(conteudo, h('div', { class: 'blocos' }, d.blocos.map((b) => bloco(b, base))));
    } catch (e) { trocar(conteudo, vazio(textoErro(e))); }
  }
  [dias, equipe, carteira].forEach((x) => { x.onchange = carregar; });
  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, 'Dashboards'), carimbo),
    h('nav', { class: 'abas', 'aria-label': 'Áreas' }, itens.map((x) => h('a', { class: `aba ${x.nome === atual ? 'ativa' : ''}`, href: `#/dashboards/${x.nome}`, 'aria-current': x.nome === atual ? 'page' : undefined }, x.titulo))),
    h('div', { class: 'filtros' }, dias, equipe, carteira, h('button', { class: 'btn btn-fantasma', type: 'button', onclick: carregar }, 'Atualizar')),
    conteudo);
  await carregar();
}
