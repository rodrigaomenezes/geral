// Comercial: funil de aquisição em quadro (Novo → Qualificação → Demonstração → Proposta → Teste → Negociação → Ganha).
import { h, trocar, dataHora, data, relativo, selo, campo, opcoes, aviso, modal, vazio, cnpj } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';
import { secaoAutomacoes } from './processos.js';
import { novoLembrete } from './meu-dia.js';

let CAT = null;
const catalogo = async () => (CAT ||= await api.get('/comercial/catalogo'));
const ABERTAS = ['novo', 'qualificacao', 'demonstracao', 'proposta', 'teste', 'negociacao'];
const moeda = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const hoje = (dias = 0) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);

function camposDaEtapa(o, para) {
  const prods = h('select', { name: 'produtos', multiple: true, size: 4 }, Object.entries(CAT.produtos).map(([k, v]) => h('option', { value: k, selected: (o.produtos || []).includes(k) }, v)));
  const c = {
    qualificacao: [campo('Nome do contato', h('input', { name: 'contatoNome', value: o.contato_nome || '', required: true })),
      campo('Telefone', h('input', { name: 'contatoTelefone', value: o.contato_telefone || '', inputmode: 'tel' })), campo('E-mail', h('input', { name: 'contatoEmail', type: 'email', value: o.contato_email || '' }))],
    demonstracao: [campo('Produtos de interesse', prods, 'Segure Ctrl (ou toque longo) para escolher vários.')],
    proposta: [campo('Produtos', prods), campo('Tamanho da frota', h('input', { name: 'frota', type: 'number', min: 0, value: o.frota ?? '', required: true })),
      campo('Valor mensal (R$)', h('input', { name: 'valorMensal', inputmode: 'decimal', value: o.valor_mensal ?? '', required: true }))],
    teste: [h('p', { class: 'suave' }, 'O fechamento só acontece depois de um teste aprovado. Combine com o cliente o critério de sucesso.'),
      campo('CNPJ', h('input', { name: 'cnpj', value: o.cnpj || '', required: true, inputmode: 'numeric' })),
      campo('Início do teste', h('input', { name: 'testeInicio', type: 'date', value: o.teste_inicio?.slice(0, 10) || hoje(), required: true })),
      campo('Fim do teste (até 30 dias)', h('input', { name: 'testeFim', type: 'date', value: o.teste_fim?.slice(0, 10) || hoje(7), required: true })),
      campo('Critério de sucesso', h('textarea', { name: 'testeCriterio', rows: 2, required: true }, o.teste_criterio || ''), 'Ex.: consultar 100% da frota sem erro de credencial em 7 dias.')],
    negociacao: [h('p', {}, 'Teste aprovado: siga para a negociação.')],
    ganha: [h('p', {}, 'Ao fechar: a conta é criada em onboarding, o CS recebe o onboarding (define o ponto focal e repassa ao Suporte) e Operações provisiona na Platform.'),
      campo('CNPJ', h('input', { name: 'cnpj', value: o.cnpj || '', required: true })), campo('Valor mensal final (R$)', h('input', { name: 'valorMensal', value: o.valor_mensal ?? '', required: true }))],
  };
  return c[para] || [];
}

function coletarProdutos(form) { return [...form.querySelectorAll('select[name=produtos] option:checked')].map((x) => x.value); }

function mover(o, para, aoMudar) {
  modal(`Mover para ${CAT.etapas[para].rotulo}`, (fechar) => {
    const f = formulario([...camposDaEtapa(o, para),
      campo('Próxima ação', h('input', { name: 'proximaAcao', maxlength: 200, placeholder: 'ex.: enviar proposta revisada' })),
      campo('Quando', h('input', { type: 'datetime-local', name: 'proximaAcaoEm' }))], 'Mover', async (d) => {
      const produtos = coletarProdutos(f);
      const r = await api.post(`/comercial/oportunidades/${o.id}/etapa`, { ...d, para, versao: o.version, ...(produtos.length ? { produtos } : {}) });
      fechar(); aviso(para === 'ganha' ? 'Venda fechada! Conta criada em onboarding e CS acionado.' : `Movida para ${CAT.etapas[para].rotulo}.`);
      aoMudar(r);
    });
    if (para === 'ganha') f.querySelectorAll('[name=proximaAcao],[name=proximaAcaoEm]').forEach((x) => x.closest('label').remove());
    return f;
  });
}

function perder(o, aoMudar) {
  modal('Marcar como perdida', (fechar) => formulario([
    campo('Motivo', opcoes(h('select', { name: 'motivoPerda', required: true }), CAT.motivosPerda, 'Escolha')),
    campo('Detalhe', h('textarea', { name: 'detalhePerda', rows: 2 })),
  ], 'Marcar perdida', async (d) => { await api.post(`/comercial/oportunidades/${o.id}/etapa`, { ...d, para: 'perdida', versao: o.version }); fechar(); aviso('Oportunidade encerrada como perdida.'); aoMudar(); }));
}

function novaOportunidade(aoCriar) {
  modal('Nova oportunidade', (fechar) => {
    const f = formulario([
      campo('Empresa', h('input', { name: 'empresa', required: true, minlength: 2 })),
      campo('Contato', h('input', { name: 'contatoNome' })), campo('Telefone', h('input', { name: 'contatoTelefone', inputmode: 'tel' })),
      campo('Origem', opcoes(h('select', { name: 'origem' }), CAT.origens)),
      campo('Produtos de interesse', h('select', { name: 'produtos', multiple: true, size: 4 }, Object.entries(CAT.produtos).map(([k, v]) => h('option', { value: k }, v)))),
      campo('Tamanho da frota', h('input', { name: 'frota', type: 'number', min: 0 })),
    ], 'Criar', async (d) => { const o = await api.post('/comercial/oportunidades', { ...d, produtos: coletarProdutos(f) }); fechar(); aviso(`${o.codigo} criada.`); aoCriar(o); });
    return f;
  });
}

export async function telaComercial(el, ctx, id) {
  await catalogo();
  if (id) return detalhe(el, ctx, id);
  const minhas = h('input', { type: 'checkbox', checked: ctx.usuario.papel === 'comercial' });
  const busca = h('input', { type: 'search', placeholder: 'Empresa, código ou CNPJ', 'aria-label': 'Buscar' });
  const quadro = h('div', { class: 'quadro' });
  const topo = h('div', { class: 'grade-kpi' });
  async function carregar() {
    const qs = new URLSearchParams({ ...(minhas.checked ? { minhas: '1' } : {}), ...(busca.value.trim() ? { q: busca.value.trim() } : {}) });
    const [{ itens }, ind] = await Promise.all([api.get(`/comercial/oportunidades?${qs}`), api.get('/comercial/indicadores')]);
    const porEtapa = Object.fromEntries(ind.porEtapa.map((x) => [x.etapa, x]));
    const pipeline = ABERTAS.reduce((s, e) => s + (porEtapa[e]?.valor || 0), 0);
    const conv = ind.testes.aprovados + ind.testes.reprovados ? Math.round((ind.testes.aprovados / (ind.testes.aprovados + ind.testes.reprovados)) * 100) : null;
    const k = (r, v, n) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-rotulo' }, r), h('strong', { class: 'kpi-valor' }, v), n ? h('small', {}, n) : null);
    trocar(topo, k('Funil aberto (mensal)', moeda(pipeline)), k('Testes em andamento', String(ind.testes.em_andamento)),
      k('Testes aprovados', conv === null ? '—' : `${conv}%`, `${ind.testes.aprovados} aprovado(s) · ${ind.testes.reprovados} reprovado(s)`),
      k('Ganhas (90 dias)', String(porEtapa.ganha?.n || 0), moeda(porEtapa.ganha?.valor || 0)), k('Ciclo médio', ind.testes.ciclo_dias ? `${Math.round(ind.testes.ciclo_dias)} dias` : '—'),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-rotulo' }, 'Próxima ação vencida'), h('strong', { class: `kpi-valor${ind.testes.acao_vencida ? ' kpi-alerta' : ''}` }, String(ind.testes.acao_vencida))));
    const agora = new Date();
    trocar(quadro, [...ABERTAS, 'ganha'].map((e) => {
      const cards = itens.filter((o) => o.etapa === e);
      return h('section', { class: `coluna coluna-${e}` }, h('div', { class: 'coluna-topo' }, h('strong', {}, CAT.etapas[e].rotulo), h('span', { class: 'suave' }, `${cards.length} · ${moeda(cards.reduce((s, o) => s + Number(o.valor_mensal || 0), 0))}`)),
        cards.length ? cards.map((o) => h('a', { class: `cartao-op ${o.proxima_acao_em && new Date(o.proxima_acao_em) < agora ? 'op-vencida' : ''}`, href: `#/comercial/${o.id}` },
          h('div', { class: 'linha-topo' }, h('strong', {}, o.empresa), o.etapa === 'teste' ? selo(o.teste_resultado || `até ${data(o.teste_fim)}`, o.teste_resultado === 'aprovado' ? 'ok' : o.teste_resultado ? 'perigo' : 'info') : null),
          h('div', { class: 'linha-meta' }, h('span', {}, moeda(o.valor_mensal)), o.frota ? h('span', {}, `${o.frota} veíc.`) : null, h('span', {}, o.responsavel_nome || 'sem dono')),
          o.proxima_acao ? h('div', { class: 'suave op-acao' }, `${o.proxima_acao} · ${relativo(o.proxima_acao_em)}`) : null)) : h('p', { class: 'vazio' }, '—'));
    }));
  }
  minhas.onchange = carregar;
  let t; busca.oninput = () => { clearTimeout(t); t = setTimeout(carregar, 350); };
  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Comercial'),
    ctx.pode('comercial.editar') ? h('button', { class: 'btn btn-primario', onclick: () => novaOportunidade((o) => { location.hash = `#/comercial/${o.id}`; }) }, 'Nova oportunidade') : null),
  h('p', { class: 'suave' }, 'Funil de aquisição: Novo → Qualificação → Demonstração → Proposta → Teste → Negociação → Ganha. Sem teste aprovado não há fechamento.'),
  topo, h('div', { class: 'filtros' }, busca, h('label', { class: 'check' }, minhas, 'Só as minhas')), quadro);
  await carregar();
}

async function detalhe(el, ctx, id) {
  const o = await api.get(`/comercial/oportunidades/${id}`);
  const recarregar = () => detalhe(el, ctx, id);
  const aberta = ABERTAS.includes(o.etapa);
  const i = ABERTAS.indexOf(o.etapa);
  const proxima = o.etapa === 'negociacao' ? 'ganha' : o.etapa === 'teste' ? (o.teste_resultado === 'aprovado' ? 'negociacao' : null) : ABERTAS[i + 1];
  const pode = ctx.pode('comercial.editar');
  const par = (r, v) => [h('dt', {}, r), h('dd', {}, v ?? '—')];
  trocar(el,
    h('a', { class: 'voltar', href: '#/comercial' }, '← Comercial'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, `${o.codigo} · ${o.empresa}`)),
    h('div', { class: 'etapas-trilha' }, [...ABERTAS, 'ganha'].map((e, j) => h('span', { class: `etapa-passo ${e === o.etapa ? 'atual' : j < i || o.etapa === 'ganha' ? 'feito' : ''}` }, CAT.etapas[e].rotulo)),
      o.etapa === 'perdida' ? selo(`Perdida: ${CAT.motivosPerda[o.motivo_perda]}`, 'perigo') : null),
    aberta && pode ? h('div', { class: 'acoes' },
      proxima ? h('button', { class: 'btn btn-primario', onclick: () => mover(o, proxima, recarregar) }, proxima === 'ganha' ? 'Fechar venda' : `Avançar para ${CAT.etapas[proxima].rotulo}`) : null,
      o.etapa === 'teste' ? h('button', { class: `btn ${o.teste_resultado ? '' : 'btn-primario'}`, onclick: () => modal('Resultado do teste', (fechar) => formulario([
        campo('O teste foi', opcoes(h('select', { name: 'resultado', required: true }), { aprovado: 'Aprovado (critério atingido)', reprovado: 'Reprovado' }, 'Escolha')),
        campo('Parecer', h('textarea', { name: 'parecer', rows: 3, required: true, minlength: 5 }), `Critério combinado: ${o.teste_criterio}`),
      ], 'Registrar', async (d) => { await api.post(`/comercial/oportunidades/${id}/teste`, { ...d, versao: o.version }); fechar(); aviso('Resultado registrado.'); recarregar(); })) }, 'Registrar resultado do teste') : null,
      h('button', { class: 'btn', onclick: () => novoLembrete(ctx, recarregar, { oportunidadeId: id }) }, '+ Lembrete'),
      h('button', { class: 'btn btn-fantasma', onclick: () => perder(o, recarregar) }, 'Marcar perdida')) : null,
    o.conta_id ? h('p', {}, 'Conta criada: ', h('a', { href: `#/contas/${o.conta_id}` }, o.conta_nome || 'abrir')) : null,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Dados'), h('dl', { class: 'dados' },
        ...par('Contato', [o.contato_nome, o.contato_telefone, o.contato_email].filter(Boolean).join(' · ')), ...par('CNPJ', o.cnpj ? cnpj(o.cnpj) : null),
        ...par('Origem', CAT.origens[o.origem]), ...par('Produtos', (o.produtos || []).map((p) => CAT.produtos[p]).join(', ') || null),
        ...par('Frota', o.frota ? `${o.frota} veículos` : null), ...par('Valor mensal', moeda(o.valor_mensal)), ...par('Responsável', o.responsavel_nome),
        ...par('Próxima ação', o.proxima_acao ? `${o.proxima_acao} · ${dataHora(o.proxima_acao_em)}` : null),
        ...(o.teste_inicio ? [...par('Teste', `${data(o.teste_inicio)} a ${data(o.teste_fim)} · ${o.teste_criterio}`), ...par('Resultado do teste', o.teste_resultado ? `${o.teste_resultado}: ${o.teste_parecer}` : 'pendente')] : []))),
      h('section', { class: 'cartao' }, h('h2', {}, 'Histórico'), h('ol', { class: 'tempo' }, o.historico.map((a) => h('li', {}, h('span', { class: 'tempo-data' }, dataHora(a.criado_em)),
        h('strong', {}, a.acao.replace('oportunidade.', '').replaceAll('_', ' ')), ` por ${a.ator_nome}`, a.depois?.etapa ? ` → ${CAT.etapas[a.depois.etapa]?.rotulo}` : '', a.motivo ? h('div', { class: 'suave' }, a.motivo) : null))))),
    ctx.pode('processo.ver') ? await secaoAutomacoes(ctx, { oportunidade: id }) : null);
}
