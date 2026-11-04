import { h, trocar, dataHora, vazio } from '../dom.js';
import { api } from '../api.js';

const resumo = (v) => (v ? Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join(' · ') : '');

export async function telaAuditoria(el) {
  const corpo = h('tbody');
  const mais = h('button', { class: 'btn btn-fantasma' }, 'Carregar mais');
  let cursor = null;
  async function carregar() {
    const r = await api.get(`/auditoria${cursor ? `?antesDe=${cursor}` : ''}`);
    for (const a of r.itens) {
      corpo.append(h('tr', {}, h('td', {}, dataHora(a.criado_em)), h('td', {}, a.ator_nome), h('td', {}, h('code', {}, a.acao)),
        h('td', {}, a.entidade_id ? h('a', { href: a.entidade === 'ocorrencia' ? `#/ocorrencias/${a.entidade_id}` : a.entidade === 'conta' ? `#/contas/${a.entidade_id}` : '#/auditoria' }, a.entidade) : a.entidade),
        h('td', { class: 'suave' }, [a.motivo, resumo(a.depois)].filter(Boolean).join(' — '))));
    }
    cursor = r.proximo;
    mais.hidden = !cursor;
  }
  mais.onclick = carregar;
  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Auditoria')),
    h('p', { class: 'suave' }, 'Trilha só de anexação: o banco recusa alterar ou apagar qualquer linha.'),
    h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' }, h('thead', {}, h('tr', {}, ['Quando', 'Quem', 'Ação', 'Item', 'Detalhe'].map((t) => h('th', {}, t)))), corpo)),
    mais);
  await carregar();
  if (!corpo.children.length) corpo.append(h('tr', {}, h('td', { colspan: 5 }, vazio('Sem registros.'))));
}
