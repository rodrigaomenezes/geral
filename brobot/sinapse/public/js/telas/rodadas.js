import { h, trocar, dataHora, relativo, selo, aviso, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { secaoAutomacoes } from './processos.js';

const ESTADO = { agendada: ['Agendada', 'neutro'], pre_rodada: ['Em pré-rodada', 'info'], pronta: ['Pronta', 'ok'], com_pendencias: ['Com pendências', 'alerta'],
  executada: ['Executada', 'ok'], concluida: ['Concluída', 'ok'] };
const COR_PEND = { aberta: 'alerta', persistente: 'perigo', corrigida: 'ok' };

export async function telaRodadas(el) {
  const r = await api.get('/rodadas');
  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Rodadas')),
    h('p', { class: 'suave' }, 'D-4: teste e diagnóstico na Platform. A partir daí os processos automáticos fazem a cadência (D-3 WhatsApp, ligação, D-1; comunicado no grupo após a rodada e follow-up D+3) e param sozinhos quando as pendências são corrigidas.'),
    h('div', { class: 'lista' }, r.itens.length ? r.itens.map((x) => h('a', { class: 'linha', href: `#/rodadas/${x.id}` },
      h('div', { class: 'linha-topo' }, h('strong', {}, x.conta_nome), x.vip ? selo('VIP', 'vip') : null, selo(...(ESTADO[x.estado] || [x.estado, 'neutro'])),
        x.pendencias_abertas ? selo(`${x.pendencias_abertas} pendência(s)`, 'alerta') : null),
      h('div', { class: 'linha-titulo' }, `${x.produto} · D0 ${dataHora(x.agendada_para)} (${relativo(x.agendada_para)})`),
      h('div', { class: 'linha-meta' }, h('span', {}, x.id_platform),
        x.veiculos_total !== null ? h('span', {}, `${x.veiculos_sucesso ?? '—'}/${x.veiculos_total} veículos com sucesso`) : null,
        x.pendencias_corrigidas_ate_d0 !== null ? h('span', {}, `${x.pendencias_corrigidas_ate_d0} de ${x.pendencias_detectadas} corrigidas até D0`) : null)))
      : vazio('Nenhuma rodada.')));
}

export async function telaRodada(el, ctx, id) {
  const r = await api.get(`/rodadas/${id}`);
  const recarregar = () => telaRodada(el, ctx, id);
  const revalidar = (p) => async (e) => {
    e.currentTarget.disabled = true;
    try {
      const res = await api.post(`/pendencias/${p.id}/revalidar`);
      if (res.corrigida) aviso(`${p.placa}: correção confirmada na Platform.${res.processosEncerrados ? ` ${res.processosEncerrados} processo(s) automático(s) encerrado(s): os contatos futuros não vão sair.` : ''}`);
      else aviso(`${p.placa}: a Platform ainda retorna erro (${res.codigo}). A pendência continua aberta.`, 'erro');
      recarregar();
    } catch (err) { aviso(textoErro(err), 'erro'); recarregar(); }
  };
  trocar(el,
    h('a', { class: 'voltar', href: '#/rodadas' }, '← Rodadas'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, `${r.conta_nome} · ${r.produto}`)),
    h('div', { class: 'selos' }, selo(...(ESTADO[r.estado] || [r.estado, 'neutro'])), r.vip ? selo('VIP', 'vip') : null, selo(`D0 ${dataHora(r.agendada_para)}`, 'info'),
      h('a', { href: `#/contas/${r.conta_id}` }, 'Ver conta')),
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Pendências'), r.pendencias.length ? h('ul', { class: 'itens' }, r.pendencias.map((p) => h('li', {},
        h('div', {}, h('strong', {}, p.placa), ' ', selo(p.estado, COR_PEND[p.estado]), ' ', selo(p.doCliente ? 'cliente' : 'técnica', p.doCliente ? 'info' : 'alerta'),
          p.recorrencias > 1 ? selo(`${p.recorrencias}x`, 'perigo') : null),
        h('div', {}, p.descricao), h('div', { class: 'suave' }, p.estado === 'corrigida' ? `Evidência: ${p.evidencia_correcao}` : `Como corrigir: ${p.instrucao}`),
        p.estado !== 'corrigida' && ctx.pode('rodada.operar') ? h('button', { class: 'btn btn-pequeno', onclick: revalidar(p) }, 'Revalidar na Platform') : null)))
        : vazio('Nenhuma pendência: rodada pronta.')),
      h('section', { class: 'cartao' }, h('h2', {}, 'Ocorrências da rodada'), r.ocorrencias.length ? null : vazio('Nenhuma.'),
      r.ocorrencias.length ? [h('ul', { class: 'itens' }, r.ocorrencias.map((o) => h('li', {},
        h('a', { href: `#/ocorrencias/${o.id}` }, `${o.protocolo} · ${o.titulo}`), ' ', selo(ctx.catalogos.estados[o.estado], 'neutro'))))] : null)),
    await secaoAutomacoes(ctx, { rodada: id }),
    r.veiculos_total !== null ? h('section', { class: 'cartao' }, h('h2', {}, 'Indicadores'), h('dl', { class: 'dados' },
      h('dt', {}, 'Veículos'), h('dd', {}, String(r.veiculos_total)), h('dt', {}, 'Sucesso / falha'), h('dd', {}, `${r.veiculos_sucesso ?? '—'} / ${r.veiculos_falha ?? '—'}`),
      h('dt', {}, 'Pendências no D-4'), h('dd', {}, String(r.pendencias_detectadas)), h('dt', {}, 'Corrigidas até D0'), h('dd', {}, r.pendencias_corrigidas_ate_d0 ?? '—'))) : null);
}
