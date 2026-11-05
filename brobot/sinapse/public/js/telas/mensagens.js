// Mensagens padrão: editar com prévia ao vivo, enviar para revisão, aprovar (com o template da Meta, opcional).
import { h, trocar, dataHora, selo, campo, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

const ESTADO = { rascunho: ['rascunho', 'alerta'], em_revisao: ['em revisão', 'info'], ativa: ['em uso', 'ok'], substituida: ['substituída', 'neutro'], reprovada: ['devolvida', 'perigo'] };

export async function telaMensagens(el, ctx, codigo) {
  if (codigo) return editor(el, ctx, codigo);
  const { itens } = await api.get('/modelos');
  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Mensagens padrão')),
    h('p', { class: 'suave' }, 'Os textos que o sistema envia sozinho (pré e pós-rodada, lembretes, insights). A equipe escreve, a Supervisão aprova, e só a versão aprovada é usada.'),
    h('div', { class: 'lista' }, itens.map((m) => h('a', { class: 'linha', href: `#/mensagens/${m.codigo}` },
      h('div', { class: 'linha-topo' }, h('strong', {}, m.nome), selo(m.emUso, m.emUso.startsWith('versão') ? 'ok' : 'neutro'),
        m.pendente ? selo(`v${m.pendente.versao} ${ESTADO[m.pendente.estado][0]}`, ESTADO[m.pendente.estado][1]) : null, m.template ? selo(`template Meta: ${m.template}`, 'info') : null),
      h('div', { class: 'linha-meta msg-resumo' }, m.texto.slice(0, 180) + (m.texto.length > 180 ? '…' : ''))))));
}

async function editor(el, ctx, codigo) {
  const d = await api.get(`/modelos/${codigo}`);
  const recarregar = () => editor(el, ctx, codigo);
  const pendente = d.versoes.find((v) => ['rascunho', 'em_revisao'].includes(v.estado));
  const ativa = d.versoes.find((v) => v.estado === 'ativa');
  const texto = h('textarea', { rows: 8, maxlength: 3000, 'aria-label': 'Texto da mensagem' });
  texto.value = (pendente || ativa)?.texto || d.padrao;
  const previa = h('div', { class: 'msg-previa', 'aria-live': 'polite' });
  const nota = h('input', { maxlength: 300, placeholder: 'O que mudou (opcional)' });
  let t;
  const atualizar = () => { clearTimeout(t); t = setTimeout(async () => {
    try { const p = await api.post(`/modelos/${codigo}/previa`, { texto: texto.value }); trocar(previa, p.texto); } catch (e) { trocar(previa, h('span', { class: 'alerta alerta-perigo' }, textoErro(e))); }
  }, 300); };
  texto.oninput = atualizar;
  const inserir = (v) => () => { const i = texto.selectionStart ?? texto.value.length; texto.value = `${texto.value.slice(0, i)}{${v}}${texto.value.slice(texto.selectionEnd ?? i)}`; texto.focus(); atualizar(); };
  const acao = (rotulo, fn, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick: async (e) => {
    e.currentTarget.disabled = true;
    try { await fn(); recarregar(); } catch (err) { aviso(textoErro(err), 'erro'); e.currentTarget.disabled = false; }
  } }, rotulo);
  const podeAprovar = ctx.pode('modelo.aprovar') && pendente?.estado === 'em_revisao';
  trocar(el,
    h('a', { class: 'voltar', href: '#/mensagens' }, '← Mensagens padrão'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, d.nome)),
    h('p', { class: 'suave' }, ativa ? `Em uso: versão ${ativa.versao}, aprovada por ${ativa.revisor || '—'} em ${dataHora(ativa.revisado_em)}.` : 'Em uso: texto padrão do sistema.',
      pendente ? ` Versão ${pendente.versao} ${ESTADO[pendente.estado][0]}.` : ''),
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Texto'),
        h('div', { class: 'chips-var' }, h('span', { class: 'suave' }, 'Inserir:'), d.variaveis.map((v) => h('button', { class: 'chip-var', type: 'button', onclick: inserir(v) }, `{${v}}`))),
        texto, campo('Nota da versão', nota),
        h('div', { class: 'acoes' },
          acao('Salvar rascunho', () => api.post(`/modelos/${codigo}/rascunho`, { texto: texto.value, nota: nota.value || undefined })),
          pendente?.estado === 'rascunho' ? acao('Enviar para aprovação', () => api.post(`/modelos/${codigo}/revisao`), 'btn-primario') : null,
          podeAprovar ? h('button', { class: 'btn btn-primario', type: 'button', onclick: () => modal(`Aprovar versão ${pendente.versao}`, (fechar) => formulario([
            h('p', { class: 'suave' }, 'Fora da janela de 24 h, o WhatsApp só aceita um modelo (template) aprovado pela Meta. Se este texto já foi aprovado lá, informe o nome e a ordem das variáveis.'),
            campo('Parecer (opcional)', h('textarea', { name: 'parecer', rows: 2 })),
            campo('Nome do template na Meta (opcional)', h('input', { name: 'templateNome', placeholder: 'ex.: pre_rodada_d3_v2', pattern: '[a-z0-9_]+' })),
            campo('Variáveis do template, em ordem ({{1}}, {{2}}…)', h('input', { name: 'templateVariaveis', placeholder: 'ex.: nome, conta, qtd, protocolo' })),
          ], 'Aprovar', async (x) => { await api.post(`/modelos/${codigo}/aprovar`, x); fechar(); aviso('Texto aprovado: já é o que o sistema envia.'); recarregar(); })) }, 'Aprovar') : null,
          podeAprovar ? h('button', { class: 'btn btn-fantasma', type: 'button', onclick: () => modal('Devolver para ajuste', (fechar) => formulario([
            campo('O que precisa mudar', h('textarea', { name: 'parecer', rows: 3, required: true, minlength: 5 })),
          ], 'Devolver', async (x) => { await api.post(`/modelos/${codigo}/reprovar`, x); fechar(); aviso('Devolvido com o parecer.'); recarregar(); })) }, 'Devolver') : null)),
      h('section', { class: 'cartao' }, h('h2', {}, 'Como o cliente vai ler'), h('div', { class: 'msg-bolha' }, previa),
        h('p', { class: 'suave' }, 'Prévia com dados de exemplo. Variáveis entre chaves são trocadas pelos dados de cada cliente.'))),
    h('section', { class: 'cartao' }, h('h2', {}, 'Histórico'), d.versoes.length ? h('ul', { class: 'itens' }, d.versoes.map((v) => h('li', {},
      h('strong', {}, `v${v.versao} `), selo(...ESTADO[v.estado]), ` ${v.autor || ''} · ${dataHora(v.criado_em)}`, v.parecer ? h('div', { class: 'suave' }, `Parecer: ${v.parecer}`) : null,
      v.template_nome ? h('div', { class: 'suave' }, `Template Meta: ${v.template_nome} (${(v.template_variaveis || []).join(', ')})`) : null,
      h('details', {}, h('summary', {}, 'Ver texto'), h('p', { class: 'msg-texto' }, v.texto))))) : vazio('Ainda sem versões da equipe: o sistema usa o texto padrão.')));
  atualizar();
}
