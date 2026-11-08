// Comercial: funil de aquisição em quadro (Novo → Qualificação → Demonstração → Proposta → Teste → Negociação → Ganha),
// propostas versionadas com alçada, atividades da negociação, suspender/retomar/reabrir e catálogo de produtos.
import { h, trocar, dataHora, data, relativo, selo, campo, opcoes, aviso, modal, vazio, cnpj } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';
import { secaoAutomacoes } from './processos.js';
import { novoLembrete } from './meu-dia.js';
import { ligar } from '../telefone.js';

let CAT = null;
const catalogo = async () => (CAT ||= await api.get('/comercial/catalogo'));
const ABERTAS = ['novo', 'qualificacao', 'demonstracao', 'proposta', 'teste', 'negociacao'];
// CRM-003: etapas e nomes do funil em vigor na organização (o servidor confere de novo ao mover).
const etapasDo = (funil) => CAT.funisConfig?.[funil]?.etapas || ABERTAS;
const nomeEtapa = (e, funil) => CAT.funisConfig?.[funil]?.rotulos?.[e] || CAT.etapas[e]?.rotulo || e;
const moeda = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
// Centavos aparecem em proposta e preço unitário (o funil arredonda para leitura rápida).
const moeda2 = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
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
    negociacao: [h('p', {}, o.etapa === 'proposta' ? 'Os produtos desta oportunidade não exigem teste no catálogo: siga direto para a negociação.' : 'Teste aprovado: siga para a negociação.')],
    ganha: [h('p', {}, 'Ao fechar: a conta é criada em onboarding, o CS recebe o onboarding (define o ponto focal e repassa ao Suporte) e Operações provisiona na Platform.'),
      campo('CNPJ', h('input', { name: 'cnpj', value: o.cnpj || '', required: true })), campo('Valor mensal final (R$)', h('input', { name: 'valorMensal', value: o.valor_mensal ?? '', required: true }))],
  };
  return c[para] || [];
}

function coletarProdutos(form) { return [...form.querySelectorAll('select[name=produtos] option:checked')].map((x) => x.value); }

function mover(o, para, aoMudar) {
  modal(`Mover para ${CAT.etapas[para].rotulo}`, (fechar) => {
    const f = formulario([...camposDaEtapa(o, para),
      para !== 'ganha' ? campo('Fechamento previsto', h('input', { name: 'fechamentoPrevisto', type: 'date', value: o.fechamento_previsto || '' })) : null,
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

function novaOportunidade(aoCriar, funilInicial = 'aquisicao') {
  modal('Nova oportunidade', (fechar) => {
    const funil = opcoes(h('select', { name: 'funil' }), CAT.funis);
    funil.value = funilInicial;
    const empresa = h('input', { name: 'empresa', minlength: 2 });
    const conta = h('select', { name: 'contaOrigemId', 'aria-label': 'Cliente da carteira' }, h('option', { value: '' }, 'Carregando clientes…'));
    const campoEmpresa = campo('Empresa', empresa);
    const campoConta = campo('Cliente da carteira', conta, 'Expansão e renovação são sempre de um cliente que já existe.');
    let carregado = false;
    const ajustar = async () => {
      const deCarteira = funil.value !== 'aquisicao';
      // O CSS do campo vence o atributo hidden: esconde pelo estilo.
      campoEmpresa.style.display = deCarteira ? 'none' : ''; campoConta.style.display = deCarteira ? '' : 'none';
      empresa.required = !deCarteira; conta.required = deCarteira;
      if (deCarteira && !carregado) {
        carregado = true;
        try { const r = await api.get('/contas?pagina=1'); trocar(conta, h('option', { value: '' }, 'Escolha'), r.itens.map((c) => h('option', { value: c.id }, c.nome))); }
        catch (e) { trocar(conta, h('option', { value: '' }, textoErro(e))); }
      }
    };
    funil.onchange = ajustar;
    const f = formulario([
      campo('Funil', funil), campoEmpresa, campoConta,
      campo('Contato', h('input', { name: 'contatoNome' })), campo('Telefone', h('input', { name: 'contatoTelefone', inputmode: 'tel' })),
      campo('Origem', opcoes(h('select', { name: 'origem' }), CAT.origens)),
      campo('Produtos de interesse', h('select', { name: 'produtos', multiple: true, size: 4 }, Object.entries(CAT.produtos).map(([k, v]) => h('option', { value: k }, v)))),
      campo('Tamanho da frota', h('input', { name: 'frota', type: 'number', min: 0 })),
      campo('Fechamento previsto (opcional)', h('input', { name: 'fechamentoPrevisto', type: 'date' }), 'Entra na previsão de vendas do mês.'),
    ], 'Criar', async (d) => { const o = await api.post('/comercial/oportunidades', { ...d, produtos: coletarProdutos(f) }); fechar(); aviso(`${o.codigo} criada.`); aoCriar(o); });
    ajustar();
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
  const prev = h('section', { class: 'cartao' });
  const aviso300 = h('p', { class: 'alerta', hidden: true });
  let funilAtual = ctx.query?.get('funil') || '';
  const abas = h('div', { class: 'abas', role: 'tablist', 'aria-label': 'Funil' });
  const desenharAbas = () => trocar(abas, [['', 'Todos'], ...Object.entries(CAT.funis)].map(([k, r]) => h('button', { class: `aba${k === funilAtual ? ' ativa' : ''}`, type: 'button', role: 'tab',
    'aria-selected': k === funilAtual ? 'true' : 'false', onclick: () => { funilAtual = k; desenharAbas(); carregar(); } }, r.split(' (')[0])));
  desenharAbas();
  async function carregar() {
    const qs = new URLSearchParams({ ...(minhas.checked ? { minhas: '1' } : {}), ...(busca.value.trim() ? { q: busca.value.trim() } : {}), ...(funilAtual ? { funil: funilAtual } : {}) });
    const [{ itens, total, limite }, ind] = await Promise.all([api.get(`/comercial/oportunidades?${qs}`), api.get('/comercial/indicadores')]);
    aviso300.hidden = !(total > limite);
    trocar(aviso300, `Mostrando ${limite} de ${total} oportunidades. Use a busca, o funil ou "Só as minhas" para ver as demais.`);
    const maior = Math.max(1, ...ind.previsao.meses.map((m) => m.bruto));
    const nomeMes = (k) => { const t = new Date(`${k}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }); return t[0].toUpperCase() + t.slice(1); };
    trocar(prev, h('h2', {}, 'Previsão de fechamento (mensal)'),
      h('ul', { class: 'previsao' }, ind.previsao.meses.map((m) => h('li', {},
        h('span', { class: 'previsao-mes' }, nomeMes(m.mes)),
        h('span', { class: 'previsao-barra', 'aria-hidden': 'true' }, h('span', { class: 'previsao-bruto', style: { width: `${(m.bruto / maior) * 100}%` } },
          h('span', { class: 'previsao-ponderado', style: { width: m.bruto ? `${(m.ponderado / m.bruto) * 100}%` : '0' } }))),
        h('span', { class: 'previsao-valor' }, h('strong', {}, moeda(m.ponderado)), ` provável de ${moeda(m.bruto)} · ${m.oportunidades} oport.`)))),
      h('p', { class: 'suave' }, ind.previsao.formula, ind.previsao.semData ? ` ${ind.previsao.semData} em andamento sem data prevista.` : '',
        ind.previsao.atrasadas ? ` ${ind.previsao.atrasadas} com data prevista já passada.` : ''));
    const porEtapa = Object.fromEntries(ind.porEtapa.map((x) => [x.etapa, x]));
    const pipeline = ABERTAS.reduce((s, e) => s + (porEtapa[e]?.valor || 0), 0);
    const conv = ind.testes.aprovados + ind.testes.reprovados ? Math.round((ind.testes.aprovados / (ind.testes.aprovados + ind.testes.reprovados)) * 100) : null;
    const k = (r, v, n) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-rotulo' }, r), h('strong', { class: 'kpi-valor' }, v), n ? h('small', {}, n) : null);
    trocar(topo, k('Funil aberto (mensal)', moeda(pipeline)), k('Testes em andamento', String(ind.testes.em_andamento)),
      k('Testes aprovados', conv === null ? '—' : `${conv}%`, `${ind.testes.aprovados} aprovado(s) · ${ind.testes.reprovados} reprovado(s)`),
      k('Ganhas (90 dias)', String(porEtapa.ganha?.n || 0), moeda(porEtapa.ganha?.valor || 0)), k('Ciclo médio', ind.testes.ciclo_dias ? `${Math.round(ind.testes.ciclo_dias)} dias` : '—'),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-rotulo' }, 'Próxima ação vencida'), h('strong', { class: `kpi-valor${ind.testes.acao_vencida ? ' kpi-alerta' : ''}` }, String(ind.testes.acao_vencida))));
    const agora = new Date();
    trocar(quadro, [...(funilAtual ? etapasDo(funilAtual) : ABERTAS), 'suspensa', 'ganha'].map((e) => {
      const cards = itens.filter((o) => o.etapa === e);
      return h('section', { class: `coluna coluna-${e}` }, h('div', { class: 'coluna-topo' }, h('strong', {}, funilAtual ? nomeEtapa(e, funilAtual) : CAT.etapas[e].rotulo), h('span', { class: 'suave' }, `${cards.length} · ${moeda(cards.reduce((s, o) => s + Number(o.valor_mensal || 0), 0))}`)),
        cards.length ? cards.map((o) => h('a', { class: `cartao-op ${o.proxima_acao_em && new Date(o.proxima_acao_em) < agora ? 'op-vencida' : ''}`, href: `#/comercial/${o.id}` },
          h('div', { class: 'linha-topo' }, h('strong', {}, o.empresa), o.funil !== 'aquisicao' ? selo(o.funil === 'renovacao' ? 'renovação' : 'expansão', 'vip') : null, o.etapa === 'teste' ? selo(o.teste_resultado || `até ${data(o.teste_fim)}`, o.teste_resultado === 'aprovado' ? 'ok' : o.teste_resultado ? 'perigo' : 'info') : null),
          h('div', { class: 'linha-meta' }, h('span', {}, moeda(o.valor_mensal)), o.frota ? h('span', {}, `${o.frota} veíc.`) : null, h('span', {}, o.responsavel_nome || 'sem dono')),
          o.proxima_acao ? h('div', { class: 'suave op-acao' }, `${o.proxima_acao} · ${relativo(o.proxima_acao_em)}`) : null)) : h('p', { class: 'vazio' }, '—'));
    }));
  }
  minhas.onchange = carregar;
  let t; busca.oninput = () => { clearTimeout(t); t = setTimeout(carregar, 350); };
  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Comercial'),
    ctx.pode('comercial.editar') ? h('button', { class: 'btn btn-primario', onclick: () => novaOportunidade((o) => { location.hash = `#/comercial/${o.id}`; }) }, 'Nova oportunidade') : null),
  h('p', { class: 'suave' }, 'Etapas: Novo → Qualificação → Demonstração → Proposta → Teste → Negociação → Ganha. Sem teste aprovado não há fechamento, salvo produtos que o catálogo dispensa e renovações.'),
  ctx.pode('comercial.gerir') ? h('div', { class: 'acoes' }, h('button', { class: 'btn btn-fantasma', onclick: () => telaProdutos(() => { CAT = null; telaComercial(el, ctx); }) }, 'Catálogo de produtos'),
    h('a', { class: 'btn btn-fantasma', href: '#/integracoes' }, 'Migrar do Pipedrive (CSV)')) : null,
  topo, prev, abas, h('div', { class: 'filtros' }, busca, h('label', { class: 'check' }, minhas, 'Minhas e da fila')), aviso300, quadro);
  await carregar();
}

async function detalhe(el, ctx, id) {
  const o = await api.get(`/comercial/oportunidades/${id}`);
  const recarregar = () => detalhe(el, ctx, id);
  const aberta = ABERTAS.includes(o.etapa);
  const trilha = etapasDo(o.funil);
  const i = trilha.indexOf(o.etapa);
  const proxima = o.etapa === 'negociacao' ? 'ganha' : o.etapa === 'teste' ? (o.teste_resultado === 'aprovado' ? 'negociacao' : null)
    : o.etapa === 'proposta' && !o.exigeTeste ? 'negociacao' : trilha[i + 1];
  const pode = ctx.pode('comercial.editar');
  const par = (r, v) => [h('dt', {}, r), h('dd', {}, v ?? '—')];
  trocar(el,
    h('a', { class: 'voltar', href: '#/comercial' }, '← Comercial'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, `${o.codigo} · ${o.empresa}`)),
    h('div', { class: 'etapas-trilha' }, [...trilha, 'ganha'].map((e, j) => h('span', { class: `etapa-passo ${e === o.etapa ? 'atual' : j < i || o.etapa === 'ganha' ? 'feito' : ''}` }, nomeEtapa(e, o.funil))),
      o.etapa === 'perdida' ? selo(`Perdida: ${CAT.motivosPerda[o.motivo_perda]}`, 'perigo') : null,
      o.etapa === 'suspensa' ? selo(`Suspensa (estava em ${CAT.etapas[o.suspensa_de]?.rotulo}): ${o.motivo_suspensao}`, 'alerta') : null,
      o.fonte === 'pipedrive' ? selo('migrada do Pipedrive', 'neutro') : null, selo(CAT.funis[o.funil]?.split(' (')[0] || o.funil, o.funil === 'aquisicao' ? 'neutro' : 'vip'), o.teste_dispensado ? selo('teste dispensado pelo catálogo', 'info') : null),
    aberta && pode ? h('div', { class: 'acoes' },
      !o.responsavel_id ? h('button', { class: 'btn btn-primario', onclick: async () => {
        try { await api.post(`/comercial/oportunidades/${id}`, { responsavelId: ctx.usuario.id, versao: o.version }); aviso('Oportunidade assumida.'); recarregar(); } catch (e) { aviso(textoErro(e), 'erro'); }
      } }, 'Assumir') : null,
      proxima ? h('button', { class: 'btn btn-primario', onclick: () => mover(o, proxima, recarregar) }, proxima === 'ganha' ? 'Fechar venda' : `Avançar para ${nomeEtapa(proxima, o.funil)}`) : null,
      o.etapa === 'teste' ? h('button', { class: `btn ${o.teste_resultado ? '' : 'btn-primario'}`, onclick: () => modal('Resultado do teste', (fechar) => formulario([
        campo('O teste foi', opcoes(h('select', { name: 'resultado', required: true }), { aprovado: 'Aprovado (critério atingido)', reprovado: 'Reprovado' }, 'Escolha')),
        campo('Parecer', h('textarea', { name: 'parecer', rows: 3, required: true, minlength: 5 }), `Critério combinado: ${o.teste_criterio}`),
      ], 'Registrar', async (d) => { await api.post(`/comercial/oportunidades/${id}/teste`, { ...d, versao: o.version }); fechar(); aviso('Resultado registrado.'); recarregar(); })) }, 'Registrar resultado do teste') : null,
      o.contato_telefone && ctx.pode('telefonia.usar') ? h('button', { class: 'btn', onclick: () => ligar({ oportunidadeId: id, aoEncerrar: recarregar }) }, '📞 Ligar') : null,
      h('button', { class: 'btn', onclick: () => novoLembrete(ctx, recarregar, { oportunidadeId: id }) }, '+ Lembrete'),
      h('button', { class: 'btn btn-fantasma', onclick: () => suspender(o, recarregar) }, 'Suspender'),
      h('button', { class: 'btn btn-fantasma', onclick: () => perder(o, recarregar) }, 'Marcar perdida')) : null,
    pode && ['suspensa', 'perdida'].includes(o.etapa) ? h('div', { class: 'acoes' }, h('button', { class: 'btn btn-primario', onclick: () => retomar(o, recarregar) }, o.etapa === 'suspensa' ? 'Retomar agora' : 'Reabrir')) : null,
    o.conta_origem_id ? h('p', {}, `${o.funil === 'renovacao' ? 'Renovação' : 'Expansão'} de `, h('a', { href: `#/contas/${o.conta_origem_id}` }, o.conta_origem_nome),
      o.conta_origem_valor ? ` · contrato atual ${moeda(o.conta_origem_valor)}/mês` : '', o.encaminhada_por_nome ? ` · encaminhada por ${o.encaminhada_por_nome}` : '') : null,
    o.conta_id && !o.conta_origem_id ? h('p', {}, 'Conta criada: ', h('a', { href: `#/contas/${o.conta_id}` }, o.conta_nome || 'abrir')) : null,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Dados'), h('dl', { class: 'dados' },
        ...par('Contato', [o.contato_nome, o.contato_telefone, o.contato_email].filter(Boolean).join(' · ')), ...par('CNPJ', o.cnpj ? cnpj(o.cnpj) : null),
        ...par('Origem', CAT.origens[o.origem]), ...par('Produtos', (o.produtos || []).map((p) => CAT.produtos[p]).join(', ') || null),
        ...par('Frota', o.frota ? `${o.frota} veículos` : null), ...par('Valor mensal', moeda(o.valor_mensal)), ...par('Fechamento previsto', o.fechamento_previsto ? data(o.fechamento_previsto) : null), ...par('Responsável', o.responsavel_nome || 'na fila do Comercial'),
        ...par('Próxima ação', o.proxima_acao ? `${o.proxima_acao} · ${dataHora(o.proxima_acao_em)}` : null),
        ...(o.teste_inicio ? [...par('Teste', `${data(o.teste_inicio)} a ${data(o.teste_fim)} · ${o.teste_criterio}`), ...par('Resultado do teste', o.teste_resultado ? `${o.teste_resultado}: ${o.teste_parecer}` : 'pendente')] : []))),
      h('section', { class: 'cartao' }, h('h2', {}, 'Histórico'), h('ol', { class: 'tempo' }, o.historico.map((a) => h('li', {}, h('span', { class: 'tempo-data' }, dataHora(a.criado_em)),
        h('strong', {}, a.acao.replace('oportunidade.', '').replaceAll('_', ' ')), ` por ${a.ator_nome}`, a.depois?.etapa ? ` → ${CAT.etapas[a.depois.etapa]?.rotulo}` : '', a.motivo ? h('div', { class: 'suave' }, a.motivo) : null))))),
    secaoPropostas(ctx, o, recarregar), secaoPessoas(ctx, o, recarregar), secaoAtividades(ctx, o, recarregar),
    ctx.pode('processo.ver') ? await secaoAutomacoes(ctx, { oportunidade: id }) : null);
}

function secaoPessoas(ctx, o, recarregar) {
  const pode = ctx.pode('comercial.editar') && !['ganha', 'perdida'].includes(o.etapa);
  const nova = () => modal('Pessoa da negociação', (fechar) => formulario([
    campo('Nome', h('input', { name: 'nome', required: true, minlength: 2, maxlength: 120 })), campo('Cargo', h('input', { name: 'cargo', maxlength: 80 })),
    campo('Telefone', h('input', { name: 'telefone', inputmode: 'tel' })), campo('E-mail', h('input', { name: 'email', type: 'email' })),
    campo('Papel na decisão', opcoes(h('select', { name: 'papel', required: true }), CAT.papeisPessoa)),
    h('p', { class: 'suave' }, 'Se o telefone ou e-mail já for de uma pessoa cadastrada, ela é reaproveitada (sem duplicar).'),
  ], 'Adicionar', async (d) => { const r = await api.post(`/comercial/oportunidades/${o.id}/pessoas`, d); fechar(); aviso(r.nova ? 'Pessoa cadastrada.' : `${r.nome} já estava cadastrada: vinculada.`); recarregar(); }));
  return h('section', { class: 'cartao' }, h('div', { class: 'titulo-tela' }, h('h2', {}, 'Pessoas'), pode ? h('button', { class: 'btn btn-pequeno', onclick: nova }, 'Adicionar pessoa') : null),
    o.contatos.length ? h('ul', { class: 'itens' }, o.contatos.map((p) => h('li', { class: 'linha-acao' },
      h('span', {}, selo(CAT.papeisPessoa[p.papel], p.papel === 'decisor' ? 'vip' : 'neutro'), ' ', h('strong', {}, p.nome), p.cargo ? ` · ${p.cargo}` : '',
        h('div', { class: 'suave' }, [p.telefone, p.email].filter(Boolean).join(' · '), p.oportunidades > 1 ? ` · em ${p.oportunidades} oportunidades` : '')),
      pode ? h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: async () => {
        try { await api.post(`/comercial/oportunidades/${o.id}/pessoas/${p.id}/desvincular`); aviso('Pessoa desvinculada (o cadastro dela continua).'); recarregar(); } catch (e) { aviso(textoErro(e), 'erro'); }
      } }, 'Desvincular') : null))) : vazio('Ninguém além do contato principal. Cadastre quem decide, quem influencia e quem vai usar.'));
}

function suspender(o, aoMudar) {
  modal('Suspender a oportunidade', (fechar) => formulario([
    h('p', { class: 'suave' }, 'Sai do funil ativo, mas volta para o seu Meu dia na data marcada.'),
    campo('Motivo', h('input', { name: 'motivo', required: true, minlength: 5, maxlength: 300, placeholder: 'ex.: orçamento só em janeiro' })),
    campo('Retomar em', h('input', { name: 'retomarEm', type: 'datetime-local', required: true })),
  ], 'Suspender', async (d) => { await api.post(`/comercial/oportunidades/${o.id}/suspender`, { ...d, versao: o.version }); fechar(); aviso('Oportunidade suspensa.'); aoMudar(); }));
}

function retomar(o, aoMudar) {
  if (o.etapa === 'suspensa') { api.post(`/comercial/oportunidades/${o.id}/retomar`, { versao: o.version }).then(() => { aviso('Retomada.'); aoMudar(); }, (e) => aviso(textoErro(e), 'erro')); return; }
  modal('Reabrir a oportunidade', (fechar) => formulario([
    campo('Por que reabrir', h('textarea', { name: 'motivo', rows: 2, required: true, minlength: 5, maxlength: 500 })),
  ], 'Reabrir', async (d) => { await api.post(`/comercial/oportunidades/${o.id}/retomar`, { ...d, versao: o.version }); fechar(); aviso('Reaberta na qualificação.'); aoMudar(); }));
}

const COR_PROPOSTA = { rascunho: 'neutro', aguardando_aprovacao: 'alerta', aprovada: 'info', enviada: 'info', aceita: 'ok', recusada: 'perigo', substituida: 'neutro' };

function novaProposta(o, aoCriar) {
  const ativos = CAT.catalogo.filter((p) => p.ativo);
  const linhas = h('div', { class: 'proposta-itens' });
  const total = h('p', { class: 'proposta-total', 'aria-live': 'polite' });
  const desconto = h('input', { name: 'descontoPct', inputmode: 'decimal', value: '0', 'aria-label': 'Desconto (%)' });
  const num = (v) => Number(String(v || '').replace(',', '.')) || 0;
  const recalcular = () => {
    const cheio = [...linhas.children].reduce((s, l) => s + num(l.querySelector('[data-q]').value) * num(l.querySelector('[data-v]').value), 0);
    trocar(total, `Total cheio ${moeda2(cheio)} · com desconto ${moeda2(cheio * (1 - num(desconto.value) / 100))} por mês`);
  };
  const linha = (produto = (o.produtos || [])[0] || ativos[0]?.codigo) => {
    const ref = (c) => CAT.catalogo.find((p) => p.codigo === c)?.preco_referencia;
    const sel = opcoes(h('select', { 'aria-label': 'Produto' }), Object.fromEntries(ativos.map((p) => [p.codigo, p.nome])));
    sel.value = produto;
    const q = h('input', { type: 'number', min: 1, value: o.frota || 1, 'aria-label': 'Quantidade', dataset: { q: '1' } });
    const v = h('input', { inputmode: 'decimal', value: ref(produto) ?? '', placeholder: 'R$ por unidade', 'aria-label': 'Valor unitário', dataset: { v: '1' } });
    sel.onchange = () => { if (ref(sel.value) !== null && ref(sel.value) !== undefined) v.value = ref(sel.value); recalcular(); };
    q.oninput = recalcular; v.oninput = recalcular;
    const el = h('div', { class: 'proposta-item' }, sel, q, v, h('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Remover item', onclick: () => { el.remove(); recalcular(); } }, '×'));
    linhas.append(el); recalcular();
  };
  desconto.oninput = recalcular;
  linha();
  modal('Nova proposta', (fechar) => formulario([
    h('p', { class: 'suave' }, 'Itens por produto (quantidade × valor por unidade). Desconto acima da alçada vai para aprovação da gestão antes de seguir ao cliente.'),
    linhas, h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => linha() }, '+ Item'),
    campo('Desconto (%)', desconto), total,
    campo('Validade', h('input', { name: 'validade', type: 'date', required: true, value: hoje(15) })),
    campo('Condições (opcional)', h('textarea', { name: 'condicoes', rows: 2, maxlength: 2000 })),
  ], 'Criar proposta', async (d) => {
    const itens = [...linhas.children].map((l) => ({ produto: l.querySelector('select').value, quantidade: num(l.querySelector('[data-q]').value), valorUnitario: l.querySelector('[data-v]').value }));
    await api.post(`/comercial/oportunidades/${o.id}/propostas`, { ...d, descontoPct: desconto.value, itens }); fechar(); aviso('Proposta criada. Revise e envie.'); aoCriar();
  }));
}

function secaoPropostas(ctx, o, recarregar) {
  const pode = ctx.pode('comercial.editar');
  const acao = (p, a, rotulo, cls = '', pedirParecer = false) => h('button', { class: `btn btn-pequeno ${cls}`, type: 'button', onclick: () => {
    const enviar = async (corpo = {}) => { await api.post(`/comercial/propostas/${p.id}/${a}`, corpo); aviso(`${rotulo}: feito.`); recarregar(); };
    if (!pedirParecer) { enviar().catch((e) => aviso(textoErro(e), 'erro')); return; }
    modal(rotulo, (fechar) => formulario([campo('Parecer', h('textarea', { name: 'parecer', rows: 2, minlength: a === 'devolver' ? 5 : 0, required: a === 'devolver' }))],
      rotulo, async (x) => { await enviar(x); fechar(); }));
  } }, rotulo);
  const botoes = (p) => {
    if (!pode) return null;
    const b = [];
    if (['rascunho', 'aprovada'].includes(p.estado)) b.push(acao(p, 'enviar', p.estado === 'rascunho' && p.exige_aprovacao ? 'Pedir aprovação' : 'Marcar como enviada', 'btn-primario'));
    if (p.estado === 'aguardando_aprovacao' && ctx.pode('comercial.gerir') && p.criado_por !== ctx.usuario.id) b.push(acao(p, 'aprovar', 'Aprovar desconto', 'btn-primario', true), acao(p, 'devolver', 'Devolver', 'btn-fantasma', true));
    if (p.estado === 'enviada') b.push(acao(p, 'aceitar', 'Cliente aceitou', 'btn-primario', true), acao(p, 'recusar', 'Cliente recusou', 'btn-fantasma', true));
    return b.length ? h('div', { class: 'acoes' }, b) : null;
  };
  return h('section', { class: 'cartao' }, h('div', { class: 'titulo-tela' }, h('h2', {}, 'Propostas'),
    pode && ['demonstracao', 'proposta', 'teste', 'negociacao'].includes(o.etapa) ? h('button', { class: 'btn btn-pequeno', onclick: () => novaProposta(o, recarregar) }, 'Nova proposta') : null),
  o.propostas.length ? h('ul', { class: 'itens' }, o.propostas.map((p) => h('li', {},
    h('div', { class: 'linha-topo' }, h('strong', {}, `v${p.versao}`), selo(CAT.estadosProposta[p.estado], COR_PROPOSTA[p.estado]),
      h('span', {}, `${moeda2(p.valor_mensal)}/mês`), Number(p.desconto_pct) ? h('span', { class: 'suave' }, `(${Number(p.desconto_pct)}% de ${moeda2(p.valor_cheio)})`) : null,
      h('span', { class: 'suave' }, `válida até ${data(p.validade)}`), p.exige_aprovacao ? selo(p.aprovador ? `aprovada por ${p.aprovador}` : 'acima da alçada', p.aprovador ? 'ok' : 'alerta') : null),
    h('div', { class: 'suave' }, p.itens.map((i) => `${CAT.produtos[i.produto] || i.produto}: ${i.quantidade} × ${moeda2(i.valorUnitario)}`).join(' · '), p.condicoes ? ` · ${p.condicoes}` : ''),
    p.parecer ? h('div', { class: 'suave' }, `Parecer: ${p.parecer}`) : null, botoes(p)))) : vazio('Nenhuma proposta ainda.'));
}

function secaoAtividades(ctx, o, recarregar) {
  const pode = ctx.pode('comercial.editar');
  const nova = () => modal('Registrar atividade', (fechar) => {
    const feita = h('input', { type: 'checkbox', name: 'feita' });
    const f = formulario([
      campo('Tipo', opcoes(h('select', { name: 'tipo', required: true }), CAT.tiposAtividade)),
      campo('Assunto', h('input', { name: 'assunto', required: true, minlength: 2, maxlength: 200 })),
      campo('Quando', h('input', { name: 'quando', type: 'datetime-local' }), 'Agendada no futuro vira a próxima ação da oportunidade.'),
      h('label', { class: 'check' }, feita, ' Já aconteceu'),
      campo('Resultado (o que foi combinado)', h('textarea', { name: 'resultado', rows: 2, maxlength: 2000 })),
    ], 'Registrar', async (d) => { await api.post(`/comercial/oportunidades/${o.id}/atividades`, { ...d, feita: feita.checked }); fechar(); aviso('Atividade registrada.'); recarregar(); });
    return f;
  });
  const concluir = (a) => modal(`Concluir: ${a.assunto}`, (fechar) => formulario([campo('Resultado', h('textarea', { name: 'resultado', rows: 3, required: true, minlength: 2 }))],
    'Concluir', async (x) => { await api.post(`/comercial/atividades/${a.id}/concluir`, x); fechar(); aviso('Atividade concluída.'); recarregar(); }));
  const lista = o.atividades.itens;
  return h('section', { class: 'cartao' }, h('div', { class: 'titulo-tela' }, h('h2', {}, 'Atividades'), pode ? h('button', { class: 'btn btn-pequeno', onclick: nova }, 'Registrar atividade') : null),
    lista.length ? h('ul', { class: 'itens' }, lista.map((a) => h('li', { class: 'linha-acao' },
      h('span', {}, selo(CAT.tiposAtividade[a.tipo], a.feita ? 'neutro' : 'info'), ' ', h('strong', {}, a.assunto), ` · ${dataHora(a.quando)}${a.autor ? ` · ${a.autor}` : ''}`,
        a.resultado ? h('div', { class: 'suave' }, a.resultado) : null),
      !a.feita && pode ? h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => concluir(a) }, 'Concluir') : null))) : vazio('Nenhuma atividade registrada.'),
    o.atividades.total > lista.length ? h('p', { class: 'suave' }, `Mostrando ${lista.length} de ${o.atividades.total}.`) : null);
}

function telaProdutos(aoMudar) {
  const editar = (p = {}) => modal(p.codigo ? `Produto: ${p.nome}` : 'Novo produto', (fechar) => {
    const exige = h('input', { type: 'checkbox', checked: p.exige_teste !== false });
    const ativo = h('input', { type: 'checkbox', checked: p.ativo !== false });
    return formulario([
      campo('Código', h('input', { name: 'codigo', required: true, value: p.codigo || '', readonly: !!p.codigo, pattern: '[a-z0-9_]{2,40}', placeholder: 'ex.: multas' })),
      campo('Nome', h('input', { name: 'nome', required: true, value: p.nome || '', maxlength: 80 })),
      campo('Preço de referência por unidade (R$)', h('input', { name: 'precoReferencia', inputmode: 'decimal', value: p.preco_referencia ?? '' })),
      campo('Unidade', h('input', { name: 'unidade', value: p.unidade || 'veículo', maxlength: 30 })),
      h('label', { class: 'check' }, exige, ' Exige teste aprovado antes do fechamento'),
      h('label', { class: 'check' }, ativo, ' Ativo (aparece em novas oportunidades e propostas)'),
    ], 'Salvar', async (d) => { await api.post('/comercial/produtos', { ...d, exigeTeste: exige.checked, ativo: ativo.checked }); fechar(); aviso('Produto salvo.'); aoMudar(); });
  });
  modal('Catálogo de produtos', () => h('div', {},
    h('ul', { class: 'itens' }, CAT.catalogo.map((p) => h('li', { class: 'linha-acao' },
      h('span', {}, h('strong', {}, p.nome), ' ', p.exige_teste ? selo('exige teste', 'info') : selo('sem teste', 'neutro'), p.ativo ? null : selo('inativo', 'neutro'),
        p.preco_referencia ? h('span', { class: 'suave' }, ` · ${moeda2(p.preco_referencia)}/${p.unidade}`) : null),
      h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => editar(p) }, 'Editar')))),
    h('div', { class: 'form-acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: () => editar() }, 'Novo produto'))));
}
