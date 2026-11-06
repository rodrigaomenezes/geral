// Gráficos do Sinapse (SVG/HTML puros, sem biblioteca e sem innerHTML).
// Regras: marcas finas e arredondadas, legenda com 2+ séries, rótulos visíveis (algumas cores têm contraste < 3:1),
// cor segue a série (ordem fixa), status só para estado (com rótulo), um eixo só, dica ao passar o mouse.
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...filhos) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const f of filhos.flat()) if (f !== null && f !== undefined) el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return el;
}

const SERIE = (i) => `var(--serie-${(i % 6) + 1})`;
const STATUS = { ok: 'var(--ok)', alerta: '#e0a000', perigo: 'var(--perigo)', neutro: '#98a2ad' };
const fmt = (v, unidade) => (v === null || v === undefined ? '—' : unidade === 'R$' ? `R$ ${Math.round(v).toLocaleString('pt-BR')}`
  : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${unidade === '%' ? '%' : unidade === 'h' ? ' h' : ''}`);

// ---------- Dica (tooltip) única ----------
function dica() {
  let el = document.getElementById('dica-grafico');
  if (!el) { el = h('div', { id: 'dica-grafico', class: 'dica-grafico', role: 'tooltip', hidden: true }); document.body.append(el); }
  return el;
}
function mostrarDica(e, ...linhas) {
  const d = dica();
  d.replaceChildren(...linhas.map((l) => (l instanceof Node ? l : h('div', {}, l))));
  d.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - d.offsetWidth - 8);
  const y = Math.max(8, e.clientY - d.offsetHeight - 12);
  Object.assign(d.style, { left: `${x}px`, top: `${y}px` });
}
const esconderDica = () => { dica().hidden = true; };
const comDica = (el, ...linhas) => { el.addEventListener('pointermove', (e) => mostrarDica(e, ...linhas)); el.addEventListener('pointerleave', esconderDica); return el; };

function legenda(series) {
  if (series.length < 2) return null;
  return h('div', { class: 'legenda' }, series.map((x, i) => h('span', { class: 'legenda-item' },
    h('i', { style: { background: x.status ? STATUS[x.status] : SERIE(i) } }), x.rotulo)));
}

const navegar = (link) => (link ? () => { location.hash = link; } : undefined);

// ---------- Barras horizontais (uma série) ----------
export function barras(linhas, { unidade, sequencial } = {}) {
  const max = Math.max(...linhas.map((l) => Number(l.valor) || 0), 1);
  return h('div', { class: 'g-barras' }, linhas.map((l) => {
    const largura = `${Math.max(1, ((Number(l.valor) || 0) / (unidade === '%' ? 100 : max)) * 100)}%`;
    const cor = sequencial ? (l.valor < 60 ? 'var(--perigo)' : l.valor < 80 ? '#e0a000' : 'var(--ok)') : SERIE(0);
    const linha = h(l.link ? 'a' : 'div', { class: 'g-linha', href: l.link },
      h('span', { class: 'g-rotulo' }, l.rotulo),
      h('span', { class: 'g-trilho' }, h('span', { class: 'g-barra', style: { width: largura, background: cor } })),
      h('span', { class: 'g-valor' }, fmt(l.valor, unidade)));
    return comDica(linha, h('strong', {}, l.rotulo), `${fmt(l.valor, unidade)}${unidade && !['%', 'R$', 'h'].includes(unidade) ? ` ${unidade}` : ''}`, l.motivos || '');
  }));
}

// ---------- Duas séries lado a lado (agrupado) ----------
export function agrupado(linhas, series) {
  const max = Math.max(...linhas.flatMap((l) => series.map((x) => Number(l[x.campo]) || 0)), 1);
  return h('div', {}, legenda(series), h('div', { class: 'g-barras' }, linhas.map((l) => comDica(
    h(l.link ? 'a' : 'div', { class: 'g-linha g-grupo', href: l.link }, h('span', { class: 'g-rotulo' }, l.rotulo),
      h('span', { class: 'g-pilha-v' }, series.map((x, i) => h('span', { class: 'g-trilho' },
        h('span', { class: 'g-barra', style: { width: `${Math.max(1, ((Number(l[x.campo]) || 0) / max) * 100)}%`, background: SERIE(i) } })))),
      h('span', { class: 'g-valor' }, series.map((x) => fmt(l[x.campo])).join(' / '))),
    h('strong', {}, l.rotulo), ...series.map((x) => `${x.rotulo}: ${fmt(l[x.campo])}`)))));
}

// ---------- Empilhado (partes de um total) ----------
export function empilhado(linhas, series) {
  const max = Math.max(...linhas.map((l) => series.reduce((t, x) => t + (Number(l[x.campo]) || 0), 0)), 1);
  return h('div', {}, legenda(series), h('div', { class: 'g-barras' }, linhas.map((l) => {
    const total = series.reduce((t, x) => t + (Number(l[x.campo]) || 0), 0);
    return comDica(h(l.link ? 'a' : 'div', { class: 'g-linha', href: l.link }, h('span', { class: 'g-rotulo' }, l.rotulo),
      h('span', { class: 'g-trilho g-empilhado', style: { width: `${(total / max) * 100}%` } }, series.map((x, i) => (Number(l[x.campo]) ? h('span', { class: 'g-seg',
        style: { flexGrow: String(Number(l[x.campo])), background: x.status ? STATUS[x.status] : SERIE(i) } }) : null))),
      h('span', { class: 'g-valor' }, fmt(total))),
    h('strong', {}, l.rotulo), ...series.map((x) => `${x.rotulo}: ${fmt(l[x.campo])}`), `Total: ${fmt(total)}`);
  })));
}

// ---------- Funil (rampa ordinal de azul) ----------
const RAMPA = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab'];
export function funil(linhas, { unidade } = {}) {
  const max = Math.max(...linhas.map((l) => l.valor || 0), 1);
  return h('div', { class: 'g-funil' }, linhas.map((l, i) => comDica(h('div', { class: 'g-funil-linha' },
    h('span', { class: 'g-rotulo' }, l.rotulo),
    h('span', { class: 'g-funil-trilho' }, h('span', { class: 'g-funil-barra', style: { width: `${Math.max(2, ((l.valor || 0) / max) * 100)}%`, background: RAMPA[i % RAMPA.length] } })),
    h('span', { class: 'g-valor' }, fmt(l.valor), l.conversao !== null && l.conversao !== undefined ? h('small', {}, ` ${fmt(l.conversao, '%')}`) : null)),
  h('strong', {}, l.rotulo), `${fmt(l.valor)} ${unidade || ''}`, l.conversao !== null && l.conversao !== undefined ? `${fmt(l.conversao, '%')} da etapa anterior` : '')));
}

// ---------- Linha no tempo (um eixo; cruz + dica) ----------
export function linha(linhas, series, { x = 'dia' } = {}) {
  const L = 640; const A = 220; const m = { e: 34, d: 12, t: 12, b: 26 };
  const max = Math.max(...linhas.flatMap((l) => series.map((sr) => Number(l[sr.campo]) || 0)), 1);
  const passo = Math.max(1, Math.ceil(max / 4));
  const topo = passo * 4;
  const px = (i) => m.e + (linhas.length < 2 ? 0 : (i / (linhas.length - 1)) * (L - m.e - m.d));
  const py = (v) => A - m.b - (v / topo) * (A - m.t - m.b);
  const grade = [0, 1, 2, 3, 4].map((k) => s('g', {}, s('line', { x1: m.e, x2: L - m.d, y1: py(k * passo), y2: py(k * passo), class: 'g-grade' }),
    s('text', { x: m.e - 6, y: py(k * passo) + 4, 'text-anchor': 'end', class: 'g-eixo' }, String(k * passo))));
  const cada = Math.max(1, Math.ceil(linhas.length / 7));
  const rotX = linhas.map((l, i) => (i % cada === 0 || i === linhas.length - 1 ? s('text', { x: px(i), y: A - 8, 'text-anchor': 'middle', class: 'g-eixo' }, l[x]) : null));
  const caminhos = series.map((sr, j) => s('path', { d: linhas.map((l, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(Number(l[sr.campo]) || 0).toFixed(1)}`).join(' '),
    fill: 'none', stroke: SERIE(j), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const ultimo = linhas.length - 1;
  const rotulosFinais = series.map((sr, j) => s('text', { x: px(ultimo) - 4, y: py(Number(linhas[ultimo]?.[sr.campo]) || 0) - 8 - j * 12, 'text-anchor': 'end', class: 'g-rotulo-final' }, `${sr.rotulo} ${linhas[ultimo]?.[sr.campo] ?? ''}`));
  const cruz = s('line', { y1: m.t, y2: A - m.b, class: 'g-cruz', visibility: 'hidden' });
  const pontos = series.map((sr, j) => s('circle', { r: 4.5, fill: SERIE(j), stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' }));
  const alvo = s('rect', { x: m.e, y: m.t, width: L - m.e - m.d, height: A - m.t - m.b, fill: 'transparent' });
  const grafico = s('svg', { viewBox: `0 0 ${L} ${A}`, class: 'g-svg', role: 'img', 'aria-label': `Gráfico de linha: ${series.map((sr) => sr.rotulo).join(' e ')}` },
    ...grade, ...rotX, ...caminhos, ...rotulosFinais, cruz, ...pontos, alvo);
  alvo.addEventListener('pointermove', (e) => {
    const r = grafico.getBoundingClientRect();
    const xv = ((e.clientX - r.left) / r.width) * L;
    const i = Math.max(0, Math.min(ultimo, Math.round(((xv - m.e) / (L - m.e - m.d)) * ultimo)));
    cruz.setAttribute('x1', px(i)); cruz.setAttribute('x2', px(i)); cruz.setAttribute('visibility', 'visible');
    pontos.forEach((p, j) => { p.setAttribute('cx', px(i)); p.setAttribute('cy', py(Number(linhas[i][series[j].campo]) || 0)); p.setAttribute('visibility', 'visible'); });
    mostrarDica(e, h('strong', {}, linhas[i][x]), ...series.map((sr) => `${sr.rotulo}: ${linhas[i][sr.campo]}`));
  });
  alvo.addEventListener('pointerleave', () => { cruz.setAttribute('visibility', 'hidden'); pontos.forEach((p) => p.setAttribute('visibility', 'hidden')); esconderDica(); });
  return h('div', {}, legenda(series), grafico);
}

// ---------- Números de destaque ----------
export function tiles(linhas) {
  return h('div', { class: 'grade-kpi g-tiles' }, linhas.map((t) => h(t.link ? 'a' : 'div', { class: 'kpi', href: t.link },
    h('span', { class: 'kpi-rotulo' }, t.rotulo), h('strong', { class: `kpi-valor${t.alerta && t.valor ? ' kpi-alerta' : ''}` }, fmt(t.valor, t.unidade)),
    t.nota ? h('small', {}, t.nota) : null)));
}

// ---------- Tabela (mesmos dados do gráfico) ----------
export function tabela(linhas, colunas) {
  return h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
    h('thead', {}, h('tr', {}, colunas.map((c) => h('th', { scope: 'col' }, c.rotulo)))),
    h('tbody', {}, linhas.map((l) => h('tr', {}, colunas.map((c, i) => h('td', {}, i === 0 && l.link ? h('a', { href: l.link }, String(l[c.campo] ?? '')) : fmt(l[c.campo]) === '—' && typeof l[c.campo] === 'string' ? l[c.campo] : typeof l[c.campo] === 'number' ? fmt(l[c.campo]) : String(l[c.campo] ?? '—'))))))));
}

export { navegar };
