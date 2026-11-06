'use strict';
// Métricas do processo (SUP-009, RNF-011, RNF-003/004): contadores e histograma de tempo das requisições, por modelo de
// rota (`/api/ocorrencias/:id`, nunca o endereço com id — o número de séries não cresce com os dados) e classe de status.
// Ficam em memória (zeram ao reiniciar, como todo contador do Prometheus); o formato é o texto do Prometheus 0.0.4.
// Nenhum dado de cliente, usuário ou organização entra nos rótulos.

const LIMITES_MS = [50, 100, 250, 500, 1000, 2000, 5000];

function criarMetricas() {
  const series = new Map(); // chave "metodo rota classe" → { n, somaMs, buckets[] }
  const inicio = Date.now();

  function registrar({ metodo, rota, status, ms }) {
    const classe = `${String(status)[0]}xx`;
    const k = `${metodo} ${rota} ${classe}`;
    let s = series.get(k);
    if (!s) {
      if (series.size > 2000) return; // proteção: rotas são finitas; isto nunca deve acontecer
      s = { metodo, rota, classe, n: 0, somaMs: 0, buckets: LIMITES_MS.map(() => 0) };
      series.set(k, s);
    }
    s.n++; s.somaMs += ms;
    LIMITES_MS.forEach((l, i) => { if (ms <= l) s.buckets[i]++; });
  }

  const rotulo = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

  /** Texto do Prometheus. `extras`: [{ nome, ajuda, tipo, valores: [{ rotulos, valor }] }]. */
  function exportar(extras = []) {
    const l = [];
    l.push('# HELP sinapse_requisicoes_total Requisições à API por rota e classe de status.', '# TYPE sinapse_requisicoes_total counter');
    for (const s of series.values()) l.push(`sinapse_requisicoes_total{metodo="${s.metodo}",rota="${rotulo(s.rota)}",status="${s.classe}"} ${s.n}`);
    l.push('# HELP sinapse_requisicao_ms Tempo de resposta da API em milissegundos.', '# TYPE sinapse_requisicao_ms histogram');
    for (const s of series.values()) {
      const base = `metodo="${s.metodo}",rota="${rotulo(s.rota)}",status="${s.classe}"`;
      LIMITES_MS.forEach((lim, i) => l.push(`sinapse_requisicao_ms_bucket{${base},le="${lim}"} ${s.buckets[i]}`));
      l.push(`sinapse_requisicao_ms_bucket{${base},le="+Inf"} ${s.n}`, `sinapse_requisicao_ms_sum{${base}} ${s.somaMs}`, `sinapse_requisicao_ms_count{${base}} ${s.n}`);
    }
    l.push('# HELP sinapse_processo_segundos Tempo desde que o processo subiu.', '# TYPE sinapse_processo_segundos gauge', `sinapse_processo_segundos ${Math.round((Date.now() - inicio) / 1000)}`);
    for (const m of extras) {
      l.push(`# HELP ${m.nome} ${m.ajuda}`, `# TYPE ${m.nome} ${m.tipo || 'gauge'}`);
      for (const v of m.valores) {
        const r = Object.entries(v.rotulos || {}).map(([k, x]) => `${k}="${rotulo(x)}"`).join(',');
        l.push(`${m.nome}${r ? `{${r}}` : ''} ${Number(v.valor) || 0}`);
      }
    }
    return `${l.join('\n')}\n`;
  }

  return { registrar, exportar };
}

module.exports = { criarMetricas, LIMITES_MS };
