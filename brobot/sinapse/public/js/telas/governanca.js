// Governança: matriz RACI com quem responde agora em cada processo, delegações temporárias e escala de plantão.
// Qualquer pessoa delega o que é dela (férias, curso, consulta); a gestão monta a matriz e a escala.
import { h, trocar, dataHora, selo, campo, opcoes, aviso, modal, vazio } from '../dom.js';
import { api } from '../api.js';
import { formulario } from './ocorrencias.js';

const POR = { delegacao: 'delegação', substituto: 'substituto', plantao: 'plantão', fila: 'fila da equipe' };
const local = (ms) => { const d = new Date(Date.now() + ms); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export async function telaGovernanca(el, ctx) {
  const [g, eq] = await Promise.all([api.get('/governanca'), api.get('/equipes')]);
  const recarregar = () => telaGovernanca(el, ctx);
  const pessoas = Object.fromEntries(eq.usuarios.map((u) => [u.id, `${u.nome} · ${u.equipe_nome}`]));
  const equipes = Object.fromEntries(eq.equipes.map((e) => [e.id, e.nome]));

  const delegar = () => modal('Delegar o que chega para mim', (fechar) => formulario([
    g.podeGerir ? campo('Quem vai ficar fora', opcoes(h('select', { name: 'deId' }), pessoas, 'Eu mesmo(a)')) : null,
    campo('Quem recebe', opcoes(h('select', { name: 'paraId', required: true }), Object.fromEntries(Object.entries(pessoas).filter(([id]) => id !== ctx.usuario.id || g.podeGerir)), 'Escolha')),
    campo('Começa em', h('input', { name: 'inicio', type: 'datetime-local', value: local(0) })),
    campo('Termina em', h('input', { name: 'fim', type: 'datetime-local', required: true, value: local(7 * 864e5) }), 'No máximo 90 dias. Ao terminar, volta sozinho.'),
    campo('Motivo', h('input', { name: 'motivo', required: true, minlength: 5, maxlength: 300, placeholder: 'ex.: férias, curso, consulta' })),
    h('p', { class: 'suave' }, 'O que estiver com você e o que chegar no período vai para quem recebe. Fica na auditoria.'),
  ], 'Delegar', async (d) => { await api.post('/delegacoes', d); fechar(); aviso('Delegação criada.'); recarregar(); }));

  const revogar = (x) => modal('Revogar a delegação', (fechar) => formulario([
    h('p', {}, `${x.de_nome} → ${x.para_nome}, até ${dataHora(x.fim)}.`),
    campo('Motivo', h('input', { name: 'motivo', maxlength: 300, placeholder: 'ex.: voltou antes' })),
  ], 'Revogar', async (d) => { await api.post(`/delegacoes/${x.id}/revogar`, d); fechar(); aviso('Delegação revogada.'); recarregar(); }));

  const novaLinha = (processo) => modal(`Matriz · ${g.processosNomes[processo]}`, (fechar) => {
    const tipo = h('select', { name: 'tipo' }, h('option', { value: 'equipe' }, 'Equipe'), h('option', { value: 'pessoa' }, 'Pessoa'));
    const equipe = campo('Equipe', opcoes(h('select', { name: 'equipeId' }), equipes));
    const pessoa = campo('Pessoa', opcoes(h('select', { name: 'usuarioId' }), pessoas));
    const alternar = () => { equipe.style.display = tipo.value === 'equipe' ? '' : 'none'; pessoa.style.display = tipo.value === 'pessoa' ? '' : 'none'; };
    tipo.addEventListener('change', alternar); alternar();
    return formulario([campo('Papel', opcoes(h('select', { name: 'papel', required: true }), g.papeis)), campo('Quem', tipo), equipe, pessoa,
      h('p', { class: 'suave' }, 'Um só aprovador (A) por processo: escolher outro substitui o atual.')], 'Incluir', async (d) => {
      const corpo = { processo, papel: d.papel, ...(d.tipo === 'pessoa' ? { usuarioId: d.usuarioId } : { equipeId: d.equipeId }) };
      await api.post('/raci', corpo); fechar(); aviso('Matriz atualizada.'); recarregar();
    });
  });

  const plantao = () => modal('Novo plantão', (fechar) => formulario([
    campo('Equipe', opcoes(h('select', { name: 'equipeId', required: true }), equipes)),
    campo('Quem fica de plantão', opcoes(h('select', { name: 'usuarioId', required: true }), pessoas)),
    campo('Início', h('input', { name: 'inicio', type: 'datetime-local', required: true, value: local(0) })),
    campo('Fim', h('input', { name: 'fim', type: 'datetime-local', required: true, value: local(864e5) }), 'Até 7 dias por plantão. No período, ocorrência nova da equipe já nasce com o plantonista.'),
  ], 'Criar plantão', async (d) => { await api.post('/plantoes', d); fechar(); aviso('Plantão criado.'); recarregar(); }));

  const cancelarPlantao = (p) => modal('Cancelar o plantão', (fechar) => formulario([
    h('p', {}, `${p.equipe_nome}: ${p.usuario_nome}, ${dataHora(p.inicio)} a ${dataHora(p.fim)}.`),
    campo('Motivo', h('input', { name: 'motivo', required: true, minlength: 5, maxlength: 300 })),
  ], 'Cancelar plantão', async (d) => { await api.post(`/plantoes/${p.id}/cancelar`, d); fechar(); aviso('Plantão cancelado.'); recarregar(); }));

  const vigente = (l) => (l.vigente ? h('span', { class: 'suave' }, ` → agora: ${l.vigente.nome || 'ninguém'} (${POR[l.vigente.por]}${l.vigente.ate ? ` até ${dataHora(l.vigente.ate)}` : ''})`) : null);

  trocar(el,
    h('div', { class: 'titulo-tela' }, h('h1', {}, 'Governança'),
      h('span', { class: 'acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: delegar }, 'Delegar'),
        g.podeGerir ? h('button', { class: 'btn', type: 'button', onclick: plantao }, 'Novo plantão') : null,
        g.podeGerir && g.processos.some((p) => !p.linhas.length) ? h('button', { class: 'btn btn-fantasma', type: 'button', onclick: async () => {
          const r = await api.post('/raci/sugestao', {}); aviso(`${r.incluidas} linha(s) sugerida(s) incluída(s). Ajuste o que for diferente na Brobot.`); recarregar();
        } }, 'Preencher com a sugestão') : null)),
    h('p', { class: 'suave' }, 'Quem responde por cada processo e quem está respondendo agora (com férias, delegação, substituto e plantão já considerados).'),
    h('section', { class: 'cartao' }, h('h2', {}, 'Delegações'),
      g.delegacoes.length ? h('ul', { class: 'itens' }, g.delegacoes.map((x) => h('li', {},
        h('strong', {}, `${x.de_nome} → ${x.para_nome}`), ' ',
        x.revogada_em ? selo('revogada', 'neutro') : x.vigente ? selo('vigente', 'ok') : x.futura ? selo('agendada', 'info') : selo('terminou', 'neutro'),
        h('div', { class: 'suave' }, `${dataHora(x.inicio)} a ${dataHora(x.fim)} · ${x.motivo}`),
        !x.revogada_em && (x.vigente || x.futura) && (g.podeGerir || x.de_id === ctx.usuario.id)
          ? h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: () => revogar(x) }, 'Revogar') : null))) : vazio('Nenhuma delegação ativa.')),
    h('section', { class: 'cartao' }, h('h2', {}, 'Plantões'),
      g.plantoes.length ? h('ul', { class: 'itens' }, g.plantoes.map((p) => h('li', {},
        h('strong', {}, `${p.equipe_nome}: ${p.usuario_nome}`), ' ', p.vigente ? selo('agora', 'ok') : selo('agendado', 'info'),
        h('div', { class: 'suave' }, `${dataHora(p.inicio)} a ${dataHora(p.fim)}`),
        g.podeGerir ? h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', onclick: () => cancelarPlantao(p) }, 'Cancelar') : null))) : vazio('Nenhum plantão na escala.')),
    h('h2', {}, 'Matriz de responsáveis (RACI)'),
    h('p', { class: 'suave' }, Object.entries(g.papeis).map(([k, v]) => `${k} = ${v}`).join(' · ')),
    h('div', { class: 'lista' }, g.processos.map((p) => h('section', { class: 'cartao' },
      h('div', { class: 'linha-topo' }, h('strong', {}, p.nome), p.faltando.length ? selo(`falta ${p.faltando.join(' e ')}`, 'perigo') : selo('completo', 'ok')),
      p.linhas.length ? h('ul', { class: 'itens' }, p.linhas.map((l) => h('li', {},
        h('strong', {}, `${l.papel} `), `${l.nome}${l.tipo === 'equipe' ? ' (equipe)' : ''}`, l.ausente ? ' · ausente' : '', vigente(l),
        g.podeGerir ? h('button', { class: 'btn btn-pequeno btn-fantasma', type: 'button', 'aria-label': `Tirar ${l.nome} do papel ${l.papel}`,
          onclick: async () => { await api.post(`/raci/${l.id}/remover`, {}); aviso('Removido da matriz.'); recarregar(); } }, 'Tirar') : null))) : h('p', { class: 'suave' }, 'Ninguém definido.'),
      g.podeGerir ? h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => novaLinha(p.chave) }, 'Incluir') : null))));
}
