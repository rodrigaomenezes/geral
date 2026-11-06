// Pedidos de titulares (LGPD): localizar a pessoa pelo telefone ou e-mail, entregar a exportação e, se o pedido for
// de eliminação, anonimizar. Sempre com o protocolo do pedido (fica na auditoria, sem o dado pessoal).
import { h, trocar, dataHora, campo, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

export async function telaLgpd(el) {
  const resultado = h('div', { 'aria-live': 'polite' });
  const telefone = h('input', { name: 'telefone', inputmode: 'tel', placeholder: '(11) 98765-4321' });
  const email = h('input', { name: 'email', type: 'email', placeholder: 'pessoa@empresa.com.br' });
  const filtro = () => ({ ...(telefone.value.trim() ? { telefone: telefone.value.trim() } : {}), ...(email.value.trim() ? { email: email.value.trim() } : {}) });

  async function buscar() {
    trocar(resultado, h('p', { class: 'carregando' }, 'Procurando…'));
    try {
      const r = await api.get(`/lgpd/titular?${new URLSearchParams(filtro())}`);
      const total = r.pontosFocais.length + r.pessoas.length + r.oportunidades.length + r.mensagens;
      const lista = (titulo, itens, fmt) => (itens.length ? [h('h3', {}, `${titulo} (${itens.length})`), h('ul', { class: 'itens' }, itens.map((x) => h('li', {}, fmt(x))))] : null);
      trocar(resultado, total ? h('section', { class: 'cartao' },
        lista('Ponto focal de cliente', r.pontosFocais, (x) => `${x.nome} · ${x.conta} · ${x.papel}${x.vigente ? '' : ' (antigo)'} · desde ${dataHora(x.criado_em)}`),
        lista('Pessoa do Comercial', r.pessoas, (x) => `${x.nome}${x.cargo ? ` · ${x.cargo}` : ''}`),
        lista('Contato de oportunidade', r.oportunidades, (x) => `${x.codigo} · ${x.empresa} · ${x.contato_nome || ''}`),
        h('p', {}, `${r.mensagens} mensagem(ns) enviada(s) para este contato.`),
        h('div', { class: 'acoes' },
          h('button', { class: 'btn btn-primario', type: 'button', onclick: () => modal('Exportar os dados do titular', (fechar) => formulario([
            campo('Protocolo ou motivo do pedido', h('input', { name: 'motivo', required: true, minlength: 5, maxlength: 300 }))], 'Gerar arquivo', async (d) => {
            const x = await api.post('/lgpd/exportar', { ...filtro(), motivo: d.motivo });
            const blob = new Blob([JSON.stringify(x, null, 2)], { type: 'application/json' });
            const a = h('a', { href: URL.createObjectURL(blob), download: `titular-${new Date().toISOString().slice(0, 10)}.json` });
            document.body.append(a); a.click(); a.remove(); fechar(); aviso('Arquivo gerado. Entregue ao titular por canal seguro.');
          })) }, 'Exportar dados'),
          h('button', { class: 'btn btn-fantasma', type: 'button', onclick: () => modal('Anonimizar o titular', (fechar) => formulario([
            h('p', { class: 'alerta alerta-perigo' }, 'Nome, telefone e e-mail desta pessoa serão substituídos em todo o Sinapse e o papel de contato será encerrado. Não dá para desfazer.'),
            campo('Protocolo ou motivo do pedido', h('input', { name: 'motivo', required: true, minlength: 5, maxlength: 300 })),
            campo('Para confirmar, digite ANONIMIZAR', h('input', { name: 'confirmacao', required: true, pattern: 'ANONIMIZAR' })),
          ], 'Anonimizar', async (d) => {
            const x = await api.post('/lgpd/anonimizar', { ...filtro(), ...d });
            fechar(); aviso(`Anonimizado: ${x.pontosFocais} ponto(s) focal(is), ${x.pessoas} pessoa(s), ${x.oportunidades} oportunidade(s), ${x.mensagens} mensagem(ns).`); buscar();
          })) }, 'Anonimizar'))) : vazio('Nada encontrado com esse telefone ou e-mail.'));
    } catch (e) { trocar(resultado, vazio(textoErro(e))); }
  }

  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Privacidade (LGPD)')),
    h('p', { class: 'suave' }, 'Atendimento a pedidos de titulares: acesso aos dados (exportação) e eliminação (anonimização). Tudo fica registrado na auditoria com o protocolo do pedido, sem o dado pessoal.'),
    h('form', { class: 'filtros', onsubmit: (e) => { e.preventDefault(); buscar(); } }, campo('Telefone', telefone), campo('E-mail', email),
      h('button', { class: 'btn btn-primario', type: 'submit' }, 'Procurar')),
    resultado);
}
