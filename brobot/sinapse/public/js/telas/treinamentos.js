// Treinamentos coletivos do CS: sessões por link numa conta de demonstração, roteiro por tela (versionado), convites
// ao ponto focal, presença, avaliação, dúvidas, próximo passo e a evolução do uso depois do treino.
import { h, trocar, dataHora, selo, campo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

const ESTADO = { agendada: ['agendada', 'info'], realizada: ['realizada', 'ok'], cancelada: ['cancelada', 'neutro'] };
const ENTREGA = { enfileirada: 'na fila de envio', enviada: 'enviado', entregue: 'entregue', lida: 'lido', falhou: 'falhou no envio', bloqueada: 'bloqueado (sem canal permitido)' };
const PRESENCA = { pendente: ['a marcar', 'neutro'], presente: ['presente', 'ok'], ausente: ['ausente', 'perigo'] };
const amanha17 = () => { const d = new Date(Date.now() + 864e5); d.setHours(14, 0, 0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export async function telaTreinamentos(el, ctx, id) {
  if (id) return detalhe(el, ctx, id);
  const r = await api.get('/treinamentos');
  const recarregar = () => telaTreinamentos(el, ctx);
  const pode = ctx.pode('treinamento.gerir');
  const nova = () => modal('Nova sessão de treinamento', (fechar) => formulario([
    campo('Título', h('input', { name: 'titulo', required: true, minlength: 3, maxlength: 120, placeholder: 'ex.: Primeiros passos · turma de novembro' })),
    campo('Roteiro', opcoes(h('select', { name: 'roteiro', required: true }), Object.fromEntries(r.roteiros.map((x) => [x.codigo, `${x.titulo} (v${x.versao})`])))),
    campo('Início', h('input', { name: 'inicio', type: 'datetime-local', required: true, value: amanha17() })),
    campo('Duração (minutos)', h('input', { name: 'duracaoMin', type: 'number', min: 15, max: 480, value: 60 })),
    campo('Link da chamada', h('input', { name: 'link', type: 'url', required: true, placeholder: 'https://…', pattern: 'https://.+' })),
    campo('Conta de demonstração da Platform', h('input', { name: 'contaDemo', required: true, value: 'Demo Brobot' }), 'Nunca a conta de um cliente: todos os participantes veem a tela.'),
    campo('Vagas (opcional)', h('input', { name: 'vagas', type: 'number', min: 1, max: 500 })),
  ], 'Criar sessão', async (d) => {
    const s = await api.post('/treinamentos', { ...d, duracaoMin: d.duracaoMin ? Number(d.duracaoMin) : undefined, vagas: d.vagas ? Number(d.vagas) : undefined });
    fechar(); aviso('Sessão criada. Agora inclua os clientes e envie os convites.'); location.hash = `#/treinamentos/${s.id}`;
  }));
  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Treinamentos'),
    pode ? h('span', { class: 'acoes' }, h('button', { class: 'btn btn-fantasma', type: 'button', onclick: () => editarRoteiro(r.roteiros, recarregar) }, 'Roteiros'),
      h('button', { class: 'btn btn-primario', type: 'button', onclick: nova }, 'Nova sessão')) : null),
  h('p', { class: 'suave' }, 'Treinamento coletivo por link, numa conta de demonstração, seguindo o roteiro tela a tela. Depois, a presença, a avaliação e o uso da Platform mostram se funcionou.'),
  r.itens.length ? h('div', { class: 'lista' }, r.itens.map((s) => h('a', { class: 'linha', href: `#/treinamentos/${s.id}` },
    h('div', { class: 'linha-topo' }, h('strong', {}, s.titulo), selo(...ESTADO[s.estado])),
    h('div', { class: 'linha-meta' }, h('span', {}, dataHora(s.inicio)), h('span', {}, `${s.roteiro} v${s.roteiro_versao}`),
      h('span', {}, `${s.participantes} cliente(s) · ${s.convidados} convidado(s)`), s.estado === 'realizada' ? h('span', {}, `${s.presentes} presente(s)`) : null,
      s.avaliacao_media ? h('span', {}, `nota ${s.avaliacao_media}`) : null, s.instrutor ? h('span', {}, s.instrutor) : null)))) : vazio('Nenhuma sessão ainda.'));
}

function editarRoteiro(roteiros, aoSalvar) {
  const base = roteiros[0] || { codigo: 'primeiros_passos', titulo: '', passos: [{ tela: '', objetivo: '' }] };
  const linhas = h('div', { class: 'roteiro-passos' });
  const linha = (p = { tela: '', objetivo: '' }) => {
    const el = h('div', { class: 'roteiro-passo' }, h('input', { 'aria-label': 'Tela', value: p.tela, placeholder: 'Tela', maxlength: 80 }),
      h('input', { 'aria-label': 'Objetivo', value: p.objetivo, placeholder: 'O que o cliente aprende nela', maxlength: 300 }),
      h('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Remover passo', onclick: () => el.remove() }, '×'));
    linhas.append(el);
  };
  base.passos.forEach(linha);
  modal(`Roteiro: ${base.titulo || 'novo'}`, (fechar) => formulario([
    h('p', { class: 'suave' }, 'Salvar cria uma nova versão. Sessões já marcadas continuam com a versão que usaram.'),
    campo('Código', h('input', { name: 'codigo', required: true, value: base.codigo, pattern: '[a-z0-9_]{2,40}' })),
    campo('Título', h('input', { name: 'titulo', required: true, value: base.titulo, minlength: 3, maxlength: 120 })),
    h('h3', {}, 'Passos (um por tela)'), linhas, h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => linha() }, '+ Passo'),
  ], 'Salvar nova versão', async (d) => {
    const passos = [...linhas.children].map((l) => ({ tela: l.children[0].value.trim(), objetivo: l.children[1].value.trim() })).filter((p) => p.tela || p.objetivo);
    const r = await api.post('/treinamentos/roteiros', { codigo: d.codigo, titulo: d.titulo, passos });
    fechar(); aviso(`Roteiro salvo (versão ${r.versao}).`); aoSalvar();
  }));
}

async function detalhe(el, ctx, id) {
  const s = await api.get(`/treinamentos/${id}`);
  const recarregar = () => detalhe(el, ctx, id);
  const pode = ctx.pode('treinamento.gerir');
  const agendada = s.estado === 'agendada';
  const comecou = new Date(s.inicio) <= new Date();
  const acao = (rotulo, fn, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick: async (e) => {
    e.currentTarget.disabled = true;
    try { await fn(); } catch (err) { aviso(textoErro(err), 'erro'); e.currentTarget.disabled = false; }
  } }, rotulo);

  const incluir = async () => {
    const contas = await api.get('/contas?pagina=1');
    const sel = h('select', { multiple: true, size: 8, 'aria-label': 'Clientes' }, contas.itens.map((c) => h('option', { value: c.id }, `${c.nome}${c.vip ? ' (VIP)' : ''}`)));
    modal('Incluir clientes', (fechar) => formulario([campo('Clientes', sel, 'Segure Ctrl (ou toque longo) para escolher vários. O convite vai ao ponto focal de cada um.')],
      'Incluir', async () => {
        const ids = [...sel.selectedOptions].map((o) => o.value);
        const r = await api.post(`/treinamentos/${id}/participantes`, { contaIds: ids }); fechar(); aviso(`${r.incluidos} cliente(s) incluído(s).`); recarregar();
      }));
  };
  const registrar = (p) => modal(`Participação: ${p.conta}`, (fechar) => {
    const presenca = opcoes(h('select', { name: 'presenca', required: true }), { presente: 'Esteve presente', ausente: 'Faltou' });
    presenca.value = p.presenca === 'pendente' ? 'presente' : p.presenca;
    return formulario([campo('Presença', presenca),
      campo('Avaliação (1 a 5, só presentes)', opcoes(h('select', { name: 'avaliacao' }), { 5: '5 · ótimo', 4: '4', 3: '3', 2: '2', 1: '1 · ruim' }, 'sem avaliação')),
      campo('Dúvidas levantadas', h('textarea', { name: 'duvidas', rows: 2, maxlength: 2000 }, p.duvidas || '')),
      campo('Próximo passo combinado', h('input', { name: 'proximoPasso', maxlength: 500, value: p.proximo_passo || '' }))],
    'Salvar', async (d) => {
      await api.post(`/treinamentos/participantes/${p.id}`, { ...d, avaliacao: d.avaliacao ? Number(d.avaliacao) : undefined }); fechar(); aviso('Registrado.'); recarregar();
    });
  });
  const ef = s.efetividade;
  const delta = (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v} consultas em 30 dias`);
  trocar(el,
    h('a', { class: 'voltar', href: '#/treinamentos' }, '← Treinamentos'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, s.titulo), selo(...ESTADO[s.estado])),
    h('p', {}, `${dataHora(s.inicio)} · ${s.duracao_min} min · instrutor: ${s.instrutor || '—'} · conta de demonstração: ${s.conta_demo}`),
    h('p', {}, h('a', { href: s.link, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir o link da chamada')),
    pode && agendada ? h('div', { class: 'acoes' },
      acao('Incluir clientes', incluir), acao('Enviar convites', async () => {
        const r = await api.post(`/treinamentos/${id}/convidar`);
        aviso(`${r.convidados} convite(s) enviado(s).${r.semPontoFocal.length ? ` Sem ponto focal: ${r.semPontoFocal.join(', ')}.` : ''}${r.bloqueados.length ? ` Bloqueados: ${r.bloqueados.join('; ')}.` : ''}`, r.semPontoFocal.length || r.bloqueados.length ? 'erro' : 'ok');
        recarregar();
      }, 'btn-primario'),
      comecou ? acao('Concluir sessão', async () => { await api.post(`/treinamentos/${id}/concluir`); aviso('Sessão concluída. Quem faltou virou tarefa de reagendamento.'); recarregar(); }) : null,
      h('button', { class: 'btn btn-fantasma', type: 'button', onclick: () => modal('Cancelar sessão', (fechar) => formulario([campo('Motivo', h('textarea', { name: 'motivo', rows: 2, required: true, minlength: 5 }))],
        'Cancelar sessão', async (d) => { await api.post(`/treinamentos/${id}/cancelar`, d); fechar(); aviso('Sessão cancelada.'); recarregar(); })) }, 'Cancelar')) : null,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao roteiro-doc' }, h('h2', {}, `Roteiro: ${s.roteiro_titulo} (v${s.roteiro_versao})`),
        h('ol', { class: 'itens' }, s.passos.map((p) => h('li', {}, h('strong', {}, p.tela), h('div', { class: 'suave' }, p.objetivo)))),
        h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: () => window.print() }, 'Imprimir o documento')),
      h('section', { class: 'cartao' }, h('h2', {}, 'Efeito no uso da Platform'),
        ef.medidos ? h('dl', { class: 'dados' }, h('dt', {}, 'Presentes'), h('dd', {}, delta(ef.variacaoMediaPresentes)), h('dt', {}, 'Ausentes'), h('dd', {}, delta(ef.variacaoMediaAusentes)),
          h('dt', {}, 'Clientes medidos'), h('dd', {}, String(ef.medidos))) : vazio('Ainda sem dados de uso (chegam pelo CSV de uso da Platform).'),
        h('p', { class: 'suave' }, 'Média da variação de consultas em 30 dias entre o convite e hoje.'))),
    h('section', { class: 'cartao' }, h('h2', {}, `Clientes (${s.participantes.length})`),
      s.participantes.length ? h('ul', { class: 'itens' }, s.participantes.map((p) => h('li', { class: 'linha-acao' },
        h('span', {}, h('strong', {}, p.conta), p.vip ? ' ' : '', p.vip ? selo('VIP', 'vip') : null, ' ', selo(...PRESENCA[p.presenca]),
          p.avaliacao ? selo(`nota ${p.avaliacao}`, 'info') : null,
          h('div', { class: 'suave' }, p.convidado_em ? `convidado ${dataHora(p.convidado_em)}${p.ponto_focal ? ` · ${p.ponto_focal}` : ''}${p.convite_status ? ` · ${ENTREGA[p.convite_status] || p.convite_status}` : ''}` : 'ainda não convidado'),
          p.duvidas ? h('div', { class: 'suave' }, `Dúvidas: ${p.duvidas}`) : null, p.proximo_passo ? h('div', { class: 'suave' }, `Próximo passo: ${p.proximo_passo}`) : null),
        pode && s.estado !== 'cancelada' && comecou ? h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => registrar(p) }, 'Registrar') : null))) : vazio('Inclua os clientes que vão participar.')));
}
