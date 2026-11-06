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

const camposSenha = () => [
  campo('Senha atual', h('input', { name: 'atual', type: 'password', autocomplete: 'current-password', required: true })),
  campo('Nova senha', h('input', { name: 'nova', type: 'password', autocomplete: 'new-password', required: true, minlength: 12, maxlength: 200 }),
    'Pelo menos 12 caracteres. Uma frase com 3 ou 4 palavras é fácil de lembrar e difícil de adivinhar.'),
];

/** Primeiro acesso (ou senha redefinida): tela inteira até trocar a temporária. */
export function telaTrocarSenha(raiz, aoTrocar, aoSair) {
  trocar(raiz, h('div', { class: 'login' }, h('div', { class: 'cartao login-cartao' },
    h('h2', {}, 'Crie a sua senha'),
    h('p', {}, 'Você entrou com uma senha temporária. Para continuar, digite-a e escolha a sua senha.'),
    formulario(camposSenha(), 'Salvar e continuar', async (d) => { await api.post('/senha', d); aviso('Senha trocada.'); aoTrocar(); }),
    h('button', { class: 'btn btn-fantasma', type: 'button', onclick: aoSair }, 'Sair'))));
}

/** Minha conta: senha, disponibilidade e verificação em duas etapas. */
export function abrirMinhaConta(ctx, aoMudar = () => {}) {
  const u = ctx.usuario;
  modal('Minha conta', (fechar) => h('div', { class: 'lista' },
    h('button', { class: 'btn', type: 'button', onclick: () => { fechar(); modal('Trocar senha', (f2) => formulario(camposSenha(), 'Trocar senha', async (d) => {
      await api.post('/senha', d); f2(); aviso('Senha trocada. Os outros aparelhos vão pedir para entrar de novo.');
    })); } }, 'Trocar senha'),
    ctx.pode('agenda.usar') ? h('button', { class: 'btn', type: 'button', onclick: async () => {
      try {
        const r = await api.post('/eu/disponivel', { disponivel: !u.disponivel }); u.disponivel = r.disponivel; fechar();
        aviso(r.disponivel ? 'Você está disponível de novo.' : 'Marcado como ausente: o que chegar vai para o seu substituto ou para a fila.'); aoMudar();
      } catch (e) { aviso(textoErro(e), 'erro'); }
    } }, u.disponivel ? 'Estou ausente agora' : 'Voltei: estou disponível') : null,
    h('button', { class: 'btn', type: 'button', onclick: () => { fechar(); abrirSeguranca(ctx, aoMudar); } },
      u.mfaAtivo ? 'Verificação em duas etapas (ativa)' : 'Ativar a verificação em duas etapas'),
    h('p', { class: 'suave' }, 'Vai ficar fora por dias? Use "Delegar", na Governança.')));
}
