// Segurança da conta: verificação em duas etapas (aplicativo autenticador) e o passo do código no login.
import { h, trocar, campo, aviso, modal } from '../dom.js';
import { api, textoErro } from '../api.js';
import { formulario } from './ocorrencias.js';

const inputCodigo = () => h('input', { name: 'codigo', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '\\d{6}', maxlength: 6, required: true, placeholder: '000000' });

/** Segundo passo do login: o código de 6 dígitos do aplicativo. */
export function pedirCodigoLogin(aoEntrar) {
  modal('Verificação em duas etapas', (fechar) => formulario([
    h('p', {}, 'Abra o aplicativo autenticador no seu celular e digite o código de 6 dígitos do Sinapse.'),
    campo('Código', inputCodigo()),
  ], 'Confirmar', async (d) => { const r = await api.post('/sessao/mfa', d); fechar(); aoEntrar(r.usuario); }));
}

/** Ativar ou desativar a verificação em duas etapas da própria conta. */
export function abrirSeguranca(ctx, aoMudar = () => {}) {
  const u = ctx.usuario;
  if (u.mfaAtivo) {
    modal('Verificação em duas etapas', (fechar) => formulario([
      h('p', {}, 'Está ativa. Para desativar (ou trocar de celular), confirme com um código atual.'),
      campo('Código', inputCodigo()),
    ], 'Desativar', async (d) => { await api.post('/mfa/desativar', d); fechar(); aviso('Verificação em duas etapas desativada. Entre de novo.'); location.reload(); }));
    return;
  }
  modal('Ativar a verificação em duas etapas', (fechar) => {
    const area = h('div', { 'aria-live': 'polite' }, h('p', { class: 'carregando' }, 'Gerando o QR Code…'));
    api.post('/mfa/iniciar').then((r) => trocar(area,
      h('ol', { class: 'qr-passos' }, h('li', {}, 'Instale um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou outro).'),
        h('li', {}, 'No aplicativo, toque em adicionar e aponte a câmera para o QR Code.'), h('li', {}, 'Digite abaixo o código de 6 dígitos que aparecer.')),
      h('div', { class: 'qr-caixa' }, h('img', { src: r.qr, alt: 'QR Code para o aplicativo autenticador', width: 220, height: 220 })),
      h('details', {}, h('summary', {}, 'Não consigo ler o QR Code'), h('p', {}, 'Digite esta chave no aplicativo: ', h('code', {}, r.segredo))),
      formulario([campo('Código do aplicativo', inputCodigo())], 'Ativar', async (d) => {
        await api.post('/mfa/confirmar', d); fechar(); aviso('Verificação em duas etapas ativa. No próximo login o código será pedido.');
        ctx.usuario.mfaAtivo = true; aoMudar();
      })), (e) => trocar(area, h('p', { class: 'alerta alerta-perigo' }, textoErro(e))));
    return area;
  });
}
