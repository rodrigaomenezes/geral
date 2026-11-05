// Montagem de tela sem innerHTML: todo texto entra como nó de texto (nada de HTML vindo de dados).

export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v); // via CSSOM: permitido pela CSP (atributo style não é)
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  anexar(el, filhos);
  return el;
}

function anexar(el, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

export function trocar(el, ...filhos) {
  el.replaceChildren();
  anexar(el, filhos);
  return el;
}

const FUSO = { timeZone: 'America/Sao_Paulo' };
export const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { ...FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const data = (v) => (v ? new Date(v).toLocaleDateString('pt-BR', FUSO) : '—');
export const cnpj = (v) => (v ? v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : '');

export function relativo(v, agora = new Date()) {
  if (!v) return '';
  const min = Math.round((new Date(v) - agora) / 60000);
  const abs = Math.abs(min);
  const txt = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} dias`;
  return min >= 0 ? `em ${txt}` : `há ${txt}`;
}

export const selo = (texto, tipo = 'neutro') => h('span', { class: `selo selo-${tipo}` }, texto);

export function campo(rotulo, entrada, ajuda) {
  return h('label', { class: 'campo' }, h('span', { class: 'campo-rotulo' }, rotulo), entrada, ajuda ? h('small', {}, ajuda) : null);
}

export function opcoes(select, mapa, vazio) {
  if (vazio) select.append(h('option', { value: '' }, vazio));
  for (const [v, t] of Object.entries(mapa)) select.append(h('option', { value: v }, t));
  return select;
}

export function aviso(texto, tipo = 'ok') {
  const area = document.getElementById('avisos');
  const el = h('div', { class: `aviso aviso-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, texto);
  area.append(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 9000 : 5000);
}

/** Janela modal simples (dialog nativo). `montar(fechar)` devolve o conteúdo; `aoFechar` roda ao fechar (opcional). */
export function modal(titulo, montar, aoFechar) {
  const dlg = h('dialog', { class: 'modal', 'aria-label': titulo });
  const fechar = () => { if (!dlg.isConnected) return; dlg.close(); dlg.remove(); if (aoFechar) aoFechar(); };
  dlg.append(h('div', { class: 'modal-topo' }, h('h2', {}, titulo), h('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Fechar', onclick: fechar }, '×')),
    montar(fechar));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); fechar(); });
  document.body.append(dlg);
  dlg.showModal();
  return fechar;
}

export const vazio = (texto) => h('p', { class: 'vazio' }, texto);
export const carregando = () => h('p', { class: 'carregando' }, 'Carregando…');
