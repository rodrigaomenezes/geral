import { h, trocar, dataHora, relativo, selo, campo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { secaoAutomacoes } from './processos.js';
import { ligar } from '../telefone.js';

const COR_ESTADO = { triagem: 'alerta', aberta: 'info', em_atendimento: 'ativo', aguardando_cliente: 'neutro', aguardando_terceiro: 'neutro',
  em_handoff: 'alerta', resolvida: 'ok', encerrada_sem_resolucao: 'neutro' };
const COR_PRIO = { baixa: 'neutro', media: 'info', alta: 'alerta', critica: 'perigo' };
const SLA = { vencido: ['Prazo vencido', 'perigo'], em_risco: ['Prazo em risco', 'alerta'], no_prazo: ['No prazo', 'ok'], pausado: ['Prazo pausado (em espera)', 'neutro'] };

export const seloEstado = (ctx, e) => selo(ctx.catalogos.estados[e] || e, COR_ESTADO[e]);
export const seloSla = (s) => (s ? selo(...SLA[s]) : null);

export async function telaOcorrencias(el, ctx, fixo = {}) {
  const filtros = { estado: fixo.estado || ctx.query?.get('estado') || 'ativas', equipe: ctx.query?.get('equipe') || '', minhas: false, q: '', pagina: 1 };
  const lista = h('div', { class: 'lista' });
  const rodape = h('div', { class: 'paginacao' });

  const estado = opcoes(h('select', { 'aria-label': 'Situação' }), { ativas: 'Ativas', encerradas: 'Encerradas', todas: 'Todas', ...ctx.catalogos.estados });
  estado.value = filtros.estado;
  const equipe = opcoes(h('select', { 'aria-label': 'Equipe' }), Object.fromEntries(ctx.equipes.equipes.map((e) => [e.codigo, e.nome])), 'Todas as equipes');
  equipe.value = filtros.equipe;
  const busca = h('input', { type: 'search', placeholder: 'Protocolo, título, cliente ou CNPJ', 'aria-label': 'Buscar' });
  const minhas = h('input', { type: 'checkbox' });
  const aplicar = () => { Object.assign(filtros, { estado: estado.value, equipe: equipe.value, q: busca.value.trim(), minhas: minhas.checked, pagina: 1 }); carregar(); };
  estado.onchange = aplicar; equipe.onchange = aplicar; minhas.onchange = aplicar;
  let t; busca.oninput = () => { clearTimeout(t); t = setTimeout(aplicar, 350); };

  async function carregar() {
    const qs = new URLSearchParams({ estado: filtros.estado, pagina: filtros.pagina });
    if (filtros.equipe) qs.set('equipe', filtros.equipe);
    if (filtros.q) qs.set('q', filtros.q);
    if (filtros.minhas) qs.set('minhas', '1');
    try {
      const r = await api.get(`/ocorrencias?${qs}`);
      trocar(lista, r.itens.length ? r.itens.map((o) => linha(ctx, o)) : vazio('Nenhuma ocorrência com esses filtros.'));
      const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
      trocar(rodape, h('span', {}, `${r.total} ocorrência(s) · página ${r.pagina} de ${paginas}`),
        h('button', { class: 'btn btn-fantasma', disabled: r.pagina <= 1, onclick: () => { filtros.pagina--; carregar(); } }, 'Anterior'),
        h('button', { class: 'btn btn-fantasma', disabled: r.pagina >= paginas, onclick: () => { filtros.pagina++; carregar(); } }, 'Próxima'));
    } catch (e) { trocar(lista, vazio(textoErro(e))); }
  }

  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, fixo.titulo || 'Ocorrências'),
      fixo.estado ? null : h('div', { class: 'acoes' }, h('a', { class: 'btn btn-fantasma', href: '#/quadro' }, 'Ver em quadro'),
        ctx.pode('ocorrencia.atender') ? h('button', { class: 'btn btn-primario', onclick: () => novaOcorrencia(ctx) }, 'Nova ocorrência') : null)),
    fixo.estado === 'triagem' ? h('p', { class: 'suave' }, 'Mensagens sem cliente identificado ou com assunto incerto. Nada se perde: cada uma tem prazo e próxima ação até ser classificada.') : null,
    h('div', { class: 'filtros' }, fixo.estado ? null : estado, equipe, busca, h('label', { class: 'check' }, minhas, 'Só as minhas')),
    lista, rodape);
  carregar();
}

function linha(ctx, o) {
  return h('a', { class: `linha linha-${o.sla || 'final'}`, href: `#/ocorrencias/${o.id}` },
    h('div', { class: 'linha-topo' }, h('strong', {}, o.protocolo), seloEstado(ctx, o.estado), selo(ctx.catalogos.prioridades[o.prioridade], COR_PRIO[o.prioridade]),
      o.vip ? selo('VIP', 'vip') : null, seloSla(o.sla), o.nivel_escalonamento ? selo(`Escalonada N${o.nivel_escalonamento}`, 'perigo') : null),
    h('div', { class: 'linha-titulo' }, o.titulo),
    h('div', { class: 'linha-meta' },
      h('span', {}, o.conta_nome || 'Cliente não identificado'), h('span', {}, o.equipe_nome), h('span', {}, o.responsavel_nome || 'Na fila'),
      o.proxima_acao ? h('span', {}, `Próxima ação: ${o.proxima_acao} (${relativo(o.proxima_acao_em)})`) : null));
}

async function escolherConta(rotulo = 'Cliente') {
  const r = await api.get('/contas?pagina=1');
  return campo(rotulo, opcoes(h('select', { name: 'contaId', required: true }), Object.fromEntries(r.itens.map((c) => [c.id, `${c.nome}${c.vip ? ' (VIP)' : ''}`])), 'Selecione'));
}

async function novaOcorrencia(ctx) {
  const contaCampo = await escolherConta();
  const tipos = Object.fromEntries(Object.entries(ctx.catalogos.tipos).filter(([k]) => k !== 'nao_classificada'));
  modal('Nova ocorrência', (fechar) => formulario([
    contaCampo,
    campo('Tipo', opcoes(h('select', { name: 'tipo', required: true }), tipos)),
    campo('Prioridade', opcoes(h('select', { name: 'prioridade', required: true }), ctx.catalogos.prioridades)),
    campo('Título', h('input', { name: 'titulo', required: true, minlength: 5, maxlength: 200 })),
    campo('Descrição', h('textarea', { name: 'descricao', rows: 3, maxlength: 4000 })),
  ], 'Abrir ocorrência', async (d) => {
    const o = await api.post('/ocorrencias', d);
    fechar(); aviso(`Ocorrência ${o.protocolo} aberta e roteada.`); location.hash = `#/ocorrencias/${o.id}`;
  }));
}

/** Formulário genérico: coleta os campos `name` e chama `enviar(dados)`. */
export function formulario(campos, rotuloBotao, enviar) {
  const botao = h('button', { class: 'btn btn-primario', type: 'submit' }, rotuloBotao);
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    const dados = {};
    for (const x of form.querySelectorAll('[name]')) {
      if (x.type === 'checkbox') dados[x.name] = x.checked;
      else if (x.value !== '') dados[x.name] = x.type === 'datetime-local' ? new Date(x.value).toISOString() : x.value;
    }
    botao.disabled = true;
    try { await enviar(dados); } catch (err) { aviso(textoErro(err), 'erro'); } finally { botao.disabled = false; }
  } }, campos, h('div', { class: 'form-acoes' }, botao));
  return form;
}

const amanha = () => { const d = new Date(Date.now() + 24 * 3600e3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

async function camposDaAcao(ctx, acao) {
  const motivo = (r = 'Motivo') => campo(r, h('textarea', { name: 'motivo', rows: 2, required: true, maxlength: 500 }));
  switch (acao) {
    case 'classificar': return [await escolherConta(), campo('Tipo', opcoes(h('select', { name: 'tipo', required: true }),
      Object.fromEntries(Object.entries(ctx.catalogos.tipos).filter(([k]) => k !== 'nao_classificada')))),
    campo('Prioridade', opcoes(h('select', { name: 'prioridade', required: true }), ctx.catalogos.prioridades))];
    case 'devolver_fila': case 'reabrir': return [motivo()];
    case 'aguardar_cliente': case 'aguardar_terceiro': return [motivo('O que estamos esperando'),
      campo('Revisar em', h('input', { type: 'datetime-local', name: 'revisaoEm', required: true, value: amanha() }), 'A espera é revisada nesta data; no máximo 3 dias.')];
    case 'solicitar_handoff': return [campo('Transferir para', opcoes(h('select', { name: 'paraEquipe', required: true }),
      Object.fromEntries(ctx.equipes.equipes.filter((e) => !['triagem', 'contingencia'].includes(e.codigo)).map((e) => [e.codigo, e.nome])))),
    motivo(), h('p', { class: 'suave' }, 'Sua equipe continua dona até a outra equipe aceitar. Sem aceite no prazo, vai para a Contingência.')];
    case 'resolver': return [campo('Desfecho', opcoes(h('select', { name: 'codigoDesfecho', required: true }), ctx.catalogos.desfechosResolvida)),
      campo('Evidência da resolução', h('textarea', { name: 'evidencia', rows: 3, required: true, minlength: 10, maxlength: 2000 }), 'O que foi verificado e onde (ex.: consulta refeita na Platform sem erro).')];
    case 'encerrar_sem_resolucao': return [campo('Motivo do encerramento', opcoes(h('select', { name: 'codigoDesfecho', required: true }), ctx.catalogos.desfechosSemResolucao)),
      motivo('Explique'), h('p', { class: 'suave' }, 'Encerrar o contato não resolve a pendência técnica: ela continua visível até ser corrigida.')];
    default: return null;
  }
}

/** Executa uma transição da máquina (detalhe e quadro usam a mesma): pede os campos que a ação exige e envia com a
 *  versão lida, para que duas pessoas mexendo ao mesmo tempo recebam conflito em vez de sobrescrever. */
export async function executarAcao(ctx, o, acao, rotulo, aoTerminar, aoCancelar = () => {}) {
  const campos = await camposDaAcao(ctx, acao);
  const enviar = async (dados) => {
    await api.post(`/ocorrencias/${o.id}/transicoes`, { acao, versao: o.version, dados });
    aviso(`${rotulo}: feito.`);
    aoTerminar();
  };
  if (!campos) { try { await enviar({}); } catch (e) { aviso(textoErro(e), 'erro'); aoCancelar(); } return; }
  let feito = false;
  modal(rotulo, (fechar) => formulario(campos, rotulo, async (d) => { await enviar(d); feito = true; fechar(); }), () => { if (!feito) aoCancelar(); });
}

export async function telaOcorrencia(el, ctx, id) {
  const o = await api.get(`/ocorrencias/${id}`);
  const recarregar = () => telaOcorrencia(el, ctx, id);

  const executar = (acao, rotulo) => executarAcao(ctx, o, acao, rotulo, recarregar);

  const acoes = h('div', { class: 'acoes' }, o.acoes.map((a) => h('button', {
    class: `btn ${['resolver', 'assumir', 'classificar', 'aceitar_handoff'].includes(a.acao) ? 'btn-primario' : ''}`, onclick: () => executar(a.acao, a.rotulo),
  }, a.rotulo)),
  o.conta_id && ctx.pode('telefonia.usar') ? h('button', { class: 'btn', onclick: () => ligar({ ocorrenciaId: o.id, aoEncerrar: recarregar }) }, '📞 Ligar') : null,
  ctx.pode('ocorrencia.intervir') && !['resolvida', 'encerrada_sem_resolucao'].includes(o.estado) ? h('button', { class: 'btn btn-fantasma', onclick: () => reatribuir(ctx, o, recarregar) }, 'Reatribuir (intervenção)') : null,
  ctx.pode('ocorrencia.atender') ? h('button', { class: 'btn btn-fantasma', onclick: () => organizar(ctx, o, recarregar) }, 'Relacionar, mesclar ou dividir') : null,
  ctx.pode('ocorrencia.intervir') && o.nivel_escalonamento > (o.escalonamento_ciente_nivel || 0) && !['resolvida', 'encerrada_sem_resolucao'].includes(o.estado)
    ? h('button', { class: 'btn btn-primario', onclick: () => ciencia(o, recarregar) }, `Registrar ciência (nível ${o.nivel_escalonamento})`) : null);

  const conversa = h('div', { class: 'conversa' }, o.interacoes.length ? o.interacoes.map((i) => h('div', { class: `msg msg-${i.direcao}` },
    h('div', { class: 'msg-meta' }, h('strong', {}, i.direcao === 'entrada' ? (i.remetente || 'Cliente') : i.direcao === 'nota' ? `Nota interna · ${i.autor_nome || ''}` : (i.autor_nome || 'Sinapse (automático)')),
      h('span', {}, `${i.canal} · ${dataHora(i.criado_em)}`), i.direcao === 'saida' ? selo(i.status_entrega, i.status_entrega === 'falhou' || i.status_entrega === 'bloqueada' ? 'perigo' : i.status_entrega === 'enviada' ? 'ok' : 'neutro') : null),
    h('p', { class: 'msg-texto' }, i.texto))) : vazio('Sem mensagens ainda.'));

  const texto = h('textarea', { rows: 3, maxlength: 3000, placeholder: 'Escreva a resposta ao cliente (sai pelo canal de origem) ou uma nota interna', 'aria-label': 'Mensagem' });
  const enviarMsg = (tipo) => async () => {
    if (texto.value.trim().length < 2) { aviso('Escreva a mensagem antes de enviar.', 'erro'); return; }
    try { await api.post(`/ocorrencias/${id}/${tipo}`, { texto: texto.value.trim() }); aviso(tipo === 'respostas' ? 'Resposta enfileirada para envio.' : 'Nota registrada.'); recarregar(); } catch (e) { aviso(textoErro(e), 'erro'); }
  };
  const ativa = !['resolvida', 'encerrada_sem_resolucao'].includes(o.estado);

  trocar(el,
    h('a', { class: 'voltar', href: o.estado === 'triagem' ? '#/triagem' : '#/ocorrencias' }, '← Voltar'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, `${o.protocolo} · ${o.titulo}`)),
    h('div', { class: 'selos' }, seloEstado(ctx, o.estado), selo(ctx.catalogos.prioridades[o.prioridade], COR_PRIO[o.prioridade]), o.vip ? selo('VIP', 'vip') : null,
      seloSla(o.sla), o.nivel_escalonamento ? selo(`Escalonada nível ${o.nivel_escalonamento}${o.escalonamento_ciente_nivel >= o.nivel_escalonamento ? ' · gestão ciente' : ''}`, o.escalonamento_ciente_nivel >= o.nivel_escalonamento ? 'alerta' : 'perigo') : null, o.reaberturas ? selo(`Reaberta ${o.reaberturas}x`, 'alerta') : null),
    acoes,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Dados'), h('dl', { class: 'dados' },
        par('Cliente', o.conta_id ? h('a', { href: `#/contas/${o.conta_id}` }, o.conta_nome) : 'Não identificado'),
        par('Ponto focal', o.ponto_focal_nome || '—'), par('Tipo', ctx.catalogos.tipos[o.tipo]), par('Origem', o.origem),
        par('Equipe (dona)', o.equipe_nome), par('Responsável', o.responsavel_nome || 'Na fila da equipe'),
        par('Próxima ação', o.proxima_acao ? `${o.proxima_acao} · ${dataHora(o.proxima_acao_em)} (${relativo(o.proxima_acao_em)})` : '—'),
        par('Primeira resposta até', dataHora(o.sla_resposta_em)), par('Prazo de resolução', `${dataHora(o.prazo_em)}${o.sla === 'pausado' ? ' (pausado: anda o tempo da espera quando retomar)' : ''}`),
        o.espera_cliente_seg || o.espera_terceiro_seg || o.espera_inicio_em ? par('Tempo em espera', [
          o.espera_cliente_seg ? `cliente ${duracao(o.espera_cliente_seg)}` : null, o.espera_terceiro_seg ? `terceiro ${duracao(o.espera_terceiro_seg)}` : null,
          o.espera_inicio_em ? `esperando desde ${dataHora(o.espera_inicio_em)}` : null].filter(Boolean).join(' · ')) : null,
        o.evidencia ? par('Evidência', o.evidencia) : null, o.motivo_encerramento ? par('Motivo do encerramento', o.motivo_encerramento) : null,
        o.codigo_desfecho ? par('Desfecho', ctx.catalogos.desfechosResolvida[o.codigo_desfecho] || ctx.catalogos.desfechosSemResolucao[o.codigo_desfecho]) : null,
        par('Aberta em', dataHora(o.criado_em)))),
      h('section', { class: 'cartao' }, h('h2', {}, 'Veículos e pendências'), o.itens.length ? h('ul', { class: 'itens' }, o.itens.map((i) => h('li', {},
        h('strong', {}, i.placa || '—'), ` ${i.descricao} `, i.pendencia_estado ? selo(i.pendencia_estado, i.pendencia_estado === 'corrigida' ? 'ok' : 'alerta') : null))) : vazio('Sem veículos vinculados.'),
      o.handoffs.length ? [h('h3', {}, 'Transferências'), h('ul', { class: 'itens' }, o.handoffs.map((x) => h('li', {}, `${x.de_nome} → ${x.para_nome}: `, selo(x.estado, x.estado === 'aceito' ? 'ok' : x.estado === 'expirado' ? 'perigo' : 'alerta'), ` prazo ${dataHora(x.prazo_aceite_em)} · ${x.motivo}`)))] : null,
      o.vinculos.length ? [h('h3', {}, 'Ocorrências ligadas'), h('ul', { class: 'itens' }, o.vinculos.map((v) => h('li', {},
        `${VINCULO[v.tipo] || v.tipo} `, h('a', { href: `#/ocorrencias/${v.id}` }, v.protocolo), ' ', seloEstado(ctx, v.estado))))] : null,
      o.tarefas.length ? [h('h3', {}, 'Tarefas'), h('ul', { class: 'itens' }, o.tarefas.map((t) => h('li', {}, `${t.titulo} · ${t.equipe_nome} · `, selo(t.estado, t.estado === 'aberta' ? 'alerta' : 'neutro'), t.resultado ? ` — ${t.resultado}` : '')))] : null)),
    h('section', { class: 'cartao' }, h('h2', {}, 'Conversa'), conversa,
      ativa && ctx.pode('ocorrencia.ver') ? h('div', { class: 'responder' }, texto, h('div', { class: 'form-acoes' },
        h('button', { class: 'btn', onclick: enviarMsg('notas') }, 'Nota interna'),
        ctx.pode('ocorrencia.atender') && o.conta_id ? h('button', { class: 'btn btn-primario', onclick: enviarMsg('respostas') }, 'Responder ao cliente') : null)) : null),
    ctx.pode('processo.ver') ? await secaoAutomacoes(ctx, { ocorrencia: id }) : null,
    h('section', { class: 'cartao' }, h('h2', {}, 'Linha do tempo (auditoria)'), h('ol', { class: 'tempo' }, o.linhaDoTempo.map((a) => h('li', {},
      h('span', { class: 'tempo-data' }, dataHora(a.criado_em)), h('strong', {}, a.acao.replace('ocorrencia.', '').replaceAll('_', ' ')),
      ` por ${a.ator_nome}`, a.motivo ? h('div', { class: 'suave' }, a.motivo) : null)))));
}

const par = (rotulo, valor) => [h('dt', {}, rotulo), h('dd', {}, valor)];
const duracao = (seg) => { const h2 = Math.floor(seg / 3600); const m = Math.round((seg % 3600) / 60); return h2 >= 24 ? `${Math.floor(h2 / 24)} d ${h2 % 24} h` : h2 ? `${h2} h ${m} min` : `${m} min`; };
/** WFL-007: ciência do escalonamento com a ação decidida e o novo prazo. */
function ciencia(o, recarregar) {
  const em4h = () => { const d = new Date(Date.now() + 4 * 3600e3); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  modal(`Ciência do escalonamento · nível ${o.nivel_escalonamento}`, (fechar) => formulario([
    h('p', {}, `Próxima ação vencida: ${o.proxima_acao}.`),
    campo('O que será feito', h('input', { name: 'acao', required: true, minlength: 5, maxlength: 200, placeholder: 'ex.: Rafael liga para o cliente hoje às 15h' }), 'Vira a próxima ação da ocorrência.'),
    campo('Até quando', h('input', { name: 'proximaAcaoEm', type: 'datetime-local', required: true, value: em4h() }), 'Se vencer de novo, o nível sobe.'),
  ], 'Registrar ciência', async (d) => { const r = await api.post(`/ocorrencias/${o.id}/ciencia`, { ...d, versao: o.version }); fechar(); aviso(`Ciência registrada; ${r.tarefasConcluidas} tarefa(s) de escalonamento concluída(s).`); recarregar(); }));
}
const VINCULO = { relacionada: 'Relacionada a', mesclada_em: 'Mesclada em', dividida_de: 'Dividida de', reaberta_por: 'Reaberta por' };

/** INT-006: relacionar, mesclar (esta é a duplicada) ou dividir (itens escolhidos vão para uma nova). Nada é apagado. */
function organizar(ctx, o, recarregar) {
  const ativa = !['resolvida', 'encerrada_sem_resolucao'].includes(o.estado);
  const protocolo = (nome, rotulo) => campo(rotulo, h('input', { name: nome, required: true, maxlength: 40, placeholder: 'SIN-000123', autocapitalize: 'characters' }));
  const motivo = () => campo('Motivo', h('textarea', { name: 'motivo', rows: 2, required: true, minlength: 5, maxlength: 500 }), 'Fica na linha do tempo das duas.');
  modal('Organizar ocorrências', (fechar) => h('div', {},
    h('details', {}, h('summary', {}, 'Relacionar a outra'), h('p', { class: 'suave' }, 'Mesmo problema em outra conta, ou assuntos ligados. As duas continuam abertas.'),
      formulario([protocolo('outra', 'Protocolo da outra ocorrência'), motivo()], 'Relacionar', async (d) => {
        await api.post(`/ocorrencias/${o.id}/relacionar`, d); fechar(); aviso('Ocorrências relacionadas.'); recarregar();
      })),
    ativa ? h('details', {}, h('summary', {}, 'Esta é duplicada: mesclar na principal'),
      h('p', { class: 'suave' }, `${o.protocolo} será encerrada como duplicada; as placas e a conversa passam para a principal (mesma conta).`),
      formulario([protocolo('principal', 'Protocolo da principal'), motivo()], 'Mesclar', async (d) => {
        const r = await api.post(`/ocorrencias/${o.id}/mesclar`, d); fechar(); aviso(`Mesclada em ${r.principal}.`); recarregar();
      })) : null,
    ativa && o.conta_id ? h('details', {}, h('summary', {}, 'Dividir em uma nova'),
      formulario([
        campo('Título da nova', h('input', { name: 'titulo', required: true, minlength: 5, maxlength: 200 })),
        campo('Prioridade', opcoes(h('select', { name: 'prioridade' }), ctx.catalogos.prioridades, 'Mesma desta')),
        o.itens.length ? h('fieldset', {}, h('legend', {}, 'Placas que vão para a nova'), o.itens.map((i) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', name: `item_${i.id}` }), `${i.placa || '—'} · ${i.descricao}`))) : null,
        motivo(),
      ], 'Dividir', async (d) => {
        const itemIds = Object.entries(d).filter(([k, v]) => k.startsWith('item_') && v === true).map(([k]) => k.slice(5));
        const r = await api.post(`/ocorrencias/${o.id}/dividir`, { titulo: d.titulo, prioridade: d.prioridade, motivo: d.motivo, itemIds });
        fechar(); aviso(`${r.protocolo} criada com ${r.itensMovidos} placa(s).`); location.hash = `#/ocorrencias/${r.id}`;
      })) : null));
}

function reatribuir(ctx, o, recarregar) {
  const pessoas = Object.fromEntries(ctx.equipes.usuarios.map((u) => [u.id, `${u.nome} (${u.equipe_nome})${u.disponivel ? '' : ' · indisponível'}`]));
  modal('Reatribuir (intervenção excepcional)', (fechar) => formulario([
    campo('Equipe', opcoes(h('select', { name: 'equipeCodigo' }), Object.fromEntries(ctx.equipes.equipes.map((e) => [e.codigo, e.nome])), 'Manter')),
    campo('Responsável', opcoes(h('select', { name: 'responsavelId' }), pessoas, 'Manter / fila')),
    campo('Justificativa', h('textarea', { name: 'motivo', rows: 2, required: true, minlength: 5 }), 'Fica registrada na auditoria.'),
  ], 'Reatribuir', async (d) => { await api.post(`/ocorrencias/${o.id}/reatribuir`, { ...d, versao: o.version }); fechar(); aviso('Ocorrência reatribuída.'); recarregar(); }));
}
