'use strict';
// Conferência das telas em 360 px (celular primeiro, RNF-012): sobe o Sinapse em memória com a demonstração, entra
// com várias personas, abre cada item do menu e confere:
//   - sem rolagem lateral (a página cabe em 360 px);
//   - todo campo (input, select, textarea) tem nome acessível (rótulo, aria-label ou placeholder);
//   - todo botão e link tem nome;
//   - toda imagem tem alt; o documento declara lang="pt-BR";
//   - nenhum erro de JavaScript na página.
// Uso: `npm run telas` (precisa do Playwright e do Chromium instalados na máquina; não entra no CI de testes).
// Autoteste: `TELAS_AUTOTESTE=1 npm run telas` injeta um campo, um botão e uma imagem sem nome na primeira tela e
// precisa apontar os 3 problemas (prova de que a conferência não passa em branco).

const { carregarConfig } = require('../server/config');
const { criarApp } = require('../server/app');

const PERSONAS = ['Marina Costa', 'Rafael Lima', 'Juliana Alves', 'Pedro Santos', 'Patrícia Gomes', 'Carla Mendes', 'Lucas Ferreira', 'Administração Sinapse'];

async function main() {
  let playwright;
  try { playwright = require('playwright'); } catch {
    console.error('Playwright não encontrado. Instale (npm i -D playwright && npx playwright install chromium) e rode de novo.');
    process.exit(2);
  }
  const cfg = carregarConfig({ SINAPSE_DATA: ':memoria:', SINAPSE_DEMO: '1', SINAPSE_WORKER: '0' });
  const app = await criarApp(cfg, { log: () => {} });
  const porta = await app.iniciar(0);
  const base = `http://127.0.0.1:${porta}`;
  const navegador = await playwright.chromium.launch();
  const problemas = [];
  const vistas = new Set();
  let totalExaminados = 0;
  try {
    for (const persona of PERSONAS) {
      const pagina = await (await navegador.newContext({ viewport: { width: 360, height: 800 } })).newPage();
      const erros = [];
      pagina.on('pageerror', (e) => erros.push(e.message));
      await pagina.goto(base);
      await pagina.waitForSelector('.persona');
      await pagina.click(`.persona:has-text("${persona}")`);
      await pagina.waitForSelector('main#conteudo');
      const rotas = await pagina.$$eval('nav.menu a', (as) => as.map((a) => a.getAttribute('href')));
      // Telas de detalhe (não estão no menu): a primeira conta e a primeira ocorrência que a persona vê.
      const detalhes = await pagina.evaluate(async () => {
        const pegar = async (u) => { try { const r = await fetch(u); return r.ok ? r.json() : null; } catch { return null; } };
        const contas = await pegar('/api/contas'); const ocs = await pegar('/api/ocorrencias');
        return [contas?.itens?.[0] && `#/contas/${contas.itens[0].id}`, ocs?.itens?.[0] && `#/ocorrencias/${ocs.itens[0].id}`].filter(Boolean);
      });
      rotas.push(...detalhes);
      for (const rota of rotas) {
        const modelo = rota.replace(/\/[0-9a-f-]{36}$/, '/:id');
        if (vistas.has(modelo)) continue; // cada tela uma vez (a primeira persona que a vê)
        vistas.add(modelo);
        erros.length = 0;
        await pagina.goto(`${base}/${rota}`);
        await pagina.waitForTimeout(600);
        if (process.env.TELAS_AUTOTESTE && vistas.size === 1) await pagina.evaluate(() => { const m = document.querySelector('main'); const i = document.createElement('input'); const b = document.createElement('button'); const img = document.createElement('img'); m.append(i, b, img); });
        const r = await pagina.evaluate(() => {
          const nome = (el) => (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.getAttribute('placeholder') || el.getAttribute('title')
            || (el.closest('label') && el.closest('label').textContent) || '').trim();
          const campos = [...document.querySelectorAll('main input:not([type=hidden]), main select, main textarea')].filter((el) => !nome(el))
            .map((el) => `${el.tagName.toLowerCase()}[name=${el.name || '?'}]`);
          const botoes = [...document.querySelectorAll('main button, main a[href]')].filter((el) => !(el.textContent.trim() || el.getAttribute('aria-label') || el.getAttribute('title')))
            .map((el) => el.outerHTML.slice(0, 80));
          const imagens = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.src.slice(-40));
          const examinados = document.querySelectorAll('main input:not([type=hidden]), main select, main textarea, main button, main a[href]').length;
          return { largura: document.documentElement.scrollWidth, lang: document.documentElement.lang, campos, botoes, imagens, examinados,
            erroTela: !!document.querySelector('main .cartao.erro') };
        });
        const onde = `${modelo} (${persona})`;
        totalExaminados += r.examinados;
        if (r.largura > 360) problemas.push(`${onde}: rolagem lateral (${r.largura}px)`);
        if (r.lang !== 'pt-BR') problemas.push(`${onde}: lang="${r.lang}"`);
        if (r.erroTela) problemas.push(`${onde}: a tela abriu com erro`);
        for (const c of r.campos) problemas.push(`${onde}: campo sem rótulo ${c}`);
        for (const b of r.botoes) problemas.push(`${onde}: botão/link sem nome ${b}`);
        for (const i of r.imagens) problemas.push(`${onde}: imagem sem alt ${i}`);
        for (const e of erros) problemas.push(`${onde}: erro de JavaScript: ${e}`);
      }
      await pagina.context().close();
    }
  } finally {
    await navegador.close();
    await app.parar();
  }
  console.log(`Telas conferidas em 360 px: ${vistas.size} (${totalExaminados} campos, botões e links examinados)`);
  if (problemas.length) {
    console.log(`Problemas (${problemas.length}):\n- ${problemas.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Nenhum problema encontrado.');
}

main().catch((e) => { console.error(e); process.exit(1); });
