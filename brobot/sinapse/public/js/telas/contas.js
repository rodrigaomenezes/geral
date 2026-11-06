import { h, trocar, data, dataHora, cnpj, selo, campo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';
import { ligar } from '../telefone.js';
import { secaoChecklists } from './checklist.js';

const COR_FIN = { ok: 'ok', alerta: 'alerta', neutro: 'neutro' };
const COR_CRED = { ok: 'ok', ausente: 'perigo', invalida: 'perigo', expirada: 'perigo', '2fa_pendente': 'alerta', vinculo_sne: 'alerta' };
const EQUIPE = { cs: 'Customer Success', suporte: 'Suporte' };

export async function telaContas(el, ctx) {
  const f = { q: '', filtro: '', pagina: 1 };
  const lista = h('div', { class: 'lista' });
  const busca = h('input', { type: 'search', placeholder: 'Nome ou CNPJ', 'aria-label': 'Buscar conta' });
  const filtro = opcoes(h('select', { 'aria-label': 'Filtro' }), { vip: 'Só VIP', sem_ponto_focal: 'Sem ponto focal' }, 'Todas as contas');
  let t; busca.oninput = () => { clearTimeout(t); t = setTimeout(() => { f.q = busca.value.trim(); carregar(); }, 350); };
  filtro.onchange = () => { f.filtro = filtro.value; carregar(); };

  async function carregar() {
    const qs = new URLSearchParams({ pagina: f.pagina });
    if (f.q) qs.set('q', f.q);
    if (f.filtro) qs.set('filtro', f.filtro);
    try {
      const r = await api.get(`/contas?${qs}`);
      trocar(lista, r.itens.length ? r.itens.map((c) => h('a', { class: 'linha', href: `#/contas/${c.id}` },
        h('div', { class: 'linha-topo' }, h('strong', {}, c.nome), c.vip ? selo('VIP', 'vip') : null, selo(EQUIPE[c.equipe] || c.equipe, 'info'),
          c.roteamento_excecao ? selo('Exceção de roteamento', 'alerta') : null, !c.tem_principal ? selo('Sem ponto focal', 'perigo') : null,
          c.credenciais_pendentes ? selo(`${c.credenciais_pendentes} credencial(is) com problema`, 'alerta') : null),
        h('div', { class: 'linha-meta' }, h('span', {}, cnpj(c.cnpj)), h('span', {}, c.segmento || ''), h('span', {}, `${c.ocorrencias_ativas} ocorrência(s) ativa(s)`),
          h('span', {}, 'Financeiro: ', selo(c.financeiro.rotulo, COR_FIN[c.financeiro.nivel]))))) : vazio('Nenhuma conta encontrada.'));
    } catch (e) { trocar(lista, vazio(textoErro(e))); }
  }
  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Carteira')),
    h('p', { class: 'suave' }, 'Regra de atendimento: VIP → Customer Success; demais → Suporte, salvo exceção aprovada e justificada.'),
    h('div', { class: 'filtros' }, busca, filtro), lista);
  await carregar();
}

export async function telaConta(el, ctx, id) {
  const c = await api.get(`/contas/${id}`);
  const recarregar = () => telaConta(el, ctx, id);
  const [checklists, vipHist] = await Promise.all([secaoChecklists(ctx, { id, status: c.status }, recarregar), api.get(`/contas/${id}/vip`)]);
  // GOV-002: VIP por pedido; outra pessoa da gestão aprova (Governança).
  const pendenteVip = vipHist.pedidos.find((p) => p.estado === 'pendente');
  const umAno = () => { const d = new Date(Date.now() + 365 * 864e5); return d.toISOString().slice(0, 10); };
  const pedirVip = (tipo) => modal({ conceder: 'Pedir VIP', renovar: 'Renovar o VIP', retirar: 'Retirar o VIP' }[tipo], (fechar) => formulario([
    tipo !== 'retirar' ? campo('Critério', h('input', { name: 'criterio', required: true, minlength: 5, maxlength: 300, value: c.vip_criterio || '', placeholder: 'ex.: frota acima de 400 veículos' })) : null,
    tipo !== 'retirar' ? campo('Válido até', h('input', { name: 'validade', type: 'date', required: true, value: umAno() }), 'Até 2 anos. 15 dias antes, o CS recebe a tarefa de renovar.') : null,
    campo('Motivo', h('textarea', { name: 'motivo', rows: 2, required: true, minlength: 5, maxlength: 500 })),
    h('p', { class: 'suave' }, 'Outra pessoa da gestão aprova. Aprovado, as ocorrências novas passam a ir para o ' + (tipo === 'retirar' ? 'Suporte.' : 'CS.')),
  ], 'Enviar pedido', async (d) => { await api.post(`/contas/${id}/vip`, { ...d, tipo }); fechar(); aviso('Pedido enviado para aprovação.'); recarregar(); }));
  const ESTADO_VIP = { pendente: ['esperando aprovação', 'alerta'], aprovado: ['aprovado', 'ok'], recusado: ['recusado', 'neutro'], automatico: ['automático', 'neutro'] };
  const TIPO_VIP = { conceder: 'Conceder VIP', renovar: 'Renovar VIP', retirar: 'Retirar VIP' };
  const secaoVip = vipHist.pedidos.length || ctx.pode('conta.editar') ? h('section', { class: 'cartao' }, h('h2', {}, 'VIP'),
    h('p', {}, c.vip ? `VIP até ${data(c.vip_validade)} · ${c.vip_criterio} · aprovado por ${c.vip_aprovador || '—'}` : 'Esta conta não é VIP.'),
    ctx.pode('conta.editar') && !pendenteVip ? h('div', { class: 'acoes' },
      !c.vip ? h('button', { class: 'btn', type: 'button', onclick: () => pedirVip('conceder') }, 'Pedir VIP') : null,
      c.vip ? h('button', { class: 'btn', type: 'button', onclick: () => pedirVip('renovar') }, 'Renovar') : null,
      c.vip ? h('button', { class: 'btn btn-fantasma', type: 'button', onclick: () => pedirVip('retirar') }, 'Retirar VIP') : null) : null,
    vipHist.pedidos.length ? h('ul', { class: 'itens' }, vipHist.pedidos.map((p) => h('li', {}, h('strong', {}, TIPO_VIP[p.tipo]), ' ', selo(...ESTADO_VIP[p.estado]),
      h('div', { class: 'suave' }, `${dataHora(p.criado_em)} · ${p.pedido_por_nome || 'Sinapse'}: ${p.motivo}${p.validade ? ` · até ${data(p.validade)}` : ''}`),
      p.decidido_por_nome ? h('div', { class: 'suave' }, `Decidido por ${p.decidido_por_nome} em ${dataHora(p.decidido_em)}${p.decisao_motivo ? `: ${p.decisao_motivo}` : ''}`) : null))) : null) : null;
  const vigentes = c.pontosFocais.filter((p) => p.vigente);
  const historico = c.pontosFocais.filter((p) => !p.vigente);

  const novoPf = () => modal('Definir ponto focal', (fechar) => formulario([
    campo('Papel', opcoes(h('select', { name: 'papel', required: true }), { principal: 'Principal', suplente: 'Suplente' })),
    campo('Nome', h('input', { name: 'nome', required: true, minlength: 3 })),
    campo('Celular (WhatsApp)', h('input', { name: 'telefone', inputmode: 'tel', placeholder: '(11) 91234-5678' })),
    campo('E-mail', h('input', { name: 'email', type: 'email' })),
    campo('Canal preferido', opcoes(h('select', { name: 'canalPreferido' }), { whatsapp: 'WhatsApp', email: 'E-mail' })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consentimentoWhatsapp' }), 'Autorizou receber avisos por WhatsApp'),
    h('p', { class: 'suave' }, 'O ponto focal atual do mesmo papel vai para o histórico (nada é apagado).'),
  ], 'Salvar', async (d) => { await api.post(`/contas/${id}/pontos-focais`, d); fechar(); aviso('Ponto focal atualizado.'); recarregar(); }));

  const grupo = () => modal('Grupo de WhatsApp do cliente', (fechar) => formulario([
    h('p', { class: 'suave' }, 'Os processos que enviam "no grupo" usam este destino (comunicado da rodada, formalização da ligação).'),
    campo('Identificador do grupo no WhatsApp', h('input', { name: 'grupo', value: c.grupo_whatsapp || '', maxlength: 120, placeholder: 'ex.: 1203630…@g.us' })),
  ], 'Salvar', async (d) => { await api.post(`/contas/${id}/grupo`, { grupo: d.grupo || '' }); fechar(); aviso('Grupo atualizado.'); recarregar(); }));

  const bloqueio = () => modal('Pedir bloqueio por inadimplência', (fechar) => formulario([
    h('p', {}, 'O bloqueio operacional só acontece com regra aprovada pelo Financeiro e autorização. O pedido é registrado na auditoria.'),
    campo('Motivo', h('textarea', { name: 'motivo', required: true, minlength: 5, rows: 2 })),
  ], 'Pedir bloqueio', async (d) => { await api.post(`/contas/${id}/bloqueio`, d); fechar(); }));

  // CS-011: o CS percebe expansão ou renovação e encaminha ao Comercial (fica na fila, com a observação).
  const encaminhar = () => modal('Encaminhar ao Comercial', (fechar) => formulario([
    campo('Tipo', opcoes(h('select', { name: 'funil', required: true }), { expansao: 'Expansão (novo produto ou mais veículos)', renovacao: 'Renovação do contrato' })),
    campo('O que o cliente disse', h('textarea', { name: 'observacao', rows: 3, required: true, minlength: 5, maxlength: 500 })),
  ], 'Encaminhar', async (d) => { const o = await api.post('/comercial/encaminhar', { ...d, contaId: id }); fechar(); aviso(`${o.codigo} encaminhada ao Comercial.`); }));

  // GOV-008: SLA acordado em contrato (horas por prioridade); vazio = padrão da organização.
  const PRIOS = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  const textoSla = (sla) => (sla ? Object.entries(sla).map(([p, r]) => `${PRIOS[p] || p}: resposta ${r.resposta} h, resolução ${r.resolucao} h`).join(' · ') : 'padrão da organização');
  const sla = () => modal('SLA de contrato', (fechar) => formulario([
    h('p', { class: 'suave' }, 'Preencha só as prioridades que o contrato define. Horas úteis (crítica em horas corridas). Vale no lugar do padrão e sem o desconto VIP.'),
    ...Object.entries(PRIOS).map(([p, nome]) => h('div', { class: 'grade-2' },
      campo(`${nome} · resposta (h)`, h('input', { name: `${p}_resposta`, type: 'number', min: 0.25, max: 720, step: 0.25, value: c.sla_contrato?.[p]?.resposta ?? '' })),
      campo(`${nome} · resolução (h)`, h('input', { name: `${p}_resolucao`, type: 'number', min: 0.25, max: 720, step: 0.25, value: c.sla_contrato?.[p]?.resolucao ?? '' })))),
    campo('Motivo (contrato, aditivo)', h('input', { name: 'motivo', required: true, minlength: 5, maxlength: 300 })),
  ], 'Salvar', async (d) => {
    const corpo = {};
    for (const p of Object.keys(PRIOS)) if (d[`${p}_resposta`] || d[`${p}_resolucao`]) corpo[p] = { resposta: Number(d[`${p}_resposta`]), resolucao: Number(d[`${p}_resolucao`]) };
    await api.post(`/contas/${id}/sla`, { sla: Object.keys(corpo).length ? corpo : null, motivo: d.motivo }); fechar(); aviso('SLA de contrato salvo.'); recarregar();
  }));

  trocar(el,
    h('a', { class: 'voltar', href: '#/contas' }, '← Carteira'),
    h('div', { class: 'titulo-tela' }, h('h1', {}, c.nome)),
    h('div', { class: 'selos' }, c.vip ? selo('VIP', 'vip') : null, selo(`Atendimento: ${EQUIPE[c.equipe] || c.equipe}`, 'info'), selo(c.status, 'neutro'),
      selo(`Financeiro: ${c.financeiro.rotulo}`, COR_FIN[c.financeiro.nivel])),
    c.alertas.length ? h('div', { class: 'alertas' }, c.alertas.map((a) => h('p', { class: `alerta ${a.codigo === 'sem_ponto_focal' ? 'alerta-perigo' : ''}` }, a.texto))) : null,
    h('div', { class: 'acoes' },
      ctx.pode('conta.editar') ? h('button', { class: 'btn btn-primario', onclick: novoPf }, 'Definir ponto focal') : null,
      ctx.pode('conta.editar') ? h('button', { class: 'btn', onclick: grupo }, c.grupo_whatsapp ? 'Alterar grupo do WhatsApp' : 'Cadastrar grupo do WhatsApp') : null,
      ctx.pode('conta.editar') && !ctx.pode('comercial.editar') ? h('button', { class: 'btn', onclick: encaminhar }, 'Encaminhar ao Comercial') : null,
      ctx.pode('governanca.gerir') ? h('button', { class: 'btn', onclick: sla }, 'SLA de contrato') : null,
      ctx.pode('financeiro.bloqueio') ? h('button', { class: 'btn btn-fantasma', onclick: bloqueio }, 'Pedir bloqueio por inadimplência') : null),
    checklists,
    secaoVip,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Cadastro'), h('dl', { class: 'dados' },
        ...par('CNPJ', cnpj(c.cnpj)), ...par('Grupo do WhatsApp', c.grupo_whatsapp ? 'cadastrado' : 'não cadastrado (mensagens "no grupo" vão ao ponto focal)'), ...par('Segmento', c.segmento || '—'), ...par('SLA', textoSla(c.sla_contrato)), ...par('ID Platform', c.id_platform || '—'), ...par('ID OMIE', c.id_omie || '—'),
        ...(c.vip ? [...par('Critério VIP', c.vip_criterio), ...par('Aprovado por', c.vip_aprovador), ...par('VIP válido até', data(c.vip_validade))] : []),
        ...(c.roteamento_excecao ? [...par('Exceção de roteamento', `${EQUIPE[c.roteamento_excecao]}: ${c.roteamento_justificativa}`)] : []),
        ...par('Situação financeira (OMIE)', `${c.financeiro.rotulo}${c.financeiro.sincronizadoEm ? ` · sincronizado ${dataHora(c.financeiro.sincronizadoEm)}` : ''}`))),
      h('section', { class: 'cartao' }, h('h2', {}, 'Pontos focais'), vigentes.length ? h('ul', { class: 'itens' }, vigentes.map((p) => h('li', {},
        h('strong', {}, `${p.papel === 'principal' ? 'Principal' : 'Suplente'}: ${p.nome}`), h('div', { class: 'suave' }, [p.telefone, p.email].filter(Boolean).join(' · ')),
        p.consentimento_whatsapp ? selo('WhatsApp autorizado', 'ok') : selo('Sem consentimento de WhatsApp', 'alerta'), p.opt_out ? selo('Opt-out', 'perigo') : null,
        p.telefone && ctx.pode('telefonia.usar') && ctx.pode('conta.editar') ? h('div', {}, h('button', { class: 'btn btn-pequeno', onclick: () => ligar({ contaId: id, numero: p.telefone, nome: `${p.nome} (${c.nome})`, aoEncerrar: recarregar }) }, '📞 Ligar')) : null)))
        : vazio('Nenhum ponto focal vigente.'),
      historico.length ? h('details', {}, h('summary', {}, `Histórico (${historico.length})`), h('ul', { class: 'itens' }, historico.map((p) => h('li', { class: 'suave' },
        `${p.papel}: ${p.nome} · até ${dataHora(p.encerrado_em)}`)))) : null)),
    c.uso ? h('section', { class: 'cartao' }, h('h2', {}, 'Uso da Platform'), h('dl', { class: 'dados' },
      ...par('Último login', c.uso.ultimo_login ? `${dataHora(c.uso.ultimo_login)}` : '—'), ...par('Usuários ativos', c.uso.usuarios_ativos ?? '—'),
      ...par('Consultas em 30 dias', c.uso.consultas_30d ?? '—'), ...par('Atualizado em', `${dataHora(c.uso.atualizado_em)} (importação CSV)`))) : null,
    h('div', { class: 'grade-2' },
      h('section', { class: 'cartao' }, h('h2', {}, 'Credenciais (só status)'), h('p', { class: 'suave' }, 'O ERP guarda só a referência e o status vindos da Platform; nunca senha ou certificado.'),
        c.credenciais.length ? h('ul', { class: 'itens' }, c.credenciais.map((x) => h('li', {}, h('strong', {}, x.tipo), ' ', selo(x.status, COR_CRED[x.status]),
          x.expira_em ? ` vence em ${data(x.expira_em)}` : ''))) : vazio('Sem credenciais informadas pela Platform.')),
      h('section', { class: 'cartao' }, h('h2', {}, 'Rodadas'), c.rodadas.length ? h('ul', { class: 'itens' }, c.rodadas.map((r) => h('li', {},
        h('a', { href: `#/rodadas/${r.id}` }, `${r.produto} · ${dataHora(r.agendada_para)}`), ' ', selo(r.estado, 'info')))) : vazio('Sem rodadas.'))),
    h('section', { class: 'cartao' }, h('h2', {}, 'Ocorrências recentes'), c.ocorrencias.length ? h('ul', { class: 'itens' }, c.ocorrencias.map((o) => h('li', {},
      h('a', { href: `#/ocorrencias/${o.id}` }, `${o.protocolo} · ${o.titulo}`), ' ', selo(ctx.catalogos.estados[o.estado], 'neutro')))) : vazio('Sem ocorrências.')));
}

const par = (rotulo, valor) => [h('dt', {}, rotulo), h('dd', {}, valor)];
