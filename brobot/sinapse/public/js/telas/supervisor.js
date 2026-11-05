import { h, trocar, dataHora, relativo, selo, campo, aviso, modal, vazio } from '../dom.js';
import { api } from '../api.js';
import { formulario } from './ocorrencias.js';

const INV = [['orfas', 'Ocorrências órfãs'], ['sem_proxima_acao', 'Sem próxima ação'], ['proxima_acao_vencida', 'Próxima ação vencida'],
  ['prazo_vencido', 'Prazo de resolução vencido'], ['em_triagem', 'Na triagem'], ['escalonadas', 'Escalonadas'], ['handoffs_pendentes', 'Transferências aguardando aceite'],
  ['handoffs_vencidos', 'Transferências vencidas']];
const META_ZERO = ['orfas', 'sem_proxima_acao', 'handoffs_vencidos'];
const NOME_INT = { platform: 'Platform Brobot', omie: 'OMIE', whatsapp: 'WhatsApp', email: 'E-mail' };

export async function telaSupervisor(el, ctx) {
  const s = await api.get('/supervisor');
  const recarregar = () => telaSupervisor(el, ctx);
  const reprocessar = (j) => modal('Reprocessar item da fila de falhas', (fechar) => formulario([
    h('p', {}, `${j.tipo} · ${j.tentativas} tentativa(s) · ${j.ultimo_erro || ''}`),
    campo('Motivo (auditado)', h('textarea', { name: 'motivo', required: true, minlength: 5, rows: 2 })),
  ], 'Reprocessar', async (d) => { await api.post(`/supervisor/jobs/${j.id}/reprocessar`, d); fechar(); aviso('Item devolvido à fila.'); recarregar(); }));

  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, 'Supervisor independente'), h('button', { class: 'btn btn-fantasma', onclick: recarregar }, 'Atualizar')),
    h('p', {}, 'Heartbeat: ', s.heartbeat.ok ? selo('ativo', 'ok') : selo('PARADO', 'perigo'), ` último sinal ${s.heartbeat.ultimoHeartbeat ? relativo(s.heartbeat.ultimoHeartbeat) : 'nunca'}. `,
      h('span', { class: 'suave' }, 'Um monitor externo consulta /api/health/supervisor e alerta se parar.')),
    h('section', { class: 'grade-kpi' }, INV.map(([k, r]) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-rotulo' }, r),
      h('strong', { class: `kpi-valor${META_ZERO.includes(k) && s.invariantes[k] > 0 ? ' kpi-alerta' : ''}` }, String(s.invariantes[k])),
      META_ZERO.includes(k) ? h('small', {}, 'meta 0') : null))),
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Integrações'), h('ul', { class: 'itens' }, s.integracoes.map((i) => h('li', {},
        h('strong', {}, NOME_INT[i.nome] || i.nome), ' ', i.disponivel ? selo('respondendo', 'ok') : selo('fora do ar', 'perigo'),
        h('div', { class: 'suave' }, `Última sincronização: ${i.ultima_sincronizacao ? dataHora(i.ultima_sincronizacao) : 'nunca'}`,
          i.falhas_consecutivas ? ` · ${i.falhas_consecutivas} falha(s) seguida(s): ${i.ultimo_erro}` : ''))))),
      h('section', { class: 'cartao' }, h('h2', {}, 'Entrada e fila de jobs'), h('dl', { class: 'dados' },
        h('dt', {}, 'Entradas aguardando processamento'), h('dd', {}, String(s.entradas.aguardando)),
        h('dt', {}, 'Webhooks repetidos ignorados'), h('dd', {}, String(s.entradas.duplicatas_ignoradas)),
        ...s.jobs.flatMap((j) => [h('dt', {}, `Jobs ${j.estado}`), h('dd', {}, String(j.n))])),
      h('h3', {}, 'Próximas rotinas'), s.proximos.length ? h('ul', { class: 'itens' }, s.proximos.map((j) => h('li', {}, `${j.tipo} · ${dataHora(j.executar_em)}`,
        j.tentativas ? selo(`retentativa ${j.tentativas}`, 'alerta') : null, j.ultimo_erro ? h('div', { class: 'suave' }, j.ultimo_erro) : null))) : vazio('Nada agendado.'))),
    h('section', { class: 'cartao' }, h('h2', {}, 'Fila de falhas (dead-letter)'), s.falhas.length ? h('ul', { class: 'itens' }, s.falhas.map((j) => h('li', {},
      h('strong', {}, j.tipo), ` · ${j.tentativas} tentativas · ${dataHora(j.concluido_em)}`, h('div', { class: 'suave' }, j.ultimo_erro),
      ctx.pode('supervisor.reprocessar') ? h('button', { class: 'btn btn-pequeno', onclick: () => reprocessar(j) }, 'Reprocessar') : null)))
      : vazio('Nenhuma falha pendente.')),
    h('section', { class: 'cartao' }, h('h2', {}, 'Divergências de reconciliação'), s.divergencias.length ? h('ul', { class: 'itens' }, s.divergencias.map((d) => h('li', {},
      selo(d.tipo, 'alerta'), ` ${d.descricao}`))) : vazio('Sem divergências.')));
}
