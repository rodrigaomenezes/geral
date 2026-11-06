// Onboarding e offboarding da conta por checklist: progresso por grupo, itens com equipe e prazo, evidência ao marcar,
// dispensa como exceção aprovada pela gestão e conclusão (ativa ou encerra a conta).
import { h, trocar, dataHora, relativo, selo, campo, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

const ESTADO = { pendente: ['pendente', 'neutro'], feito: ['feito', 'ok'], dispensa_pedida: ['dispensa pedida', 'alerta'], dispensado: ['dispensado', 'info'] };
const EQUIPE = { cs: 'CS', suporte: 'Suporte', operacoes: 'Operações', financeiro: 'Financeiro', dev: 'Desenvolvimento', supervisao: 'Supervisão', comercial: 'Comercial' };

export async function secaoChecklists(ctx, conta, recarregar) {
  const caixa = h('section', { class: 'cartao checklists', 'aria-live': 'polite' });
  let dados;
  try { dados = await api.get(`/contas/${conta.id}/checklists`); } catch (e) { return trocar(caixa, h('h2', {}, 'Onboarding e offboarding'), vazio(textoErro(e))); }
  const abertos = dados.checklists.filter((k) => k.estado === 'aberto');
  const temAberto = (tipo) => abertos.some((k) => k.tipo === tipo);
  const podeAbrir = ctx.pode('conta.editar');

  const abrirOff = () => modal('Iniciar offboarding', (fechar) => formulario([
    h('p', { class: 'suave' }, 'Abre o checklist de encerramento. A conta só é encerrada quando todos os itens obrigatórios estiverem feitos ou dispensados. Nada é apagado.'),
    campo('Motivo do encerramento', h('textarea', { name: 'motivo', rows: 3, required: true, minlength: 5, maxlength: 1000 }), 'Ex.: cancelamento pedido pelo cliente, troca de fornecedor.'),
  ], 'Iniciar offboarding', async (d) => { await api.post(`/contas/${conta.id}/checklists`, { tipo: 'offboarding', motivo: d.motivo }); fechar(); aviso('Offboarding iniciado.'); recarregar(); }));
  const abrirOn = async () => { try { await api.post(`/contas/${conta.id}/checklists`, { tipo: 'onboarding' }); aviso('Onboarding iniciado.'); recarregar(); } catch (e) { aviso(textoErro(e), 'erro'); } };

  const agir = (i, acao, titulo, rotulo, nomeCampo, ajuda) => () => {
    if (!nomeCampo) { api.post(`/checklists/itens/${i.id}/${acao}`, {}).then(() => { aviso(`${titulo}: feito.`); recarregar(); }, (e) => aviso(textoErro(e), 'erro')); return; }
    modal(titulo, (fechar) => formulario([h('p', {}, i.titulo), campo(rotulo, h('textarea', { name: nomeCampo, rows: 3, required: true, minlength: 5, maxlength: 1000 }), ajuda)],
      titulo, async (d) => { await api.post(`/checklists/itens/${i.id}/${acao}`, d); fechar(); aviso(`${titulo}: feito.`); recarregar(); }));
  };
  const minhaVez = (i) => ctx.pode('conta.editar') || ctx.usuario.equipeCodigo === i.equipe_codigo;
  const botoes = (i) => {
    const b = [];
    if (i.estado === 'pendente' && minhaVez(i)) {
      b.push(h('button', { class: 'btn btn-pequeno btn-primario', type: 'button', onclick: agir(i, 'feito', 'Marcar como feito', 'Evidência', 'evidencia', 'O que foi feito, onde está e quem confirmou.') }, 'Feito'));
      if (i.obrigatorio) b.push(h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: agir(i, 'pedir_dispensa', 'Pedir dispensa', 'Por que não se aplica', 'motivo', 'A gestão aprova a exceção.') }, 'Não se aplica'));
    }
    if (i.estado === 'dispensa_pedida' && ctx.pode('ocorrencia.intervir') && i.dispensa_pedida_por !== ctx.usuario.id) {
      b.push(h('button', { class: 'btn btn-pequeno btn-primario', type: 'button', onclick: agir(i, 'aprovar_dispensa', 'Aprovar dispensa') }, 'Aprovar dispensa'),
        h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: agir(i, 'negar_dispensa', 'Negar dispensa') }, 'Negar'));
    }
    return b.length ? h('span', { class: 'acoes' }, b) : null;
  };

  const blocoChecklist = (k) => {
    const aberto = k.estado === 'aberto';
    const porGrupo = Object.keys(dados.grupos).filter((g) => k.itens.some((i) => i.grupo === g));
    return h('div', { class: 'checklist' },
      h('div', { class: 'linha-topo' }, h('strong', {}, k.rotulo), selo(aberto ? 'em andamento' : 'concluído', aberto ? 'info' : 'ok'),
        h('span', { class: 'suave' }, `aberto ${dataHora(k.aberto_em)}${k.aberto_por_nome ? ` por ${k.aberto_por_nome}` : ''} · modelo v${k.modelo_versao}`
          + (k.pedidos_cliente ? ` · cliente lembrado ${k.pedidos_cliente}x (último ${dataHora(k.ultimo_pedido_cliente_em)})` : ''))),
      k.motivo ? h('p', { class: 'suave' }, `Motivo: ${k.motivo}`) : null,
      h('div', { class: 'checklist-progresso' }, k.progresso.grupos.map((g) => h('div', { class: 'checklist-grupo' },
        h('span', {}, g.nome), h('span', { class: 'checklist-barra', role: 'img', 'aria-label': `${g.prontos} de ${g.total}` }, h('span', { style: { width: `${g.total ? (g.prontos / g.total) * 100 : 0}%` } })),
        h('span', { class: 'suave' }, `${g.prontos}/${g.total}`)))),
      porGrupo.map((g) => h('div', {}, h('h3', {}, dados.grupos[g]), h('ul', { class: 'itens' }, k.itens.filter((i) => i.grupo === g).map((i) => h('li', { class: `linha-acao checklist-item${i.atrasado ? ' atrasado' : ''}` },
        h('span', {}, selo(...ESTADO[i.estado]), ' ', h('strong', {}, i.titulo), i.obrigatorio ? '' : h('span', { class: 'suave' }, ' (opcional)'),
          h('div', { class: 'suave' }, `${EQUIPE[i.equipe_codigo] || i.equipe_codigo}`, ['pendente', 'dispensa_pedida'].includes(i.estado) ? ` · prazo ${relativo(i.prazo_em)}` : '',
            i.atrasado ? h('strong', { class: 'texto-perigo' }, ' · atrasado') : null),
          i.evidencia ? h('div', { class: 'suave' }, `${i.automatico ? '' : `${i.feito_por_nome || ''}: `}${i.evidencia}`) : null,
          i.dispensa_motivo ? h('div', { class: 'suave' }, `Dispensa${i.pedida_por_nome ? ` pedida por ${i.pedida_por_nome}` : ''}: ${i.dispensa_motivo}${i.aprovada_por_nome ? ` · aprovada por ${i.aprovada_por_nome}` : ''}`) : null),
        aberto ? botoes(i) : null))))),
      aberto && ctx.pode('conta.editar') ? h('div', { class: 'form-acoes' },
        k.progresso.podeConcluir ? null : h('span', { class: 'suave' }, `Faltam ${k.progresso.faltam.length} item(ns) obrigatório(s). `),
        h('button', { class: 'btn btn-primario', type: 'button', disabled: !k.progresso.podeConcluir, onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { const r = await api.post(`/checklists/${k.id}/concluir`); aviso(k.tipo === 'onboarding' ? `Onboarding concluído: conta ${r.contaStatus}.` : 'Offboarding concluído: conta encerrada.'); recarregar(); }
          catch (err) { aviso(textoErro(err), 'erro'); e.currentTarget.disabled = false; }
        } }, k.tipo === 'onboarding' ? 'Concluir onboarding' : 'Concluir offboarding e encerrar a conta')) : null);
  };

  return trocar(caixa,
    h('div', { class: 'titulo-tela' }, h('h2', {}, 'Onboarding e offboarding'),
      podeAbrir ? h('span', { class: 'acoes' },
        !temAberto('onboarding') && conta.status !== 'encerrada' ? h('button', { class: 'btn btn-pequeno', type: 'button', onclick: abrirOn }, 'Iniciar onboarding') : null,
        !temAberto('offboarding') && conta.status !== 'encerrada' ? h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: abrirOff }, 'Iniciar offboarding') : null) : null),
    dados.checklists.length ? dados.checklists.map(blocoChecklist) : vazio('Nenhum checklist. A venda de cliente novo abre o onboarding sozinha.'));
}
