// Desenvolvimento: incidentes (linha do tempo, aviso aos clientes, post-mortem), backlog de melhorias (aprovação,
// release, validação na operação) e releases. Substitui o Redmine no que é decisão e acompanhamento.
import { h, trocar, dataHora, data, selo, campo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

const COR_SEV = { sev1: 'perigo', sev2: 'alerta', sev3: 'info' };
const COR_INC = { aberto: 'perigo', mitigado: 'alerta', resolvido: 'ok', encerrado: 'neutro' };
const COR_MEL = { proposta: 'neutro', aprovada: 'info', recusada: 'neutro', em_desenvolvimento: 'info', liberada: 'alerta', validada: 'ok' };
const PRIO = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };
const TIPO = { melhoria: 'Melhoria', correcao: 'Correção', preventiva: 'Ação preventiva' };
const ORIGEM = { cliente: 'pedido de cliente', ocorrencia: 'ocorrência', reincidencia: 'reincidência', incidente: 'incidente', interna: 'interna' };

export async function telaDesenvolvimento(el, ctx, id) {
  if (id) return detalheIncidente(el, ctx, id);
  const aba = ctx.query?.get('aba') || 'incidentes';
  const d = await api.get('/desenvolvimento');
  const recarregar = () => telaDesenvolvimento(el, ctx);
  const ir = (a) => { location.hash = `#/desenvolvimento?aba=${a}`; };
  const abas = h('div', { class: 'abas', role: 'tablist' }, [['incidentes', 'Incidentes'], ['melhorias', 'Melhorias'], ['releases', 'Releases']].map(([k, r]) =>
    h('button', { class: `aba${k === aba ? ' ativa' : ''}`, type: 'button', role: 'tab', 'aria-selected': k === aba ? 'true' : 'false', onclick: () => ir(k) }, r)));
  const conteudo = { incidentes: () => abaIncidentes(ctx, d, recarregar), melhorias: () => abaMelhorias(ctx, d, recarregar), releases: () => abaReleases(ctx, d, recarregar) }[aba]();
  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Desenvolvimento')), abas, conteudo);
}

function abaIncidentes(ctx, d, recarregar) {
  const novo = async () => {
    const contas = await api.get('/contas?pagina=1');
    const sel = h('select', { multiple: true, size: 6, 'aria-label': 'Clientes afetados' }, contas.itens.map((c) => h('option', { value: c.id }, c.nome)));
    const comunicar = h('input', { type: 'checkbox' });
    modal('Abrir incidente', (fechar) => formulario([
      campo('Título', h('input', { name: 'titulo', required: true, minlength: 5, maxlength: 200 })),
      campo('Severidade', opcoes(h('select', { name: 'severidade', required: true }), d.severidades)),
      campo('Produto (opcional)', h('input', { name: 'produto', maxlength: 80 })),
      campo('Impacto', h('textarea', { name: 'impacto', rows: 2, required: true, minlength: 5, maxlength: 2000 }), 'Sem senha, token ou chave: o sistema remove o que parecer segredo.'),
      campo('Clientes afetados', sel), campo('Primeira atualização', h('textarea', { name: 'primeiraAtualizacao', rows: 2, maxlength: 2000 })),
      h('label', { class: 'check' }, comunicar, ' Avisar agora os clientes afetados (ponto focal, canal permitido)'),
    ], 'Abrir incidente', async (x) => {
      const r = await api.post('/incidentes', { ...x, comunicar: comunicar.checked, contaIds: [...sel.selectedOptions].map((o) => o.value) });
      fechar(); aviso(`${r.codigo} aberto.`); location.hash = `#/desenvolvimento/${r.id}`;
    }));
  };
  return h('div', {},
    ctx.pode('dev.gerir') ? h('div', { class: 'acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: novo }, 'Abrir incidente')) : null,
    d.incidentes.itens.length ? h('div', { class: 'lista' }, d.incidentes.itens.map((i) => h('a', { class: `linha linha-${['aberto', 'mitigado'].includes(i.estado) ? 'vencido' : 'final'}`, href: `#/desenvolvimento/${i.id}` },
      h('div', { class: 'linha-topo' }, h('strong', {}, i.codigo), selo(i.severidade.toUpperCase(), COR_SEV[i.severidade]), selo(d.estadosIncidente[i.estado], COR_INC[i.estado])),
      h('div', { class: 'linha-titulo' }, i.titulo),
      h('div', { class: 'linha-meta' }, h('span', {}, `início ${dataHora(i.inicio_em)}`), i.produto ? h('span', {}, i.produto) : null,
        h('span', {}, `${i.contas} cliente(s) afetado(s)`), i.responsavel ? h('span', {}, i.responsavel) : null)))) : vazio('Nenhum incidente registrado.'));
}

async function detalheIncidente(el, ctx, id) {
  const i = await api.get(`/incidentes/${id}`);
  const recarregar = () => detalheIncidente(el, ctx, id);
  const pode = ctx.pode('dev.gerir') && i.estado !== 'encerrado';
  const atualizar = () => modal('Atualizar o incidente', (fechar) => {
    const comunicar = h('input', { type: 'checkbox' });
    const estado = opcoes(h('select', { name: 'estado' }), Object.fromEntries(i.proximos.map((e) => [e, e === 'mitigado' ? 'Mitigado (contorno no ar)' : 'Resolvido'])), 'Sem mudar a situação');
    return formulario([campo('O que mudou', h('textarea', { name: 'texto', rows: 3, required: true, minlength: 3, maxlength: 2000 })), campo('Situação', estado),
      h('label', { class: 'check' }, comunicar, ` Avisar os ${i.contas.length} cliente(s) afetado(s)`)],
    'Registrar', async (x) => { await api.post(`/incidentes/${id}/atualizacoes`, { ...x, comunicar: comunicar.checked, versao: i.version }); fechar(); aviso('Atualização registrada.'); recarregar(); });
  });
  const postMortem = () => modal('Post-mortem', (fechar) => formulario([
    campo('Causa raiz', h('textarea', { name: 'causaRaiz', rows: 3, required: true, minlength: 10 })),
    campo('Lições aprendidas', h('textarea', { name: 'licoes', rows: 3, required: true, minlength: 10 })),
    campo('Ações preventivas (uma por linha)', h('textarea', { name: 'acoes', rows: 3 }), 'Cada linha vira uma melhoria proposta, ligada a este incidente.'),
  ], 'Encerrar com post-mortem', async (x) => {
    const r = await api.post(`/incidentes/${id}/encerrar`, { causaRaiz: x.causaRaiz, licoes: x.licoes, acoes: String(x.acoes || '').split('\n').map((l) => l.trim()).filter(Boolean) });
    fechar(); aviso(`Incidente encerrado. ${r.acoes.length} ação(ões) preventiva(s) no backlog.`); recarregar();
  }));
  trocar(el,
    h('a', { class: 'voltar', href: '#/desenvolvimento' }, '← Desenvolvimento'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, `${i.codigo} · ${i.titulo}`)),
    h('div', { class: 'selos' }, selo(i.severidade.toUpperCase(), COR_SEV[i.severidade]), selo(i.estado, COR_INC[i.estado]), i.produto ? selo(i.produto, 'neutro') : null,
      i.duracaoMin !== null ? selo(`resolvido em ${i.duracaoMin >= 60 ? `${Math.floor(i.duracaoMin / 60)} h ${i.duracaoMin % 60} min` : `${i.duracaoMin} min`}`, 'info') : null),
    pode ? h('div', { class: 'acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: atualizar }, 'Atualizar'),
      i.estado === 'resolvido' ? h('button', { class: 'btn', type: 'button', onclick: postMortem }, 'Post-mortem e encerrar') : null) : null,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Impacto'), h('p', {}, i.impacto),
        h('h3', {}, `Clientes afetados (${i.contas.length})`), i.contas.length ? h('ul', { class: 'itens' }, i.contas.map((c) => h('li', {}, h('a', { href: `#/contas/${c.id}` }, c.nome), c.vip ? ' ' : '', c.vip ? selo('VIP', 'vip') : null))) : vazio('Nenhum informado.'),
        i.causa_raiz ? [h('h3', {}, 'Causa raiz'), h('p', {}, i.causa_raiz), h('h3', {}, 'Lições'), h('p', {}, i.licoes)] : null,
        i.melhorias.length ? [h('h3', {}, 'Ações preventivas'), h('ul', { class: 'itens' }, i.melhorias.map((m) => h('li', {}, `${m.codigo} · ${m.titulo} `, selo(m.estado, COR_MEL[m.estado]))))] : null),
      h('section', { class: 'cartao' }, h('h2', {}, 'Linha do tempo'), h('ol', { class: 'tempo' }, i.linha.map((l) => h('li', {},
        h('span', { class: 'tempo-data' }, dataHora(l.criado_em)), l.estado ? h('strong', {}, `${l.estado} · `) : null, l.texto,
        h('div', { class: 'suave' }, `${l.autor || 'sistema'}${l.comunicado_clientes ? ` · aviso a ${l.avisos} cliente(s)` : ''}`)))))));
}

function abaMelhorias(ctx, d, recarregar) {
  const nova = () => modal('Propor melhoria', (fechar) => formulario([
    campo('Título', h('input', { name: 'titulo', required: true, minlength: 5, maxlength: 200 })),
    campo('Descrição (o problema e o resultado esperado)', h('textarea', { name: 'descricao', rows: 3, required: true, minlength: 10, maxlength: 4000 })),
    campo('Tipo', opcoes(h('select', { name: 'tipo' }), { melhoria: 'Melhoria', correcao: 'Correção', preventiva: 'Ação preventiva (problema recorrente)' })),
    campo('Origem', opcoes(h('select', { name: 'origem' }), { cliente: 'Pedido de cliente', ocorrencia: 'Ocorrência', reincidencia: 'Reincidência', interna: 'Interna' })),
    campo('Prioridade sugerida', (() => { const x = opcoes(h('select', { name: 'prioridade' }), PRIO); x.value = 'media'; return x; })()),
  ], 'Propor', async (x) => { const m = await api.post('/melhorias', x); fechar(); aviso(`${m.codigo} proposta. A gestão aprova.`); recarregar(); }));
  const agir = (m, acao, rotulo, campoNome, ajuda) => () => {
    if (!campoNome) { api.post(`/melhorias/${m.id}/${acao}`, {}).then(() => { aviso(`${rotulo}: feito.`); recarregar(); }, (e) => aviso(textoErro(e), 'erro')); return; }
    modal(`${rotulo}: ${m.codigo}`, (fechar) => formulario([campo(ajuda, h('textarea', { name: campoNome, rows: 3, required: true, minlength: campoNome === 'evidencia' ? 10 : 5 }))],
      rotulo, async (x) => { await api.post(`/melhorias/${m.id}/${acao}`, x); fechar(); aviso(`${rotulo}: feito.`); recarregar(); }));
  };
  const botoes = (m) => {
    const b = [];
    if (m.estado === 'proposta' && ctx.pode('ocorrencia.intervir')) b.push(h('button', { class: 'btn btn-pequeno btn-primario', type: 'button', onclick: agir(m, 'aprovar', 'Aprovar') }, 'Aprovar'),
      h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: agir(m, 'recusar', 'Recusar', 'motivo', 'Motivo da recusa') }, 'Recusar'));
    if (m.estado === 'aprovada' && ctx.pode('dev.gerir')) b.push(h('button', { class: 'btn btn-pequeno', type: 'button', onclick: agir(m, 'iniciar', 'Iniciar desenvolvimento') }, 'Iniciar'));
    if (m.estado === 'liberada' && ctx.pode('conta.editar') && ctx.usuario.papel !== 'dev') b.push(h('button', { class: 'btn btn-pequeno btn-primario', type: 'button', onclick: agir(m, 'validar', 'Validar na operação', 'evidencia', 'O que foi conferido com o cliente e onde') }, 'Validar'));
    return b.length ? h('span', { class: 'acoes' }, b) : null;
  };
  return h('div', {},
    ctx.pode('ocorrencia.atender') ? h('div', { class: 'acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: nova }, 'Propor melhoria')) : null,
    d.melhorias.itens.length ? h('ul', { class: 'itens' }, d.melhorias.itens.map((m) => h('li', { class: 'linha-acao' },
      h('span', {}, h('strong', {}, `${m.codigo} · ${m.titulo}`), ' ', selo(d.estadosMelhoria[m.estado], COR_MEL[m.estado]), ' ', selo(PRIO[m.prioridade], m.prioridade === 'critica' ? 'perigo' : m.prioridade === 'alta' ? 'alerta' : 'neutro'),
        h('div', { class: 'suave' }, `${TIPO[m.tipo] || m.tipo} · origem: ${ORIGEM[m.origem] || m.origem}${m.ocorrencias ? ` · ${m.ocorrencias} ocorrência(s)` : ''}${m.release ? ` · release ${m.release}` : ''}${m.proposta_por_nome ? ` · proposta por ${m.proposta_por_nome}` : ''}`),
        m.link_externo ? h('a', { href: m.link_externo, target: '_blank', rel: 'noopener noreferrer' }, 'ver no repositório') : null),
      botoes(m)))) : vazio('Backlog vazio.'));
}

function abaReleases(ctx, d, recarregar) {
  const nova = () => modal('Nova release', (fechar) => formulario([
    campo('Versão', h('input', { name: 'versao', required: true, placeholder: 'ex.: 2026.11.1', pattern: '[0-9A-Za-z][0-9A-Za-z._-]{0,39}' })),
    campo('Previsão', h('input', { name: 'previstoPara', type: 'date' })), campo('Notas', h('textarea', { name: 'notas', rows: 3, maxlength: 4000 })),
  ], 'Criar', async (x) => { await api.post('/releases', x); fechar(); aviso('Release criada.'); recarregar(); }));
  const incluir = (r) => {
    const candidatas = d.melhorias.itens.filter((m) => ['aprovada', 'em_desenvolvimento'].includes(m.estado) && !m.release);
    modal(`Incluir na ${r.versao}`, (fechar) => (candidatas.length ? formulario([campo('Melhoria', opcoes(h('select', { name: 'melhoriaId', required: true }), Object.fromEntries(candidatas.map((m) => [m.id, `${m.codigo} · ${m.titulo}`]))))],
      'Incluir', async (x) => { await api.post(`/releases/${r.id}/melhorias`, x); fechar(); aviso('Incluída.'); recarregar(); }) : vazio('Nenhuma melhoria aprovada fora de release.')));
  };
  const pode = ctx.pode('dev.gerir');
  return h('div', {},
    pode ? h('div', { class: 'acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: nova }, 'Nova release')) : null,
    d.releases.length ? h('ul', { class: 'itens' }, d.releases.map((r) => h('li', { class: 'linha-acao' },
      h('span', {}, h('strong', {}, r.versao), ' ', selo(r.estado, r.estado === 'publicada' ? 'ok' : 'info'),
        h('div', { class: 'suave' }, `${r.melhorias} melhoria(s) · ${r.validadas} validada(s) na operação${r.previsto_para ? ` · previsão ${data(r.previsto_para)}` : ''}${r.publicada_em ? ` · publicada ${dataHora(r.publicada_em)}` : ''}`)),
      pode && r.estado === 'planejada' ? h('span', { class: 'acoes' }, h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => incluir(r) }, 'Incluir melhoria'),
        h('button', { class: 'btn btn-pequeno btn-primario', type: 'button', onclick: async () => {
          if (!confirm(`Publicar a ${r.versao}? As melhorias dela vão para validação da operação.`)) return;
          try { const x = await api.post(`/releases/${r.id}/publicar`); aviso(`${x.melhorias} melhoria(s) liberada(s); a operação valida.`); recarregar(); } catch (e) { aviso(textoErro(e), 'erro'); }
        } }, 'Publicar')) : null))) : vazio('Nenhuma release.'));
}
