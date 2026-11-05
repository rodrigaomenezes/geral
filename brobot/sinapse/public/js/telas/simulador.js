import { h, trocar, dataHora, selo, aviso } from '../dom.js';
import { api, textoErro } from '../api.js';

const CENARIOS = [
  ['mensagem_desconhecida', 'AT-001', 'Mensagem de número desconhecido', 'Vai para a Triagem com prazo; nada se perde.'],
  ['webhook_triplo', 'AT-002', 'Mesmo webhook 3 vezes', 'Uma ocorrência só; repetições auditadas.'],
  ['responsavel_indisponivel', 'AT-003', 'Rafael indisponível (alterna)', 'Ao processar, ocorrências dele vão para a substituta.'],
  ['acesso_outro_tenant', 'AT-014', 'Ler dado de outra organização', 'Banco devolve nada (RLS) e a tentativa é auditada.'],
  ['bloqueio_inadimplencia', 'AT-015', 'Pedir bloqueio por inadimplência', 'Sem regra aprovada: nenhuma ação na Platform.'],
];

export async function telaSimulador(el, ctx) {
  const e = await api.get('/demo/estado');
  const recarregar = () => telaSimulador(el, ctx);
  const rodar = (nome, corpo = {}) => async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { const r = await api.post(`/demo/cenarios/${nome}`, corpo); aviso(r.mensagem || 'Feito.'); await recarregar(); } catch (err) { aviso(textoErro(err), 'erro'); b.disabled = false; }
  };
  const pendencia = h('select', { 'aria-label': 'Pendência' }, e.pendencias.map((p) => h('option', { value: p.id }, `${p.conta_nome} · ${p.placa} · ${p.erro_codigo}`)));

  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, 'Simulador da apresentação')),
    h('p', { class: 'suave' }, 'Os cenários usam os mesmos serviços da operação real. Relógio do sistema: ', h('strong', {}, dataHora(e.agora)),
      e.deslocamentoHoras ? ` (adiantado ${e.deslocamentoHoras} h)` : ''),
    h('section', { class: 'cartao' }, h('h2', {}, 'Tempo'), h('p', { class: 'suave' }, 'Adiante o relógio para ver D-3, ligação, D-1, D0 e D+3 acontecerem, e o supervisor escalonar prazos vencidos.'),
      h('div', { class: 'acoes' }, [[1, '+1 hora'], [3, '+3 horas'], [24, '+1 dia'], [72, '+3 dias']].map(([horas, r]) => h('button', { class: 'btn', onclick: rodar('avancar_relogio', { horas }) }, r)),
        h('button', { class: 'btn btn-fantasma', onclick: rodar('processar_agora') }, 'Processar fila agora'))),
    h('section', { class: 'cartao' }, h('h2', {}, 'Integrações (AT-005, AT-006, AT-007)'), h('div', { class: 'acoes' }, e.integracoes.map((i) => h('button', {
      class: `btn ${i.disponivel ? '' : 'btn-perigo'}`, onclick: rodar('alternar_integracao', { nome: i.nome }),
    }, `${i.nome}: ${i.disponivel ? 'derrubar' : 'restaurar'}`))),
    h('p', { class: 'suave' }, 'Fora do ar, a Platform segura a pré-rodada em retentativa; o OMIE mantém o último status sem inventar; o WhatsApp tenta de novo e cai para e-mail.')),
    h('section', { class: 'cartao' }, h('h2', {}, 'Correção pelo cliente (AT-008)'),
      e.pendencias.length ? [h('p', { class: 'suave' }, '1) Simule a correção na Platform. 2) Na tela da rodada, clique em "Revalidar": o ERP confirma, fecha a pendência e cancela os contatos futuros.'),
        h('div', { class: 'filtros' }, pendencia, h('button', { class: 'btn', onclick: (ev) => rodar('cliente_corrigiu', { pendenciaId: pendencia.value })(ev) }, 'Cliente corrigiu na Platform'))]
        : h('p', {}, 'Nenhuma pendência aberta.')),
    h('section', { class: 'cartao' }, h('h2', {}, 'Cenários de aceite'), h('ul', { class: 'itens' }, CENARIOS.map(([nome, at, rotulo, desc]) => h('li', {},
      selo(at, 'info'), ' ', h('strong', {}, rotulo), h('div', { class: 'suave' }, desc), h('button', { class: 'btn btn-pequeno', onclick: rodar(nome) }, 'Executar')))),
      h('p', { class: 'suave' }, `Rafael está ${e.rafaelDisponivel ? 'disponível' : 'indisponível'}.`)),
    h('section', { class: 'cartao' }, h('h2', {}, 'Reiniciar'), h('p', { class: 'suave' }, 'Apaga a demonstração e cria de novo (só funciona sem organizações reais no banco).'),
      h('button', { class: 'btn btn-perigo', onclick: async () => {
        if (!window.confirm('Reiniciar toda a demonstração?')) return;
        try { await api.post('/demo/reiniciar'); location.hash = ''; location.reload(); } catch (err) { aviso(textoErro(err), 'erro'); }
      } }, 'Reiniciar demonstração')));
}
