// Plataforma: o que muda entre o navegador e o app Android (ponte `GuiaNativo`).
// Voz, notificações, segundo plano e GPS do companheiro. Nenhuma regra de guia aqui (essas ficam em nucleo.js).
//
// No navegador: voz pela Web Speech API; notificação pelo service worker, só quando a página está escondida
// e o navegador ainda a mantém viva (com a tela bloqueada, o navegador congela a página).
// No app Android: a ponte injeta `window.GuiaNativo`; GPS vem de um serviço em primeiro plano (funciona com a tela
// bloqueada), a voz é o TextToSpeech do sistema e a notificação é nativa.

const nativo = typeof window !== 'undefined' && window.GuiaNativo ? window.GuiaNativo : null;

export const ehAppNativo = () => !!nativo;

/** Os tipos de alerta que a pessoa pode configurar, na ordem da tela. */
export const TIPOS_CONFIGURAVEIS = [
  { tipo: 'importante', nome: 'Importante', exemplo: 'segurança e atenção no caminho' },
  { tipo: 'chegada', nome: 'Você chegou', exemplo: 'a história do ponto ao chegar' },
  { tipo: 'a-caminho', nome: 'Logo à frente', exemplo: 'um ponto a até 200 m no seu caminho' },
  { tipo: 'dica', nome: 'Dicas', exemplo: 'atalhos e conselhos práticos' },
  { tipo: 'novidade', nome: 'Novidades', exemplo: 'quando você entra numa área nova' },
];
/** Como avisar cada tipo: com notificação (inclusive em segundo plano), só com o app aberto, ou nunca. */
export const MODOS = { notificar: 'Avisar e notificar', app: 'Só com o app aberto', off: 'Desligado' };
export const AVISOS_PADRAO = { importante: 'notificar', chegada: 'notificar', 'a-caminho': 'app', dica: 'app', novidade: 'app' };

/** O app está na frente da pessoa? (no Android pergunta à ponte: a WebView continua "visível" em segundo plano). */
export function emPrimeiroPlano() {
  if (nativo) { try { return !!nativo.emPrimeiroPlano(); } catch { return true; } }
  return document.visibilityState === 'visible';
}

/** Tipos que podem ser dados agora: em segundo plano só os marcados para notificar. */
export function tiposAtivos(avisos, primeiroPlano = emPrimeiroPlano()) {
  return TIPOS_CONFIGURAVEIS.map((t) => t.tipo).filter((t) => {
    const modo = avisos[t] || AVISOS_PADRAO[t];
    return primeiroPlano ? modo !== 'off' : modo === 'notificar';
  });
}

// ---------- Voz ----------
let vozPt = null;
function escolherVoz() {
  const vozes = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  vozPt = vozes.find((v) => v.lang === 'pt-BR') || vozes.find((v) => v.lang && v.lang.startsWith('pt')) || null;
}
if (!nativo && typeof window !== 'undefined' && 'speechSynthesis' in window) { escolherVoz(); speechSynthesis.addEventListener?.('voiceschanged', escolherVoz); }

export function falar(texto) {
  if (nativo) { try { nativo.falar(String(texto)); } catch { /* sem voz */ } return; }
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR'; if (vozPt) u.voice = vozPt; u.rate = 1.02;
  speechSynthesis.speak(u);
}
export function pararFala() {
  if (nativo) { try { nativo.pararFala(); } catch { /* nada */ } return; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
export function falando() {
  if (nativo) { try { return !!nativo.falando(); } catch { return false; } }
  return 'speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending);
}
/** iPhone só libera a voz depois de um toque: chamar dentro de um clique. */
export function liberarVoz() {
  if (!nativo && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
}

// ---------- Notificações ----------
/** 'concedida' | 'negada' | 'perguntar' | 'indisponivel' */
export function estadoNotificacoes() {
  if (nativo) return 'concedida'; // o Android pede na primeira notificação
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'indisponivel';
  return { granted: 'concedida', denied: 'negada' }[Notification.permission] || 'perguntar';
}
export async function pedirNotificacoes() {
  if (nativo || !('Notification' in window)) return estadoNotificacoes();
  try { await Notification.requestPermission(); } catch { /* navegador antigo */ }
  return estadoNotificacoes();
}

/** Notifica o alerta se a pessoa marcou "notificar" para o tipo e o app não está na frente dela. */
export async function notificar(alerta, modo) {
  if (modo !== 'notificar' || emPrimeiroPlano()) return false;
  const titulo = alerta.titulo;
  const corpo = alerta.textoCurto || alerta.texto || '';
  if (nativo) {
    try { nativo.notificar(JSON.stringify({ id: alerta.id, tipo: alerta.tipo, titulo, texto: corpo })); return true; } catch { return false; }
  }
  if (estadoNotificacoes() !== 'concedida') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(titulo, { body: corpo, tag: `guia-${alerta.id}`, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      vibrate: alerta.tipo === 'importante' ? [200, 100, 200, 100, 200] : [120], data: { id: alerta.id, tipo: alerta.tipo }, renotify: false });
    return true;
  } catch { return false; }
}

// ---------- GPS do companheiro no app nativo ----------
/** No app Android o GPS vem do serviço em primeiro plano (continua com a tela bloqueada). Devolve função para parar ou null. */
export function acompanharGpsNativo(aoMudar, aoEncerrar) {
  if (!nativo) return null;
  window.guiaReceberPosicao = (p) => { if (p && Number.isFinite(p.lat)) aoMudar({ lat: p.lat, lng: p.lng, precisao: p.precisao }); };
  // "Encerrar caminhada" tocado na notificação fixa, ou GPS negado: a tela acompanha.
  window.guiaAcompanhamentoEncerrado = () => { if (aoEncerrar) aoEncerrar(); };
  try { nativo.iniciarAcompanhamento(); } catch { return null; }
  return () => { try { nativo.pararAcompanhamento(); } catch { /* já parado */ } window.guiaReceberPosicao = null; window.guiaAcompanhamentoEncerrado = null; };
}

/** Toque na notificação (navegador: service worker; Android: a atividade chama esta função). */
export function aoAbrirAlerta(abrir) {
  window.guiaAbrirAlerta = (id) => abrir(String(id));
  if (!nativo && 'serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.abrirAlerta) abrir(String(e.data.abrirAlerta)); });
  }
}
