import { h, trocar, aviso } from '../dom.js';
import { api, textoErro } from '../api.js';

export async function telaLogin(raiz, { demo, aoEntrar }) {
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const senha = h('input', { type: 'password', name: 'senha', autocomplete: 'current-password', required: true });
  const form = h('form', { class: 'login-form', onsubmit: async (e) => {
    e.preventDefault();
    try { aoEntrar((await api.post('/sessao/entrar', { email: email.value, senha: senha.value })).usuario); } catch (err) { aviso(textoErro(err), 'erro'); }
  } },
  h('label', { class: 'campo' }, h('span', { class: 'campo-rotulo' }, 'E-mail'), email),
  h('label', { class: 'campo' }, h('span', { class: 'campo-rotulo' }, 'Senha'), senha),
  h('button', { class: 'btn btn-primario', type: 'submit' }, 'Entrar'));

  const personas = h('div', { class: 'personas' });
  trocar(raiz, h('div', { class: 'login' },
    h('div', { class: 'login-marca' }, h('img', { src: '/icon.svg', alt: '', width: 56, height: 56 }),
      h('h1', {}, 'Sinapse'), h('p', {}, 'ERP Operacional da Brobot: Operações, Suporte e Customer Success num só fluxo, auditável de ponta a ponta.')),
    h('div', { class: 'cartao login-cartao' },
      demo ? [h('h2', {}, 'Demonstração: entre como'), h('p', { class: 'suave' }, 'Escolha uma pessoa fictícia para ver o sistema pelo perfil dela.'), personas,
        h('details', {}, h('summary', {}, 'Entrar com e-mail e senha'), form)] : [h('h2', {}, 'Entrar'), form])));

  if (!demo) return;
  try {
    const { personas: lista } = await api.get('/demo/personas');
    const porOrg = {};
    for (const p of lista) (porOrg[p.tenant_nome] ||= []).push(p);
    for (const [org, ps] of Object.entries(porOrg)) {
      personas.append(h('h3', {}, org), h('div', { class: 'personas-grade' }, ps.map((p) => h('button', {
        class: 'persona', type: 'button',
        onclick: async () => {
          try { aoEntrar((await api.post('/sessao/demo', { usuarioId: p.id })).usuario); } catch (err) { aviso(textoErro(err), 'erro'); }
        },
      }, h('strong', {}, p.nome), h('span', {}, p.papelNome === p.equipe_nome ? p.papelNome : `${p.papelNome} · ${p.equipe_nome}`)))));
    }
  } catch (err) { aviso(textoErro(err), 'erro'); }
}
