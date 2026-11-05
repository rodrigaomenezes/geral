// Processos automáticos: lista, detalhe (versões e execuções) e editor em formulário (gatilho → condições → passos).
import { h, trocar, dataHora, relativo, selo, campo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

let CAT = null;
const catalogo = async () => (CAT ||= await api.get('/processos/catalogo'));

const DESTINOS = { ponto_focal: 'Ponto focal', grupo: 'Grupo do cliente (WhatsApp)', grupo_e_ponto_focal: 'Grupo e ponto focal' };
const TIPOS_TAREFA = { geral: 'Tarefa', ligacao: 'Ligação', validar_correcao: 'Validar correção', revisar_espera: 'Revisar espera' };
const ORIGENS = { whatsapp: 'WhatsApp', email: 'E-mail', portal: 'Portal', api: 'API', platform: 'Platform', interna: 'Interna' };
const STATUS_CONTA = { onboarding: 'Onboarding', ativa: 'Ativa', suspensa: 'Suspensa', encerrada: 'Encerrada' };
const DIAS = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 7: 'Domingo' };
const COR_EXE = { em_andamento: 'ativo', aguardando: 'info', concluida: 'ok', encerrada: 'neutro', cancelada: 'neutro', falhou: 'perigo' };
const NOME_EXE = { em_andamento: 'em andamento', aguardando: 'aguardando', concluida: 'concluída', encerrada: 'parou sozinho', cancelada: 'cancelada', falhou: 'falhou' };
const COR_LOG = { executado: 'ok', pulado: 'neutro', aguardando: 'info', encerrado: 'neutro', falhou: 'perigo' };

function rotulosValores(ctx) {
  return { ...ctx.catalogos.tipos, ...ctx.catalogos.prioridades, ...ctx.catalogos.estados, ...CAT.modelos, ...DESTINOS, ...TIPOS_TAREFA, ...ORIGENS,
    ...STATUS_CONTA, texto_livre: 'Texto livre', da_conta: 'Da conta (VIP → CS, demais → Suporte)',
    ...Object.fromEntries(ctx.equipes.equipes.map((e) => [e.codigo, e.nome])) };
}

// ---------- Lista ----------
export async function telaProcessos(el, ctx, id) {
  await catalogo();
  if (id === 'novo') return editor(el, ctx, null);
  if (id) return detalhe(el, ctx, id);
  const { itens } = await api.get('/processos');
  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, 'Processos automáticos'),
      ctx.pode('processo.editar') ? h('a', { class: 'btn btn-primario', href: '#/processos/novo' }, 'Novo processo') : null),
    h('p', { class: 'suave' }, 'Escreva o processo uma vez: o Sinapse acompanha sozinho, no prazo, e para quando o motivo deixa de existir. Cada mudança vira uma versão nova; o que já está rodando continua na versão em que começou.'),
    h('div', { class: 'lista' }, itens.length ? itens.map((p) => h('a', { class: `linha ${p.ativo ? 'linha-no_prazo' : ''}`, href: `#/processos/${p.id}` },
      h('div', { class: 'linha-topo' }, h('strong', {}, p.nome), p.ativo ? selo(`ligado · v${p.versaoAtiva}`, 'ok') : selo('desligado', 'neutro'),
        p.temRascunho ? selo('rascunho pendente', 'alerta') : null, p.sistema ? selo('padrão', 'info') : null,
        p.emAndamento ? selo(`${p.emAndamento} em andamento`, 'ativo') : null, p.falhas ? selo(`${p.falhas} falha(s)`, 'perigo') : null),
      h('div', { class: 'linha-meta' }, h('span', {}, p.resumo)),
      h('div', { class: 'linha-meta' }, h('span', {}, `${p.ultimos30Dias} execução(ões) nos últimos 30 dias`))))
      : vazio('Nenhum processo ainda.')));
}

// ---------- Execuções (usado também nas telas de rodada e ocorrência) ----------
export function blocoExecucoes(ctx, execucoes, aoMudar) {
  if (!execucoes.length) return vazio('Nenhum processo automático rodou aqui ainda.');
  return h('div', { class: 'execucoes' }, execucoes.map((e) => h('details', { class: 'execucao', open: ['em_andamento', 'aguardando'].includes(e.estado) },
    h('summary', {}, h('strong', {}, e.processo_nome), ` v${e.versao} `, selo(NOME_EXE[e.estado] || e.estado, COR_EXE[e.estado]),
      e.espera_ate && e.estado === 'aguardando' ? h('span', { class: 'suave' }, ` próximo passo ${relativo(e.espera_ate)} (${dataHora(e.espera_ate)})`) : null,
      e.conta_nome ? h('span', { class: 'suave' }, ` · ${e.conta_nome}`) : null),
    h('ol', { class: 'tempo' },
      e.registro.map((l) => h('li', {}, h('span', { class: 'tempo-data' }, dataHora(l.criado_em)), selo(l.resultado, COR_LOG[l.resultado]), ' ', l.detalhe)),
      e.proximos.map((p) => h('li', { class: 'tempo-futuro' }, h('span', { class: 'tempo-data' }, 'a seguir'), p))),
    e.motivo ? h('p', { class: 'suave' }, e.motivo) : null,
    ['em_andamento', 'aguardando'].includes(e.estado) && ctx.pode('processo.editar') ? h('button', { class: 'btn btn-pequeno', onclick: () => modal('Cancelar execução', (fechar) => formulario([
      campo('Motivo (fica na auditoria)', h('textarea', { name: 'motivo', required: true, minlength: 5, rows: 2 })),
    ], 'Cancelar execução', async (d) => { await api.post(`/execucoes/${e.id}/cancelar`, d); fechar(); aviso('Execução cancelada.'); aoMudar?.(); })) }, 'Cancelar') : null)));
}

export async function secaoAutomacoes(ctx, filtro) {
  const corpo = h('div', {}, h('p', { class: 'carregando' }, 'Carregando…'));
  const carregar = async () => {
    try { trocar(corpo, blocoExecucoes(ctx, (await api.get(`/execucoes?${new URLSearchParams(filtro)}`)).itens, carregar)); } catch (e) { trocar(corpo, vazio(textoErro(e))); }
  };
  carregar();
  return h('section', { class: 'cartao' }, h('h2', {}, 'Processos automáticos'), corpo);
}

// ---------- Detalhe ----------
async function detalhe(el, ctx, id) {
  const p = await api.get(`/processos/${id}`);
  const recarregar = () => detalhe(el, ctx, id);
  const ativa = p.versoes.find((v) => v.estado === 'ativa');
  const rasc = p.versoes.find((v) => v.estado === 'rascunho');
  const porConta = CAT.gatilhos[(ativa || rasc)?.definicao.gatilho]?.entidade === 'conta';
  const acao = (rotulo, fn, cls = '') => h('button', { class: `btn ${cls}`, onclick: async (e) => {
    e.currentTarget.disabled = true;
    try { await fn(); } catch (err) { aviso(textoErro(err), 'erro'); e.currentTarget.disabled = false; }
  } }, rotulo);
  const pode = ctx.pode('processo.editar');
  trocar(el,
    h('a', { class: 'voltar', href: '#/processos' }, '← Processos'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, p.nome)),
    h('div', { class: 'selos' }, ativa ? selo(`ligado · versão ${ativa.versao}`, 'ok') : selo('desligado', 'neutro'), rasc ? selo(`rascunho v${rasc.versao}`, 'alerta') : null,
      p.sistema ? selo('padrão', 'info') : null),
    p.descricao ? h('p', { class: 'suave' }, p.descricao) : null,
    pode ? h('div', { class: 'acoes' },
      h('a', { class: 'btn btn-primario', href: `#/processos/${id}/editar` }, rasc ? 'Continuar edição' : 'Editar (cria nova versão)'),
      rasc ? acao(`Ativar versão ${rasc.versao}`, async () => { await api.post(`/processos/${id}/ativar`, {}); aviso('Processo ativado.'); recarregar(); }, 'btn-primario') : null,
      ativa && porConta ? acao('Executar agora', async () => { const r = await api.post(`/processos/${id}/executar`); aviso(`${r.iniciadas} de ${r.contas} conta(s) entraram no processo.`); recarregar(); }) : null,
      ativa ? h('button', { class: 'btn btn-fantasma', onclick: () => modal('Desligar processo', (fechar) => formulario([
        campo('Motivo', h('textarea', { name: 'motivo', required: true, minlength: 5, rows: 2 })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'cancelarExecucoes' }), 'Cancelar também as execuções em andamento'),
      ], 'Desligar', async (d) => { await api.post(`/processos/${id}/desativar`, d); fechar(); aviso('Processo desligado.'); recarregar(); })) }, 'Desligar') : null) : null,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Como funciona'), h('ul', { class: 'passos-lidos' },
        (ativa || rasc).resumo.split(/(?<=\.) (?=\d+\.|Para sozinho|Se:)/).map((frase) => h('li', {}, frase)))),
      h('section', { class: 'cartao' }, h('h2', {}, 'Versões'), h('ul', { class: 'itens' }, p.versoes.map((v) => h('li', {},
        h('strong', {}, `v${v.versao}`), ' ', selo(v.estado, v.estado === 'ativa' ? 'ok' : v.estado === 'rascunho' ? 'alerta' : 'neutro'),
        ` ${v.ativada_em ? `ativada ${dataHora(v.ativada_em)}${v.ativada_por_nome ? ` por ${v.ativada_por_nome}` : ''}` : `criada ${dataHora(v.criado_em)}`}`,
        v.nota ? h('div', { class: 'suave' }, v.nota) : null,
        pode && ['substituida', 'desativada'].includes(v.estado) ? h('button', { class: 'btn btn-pequeno', onclick: () => modal(`Restaurar versão ${v.versao}`, (fechar) => formulario([
          h('p', { class: 'suave' }, v.resumo), campo('Motivo', h('textarea', { name: 'motivo', required: true, minlength: 5, rows: 2 })),
        ], 'Restaurar e ativar', async (d) => { await api.post(`/processos/${id}/restaurar`, { versao: v.versao, motivo: d.motivo }); fechar(); aviso('Versão restaurada como nova versão ativa.'); recarregar(); })) }, 'Restaurar') : null))))),
    h('section', { class: 'cartao' }, h('h2', {}, 'Execuções recentes'), blocoExecucoes(ctx, p.execucoes, recarregar)));
}

// ---------- Editor ----------
const NOVO = { gatilho: 'ocorrencia.criada', condicoes: [], encerrarSe: [], passos: [{ tipo: 'criar_tarefa', equipe: 'da_conta', prazoHoras: 4, titulo: '' }] };
const clone = (x) => JSON.parse(JSON.stringify(x));

export async function editorRota(el, ctx, id) { await catalogo(); return editor(el, ctx, id); }

async function editor(el, ctx, id) {
  const atual = id ? await api.get(`/processos/${id}`) : null;
  const base = atual ? (atual.versoes.find((v) => v.estado === 'rascunho') || atual.versoes.find((v) => v.estado === 'ativa') || atual.versoes[0]).definicao : NOVO;
  const def = clone(base);
  const meta = { nome: atual?.nome || '', descricao: atual?.descricao || '', nota: '' };
  const R = rotulosValores(ctx);
  const corpo = h('div', {});
  const resultado = h('div', {});

  const selectDe = (valores, valor, aoMudar, vazioTxt) => {
    const s = opcoes(h('select', {}), Object.fromEntries(valores.map((v) => [v, R[v] || v])), vazioTxt);
    s.value = valor ?? '';
    s.onchange = () => aoMudar(s.value);
    return s;
  };

  function linhaCondicao(lista, i) {
    const c = lista[i];
    const campoDef = CAT.campos[c.campo] || {};
    const ops = Object.entries(CAT.operadores).filter(([, o]) => o.tipos.includes(campoDef.tipo)).map(([k]) => k);
    const rotOps = Object.fromEntries(Object.entries(CAT.operadores).map(([k, o]) => [k, o.rotulo]));
    const sCampo = opcoes(h('select', { 'aria-label': 'Campo' }), Object.fromEntries(Object.entries(CAT.campos).map(([k, f]) => [k, f.rotulo])));
    sCampo.value = c.campo;
    sCampo.onchange = () => { lista[i] = { campo: sCampo.value, operador: 'igual', valor: '' }; desenhar(); };
    const sOp = opcoes(h('select', { 'aria-label': 'Operador' }), Object.fromEntries(ops.map((o) => [o, rotOps[o]])));
    sOp.value = c.operador;
    sOp.onchange = () => { c.operador = sOp.value; desenhar(); };
    let valor;
    if (campoDef.tipo === 'booleano') {
      valor = opcoes(h('select', { 'aria-label': 'Valor' }), { true: 'sim', false: 'não' });
      valor.value = String(c.valor === true || c.valor === 'true');
      valor.onchange = () => { c.valor = valor.value === 'true'; };
      if (c.valor === '' || c.valor === undefined) c.valor = true;
    } else if (campoDef.valores && c.operador !== 'em') {
      valor = selectDe(campoDef.valores, c.valor, (v) => { c.valor = v; }, 'Escolha');
    } else {
      valor = h('input', { 'aria-label': 'Valor', value: Array.isArray(c.valor) ? c.valor.join(', ') : c.valor ?? '', placeholder: c.operador === 'em' ? 'valores separados por vírgula' : '' });
      valor.oninput = () => { c.valor = campoDef.tipo === 'numero' ? Number(valor.value) : valor.value; };
    }
    return h('div', { class: 'cond' }, sCampo, sOp, valor, h('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Remover condição', onclick: () => { lista.splice(i, 1); desenhar(); } }, '×'));
  }

  const blocoCondicoes = (titulo, ajuda, lista) => h('div', { class: 'bloco-cond' }, h('h3', {}, titulo), ajuda ? h('p', { class: 'suave' }, ajuda) : null,
    lista.map((_, i) => linhaCondicao(lista, i)),
    h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => { lista.push({ campo: 'conta.vip', operador: 'igual', valor: true }); desenhar(); } }, '+ Condição'));

  function cartaoPasso(i) {
    const p = def.passos[i];
    const pd = CAT.passos[p.tipo];
    const tipo = opcoes(h('select', { 'aria-label': 'Tipo de passo' }), Object.fromEntries(Object.entries(CAT.passos).map(([k, x]) => [k, x.rotulo])));
    tipo.value = p.tipo;
    tipo.onchange = () => { def.passos[i] = { tipo: tipo.value }; desenhar(); };
    const params = Object.entries(pd.params).map(([nome, pr]) => {
      let ent;
      if (pr.tipo === 'lista') ent = selectDe(pr.valores, p[nome], (v) => { p[nome] = v; desenhar(); }, pr.obrigatorio ? 'Escolha' : '—');
      else if (pr.tipo === 'equipe') ent = selectDe(['da_conta', ...ctx.equipes.equipes.map((e) => e.codigo)], p[nome], (v) => { p[nome] = v; }, 'Escolha');
      else if (pr.tipo === 'numero') { ent = h('input', { type: 'number', step: 'any', value: p[nome] ?? '', inputmode: 'decimal' }); ent.oninput = () => { p[nome] = ent.value === '' ? undefined : Number(ent.value); }; }
      else { ent = h('textarea', { rows: 2, value: p[nome] ?? '' }); ent.value = p[nome] ?? ''; ent.oninput = () => { p[nome] = ent.value; }; }
      if (p.tipo === 'enviar_mensagem' && nome === 'texto' && p.modelo !== 'texto_livre') return null;
      return campo(pr.rotulo, ent);
    });
    p.seCondicoes ||= [];
    const mover = (d) => { const j = i + d; if (j < 0 || j >= def.passos.length) return; [def.passos[i], def.passos[j]] = [def.passos[j], def.passos[i]]; desenhar(); };
    return h('div', { class: 'passo' },
      h('div', { class: 'passo-topo' }, h('span', { class: 'passo-num' }, String(i + 1)), tipo,
        h('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Subir passo', onclick: () => mover(-1) }, '↑'),
        h('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Descer passo', onclick: () => mover(1) }, '↓'),
        h('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Remover passo', onclick: () => { def.passos.splice(i, 1); desenhar(); } }, '×')),
      h('div', { class: 'passo-params' }, params),
      h('details', { open: p.seCondicoes.length > 0 }, h('summary', {}, `Só fazer este passo se… (${p.seCondicoes.length})`), blocoCondicoes('', null, p.seCondicoes)));
  }

  function desenhar() {
    const g = opcoes(h('select', { 'aria-label': 'Gatilho' }), Object.fromEntries(Object.entries(CAT.gatilhos).map(([k, x]) => [k, x.rotulo])));
    g.value = def.gatilho;
    g.onchange = () => { def.gatilho = g.value; if (CAT.gatilhos[g.value].agenda && !def.agenda) def.agenda = { diaSemana: 1, hora: 9 }; desenhar(); };
    const agenda = CAT.gatilhos[def.gatilho]?.agenda ? h('div', { class: 'filtros' },
      (() => { const s = opcoes(h('select', { 'aria-label': 'Dia da semana' }), DIAS); s.value = String(def.agenda.diaSemana); s.onchange = () => { def.agenda.diaSemana = Number(s.value); }; return s; })(),
      (() => { const s = opcoes(h('select', { 'aria-label': 'Hora' }), Object.fromEntries([...Array(24).keys()].map((x) => [x, `${x}h`]))); s.value = String(def.agenda.hora); s.onchange = () => { def.agenda.hora = Number(s.value); }; return s; })()) : null;
    const nome = h('input', { value: meta.nome, required: true, minlength: 3, maxlength: 120 }); nome.oninput = () => { meta.nome = nome.value; };
    const desc = h('textarea', { rows: 2, maxlength: 1000 }); desc.value = meta.descricao; desc.oninput = () => { meta.descricao = desc.value; };
    trocar(corpo,
      h('section', { class: 'cartao' }, campo('Nome do processo', nome), campo('Para que serve (opcional)', desc)),
      h('section', { class: 'cartao' }, h('h2', {}, '1. Quando começa'), g, agenda,
        blocoCondicoes('Só se…', 'Todas as condições precisam valer para o processo começar.', def.condicoes)),
      h('section', { class: 'cartao' }, h('h2', {}, '2. O que fazer, em ordem'),
        def.passos.map((_, i) => cartaoPasso(i)),
        h('button', { class: 'btn', type: 'button', onclick: () => { def.passos.push({ tipo: 'esperar', horas: 24 }); desenhar(); } }, '+ Passo')),
      h('section', { class: 'cartao' }, h('h2', {}, '3. Para sozinho se…'),
        blocoCondicoes('', 'Basta uma valer. É checado antes de cada passo e sempre que algo muda no cliente (ex.: pendências corrigidas).', def.encerrarSe)));
  }

  async function salvar() {
    if (!id) {
      const r = await api.post('/processos', { nome: meta.nome, descricao: meta.descricao, definicao: def });
      return r.id;
    }
    await api.post(`/processos/${id}/rascunho`, { nome: meta.nome, descricao: meta.descricao, definicao: def });
    return id;
  }
  const botao = (rotulo, fn, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await fn(); } catch (err) { aviso(textoErro(err), 'erro'); } finally { b.disabled = false; }
  } }, rotulo);

  desenhar();
  trocar(el,
    h('a', { class: 'voltar', href: id ? `#/processos/${id}` : '#/processos' }, '← Voltar'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, id ? `Editar: ${atual.nome}` : 'Novo processo')),
    id && atual.versoes.some((v) => v.estado === 'ativa') ? h('p', { class: 'suave' }, 'Você está editando um rascunho. A versão ligada continua valendo até você ativar esta.') : null,
    corpo,
    h('section', { class: 'cartao' }, h('h2', {}, 'Antes de ativar'), resultado,
      h('div', { class: 'acoes' },
        botao('Simular num item real', async () => {
          const s = await api.post('/processos/simular', { definicao: def });
          trocar(resultado, h('p', {}, h('strong', {}, 'Em português: '), s.descricao), h('p', { class: 'suave' }, `Simulado com: ${s.alvo}`),
            h('ol', { class: 'tempo' }, s.linhas.map((l) => h('li', {}, selo(l.resultado, l.resultado === 'faria' ? 'ok' : l.resultado === 'esperaria' ? 'info' : 'neutro'), ' ', l.texto))),
            h('p', { class: 'suave' }, 'Nada foi gravado. A simulação supõe que nada mude durante as esperas e que as ligações não sejam atendidas.'));
        }),
        botao('Salvar rascunho', async () => { const nid = await salvar(); aviso('Rascunho salvo.'); location.hash = `#/processos/${nid}`; }),
        botao('Salvar e ativar', async () => { const nid = await salvar(); await api.post(`/processos/${nid}/ativar`, {}); aviso('Processo ativado: já vale para os próximos eventos.'); location.hash = `#/processos/${nid}`; }, 'btn-primario'))));
}
