// Integrações por CSV com a Platform e o OMIE: importar (com prévia) e exportar.
import { h, trocar, dataHora, selo, aviso, vazio } from '../dom.js';
import { api, ErroApi, textoErro } from '../api.js';

async function enviarCsv(caminho, arquivo) {
  const r = await fetch(`/api${caminho}`, { method: 'POST', headers: { 'Content-Type': 'text/csv', 'X-Arquivo': encodeURIComponent(arquivo.name).slice(0, 120) },
    body: await arquivo.text(), credentials: 'same-origin' });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new ErroApi(r.status, d);
  return d;
}

const ORIGEM = { platform: 'Platform', omie: 'OMIE' };

export async function telaIntegracoes(el, ctx) {
  const p = await api.get('/integracoes');
  const recarregar = () => telaIntegracoes(el, ctx);

  const cartaoImport = (tipo, def) => {
    const saida = h('div', {});
    const entrada = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': `Arquivo para ${def.nome}` });
    entrada.onchange = async () => {
      const arq = entrada.files[0]; if (!arq) return;
      trocar(saida, h('p', { class: 'carregando' }, 'Conferindo o arquivo…'));
      try {
        const pr = await enviarCsv(`/integracoes/csv/${tipo}/previa`, arq);
        trocar(saida,
          h('p', {}, selo(`${pr.validas} linha(s) válida(s)`, 'ok'), ' ', pr.erros.length ? selo(`${pr.erros.length} com erro`, 'perigo') : null, ` de ${pr.linhas} · separador "${pr.separador}"`),
          pr.jaImportadoEm ? h('p', { class: 'alerta' }, `Este mesmo arquivo já foi importado em ${dataHora(pr.jaImportadoEm)}.`) : null,
          pr.erros.length ? h('details', { open: pr.erros.length <= 5 }, h('summary', {}, 'Ver linhas com erro'), h('ul', { class: 'itens' }, pr.erros.map((e) => h('li', {}, h('strong', {}, `Linha ${e.linha}: `), e.erro)))) : null,
          pr.amostra.length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' }, h('thead', {}, h('tr', {}, pr.cabecalhos.map((c) => h('th', {}, c)))),
            h('tbody', {}, pr.amostra.map((l) => h('tr', {}, pr.cabecalhos.map((c) => h('td', {}, l[c]))))))) : null,
          pr.validas && !pr.jaImportadoEm ? h('div', { class: 'form-acoes' }, h('button', { class: 'btn btn-primario', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const a = await enviarCsv(`/integracoes/csv/${tipo}/aplicar`, arq);
              aviso(`${a.aplicadas} linha(s) aplicada(s).`);
              trocar(saida, h('ul', { class: 'itens' }, a.resumo.map((x) => h('li', {}, x))), a.erros.length ? h('p', { class: 'suave' }, `${a.erros.length} linha(s) não entraram (veja o histórico).`) : null);
              setTimeout(recarregar, 1500);
            } catch (err) { aviso(textoErro(err), 'erro'); e.currentTarget.disabled = false; }
          } }, `Aplicar ${pr.validas} linha(s)`)) : null);
      } catch (err) { trocar(saida, h('p', { class: 'alerta alerta-perigo' }, textoErro(err))); }
    };
    entrada.className = 'arquivo-oculto';
    const escolher = h('label', { class: 'btn' }, 'Escolher arquivo CSV', entrada);
    return h('div', { class: 'cartao' }, h('div', { class: 'linha-topo' }, selo(ORIGEM[def.origem], 'info'), h('strong', {}, def.nome)),
      h('details', {}, h('summary', {}, 'Colunas esperadas'), h('code', { class: 'exemplo-csv' }, def.exemplo)), h('div', { class: 'acoes' }, escolher), saida);
  };

  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, 'Integrações')),
    h('p', { class: 'suave' }, 'Nesta fase a Platform e o OMIE conversam com o Sinapse por arquivos CSV: exporte de um lado, importe do outro. Toda importação mostra uma prévia antes de gravar, e o mesmo arquivo nunca entra duas vezes. Aceita ";" (Excel) ou ",".'),
    h('h2', {}, 'Importar'),
    h('div', { class: 'grade-2' }, Object.entries(p.importacoes).map(([k, d]) => cartaoImport(k, d))),
    h('h2', {}, 'Exportar'),
    h('div', { class: 'cartao' }, h('ul', { class: 'itens' }, Object.entries(p.exportacoes).map(([k, d]) => h('li', {}, selo(ORIGEM[d.destino], 'info'), ' ', d.nome, ' ',
      h('a', { class: 'btn btn-pequeno', href: `/api/integracoes/exportar/${k}`, download: '' }, 'Baixar CSV'))))),
    h('h2', {}, 'Histórico de importações'),
    p.historico.length ? h('div', { class: 'tabela-rolagem' }, h('table', { class: 'tabela' },
      h('thead', {}, h('tr', {}, ['Quando', 'Tipo', 'Arquivo', 'Linhas', 'Aplicadas', 'Com erro', 'Por'].map((x) => h('th', {}, x)))),
      h('tbody', {}, p.historico.map((x) => h('tr', {}, h('td', {}, dataHora(x.criado_em)), h('td', {}, x.tipo), h('td', {}, decodeURIComponent(x.arquivo)), h('td', {}, String(x.linhas)),
        h('td', {}, String(x.aplicadas)), h('td', {}, String(x.com_erro)), h('td', {}, x.por || '—')))))) : vazio('Nenhuma importação ainda.'));
}
