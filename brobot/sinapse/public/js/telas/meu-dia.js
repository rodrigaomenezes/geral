// Meu dia: tudo o que pede a minha atenção agora, numa lista só, com ação de um clique.
import { h, trocar, dataHora, relativo, selo, campo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

const RECORRENCIAS = { '': 'Não repete', diaria: 'Todo dia', dias_uteis: 'Dias úteis', semanal: 'Toda semana', mensal: 'Todo mês' };
const ETAPA = { novo: 'Novo lead', qualificacao: 'Qualificação', demonstracao: 'Demonstração', proposta: 'Proposta', teste: 'Teste', negociacao: 'Negociação' };

const daquiA = (horas) => { const d = new Date(Date.now() + horas * 3600e3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function novoLembrete(ctx, aoSalvar, extra = {}) {
  const equipes = Object.fromEntries(ctx.equipes.equipes.map((e) => [e.codigo, `Equipe ${e.nome}`]));
  modal('Novo lembrete', (fechar) => formulario([
    campo('Lembrar de', h('input', { name: 'titulo', required: true, minlength: 2, maxlength: 200 })),
    campo('Quando', h('input', { type: 'datetime-local', name: 'quando', required: true, value: daquiA(1) })),
    campo('Repetir', opcoes(h('select', { name: 'recorrencia' }), RECORRENCIAS)),
    campo('Para', opcoes(h('select', { name: 'equipeCodigo' }), equipes, 'Só para mim')),
    campo('Detalhe (opcional)', h('textarea', { name: 'detalhe', rows: 2, maxlength: 1000 })),
  ], 'Criar lembrete', async (d) => {
    if (!d.recorrencia) delete d.recorrencia;
    await api.post('/lembretes', { ...d, ...extra }); fechar(); aviso('Lembrete criado.'); aoSalvar?.();
  }));
}

export async function telaMeuDia(el, ctx) {
  const d = await api.get('/meu-dia');
  const recarregar = () => telaMeuDia(el, ctx);
  const agora = new Date(d.agora);
  const atrasado = (x) => new Date(x) < agora;
  const acao = (rotulo, fn, cls = 'btn-pequeno') => h('button', { class: `btn ${cls}`, onclick: async (e) => {
    e.currentTarget.disabled = true;
    try { await fn(); recarregar(); } catch (err) { aviso(textoErro(err), 'erro'); e.currentTarget.disabled = false; }
  } }, rotulo);

  // Uma fila de prioridades: atrasado primeiro, depois por horário.
  const itens = [
    ...d.ocorrencias.map((o) => ({ quando: o.proxima_acao_em, tipo: 'Ocorrência', titulo: `${o.protocolo} · ${o.titulo}`, sub: `${o.conta_nome || 'sem cliente'} · ${o.proxima_acao}`,
      link: `#/ocorrencias/${o.id}`, vip: o.vip, minha: o.minha })),
    ...d.tarefas.map((t) => ({ quando: t.prazo_em, tipo: t.tipo === 'ligacao' ? 'Ligação' : t.tipo === 'escalonamento' ? 'Escalonamento' : 'Tarefa', titulo: t.titulo,
      sub: [t.protocolo, t.conta_nome].filter(Boolean).join(' · '), link: '#/tarefas', minha: t.minha })),
    ...d.oportunidades.map((o) => ({ quando: o.proxima_acao_em, tipo: 'Comercial', titulo: `${o.codigo} · ${o.empresa}`, sub: `${ETAPA[o.etapa]} · ${o.proxima_acao}`, link: `#/comercial/${o.id}`, minha: true })),
  ].sort((a, b) => new Date(a.quando) - new Date(b.quando));

  const linhaItem = (i) => h('a', { class: `linha ${atrasado(i.quando) ? 'linha-vencido' : 'linha-no_prazo'}`, href: i.link },
    h('div', { class: 'linha-topo' }, selo(i.tipo, i.tipo === 'Escalonamento' ? 'perigo' : i.tipo === 'Comercial' ? 'vip' : 'info'), i.vip ? selo('VIP', 'vip') : null,
      atrasado(i.quando) ? selo(`atrasado ${relativo(i.quando, agora).replace('há ', '')}`, 'perigo') : h('span', { class: 'suave' }, `${dataHora(i.quando)} (${relativo(i.quando, agora)})`),
      i.minha === false ? h('span', { class: 'suave' }, '· fila da equipe') : null),
    h('div', { class: 'linha-titulo' }, i.titulo), i.sub ? h('div', { class: 'linha-meta' }, i.sub) : null);

  const lembrete = (l) => h('div', { class: `linha ${atrasado(l.quando) ? 'linha-vencido' : 'linha-no_prazo'}` },
    h('div', { class: 'linha-topo' }, selo('Lembrete', 'alerta'), l.da_equipe ? selo('da equipe', 'neutro') : null, l.recorrencia ? selo(RECORRENCIAS[l.recorrencia], 'neutro') : null,
      h('span', { class: 'suave' }, `${dataHora(l.quando)} (${relativo(l.quando, agora)})`), l.adiamentos >= 3 ? selo(`adiado ${l.adiamentos}x`, 'perigo') : null),
    h('div', { class: 'linha-titulo' }, l.titulo), l.detalhe ? h('div', { class: 'linha-meta' }, l.detalhe) : null,
    h('div', { class: 'form-acoes' },
      l.ocorrencia_id ? h('a', { class: 'btn btn-pequeno', href: `#/ocorrencias/${l.ocorrencia_id}` }, 'Abrir') : l.oportunidade_id ? h('a', { class: 'btn btn-pequeno', href: `#/comercial/${l.oportunidade_id}` }, 'Abrir')
        : l.conta_id ? h('a', { class: 'btn btn-pequeno', href: `#/contas/${l.conta_id}` }, 'Abrir') : null,
      acao('+1 h', () => api.post(`/lembretes/${l.id}/adiar`, { horas: 1 })), acao('Amanhã', () => api.post(`/lembretes/${l.id}/adiar`, { horas: 24 })),
      acao(l.recorrencia ? 'Feito (próximo)' : 'Feito', () => api.post(`/lembretes/${l.id}/concluir`), 'btn-pequeno btn-primario')));

  const vencendo = itens.filter((i) => new Date(i.quando) < new Date(d.fimDoDia));
  const proximos = itens.filter((i) => new Date(i.quando) >= new Date(d.fimDoDia));
  const chip = (n, rotulo, tipo) => h('div', { class: `chip-resumo chip-${tipo}` }, h('strong', {}, String(n)), h('span', {}, rotulo));
  const hora = Number(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric' }));
  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, `${hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'}, ${ctx.usuario.nome.split(' ')[0]}`),
      ctx.pode('agenda.usar') ? h('button', { class: 'btn btn-primario', onclick: () => novoLembrete(ctx, recarregar) }, '+ Lembrete') : null),
    h('div', { class: 'chips-resumo' }, chip(d.resumo.atrasados, 'atrasado(s)', d.resumo.atrasados ? 'perigo' : 'ok'), chip(d.resumo.hoje, 'para hoje', 'info'),
      chip(d.resumo.transferencias, 'transferência(s) para a equipe', d.resumo.transferencias ? 'alerta' : 'neutro'), chip(d.resumo.aguardando, 'aguardando cliente', 'neutro')),
    d.transferencias.length ? h('section', { class: 'cartao destaque' }, h('h2', {}, 'Transferências esperando o aceite da sua equipe'),
      h('div', { class: 'lista' }, d.transferencias.map((t) => h('a', { class: `linha ${atrasado(t.prazo_aceite_em) ? 'linha-vencido' : 'linha-em_risco'}`, href: `#/ocorrencias/${t.ocorrencia_id}` },
        h('div', { class: 'linha-topo' }, h('strong', {}, t.protocolo), h('span', { class: 'suave' }, `de ${t.de_nome} · aceitar até ${dataHora(t.prazo_aceite_em)}`)),
        h('div', { class: 'linha-titulo' }, t.titulo), h('div', { class: 'linha-meta' }, t.motivo))))) : null,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Agora e hoje'), vencendo.length ? h('div', { class: 'lista' }, vencendo.map(linhaItem)) : vazio('Nada atrasado nem vencendo hoje. 👏'),
        proximos.length ? [h('h3', {}, 'Próximos dias'), h('div', { class: 'lista' }, proximos.slice(0, 10).map(linhaItem))] : null),
      h('section', { class: 'cartao' }, h('h2', {}, 'Lembretes'), d.lembretes.length ? h('div', { class: 'lista' }, d.lembretes.map(lembrete)) : vazio('Sem lembretes. Use "+ Lembrete".'),
        d.aguardando.length ? [h('h3', {}, 'Aguardando o cliente (com revisão marcada)'), h('ul', { class: 'itens' }, d.aguardando.map((o) => h('li', {},
          h('a', { href: `#/ocorrencias/${o.id}` }, `${o.protocolo} · ${o.titulo}`), h('div', { class: 'suave' }, `${o.conta_nome || ''} · revisar ${relativo(o.proxima_acao_em, agora)}`))))] : null)));
}

// ---------- Sino de notificações (no topo) ----------
const GRAVIDADE = { alerta: 'Atenção', critica: 'Urgente' };

export function sinoNotificacoes() {
  const contador = h('span', { class: 'sino-contador', hidden: true });
  const painel = h('div', { class: 'sino-painel', hidden: true });
  const botao = h('button', { class: 'btn-sino', type: 'button', 'aria-label': 'Avisos', onclick: () => { painel.hidden = !painel.hidden; } }, '🔔', contador);
  let timer = null;
  async function carregar() {
    try {
      const n = await api.get('/notificacoes');
      contador.hidden = !n.naoLidas;
      contador.textContent = n.naoLidas > 9 ? '9+' : String(n.naoLidas);
      botao.setAttribute('aria-label', n.naoLidas ? `Avisos: ${n.naoLidas} não lido${n.naoLidas > 1 ? 's' : ''}` : 'Avisos: nenhum novo');
      trocar(painel, h('div', { class: 'sino-topo' }, h('strong', {}, 'Avisos'),
        n.naoLidas ? h('button', { class: 'btn btn-pequeno', onclick: async () => { await api.post('/notificacoes/lidas', { todas: true }); carregar(); } }, 'Marcar todos como lidos') : null),
      n.itens.length ? n.itens.map((x) => h('a', { class: `sino-item ${x.lida_em ? '' : 'nao-lida'} grav-${x.gravidade}`, href: x.link || '#/meu-dia',
        onclick: () => { painel.hidden = true; if (!x.lida_em) api.post('/notificacoes/lidas', { ids: [x.id] }).then(carregar).catch(() => {}); } },
      // a gravidade não fica só na cor da borda: vai escrita (leitor de tela e daltonismo)
      x.gravidade !== 'info' ? h('span', { class: `sino-grav grav-${x.gravidade}` }, GRAVIDADE[x.gravidade]) : null,
      h('strong', {}, x.titulo), x.texto ? h('span', {}, x.texto) : null, h('small', {}, dataHora(x.criado_em)))) : vazio('Nenhum aviso.'));
    } catch { /* sem conexão: tenta no próximo ciclo */ }
    clearTimeout(timer);
    timer = setTimeout(carregar, 60e3);
  }
  carregar();
  return h('div', { class: 'sino' }, botao, painel);
}
