// Integrações por CSV com a Platform e o OMIE: importar (prévia, mapeamento de colunas) e exportar (lote que só
// conta como aplicado no destino depois da confirmação com evidência).
import { h, trocar, dataHora, relativo, selo, campo, aviso, modal, vazio } from '../dom.js';
import { api, ErroApi, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

async function enviarCsv(caminho, arquivo, mapa) {
  const cab = { 'Content-Type': 'text/csv', 'X-Arquivo': encodeURIComponent(arquivo.name).slice(0, 120) };
  if (mapa) cab['X-Mapa'] = encodeURIComponent(JSON.stringify(mapa));
  const r = await fetch(`/api${caminho}`, { method: 'POST', headers: cab, body: await arquivo.text(), credentials: 'same-origin' });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new ErroApi(r.status, d);
  return d;
}

const ORIGEM = { platform: 'Platform', omie: 'OMIE', pipedrive: 'Pipedrive' };
const LOTE = { aguardando_confirmacao: ['aguardando confirmação', 'alerta'], confirmado: ['aplicado no destino', 'ok'], falhou: ['falhou no destino', 'perigo'] };

export async function telaIntegracoes(el, ctx) {
  const p = await api.get('/integracoes');
  const recarregar = () => telaIntegracoes(el, ctx);

  const cartaoImport = (tipo, def) => {
    if (def.permissao && !ctx.pode(def.permissao)) return null; // ex.: migração do Pipedrive só pela gestão comercial
    const saida = h('div', { 'aria-live': 'polite' });
    const entrada = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': `Arquivo para ${def.nome}` });
    let mapaEscolhido = null;

    const formMapa = (arq, pr) => {
      const selects = Object.fromEntries(pr.campos.map((cp) => {
        const s = h('select', { 'aria-label': `Coluna do arquivo para ${cp}` },
          h('option', { value: '' }, pr.opcionais.includes(cp) ? '— o arquivo não tem (opcional)' : '— escolha a coluna'),
          pr.cabecalhos.map((c) => h('option', { value: c, selected: pr.sugestao[cp] === c }, `${c}${pr.amostra[0]?.[c] ? ` (ex.: ${String(pr.amostra[0][c]).slice(0, 30)})` : ''}`)));
        return [cp, s];
      }));
      return h('div', { class: 'mapa-csv' },
        h('p', { class: 'alerta' }, `As colunas deste arquivo têm outros nomes. Ligue cada campo do Sinapse a uma coluna do arquivo (faltavam: ${pr.faltam.join(', ')}). O mapa fica salvo para os próximos arquivos deste fluxo.`),
        h('div', { class: 'mapa-linhas' }, pr.campos.map((cp) => campo(`${cp}${pr.opcionais.includes(cp) ? ' (opcional)' : ''}`, selects[cp]))),
        h('div', { class: 'form-acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: () => {
          mapaEscolhido = Object.fromEntries(Object.entries(selects).map(([cp, s]) => [cp, s.value]).filter(([, v]) => v));
          conferir(arq);
        } }, 'Conferir com este mapa')));
    };

    async function conferir(arq) {
      trocar(saida, h('p', { class: 'carregando' }, 'Conferindo o arquivo…'));
      try {
        const pr = await enviarCsv(`/integracoes/csv/${tipo}/previa`, arq, mapaEscolhido);
        if (pr.precisaMapear) { trocar(saida, formMapa(arq, pr)); return; }
        trocar(saida,
          h('p', {}, selo(`${pr.validas} linha(s) válida(s)`, 'ok'), ' ', pr.erros.length ? selo(`${pr.erros.length} com erro`, 'perigo') : null, ` de ${pr.linhas} · separador "${pr.separador}"`,
            pr.mapa?.origem === 'salvo' ? h('span', { class: 'suave' }, ` · mapa de colunas salvo v${pr.mapa.versao}`) : null,
            pr.mapa?.origem === 'enviado' ? h('span', { class: 'suave' }, ' · mapa novo (será salvo ao aplicar)') : null),
          pr.jaImportadoEm ? h('p', { class: 'alerta' }, `Este mesmo arquivo já foi importado em ${dataHora(pr.jaImportadoEm)}.`) : null,
          pr.erros.length ? h('details', { open: pr.erros.length <= 5 }, h('summary', {}, 'Ver linhas com erro'), h('ul', { class: 'itens' }, pr.erros.map((e) => h('li', {}, h('strong', {}, `Linha ${e.linha}: `), e.erro)))) : null,
          pr.amostra.length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' }, h('thead', {}, h('tr', {}, pr.cabecalhos.map((c) => h('th', {}, c)))),
            h('tbody', {}, pr.amostra.map((l) => h('tr', {}, pr.cabecalhos.map((c) => h('td', {}, l[c]))))))) : null,
          h('div', { class: 'form-acoes' },
            pr.mapa?.origem !== 'nenhum' ? h('button', { class: 'btn btn-fantasma', type: 'button', onclick: () => {
              mapaEscolhido = {}; // mapa vazio: o servidor ignora o salvo e pede a ligação das colunas de novo
              conferir(arq);
            } }, 'Refazer o mapa de colunas') : null,
            pr.validas && !pr.jaImportadoEm ? h('button', { class: 'btn btn-primario', type: 'button', onclick: async (e) => {
              e.currentTarget.disabled = true;
              try {
                const a = await enviarCsv(`/integracoes/csv/${tipo}/aplicar`, arq, mapaEscolhido);
                aviso(`${a.aplicadas} linha(s) aplicada(s)${a.estado === 'parcial' ? ' · importação parcial' : ''}.`);
                trocar(saida, h('ul', { class: 'itens' }, a.resumo.map((x) => h('li', {}, x))), a.erros.length ? h('p', { class: 'suave' }, `${a.erros.length} linha(s) não entraram (veja o histórico).`) : null);
                setTimeout(recarregar, 1500);
              } catch (err) { aviso(textoErro(err), 'erro'); e.currentTarget.disabled = false; }
            } }, `Aplicar ${pr.validas} linha(s)`) : null));
      } catch (err) { trocar(saida, h('p', { class: 'alerta alerta-perigo' }, textoErro(err))); }
    }

    entrada.onchange = () => { const arq = entrada.files[0]; if (!arq) return; mapaEscolhido = null; conferir(arq); };
    entrada.className = 'arquivo-oculto';
    const escolher = h('label', { class: 'btn' }, 'Escolher arquivo CSV', entrada);
    return h('div', { class: 'cartao' }, h('div', { class: 'linha-topo' }, selo(ORIGEM[def.origem], 'info'), h('strong', {}, def.nome)),
      h('p', { class: 'suave integra-frescor' }, def.ultimoArquivoEm ? `Último arquivo ${relativo(def.ultimoArquivoEm)}` : 'Nenhum arquivo recebido ainda',
        def.mapaVersao ? ` · mapa de colunas v${def.mapaVersao}` : '', ` · layout ${def.layout}`),
      h('details', {}, h('summary', {}, 'Colunas esperadas'), h('code', { class: 'exemplo-csv' }, def.exemplo)), h('div', { class: 'acoes' }, escolher), saida);
  };

  const resolver = (l, resultado) => modal(resultado === 'confirmado' ? 'Confirmar aplicação no destino' : 'Registrar falha no destino', (fechar) => formulario([
    h('p', { class: 'suave' }, `${l.arquivo} · ${l.linhas} linha(s) para ${ORIGEM[l.destino]}.`),
    campo(resultado === 'confirmado' ? 'Evidência (quem importou, quando, quantas linhas entraram, rejeições)' : 'O que aconteceu no destino',
      h('textarea', { name: 'evidencia', rows: 3, required: true, minlength: 10, maxlength: 1000 })),
  ], resultado === 'confirmado' ? 'Confirmar' : 'Registrar falha', async (x) => {
    await api.post(`/integracoes/lotes/${l.id}/resolver`, { resultado, evidencia: x.evidencia }); fechar(); aviso('Lote atualizado.'); recarregar();
  }));

  const aguardando = p.lotes.filter((l) => l.estado === 'aguardando_confirmacao');
  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, 'Integrações')),
    h('p', { class: 'suave' }, 'Nesta fase a Platform e o OMIE conversam com o Sinapse por arquivos CSV: exporte de um lado, importe do outro. A extração e a importação no outro sistema ainda são manuais. Toda importação mostra uma prévia antes de gravar, e o mesmo arquivo nunca entra duas vezes. Aceita ";" (Excel) ou ",".'),
    aguardando.length ? h('p', { class: 'alerta' }, `${aguardando.length} arquivo(s) exportado(s) aguardando confirmação de que foram aplicados no destino${aguardando.some((l) => l.atrasado) ? ' (há lote com prazo vencido)' : ''}.`) : null,
    h('h2', {}, 'Importar'),
    h('div', { class: 'grade-2' }, Object.entries(p.importacoes).map(([k, d]) => cartaoImport(k, d))),
    h('h2', {}, 'Exportar'),
    h('div', { class: 'cartao' },
      h('p', { class: 'suave' }, 'Cada download gera um lote. Baixar não é aplicar: depois de importar no destino, confirme aqui com a evidência. Sem confirmação em 2 dias, a Supervisão recebe uma tarefa.'),
      h('ul', { class: 'itens' }, Object.entries(p.exportacoes).map(([k, d]) => h('li', {}, selo(ORIGEM[d.destino], 'info'), ' ', d.nome, ' ',
        h('a', { class: 'btn btn-pequeno', href: `/api/integracoes/exportar/${k}`, download: '', onclick: () => setTimeout(recarregar, 1500) }, 'Baixar CSV'))))),
    h('h2', {}, 'Lotes exportados'),
    p.lotes.length ? h('ul', { class: 'itens' }, p.lotes.map((l) => h('li', { class: 'linha-acao' },
      h('span', {}, selo(...LOTE[l.estado]), l.atrasado ? selo('prazo vencido', 'perigo') : null, ' ', h('strong', {}, l.arquivo), ` · ${l.linhas} linha(s) · ${dataHora(l.criado_em)} · ${l.por || '—'}`,
        l.evidencia ? h('div', { class: 'suave' }, `${l.resolvido_por_nome || ''}: ${l.evidencia}`) : null),
      l.estado === 'aguardando_confirmacao' ? h('span', { class: 'acoes' },
        h('button', { class: 'btn btn-pequeno btn-primario', type: 'button', onclick: () => resolver(l, 'confirmado') }, 'Confirmar'),
        h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: () => resolver(l, 'falhou') }, 'Falhou')) : null))) : vazio('Nenhum arquivo exportado ainda.'),
    h('h2', {}, 'Histórico de importações'),
    p.historico.length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {}, ['Quando', 'Tipo', 'Arquivo', 'Situação', 'Linhas', 'Aplicadas', 'Com erro', 'Mapa', 'Por'].map((x) => h('th', {}, x)))),
      h('tbody', {}, p.historico.map((x) => h('tr', {}, h('td', {}, dataHora(x.criado_em)), h('td', {}, x.tipo), h('td', {}, decodeURIComponent(x.arquivo)),
        h('td', {}, selo(x.estado === 'parcial' ? 'parcial' : 'completa', x.estado === 'parcial' ? 'alerta' : 'ok')), h('td', {}, String(x.linhas)),
        h('td', {}, String(x.aplicadas)), h('td', {}, String(x.com_erro)), h('td', {}, x.mapa_versao ? `v${x.mapa_versao}` : '—'), h('td', {}, x.por || '—')))))) : vazio('Nenhuma importação ainda.'));
}
