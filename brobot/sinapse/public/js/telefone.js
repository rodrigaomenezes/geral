// Softphone do Sinapse (adaptado do Lumen Operações). A tela só fala com a central (/api/telefonia):
//  - Computador: operadora SIP/WebRTC (JsSIP, carregado sob demanda) ou modo de treino (simulado, sem custo)
//  - Celular: abre o discador do aparelho e, na volta, pede o resultado
// No fim, a pessoa confirma o resultado e anota o combinado; a central registra na ocorrência/oportunidade e,
// se a ligação veio de uma tarefa, conclui a tarefa ("atendeu"/"não atendeu") e o processo segue sozinho.
import { h, trocar, aviso, modal } from './dom.js';
import { api, textoErro } from './api.js';

const T = { cfg: null, ua: null, uaEstado: 'desligado', chamada: null };
const ler = (k) => { try { return localStorage.getItem(`sinapse.tel.${k}`) || ''; } catch { return ''; } };
const guardar = (k, v) => { try { if (v) localStorage.setItem(`sinapse.tel.${k}`, v); else localStorage.removeItem(`sinapse.tel.${k}`); } catch { /* sem armazenamento */ } };
const ROTULO = { atendida: 'Atendida', nao_atendida: 'Não atendeu', ocupado: 'Ocupado', falhou: 'Não completou', cancelada: 'Cancelada' };
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function config(forcar) {
  if (!T.cfg || forcar) T.cfg = await api.get('/telefonia/config').catch((e) => ({ ativo: false, motivo: textoErro(e), computador: {}, celular: {} }));
  return T.cfg;
}

function escolherCanal() {
  const c = T.cfg;
  const pode = { computador: c.computador.ok, celular: c.celular.ok };
  const pref = ler('canal');
  if (pref && pode[pref]) return Promise.resolve(pref);
  if (!pode.computador) return Promise.resolve('celular');
  if (!pode.celular) return Promise.resolve('computador');
  return new Promise((ok) => {
    modal('Como você quer ligar?', (fechar) => {
      const lembrar = h('input', { type: 'checkbox' });
      const escolha = (canal) => () => { if (lembrar.checked) guardar('canal', canal); fechar(); ok(canal); };
      return h('div', { class: 'form' },
        h('button', { class: 'opcao-canal', type: 'button', onclick: escolha('computador') }, h('strong', {}, '🎧 Computador'),
          h('span', {}, c.provedor === 'treino' ? 'Modo de treino: ligação simulada, sem custo.' : `Pelo fone, aqui no sistema${c.operadora ? ` (${c.operadora})` : ''}.`)),
        h('button', { class: 'opcao-canal', type: 'button', onclick: escolha('celular') }, h('strong', {}, '📱 Celular'), h('span', {}, 'Pelo chip do seu celular; no fim o sistema pergunta o resultado.')),
        h('label', { class: 'check' }, lembrar, 'Lembrar minha escolha'));
    });
  });
}

// ---------- Operadora (JsSIP) ----------
function carregarJsSIP() {
  if (window.JsSIP) return Promise.resolve();
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = '/vendor/jssip.min.js'; s.onload = ok; s.onerror = () => falha(new Error('Não foi possível carregar o telefone.'));
    document.head.append(s);
  });
}

async function conectarOperadora() {
  if (T.ua && T.uaEstado === 'registrado') return;
  await carregarJsSIP();
  if (!T.ua) {
    const s = await api.post('/telefonia/sessao'); // credencial pedida na hora; não fica salva no navegador
    T.sip = s;
    T.ua = new window.JsSIP.UA({ sockets: [new window.JsSIP.WebSocketInterface(s.ws_url)], uri: `sip:${s.usuario}@${s.dominio}`, password: s.senha,
      display_name: s.nome, register: true, session_timers: false, user_agent: 'Sinapse' });
    T.ua.on('registered', () => { T.uaEstado = 'registrado'; });
    T.ua.on('registrationFailed', () => { T.uaEstado = 'erro'; });
    T.ua.on('disconnected', () => { T.uaEstado = 'desconectado'; });
    T.ua.start();
  }
  for (let i = 0; i < 48 && T.uaEstado !== 'registrado' && T.uaEstado !== 'erro'; i++) await new Promise((r) => setTimeout(r, 250));
  if (T.uaEstado !== 'registrado') throw new Error('A operadora não aceitou o ramal. Confira o ramal com a gestão.');
}

// ---------- Painel flutuante ----------
function painel() {
  let el = document.getElementById('telefone');
  if (!el) { el = h('aside', { id: 'telefone', class: 'telefone', 'aria-live': 'polite' }); document.body.append(el); }
  return el;
}
function fechar() { document.getElementById('telefone')?.remove(); clearInterval(T.relogio); T.chamada = null; }

async function evento(nome, dados = {}) {
  try { return await api.post(`/telefonia/chamadas/${T.chamada.id}/eventos`, { evento: nome, ...dados }); } catch (e) { if (nome === 'encerrada') aviso(textoErro(e), 'erro'); return null; }
}

function desenhar() {
  const c = T.chamada;
  if (!c) return;
  const em = c.estado === 'em_ligacao' || c.estado === 'em_espera';
  const btn = (rotulo, fn, cls = '') => h('button', { class: `btn btn-pequeno ${cls}`, type: 'button', onclick: fn }, rotulo);
  const estados = { preparando: 'Preparando…', discando: 'Discando…', tocando: 'Chamando…', em_ligacao: 'Em ligação', em_espera: 'Em espera', celular: 'No seu celular', fim: 'Ligação encerrada' };
  trocar(painel(),
    h('div', { class: 'telefone-topo' }, h('strong', {}, c.nome || c.numero), h('span', { class: 'suave' }, c.numero)),
    h('div', { class: 'telefone-estado' }, estados[c.estado] || c.estado, em ? h('span', { class: 'telefone-tempo' }, fmt(c.segundos || 0)) : null,
      c.provedor === 'treino' ? h('span', { class: 'selo selo-vip' }, 'treino') : null),
    c.estado === 'fim' || c.estado === 'celular' ? fimDaLigacao() : h('div', { class: 'acoes' },
      em ? btn(c.mudo ? 'Ativar som' : 'Mudo', () => { c.mudo = !c.mudo; c.sessao?.[c.mudo ? 'mute' : 'unmute']?.(); evento(c.mudo ? 'mudo' : 'som'); desenhar(); }) : null,
      em && c.recursos?.espera ? btn(c.estado === 'em_espera' ? 'Retomar' : 'Espera', async () => {
        const indo = c.estado !== 'em_espera'; c.sessao?.[indo ? 'hold' : 'unhold']?.(); await evento(indo ? 'espera' : 'retomada'); c.estado = indo ? 'em_espera' : 'em_ligacao'; desenhar();
      }) : null,
      btn('Desligar', () => terminar(em ? 'atendida' : 'cancelada'), 'btn-perigo')));
}

function fimDaLigacao() {
  const c = T.chamada;
  const resultado = h('select', { 'aria-label': 'Resultado' }, ...['atendida', 'nao_atendida', 'ocupado', 'falhou'].map((r) => h('option', { value: r, selected: r === c.resultado }, ROTULO[r])));
  const nota = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'O que foi combinado? (ex.: vai corrigir o vínculo SNE até amanhã às 12h)' });
  return h('div', { class: 'form' },
    c.estado === 'celular' ? h('p', { class: 'suave' }, 'Quando terminar no celular, registre como foi:') : null,
    h('label', { class: 'campo' }, h('span', { class: 'campo-rotulo' }, 'Resultado'), resultado),
    h('label', { class: 'campo' }, h('span', { class: 'campo-rotulo' }, 'Anotação'), nota),
    h('div', { class: 'form-acoes' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      const r = await evento('encerrada', { resultado: resultado.value, anotacao: nota.value.trim() || undefined });
      if (r) { aviso(`Ligação registrada: ${r.rotulo}${c.tarefa_id ? ' · tarefa concluída' : ''}.`); const fim = c.aoEncerrar; fechar(); fim?.(r); }
      else e.currentTarget.disabled = false;
    } }, 'Salvar')));
}

function iniciarRelogio() {
  clearInterval(T.relogio);
  T.relogio = setInterval(() => { if (T.chamada && T.chamada.inicio) { T.chamada.segundos = Math.round((Date.now() - T.chamada.inicio) / 1000); desenhar(); } }, 1000);
}

function terminar(resultadoPadrao) {
  const c = T.chamada; if (!c) return;
  try { c.sessao?.terminate?.(); } catch { /* já encerrada */ }
  clearTimeout(c.simulacao);
  c.resultado = c.resultado || resultadoPadrao;
  c.estado = 'fim';
  clearInterval(T.relogio);
  desenhar();
}

async function ligarComputador(ch) {
  const c = T.chamada;
  if (ch.provedor === 'treino') {
    await evento('discando'); c.estado = 'discando'; desenhar();
    c.simulacao = setTimeout(async () => {
      await evento('tocando'); c.estado = 'tocando'; desenhar();
      c.simulacao = setTimeout(async () => {
        if (Math.random() < 0.65) { await evento('atendida'); c.estado = 'em_ligacao'; c.inicio = Date.now(); iniciarRelogio(); desenhar(); }
        else { c.resultado = 'nao_atendida'; terminar('nao_atendida'); }
      }, 2500);
    }, 900);
    return;
  }
  await conectarOperadora();
  const sessao = T.ua.call(`sip:${ch.discar}@${T.sip.dominio}`, { mediaConstraints: { audio: true, video: false },
    pcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...(T.sip.ice_servers || []).map((l) => { const [urls, username, credential] = l.split(/\s+/); return username ? { urls, username, credential } : { urls }; })] } });
  c.sessao = sessao;
  sessao.on('progress', async () => { if (c.estado !== 'tocando') { await evento('tocando'); c.estado = 'tocando'; desenhar(); } });
  sessao.on('confirmed', async () => { await evento('atendida'); c.estado = 'em_ligacao'; c.inicio = Date.now(); iniciarRelogio(); desenhar(); });
  sessao.connection?.addEventListener('track', (e) => { const a = document.getElementById('telefone-audio') || document.body.appendChild(h('audio', { id: 'telefone-audio', autoplay: true })); a.srcObject = e.streams[0]; });
  const causa = { Busy: 'ocupado', 'No Answer': 'nao_atendida', Rejected: 'nao_atendida', Canceled: 'cancelada', Unavailable: 'nao_atendida' };
  sessao.on('failed', (e) => { c.resultado = causa[e.cause] || 'falhou'; terminar(c.resultado); });
  sessao.on('ended', () => terminar('atendida'));
}

/** Liga a partir de uma tarefa, ocorrência, oportunidade, conta ou número. `aoEncerrar` recebe o resumo final. */
export async function ligar(alvo = {}) {
  const cfg = await config();
  if (!cfg.ativo) { aviso(cfg.motivo || 'A telefonia pelo sistema está desligada.', 'erro'); return; }
  if (T.chamada) { aviso('Você já está numa ligação.', 'erro'); return; }
  const canal = await escolherCanal();
  if (!canal) return;
  try {
    const ch = await api.post('/telefonia/chamadas', { canal, numero: alvo.numero, nome: alvo.nome, tarefaId: alvo.tarefaId, ocorrenciaId: alvo.ocorrenciaId,
      oportunidadeId: alvo.oportunidadeId, contaId: alvo.contaId });
    T.chamada = { ...ch, estado: 'preparando', recursos: cfg.computador.recursos, aoEncerrar: alvo.aoEncerrar };
    desenhar();
    if (canal === 'celular') { T.chamada.estado = 'celular'; desenhar(); window.location.href = `tel:${ch.discar}`; return; }
    await ligarComputador(ch);
  } catch (e) {
    aviso(textoErro(e) || e.message, 'erro');
    if (T.chamada) { T.chamada.resultado = 'falhou'; terminar('falhou'); }
  }
}

export const telefoneAtivo = async () => (await config()).ativo;
