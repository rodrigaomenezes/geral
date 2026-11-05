import { h, trocar, dataHora } from '../dom.js';
import { api } from '../api.js';

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')}%`);

function kpi(rotulo, valor, { meta, ruim, link, nota } = {}) {
  const alerta = ruim !== undefined && ruim;
  const corpo = [h('span', { class: 'kpi-rotulo' }, rotulo), h('strong', { class: `kpi-valor${alerta ? ' kpi-alerta' : ''}` }, valor),
    meta ? h('small', {}, meta) : null, nota ? h('small', { class: 'suave' }, nota) : null];
  return link ? h('a', { class: 'kpi', href: link }, corpo) : h('div', { class: 'kpi' }, corpo);
}

export async function telaPainel(el, ctx) {
  const k = await api.get('/painel');
  const o = k.ocorrencias;
  const barras = h('div', { class: 'barras' }, k.porEquipe.filter((e) => e.ativas || e.vencidas).map((e) => {
    const max = Math.max(...k.porEquipe.map((x) => x.ativas), 1);
    return h('div', { class: 'barra-linha' }, h('span', { class: 'barra-nome' }, e.nome),
      h('div', { class: 'barra-trilho' }, h('div', { class: 'barra', style: { width: `${Math.round((e.ativas / max) * 100)}%` } })),
      h('span', { class: 'barra-num' }, `${e.ativas}${e.vencidas ? ` · ${e.vencidas} vencida(s)` : ''}`));
  }));
  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, `Olá, ${ctx.usuario.nome.split(' ')[0]}`), h('p', { class: 'suave' }, `Situação em ${dataHora(k.geradoEm)}`)),
    h('section', { class: 'grade-kpi', 'aria-label': 'Invariantes' },
      kpi('Ocorrências órfãs', o.orfas, { meta: 'meta 0', ruim: o.orfas > 0, link: '#/supervisor' }),
      kpi('Sem próxima ação', o.sem_proxima_acao, { meta: 'meta 0', ruim: o.sem_proxima_acao > 0, link: '#/supervisor' }),
      kpi('Ocorrências ativas', o.ativas, { link: '#/ocorrencias', nota: `${o.vencidas} com prazo vencido` }),
      kpi('Na triagem', o.triagem, { link: '#/triagem', ruim: o.triagem > 5 }),
      kpi('SLA de primeira resposta', fmtPct(o.slaPrimeiraResposta), { meta: 'dentro do prazo' }),
      kpi('Tarefas abertas', k.tarefas.abertas, { link: '#/tarefas', nota: `${k.tarefas.vencidas} vencida(s)`, ruim: k.tarefas.vencidas > 0 })),
    h('section', { class: 'grade-kpi', 'aria-label': 'Rodadas' },
      kpi('Correção pré-rodada', fmtPct(k.rodadas.correcaoPreRodada), { meta: 'corrigidas até D0 / detectadas no D-4', link: '#/rodadas' }),
      kpi('Sucesso de consultas', fmtPct(k.rodadas.sucessoConsultas), { meta: 'veículos com resultado / elegíveis' }),
      kpi('Pendências abertas', k.pendencias.abertas, { nota: `${k.pendencias.persistentes} persistente(s) após a rodada`, link: '#/rodadas' }),
      kpi('Próximas rodadas', k.rodadas.proximas, { link: '#/rodadas' }),
      kpi('Handoff no prazo', fmtPct(k.handoff.noPrazo), { meta: 'aceitas no prazo / decididas' }),
      kpi('Contas sem ponto focal', k.qualidade.sem_ponto_focal, { ruim: k.qualidade.sem_ponto_focal > 0, link: '#/contas', nota: `de ${k.qualidade.contas} contas` }),
      kpi('Fila de falhas', k.integracoes.fila_falhas, { ruim: k.integracoes.fila_falhas > 0, nota: `${k.integracoes.em_retentativa} em retentativa`, link: ctx.pode('supervisor.ver') ? '#/supervisor' : undefined })),
    h('section', { class: 'cartao' }, h('h2', {}, 'Ocorrências ativas por equipe'), barras));
}
