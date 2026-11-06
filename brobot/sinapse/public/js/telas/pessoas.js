// Pessoas e equipes (Administração): cadastrar com senha temporária (mostrada uma vez), mudar perfil, equipe e
// substituto, marcar ausência, desativar (nada se apaga) e redefinir a senha. Lista paginada com busca.
import { h, trocar, selo, campo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api } from '../api.js';
import { formulario } from './ocorrencias.js';

const motivo = (rotulo = 'Motivo') => campo(rotulo, h('input', { name: 'motivo', required: true, minlength: 5, maxlength: 300 }));

function mostrarSenha(titulo, nome, senha) {
  modal(titulo, () => h('div', {},
    h('p', {}, `Senha temporária de ${nome}:`),
    h('p', { class: 'senha-temporaria' }, h('code', {}, senha)),
    h('p', { class: 'alerta' }, 'Ela aparece só agora. Entregue pessoalmente ou por um canal seguro; no primeiro acesso a pessoa cria a própria senha.')));
}

export async function telaPessoas(el, ctx) {
  const q = ctx.query?.get('q') || '';
  const pagina = Number(ctx.query?.get('pagina')) || 1;
  const inativos = ctx.query?.get('inativos') === '1';
  const r = await api.get(`/pessoas?${new URLSearchParams({ q, pagina, ...(inativos ? { inativos: '1' } : {}) })}`);
  const recarregar = () => telaPessoas(el, ctx);
  const ir = (extra) => { location.hash = `#/pessoas?${new URLSearchParams({ q, pagina, ...(inativos ? { inativos: '1' } : {}), ...extra })}`; };
  const equipes = Object.fromEntries(r.equipes.map((e) => [e.id, e.nome]));
  const ativos = Object.fromEntries((ctx.equipes?.usuarios || []).map((u) => [u.id, u.nome]));

  const nova = () => modal('Cadastrar pessoa', (fechar) => formulario([
    campo('Nome', h('input', { name: 'nome', required: true, minlength: 3, maxlength: 120 })),
    campo('E-mail', h('input', { name: 'email', type: 'email', required: true, maxlength: 200 })),
    campo('Perfil', opcoes(h('select', { name: 'papel', required: true }), r.papeis), 'O perfil define o que a pessoa pode fazer.'),
    campo('Equipe', opcoes(h('select', { name: 'equipeId', required: true }), equipes)),
  ], 'Cadastrar', async (d) => {
    const x = await api.post('/pessoas', d); fechar(); recarregar(); mostrarSenha('Pessoa cadastrada', x.usuario.nome, x.senhaTemporaria);
  }));

  const editar = (p) => modal(`Editar · ${p.nome}`, (fechar) => {
    const disp = h('input', { type: 'checkbox', name: 'disponivel' }); disp.checked = p.disponivel;
    const papel = opcoes(h('select', { name: 'papel' }), r.papeis); papel.value = p.papel;
    const equipe = opcoes(h('select', { name: 'equipeId' }), equipes); equipe.value = p.equipe_id;
    const sub = opcoes(h('select', { name: 'substitutoId' }), Object.fromEntries(Object.entries(ativos).filter(([id]) => id !== p.id)), 'Sem substituto');
    sub.value = p.substituto_id || '';
    return formulario([campo('Nome', h('input', { name: 'nome', value: p.nome, required: true, minlength: 3, maxlength: 120 })),
      campo('Perfil', papel, 'Trocar o perfil encerra as sessões abertas da pessoa.'), campo('Equipe', equipe),
      campo('Substituto (quando ausente)', sub), h('label', { class: 'check' }, disp, 'Disponível para receber atendimentos'),
      campo('Motivo (opcional)', h('input', { name: 'motivo', maxlength: 300 }))], 'Salvar', async (d) => {
      const x = await api.post(`/pessoas/${p.id}`, { ...d, substitutoId: d.substitutoId || null });
      fechar(); aviso(x.alterado ? 'Cadastro atualizado.' : 'Nada mudou.'); recarregar();
    });
  });

  const agir = (p, acao, titulo, texto) => modal(titulo, (fechar) => formulario([h('p', {}, texto), motivo()], titulo, async (d) => {
    const x = await api.post(`/pessoas/${p.id}/${acao}`, d); fechar(); recarregar();
    if (x.senhaTemporaria) mostrarSenha('Senha redefinida', p.nome, x.senhaTemporaria); else aviso('Feito.');
  }));

  const novaEquipe = () => modal('Nova equipe', (fechar) => formulario([
    campo('Nome', h('input', { name: 'nome', required: true, minlength: 2, maxlength: 60 })),
    campo('Código', h('input', { name: 'codigo', required: true, pattern: '[a-z_]{2,30}', maxlength: 30, placeholder: 'ex.: implantacao' }), 'Só letras minúsculas e "_". Não muda depois.'),
  ], 'Criar equipe', async (d) => { await api.post('/equipes', d); fechar(); aviso('Equipe criada.'); recarregar(); }));

  const busca = h('input', { type: 'search', name: 'q', value: q, placeholder: 'Nome ou e-mail', 'aria-label': 'Buscar pessoa' });
  const mostrarInativos = h('input', { type: 'checkbox' }); mostrarInativos.checked = inativos;
  mostrarInativos.addEventListener('change', () => { location.hash = `#/pessoas?${new URLSearchParams({ q, ...(mostrarInativos.checked ? { inativos: '1' } : {}) })}`; });

  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, 'Pessoas e equipes'),
      h('span', { class: 'acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: nova }, 'Cadastrar pessoa'),
        h('button', { class: 'btn', type: 'button', onclick: novaEquipe }, 'Nova equipe'))),
    h('form', { class: 'filtros', onsubmit: (e) => { e.preventDefault(); ir({ q: busca.value.trim(), pagina: 1 }); } }, busca,
      h('button', { class: 'btn', type: 'submit' }, 'Buscar'), h('label', { class: 'check' }, mostrarInativos, 'Mostrar desativadas')),
    r.itens.length ? h('div', { class: 'lista' }, r.itens.map((p) => h('div', { class: 'linha' },
      h('div', { class: 'linha-topo' }, h('strong', {}, p.nome), selo(r.papeis[p.papel] || p.papel, 'info'),
        !p.ativo ? selo('desativada', 'neutro') : !p.disponivel ? selo('ausente', 'alerta') : null,
        p.senha_trocar ? selo('senha temporária', 'alerta') : null, p.mfa_ativo ? selo('2 etapas', 'ok') : null),
      h('div', { class: 'linha-meta' }, h('span', {}, p.email), h('span', {}, p.equipe_nome), p.substituto_nome ? h('span', {}, `substituto: ${p.substituto_nome}`) : null),
      h('div', { class: 'acoes' },
        p.ativo ? h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => editar(p) }, 'Editar') : null,
        p.ativo && p.id !== ctx.usuario.id ? h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => agir(p, 'senha', 'Redefinir senha', `Uma senha temporária nova será gerada para ${p.nome}; a atual e as sessões abertas deixam de valer.`) }, 'Redefinir senha') : null,
        p.ativo && p.id !== ctx.usuario.id ? h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: () => agir(p, 'desativar', 'Desativar', `${p.nome} deixa de entrar no Sinapse; o histórico fica. O que estiver com a pessoa volta para o substituto ou para a fila.`) }, 'Desativar') : null,
        !p.ativo ? h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => agir(p, 'reativar', 'Reativar', `${p.nome} volta a entrar com a senha que tinha.`) }, 'Reativar') : null)))) : vazio('Ninguém encontrado.'),
    r.paginas > 1 ? h('div', { class: 'paginacao' },
      pagina > 1 ? h('button', { class: 'btn', type: 'button', onclick: () => ir({ pagina: pagina - 1 }) }, '← Anteriores') : null,
      h('span', {}, `Página ${pagina} de ${r.paginas}`),
      pagina < r.paginas ? h('button', { class: 'btn', type: 'button', onclick: () => ir({ pagina: pagina + 1 }) }, 'Próximas →') : null) : null);
}
