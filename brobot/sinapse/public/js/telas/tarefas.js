import { h, trocar, dataHora, relativo, selo, campo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api } from '../api.js';
import { formulario } from './ocorrencias.js';
import { ligar } from '../telefone.js';

export async function telaTarefas(el, ctx) {
  let minhas = true;
  const lista = h('div', { class: 'lista' });
  const alternar = h('input', { type: 'checkbox', checked: true, onchange: (e) => { minhas = e.target.checked; carregar(); } });

  async function carregar() {
    const r = await api.get(`/tarefas?minhas=${minhas ? 1 : 0}`);
    const agora = new Date();
    trocar(lista, r.itens.length ? r.itens.map((t) => h('div', { class: `linha ${new Date(t.prazo_em) < agora ? 'linha-vencido' : 'linha-no_prazo'}` },
      h('div', { class: 'linha-topo' }, selo(ctx.catalogos.tiposTarefa[t.tipo] || t.tipo, t.tipo === 'escalonamento' ? 'perigo' : 'info'),
        h('span', {}, `Prazo ${dataHora(t.prazo_em)} (${relativo(t.prazo_em)})`)),
      h('div', { class: 'linha-titulo' }, t.titulo),
      h('div', { class: 'linha-meta' }, h('span', {}, t.equipe_nome), h('span', {}, t.responsavel_nome || 'Fila da equipe'),
        t.protocolo ? h('a', { href: `#/ocorrencias/${t.ocorrencia_id}` }, t.protocolo) : null, t.conta_nome ? h('span', {}, t.conta_nome) : null),
      ctx.pode('ocorrencia.atender') ? h('div', { class: 'form-acoes' },
        t.tipo === 'ligacao' && ctx.pode('telefonia.usar') ? h('button', { class: 'btn btn-primario', onclick: () => ligar({ tarefaId: t.id, aoEncerrar: carregar }) }, '📞 Ligar agora') : null,
        h('button', { class: 'btn', onclick: () => concluir(t) }, t.tipo === 'ligacao' ? 'Registrar sem ligar' : 'Concluir')) : null))
      : vazio(minhas ? 'Nenhuma tarefa sua ou da sua equipe.' : 'Nenhuma tarefa aberta.'));
  }

  function concluir(t) {
    modal(t.tipo === 'ligacao' ? 'Registrar a ligação' : 'Concluir tarefa', (fechar) => formulario([
      h('p', {}, t.titulo),
      t.tipo === 'ligacao' ? campo('A ligação foi atendida?', opcoes(h('select', { name: 'resultadoCodigo', required: true }),
        { atendeu: 'Sim, falei com o ponto focal', nao_atendeu: 'Não atendeu' }, 'Escolha'),
        'Se não atender, o processo formaliza sozinho por mensagem no grupo e com o ponto focal.') : null,
      campo(t.tipo === 'ligacao' ? 'Resultado da ligação' : 'Resultado', h('textarea', { name: 'resultado', rows: 3, required: true, minlength: 3 }),
        t.tipo === 'ligacao' ? 'Ex.: atendeu, combinou corrigir o vínculo SNE até amanhã às 12h.' : null),
    ], 'Concluir', async (d) => { await api.post(`/tarefas/${t.id}/concluir`, d); fechar(); aviso('Tarefa concluída.'); carregar(); }));
  }

  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Tarefas')),
    h('div', { class: 'filtros' }, h('label', { class: 'check' }, alternar, 'Só minhas e da minha equipe')), lista);
  await carregar();
}
