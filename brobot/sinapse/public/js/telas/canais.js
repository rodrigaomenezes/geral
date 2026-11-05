// Canais da organização: WhatsApp (QR Code ou API oficial da Meta) e telefonia (operadora e ramais).
import { h, trocar, dataHora, selo, campo, aviso, modal, vazio } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

const ESTADO_QR = {
  nunca_conectado: ['não conectado', 'neutro'], parado: ['desligado', 'neutro'], conectando: ['conectando…', 'info'],
  aguardando_qr: ['aguardando leitura do QR', 'alerta'], conectado: ['conectado', 'ok'], reconectando: ['reconectando…', 'alerta'],
  expirado: ['QR expirou', 'perigo'], desconectado: ['desconectado', 'perigo'],
};

export async function telaCanais(el, ctx) {
  const blocos = [];
  if (ctx.pode('canais.gerir')) blocos.push(await blocoWhatsapp(el, ctx));
  if (ctx.pode('telefonia.gerir')) blocos.push(await blocoTelefonia(el, ctx));
  trocar(el, h('div', { class: 'titulo-tela' }, h('h1', {}, 'Canais')),
    h('p', { class: 'suave' }, 'Por onde o Sinapse conversa com os clientes. Um número de WhatsApp ativo por vez; as ligações saem pelo computador (operadora) ou pelo celular.'),
    blocos);
}

async function blocoWhatsapp(el, ctx) {
  const [{ numero }, qr] = await Promise.all([api.get('/whatsapp/numero'), api.get('/whatsapp/qr')]);
  const recarregar = () => telaCanais(el, ctx);
  const areaQr = h('div', { class: 'qr-area', 'aria-live': 'polite' });
  let espera = null;

  const desenhar = (s) => {
    const [rot, tipo] = ESTADO_QR[s.estado] || [s.status || s.estado, 'neutro'];
    trocar(areaQr,
      h('p', {}, 'Situação: ', selo(rot, tipo), s.telefone ? ` · ${s.telefone}` : ''),
      s.erro && s.estado !== 'conectado' ? h('p', { class: 'alerta alerta-perigo' }, s.erro) : null,
      s.qr ? h('div', { class: 'qr-caixa' },
        h('img', { src: s.qr, alt: 'QR Code para conectar o WhatsApp', width: 260, height: 260 }),
        h('ol', { class: 'qr-passos' }, h('li', {}, 'No celular do número da empresa, abra o WhatsApp.'),
          h('li', {}, 'Toque em Configurações (ou ⋮) → Aparelhos conectados → Conectar um aparelho.'),
          h('li', {}, 'Aponte a câmera para este QR Code. Ele muda sozinho a cada poucos segundos.'))) : null);
  };
  // Enquanto a conexão não termina, consulta de novo a cada 2 s — só com a tela aberta.
  const acompanhar = async () => {
    clearTimeout(espera);
    if (!areaQr.isConnected) return;
    try {
      const s = await api.get('/whatsapp/qr');
      desenhar(s);
      if (['conectando', 'aguardando_qr', 'reconectando'].includes(s.estado)) espera = setTimeout(acompanhar, 2000);
      else if (s.estado === 'conectado') aviso('WhatsApp conectado: as mensagens já chegam no Sinapse.');
    } catch (e) { trocar(areaQr, h('p', { class: 'alerta alerta-perigo' }, textoErro(e))); }
  };
  desenhar(qr);
  if (['conectando', 'aguardando_qr', 'reconectando'].includes(qr.estado)) espera = setTimeout(acompanhar, 2000);

  const conectarQr = () => modal('Conectar o WhatsApp por QR Code', (fechar) => h('div', {},
    h('p', {}, 'O Sinapse vira mais um "aparelho conectado" do número da empresa, como o WhatsApp Web.'),
    h('div', { class: 'alerta' }, h('strong', {}, 'Cuidados para o número não ser bloqueado: '),
      'esta conexão não é a API oficial da Meta. Use um número da empresa (não pessoal), mande mensagens só para quem já é cliente e conversa com vocês, evite envio em massa e mantenha o celular ligado à internet de vez em quando. Para volume alto, prefira a API oficial.'),
    h('div', { class: 'form-acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { const s = await api.post('/whatsapp/qr/conectar'); fechar(); desenhar(s); espera = setTimeout(acompanhar, 1000); } catch (err) { aviso(textoErro(err), 'erro'); e.currentTarget.disabled = false; }
    } }, 'Entendi, gerar QR Code'))));

  const oficial = () => modal('Conectar pela API oficial (Meta)', (fechar) => formulario([
    h('p', { class: 'suave' }, 'Dados do WhatsApp Manager (Meta Business). O token fica cifrado no banco e nunca aparece de volta na tela.'),
    campo('Phone Number ID', h('input', { name: 'phoneNumberId', required: true, inputmode: 'numeric', pattern: '\\d{5,30}' })),
    campo('WhatsApp Business Account ID (opcional)', h('input', { name: 'wabaId', inputmode: 'numeric' })),
    campo('Número para exibição', h('input', { name: 'numeroExibicao', placeholder: '+55 11 4000-0000' })),
    campo('Token de acesso permanente', h('input', { name: 'token', type: 'password', required: true, minlength: 20, autocomplete: 'off' })),
  ], 'Salvar e ativar', async (x) => { await api.post('/whatsapp/numero', x); fechar(); aviso('Número oficial ativo.'); recarregar(); }));

  const ativoQr = numero?.provedor === 'qr';
  return h('section', { class: 'cartao' }, h('h2', {}, 'WhatsApp'),
    h('p', {}, 'Número ativo: ', numero ? h('strong', {}, `${numero.numero_exibicao || 'sem número exibido'} · ${numero.provedor === 'qr' ? 'QR Code' : numero.provedor === 'cloud' ? 'API oficial' : 'demonstração'}`) : h('span', { class: 'suave' }, 'nenhum (as mensagens saem pela demonstração)'),
      numero ? h('span', { class: 'suave' }, ` · atualizado ${dataHora(numero.atualizado_em)}`) : null),
    h('div', { class: 'grade-2' },
      h('div', {}, h('h3', {}, 'Por QR Code'), areaQr,
        h('div', { class: 'acoes' },
          h('button', { class: 'btn btn-primario', type: 'button', onclick: conectarQr }, qr.estado === 'conectado' ? 'Reconectar' : 'Conectar'),
          ativoQr || qr.estado === 'conectado' ? h('button', { class: 'btn btn-fantasma', type: 'button', onclick: async (e) => {
            if (!confirm('Desconectar o WhatsApp? As mensagens deixam de chegar até conectar de novo.')) return;
            e.currentTarget.disabled = true;
            try { await api.post('/whatsapp/qr/desconectar'); aviso('WhatsApp desconectado.'); recarregar(); } catch (err) { aviso(textoErro(err), 'erro'); e.currentTarget.disabled = false; }
          } }, 'Desconectar') : null)),
      h('div', {}, h('h3', {}, 'API oficial da Meta'),
        h('p', { class: 'suave' }, 'Recomendada para uso contínuo: sem risco de bloqueio por uso de aparelho conectado e com modelos aprovados para fora da janela de 24 h.'),
        numero?.provedor === 'cloud' ? h('p', {}, selo('ativa', 'ok'), numero.tem_token ? ' · token guardado' : '') : null,
        h('div', { class: 'acoes' }, h('button', { class: 'btn', type: 'button', onclick: oficial }, numero?.provedor === 'cloud' ? 'Trocar dados' : 'Conectar')))));
}

const PROVEDOR_TEL = { desligado: 'Desligada', treino: 'Treino (sem operadora)', sip: 'Operadora SIP (computador)' };

async function blocoTelefonia(el, ctx) {
  const { config, ramais } = await api.get('/telefonia/admin');
  const recarregar = () => telaCanais(el, ctx);
  const sel = (nome, mapa, atual) => h('select', { name: nome }, Object.entries(mapa).map(([v, r]) => h('option', { value: v, selected: v === String(atual) }, r)));
  const caixa = h('input', { type: 'checkbox', name: 'celular', checked: config.celular !== false });
  const editarRamal = (r) => modal(`Ramal de ${r.nome}`, (fechar) => formulario([
    campo('Usuário SIP (ramal)', h('input', { name: 'usuarioSip', required: true, value: r.usuario_sip || '', maxlength: 80 })),
    campo(r.tem_senha ? 'Nova senha (deixe em branco para manter)' : 'Senha do ramal', h('input', { name: 'senha', type: 'password', autocomplete: 'off', maxlength: 200 })),
    campo('Nome exibido (opcional)', h('input', { name: 'nomeExibicao', value: r.nome_exibicao || '', maxlength: 80 })),
  ], 'Salvar ramal', async (x) => { await api.post(`/telefonia/admin/ramais/${r.usuario_id}`, x); fechar(); aviso('Ramal salvo (senha cifrada).'); recarregar(); }));

  return h('section', { class: 'cartao' }, h('h2', {}, 'Telefonia'),
    formulario([
      campo('Como as ligações saem pelo computador', sel('provedor', PROVEDOR_TEL, config.provedor)),
      campo('Operadora (nome)', h('input', { name: 'operadora', value: config.operadora || '', maxlength: 60 })),
      campo('Endereço WebSocket da operadora (wss://…)', h('input', { name: 'wsUrl', value: config.ws_url || '', placeholder: 'wss://sip.operadora.com.br:7443', maxlength: 300 })),
      campo('Domínio SIP', h('input', { name: 'dominio', value: config.dominio || '', maxlength: 200 })),
      campo('Formato do número discado', sel('formatoNumero', { 55: '55 + DDD + número', '0ddd': '0 + DDD + número', ddd: 'DDD + número', e164: '+55 (E.164)' }, config.formato_numero || '55')),
      campo('Prefixo da operadora (opcional)', h('input', { name: 'prefixo', value: config.prefixo || '', maxlength: 6, inputmode: 'numeric' })),
      h('label', { class: 'check' }, caixa, ' Permitir ligar pelo celular (o sistema abre o discador e pergunta o resultado)'),
    ], 'Salvar telefonia', async (x) => { await api.post('/telefonia/admin/config', { ...x, celular: caixa.checked }); aviso('Telefonia salva.'); recarregar(); }),
    h('h3', {}, 'Ramais'),
    ramais.length ? h('ul', { class: 'itens' }, ramais.map((r) => h('li', { class: 'linha-acao' },
      h('span', {}, h('strong', {}, r.nome), ' ', r.usuario_sip ? selo(`ramal ${r.usuario_sip}`, r.ativo === false ? 'neutro' : 'ok') : selo('sem ramal', 'neutro'), r.tem_senha ? ' · senha guardada' : ''),
      h('button', { class: 'btn btn-pequeno', type: 'button', onclick: () => editarRamal(r) }, r.usuario_sip ? 'Editar' : 'Configurar')))) : vazio('Nenhuma pessoa ativa.'));
}
