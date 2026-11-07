'use strict';
// Teste de carga (RNF-003: P95 das telas operacionais até 2 s em carga nominal). Sobe o Sinapse em memória com a
// demonstração completa, entra com várias pessoas e dispara, em paralelo, as chamadas que abrem as telas do dia a dia
// (Meu dia, painel, ocorrências, quadro, rodadas, carteira, comercial, dashboards). Mede o tempo de cada resposta e
// mostra P50/P95/máximo por tela. Sai com erro se alguma tela passar do limite ou responder com erro.
// Uso: `npm run carga` (padrão: 20 usuários simultâneos por 20 s; CARGA_USUARIOS, CARGA_SEGUNDOS e CARGA_P95_MS mudam).
// O número vale para esta máquina e o banco embutido; em produção, repita apontando para o ambiente dimensionado.

const { carregarConfig } = require('../server/config');
const { criarApp } = require('../server/app');

const USUARIOS = Number(process.env.CARGA_USUARIOS || 20);
const SEGUNDOS = Number(process.env.CARGA_SEGUNDOS || 20);
const LIMITE_P95 = Number(process.env.CARGA_P95_MS || 2000);
const PERSONAS = ['Marina Costa', 'Rafael Lima', 'Bianca Rocha', 'Juliana Alves', 'Pedro Santos', 'Patrícia Gomes', 'Diego Araújo', 'Lucas Ferreira'];
const TELAS = [
  ['Meu dia', '/api/meu-dia'], ['Painel', '/api/painel'], ['Ocorrências', '/api/ocorrencias'], ['Quadro', '/api/ocorrencias/quadro'],
  ['Rodadas', '/api/rodadas'], ['Carteira', '/api/contas'], ['Comercial', '/api/comercial/oportunidades'], ['Avisos', '/api/notificacoes'],
  ['Dashboard operação', '/api/dashboards/operacao'], ['Busca por placa', '/api/ocorrencias?estado=todas&q=RSU-2B34'],
];

const percentil = (v, p) => { if (!v.length) return 0; const o = [...v].sort((a, b) => a - b); return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)]; };

async function main() {
  const cfg = carregarConfig({ SINAPSE_DATA: ':memoria:', SINAPSE_DEMO: '1' });
  const app = await criarApp(cfg, { log: () => {} });
  const base = `http://127.0.0.1:${await app.iniciar(0)}`;
  const personas = (await (await fetch(`${base}/api/demo/personas`)).json()).personas;
  const cookies = [];
  for (const nome of PERSONAS) {
    const p = personas.find((x) => x.nome === nome);
    const r = await fetch(`${base}/api/sessao/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usuarioId: p.id }) });
    cookies.push(r.headers.get('set-cookie').split(';')[0]);
  }
  const tempos = Object.fromEntries(TELAS.map(([n]) => [n, []]));
  const erros = {};
  const fim = Date.now() + SEGUNDOS * 1000;
  let total = 0;
  const usuario = async (i) => {
    const cookie = cookies[i % cookies.length];
    let k = i;
    while (Date.now() < fim) {
      const [nome, url] = TELAS[k++ % TELAS.length];
      const t0 = performance.now();
      try {
        const r = await fetch(base + url, { headers: { cookie } });
        await r.arrayBuffer();
        // 403 é esperado quando o perfil não vê aquela tela: conta o tempo, não é erro.
        if (r.status >= 500 || r.status === 401) erros[nome] = (erros[nome] || 0) + 1;
      } catch { erros[nome] = (erros[nome] || 0) + 1; }
      tempos[nome].push(performance.now() - t0);
      total++;
    }
  };
  console.log(`Carga: ${USUARIOS} usuários simultâneos por ${SEGUNDOS} s (limite P95 ${LIMITE_P95} ms)…`);
  await Promise.all(Array.from({ length: USUARIOS }, (_, i) => usuario(i)));
  await app.parar();
  let falhou = false;
  console.log(`\n${'Tela'.padEnd(22)}${'pedidos'.padStart(8)}${'P50 ms'.padStart(9)}${'P95 ms'.padStart(9)}${'máx ms'.padStart(9)}  erros`);
  for (const [nome] of TELAS) {
    const v = tempos[nome];
    const p95 = percentil(v, 95);
    if (p95 > LIMITE_P95 || erros[nome]) falhou = true;
    console.log(`${nome.padEnd(22)}${String(v.length).padStart(8)}${percentil(v, 50).toFixed(0).padStart(9)}${p95.toFixed(0).padStart(9)}${Math.max(...v).toFixed(0).padStart(9)}  ${erros[nome] || 0}`);
  }
  console.log(`\n${total} pedidos em ${SEGUNDOS} s (${(total / SEGUNDOS).toFixed(1)}/s). ${falhou ? 'ACIMA DO LIMITE ou com erro.' : 'Todas as telas dentro do limite.'}`);
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
