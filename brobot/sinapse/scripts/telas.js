'use strict';
// Conferência das telas em 360 px (celular primeiro, RNF-012): sobe o Sinapse em memória com a demonstração, entra
// com várias personas, abre cada item do menu e confere:
//   - sem rolagem lateral (a página cabe em 360 px);
//   - todo campo (input, select, textarea) tem nome acessível (rótulo, aria-label ou placeholder);
//   - todo botão e link tem nome;
//   - toda imagem tem alt; o documento declara lang="pt-BR";
//   - contraste do texto (WCAG AA): 4,5:1 no texto comum e 3:1 no texto grande (24 px, ou 18,66 px em negrito);
//   - ordem de foco: nenhum tabindex positivo e o foco do teclado sempre visível (contorno ou sombra);
//   - nenhum erro de JavaScript na página.
// Uso: `npm run telas` (precisa do Playwright e do Chromium instalados na máquina; não entra no CI de testes).
// Autoteste: `TELAS_AUTOTESTE=1 npm run telas` injeta um campo, um botão e uma imagem sem nome na primeira tela e
// precisa apontar os 3 problemas (prova de que a conferência não passa em branco); com contraste e foco, injeta também um
// texto cinza-claro sobre branco e um botão sem foco visível (5 problemas).

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
        if (process.env.TELAS_AUTOTESTE && vistas.size === 1) {
          await pagina.evaluate(() => {
            const m = document.querySelector('main'); const i = document.createElement('input'); const b = document.createElement('button'); const img = document.createElement('img');
            const p = document.createElement('p'); p.textContent = 'Texto sem contraste'; p.style.color = '#cccccc'; p.style.background = '#ffffff';
            const sf = document.createElement('a'); sf.href = '#/'; sf.textContent = 'Link sem foco'; sf.style.outline = 'none'; sf.style.boxShadow = 'none'; sf.dataset.semFoco = '1';
            const st = document.createElement('style'); st.textContent = '[data-sem-foco]:focus, [data-sem-foco]:focus-visible { outline: none !important; box-shadow: none !important; }';
            m.prepend(sf); m.append(i, b, img, p, st);
          });
        }
        const r = await pagina.evaluate(() => {
          const nome = (el) => (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.getAttribute('placeholder') || el.getAttribute('title')
            || (el.closest('label') && el.closest('label').textContent) || '').trim();
          const campos = [...document.querySelectorAll('main input:not([type=hidden]), main select, main textarea')].filter((el) => !nome(el))
            .map((el) => `${el.tagName.toLowerCase()}[name=${el.name || '?'}]`);
          const botoes = [...document.querySelectorAll('main button, main a[href]')].filter((el) => !(el.textContent.trim() || el.getAttribute('aria-label') || el.getAttribute('title')))
            .map((el) => el.outerHTML.slice(0, 80));
          const imagens = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.src.slice(-40));
          const examinados = document.querySelectorAll('main input:not([type=hidden]), main select, main textarea, main button, main a[href]').length;
          // Contraste: cor do texto contra o primeiro fundo opaco dos ancestrais (luminância relativa da WCAG 2.x).
          const rgb = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
          const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
          const fundo = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0.9) return c; } return { r: 255, g: 255, b: 255 }; };
          const contraste = [];
          const textos = [...document.querySelectorAll('main *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
            .filter((el) => el.offsetParent !== null && !el.closest('[hidden]'));
          for (const el of textos) {
            const st = getComputedStyle(el); const cor = rgb(st.color); if (!cor || cor.a < 0.5) continue;
            const f = fundo(el); const [l1, l2] = [lum(cor), lum(f)].sort((a, b) => b - a); const razao = (l1 + 0.05) / (l2 + 0.05);
            const px = parseFloat(st.fontSize); const grande = px >= 24 || (px >= 18.66 && Number(st.fontWeight) >= 700);
            if (razao < (grande ? 3 : 4.5)) contraste.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}" ${razao.toFixed(2)}:1`);
          }
          const tabindex = [...document.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0).map((e) => e.outerHTML.slice(0, 60));
          return { largura: document.documentElement.scrollWidth, lang: document.documentElement.lang, campos, botoes, imagens, examinados,
            erroTela: !!document.querySelector('main .cartao.erro'), contraste: [...new Set(contraste)].slice(0, 5), tabindex };
        });
        // Foco: percorre os primeiros elementos com Tab e confere que cada um mostra onde está o foco.
        const semFoco = [];
        await pagina.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
        for (let i = 0; i < 12; i++) {
          await pagina.keyboard.press('Tab');
          const f = await pagina.evaluate(() => {
            const e = document.activeElement; if (!e || e === document.body) return null;
            const st = getComputedStyle(e);
            const visivel = (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0) || (st.boxShadow && st.boxShadow !== 'none');
            return visivel ? null : (e.outerHTML || '').slice(0, 70);
          });
          if (f) semFoco.push(f);
        }
        const onde = `${modelo} (${persona})`;
        totalExaminados += r.examinados;
        if (r.largura > 360) problemas.push(`${onde}: rolagem lateral (${r.largura}px)`);
        if (r.lang !== 'pt-BR') problemas.push(`${onde}: lang="${r.lang}"`);
        if (r.erroTela) problemas.push(`${onde}: a tela abriu com erro`);
        for (const c of r.campos) problemas.push(`${onde}: campo sem rótulo ${c}`);
        for (const b of r.botoes) problemas.push(`${onde}: botão/link sem nome ${b}`);
        for (const i of r.imagens) problemas.push(`${onde}: imagem sem alt ${i}`);
        for (const c of r.contraste) problemas.push(`${onde}: contraste baixo ${c}`);
        for (const x of r.tabindex) problemas.push(`${onde}: tabindex positivo muda a ordem de foco ${x}`);
        for (const x of [...new Set(semFoco)].slice(0, 3)) problemas.push(`${onde}: foco do teclado invisível em ${x}`);
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
