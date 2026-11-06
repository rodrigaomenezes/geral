// Consultas da Platform (REC-008, BL-03 "erros invisíveis"): esperado × gerado por cliente e produto na janela, com os
// erros separados por tipo e os alertas abertos. Os dados chegam pelo CSV de volumetria (Integrações).
import { h, trocar, data, selo, opcoes, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';

const num = (v) => Number(v || 0).toLocaleString('pt-BR');

export async function telaConsultas(el) {
  const filtros = { dias: '7', pagina: 1 };
  const lista = h('div', { class: 'lista' });
  const rodape = h('div', { class: 'paginacao' });
  const nota = h('p', { class: 'suave' });
  const dias = opcoes(h('select', { 'aria-label': 'Período' }), { 7: 'Últimos 7 dias', 14: 'Últimos 14 dias', 30: 'Últimos 30 dias' });
  dias.value = filtros.dias;
  dias.onchange = () => { filtros.dias = dias.value; filtros.pagina = 1; carregar(); };

  async function carregar() {
    try {
      const r = await api.get(`/monitoramento/consultas?dias=${filtros.dias}&pagina=${filtros.pagina}`);
      if (!r.ate) {
        trocar(nota, '');
        trocar(lista, vazio('Ainda não chegou nenhum arquivo de volumetria da Platform. Importe em Integrações → "Platform → volumetria de consultas".'));
        trocar(rodape); return;
      }
      const L = r.limites;
      trocar(nota, `Até ${data(r.ate)} (último dia recebido). Alertas automáticos: mais de ${L.toleranciaNaoGeradas * 100}% das consultas esperadas sem gerar, `
        + `${L.diasSemExecucao} dias sem nenhuma consulta, ou erro técnico em ${L.taxaErroTecnico * 100}% das geradas. Indisponibilidade externa só é contada.`);
      trocar(lista, r.itens.length ? r.itens.map((x) => {
        const pct = x.esperadas ? Math.round((x.geradas / x.esperadas) * 100) : 100;
        const tipo = pct >= 95 ? 'ok' : pct >= 70 ? 'alerta' : 'perigo';
        return h('a', { class: `linha linha-${tipo === 'ok' ? 'no_prazo' : tipo === 'alerta' ? 'em_risco' : 'vencido'}`, href: `#/contas/${x.conta_id}` },
          h('div', { class: 'linha-topo' }, h('strong', {}, x.nome), x.vip ? selo('VIP', 'vip') : null, selo(x.produto, 'neutro'),
            selo(`${pct}% gerado`, tipo), x.alertas_ativos ? selo(`${x.alertas_ativos} alerta(s) aberto(s)`, 'perigo') : null),
          h('div', { class: 'consulta-barra', role: 'img', 'aria-label': `${x.geradas} de ${x.esperadas} consultas geradas` },
            h('span', { style: { width: `${Math.min(100, pct)}%` } })),
          h('div', { class: 'linha-meta' }, h('span', {}, `${num(x.geradas)} de ${num(x.esperadas)} geradas`),
            x.faltando ? h('span', {}, h('strong', {}, `${num(x.faltando)} não gerada(s)`)) : null,
            x.erros_tecnicos ? h('span', {}, `${num(x.erros_tecnicos)} erro(s) técnico(s)`) : null,
            x.erros_usuario ? h('span', {}, `${num(x.erros_usuario)} erro(s) de usuário`) : null,
            x.indisponiveis ? h('span', {}, `${num(x.indisponiveis)} por indisponibilidade externa`) : null,
            h('span', {}, `último dia ${data(x.ultimo_dia)}`)));
      }) : vazio('Nenhuma consulta no período.'));
      const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
      trocar(rodape, h('span', {}, `${r.total} cliente×produto · página ${r.pagina} de ${paginas}`),
        h('button', { class: 'btn btn-fantasma', disabled: r.pagina <= 1, onclick: () => { filtros.pagina--; carregar(); } }, 'Anterior'),
        h('button', { class: 'btn btn-fantasma', disabled: r.pagina >= paginas, onclick: () => { filtros.pagina++; carregar(); } }, 'Próxima'));
    } catch (e) { trocar(lista, vazio(textoErro(e))); }
  }

  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Consultas')),
    h('p', { class: 'suave' }, 'O que cada cliente deveria ter consultado e o que a Platform de fato gerou. Consulta que falta sem dar erro é o "erro invisível": o cliente só deixa de receber.'),
    h('div', { class: 'filtros' }, dias), nota, lista, rodape);
  carregar();
}
