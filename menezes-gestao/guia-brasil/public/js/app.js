// Interface do GuIA Brasil. Regras ficam em nucleo.js; aqui só tela, sensores, voz e rede.
import { decidirNarracao, proximos, responderLocal, candidatosFoto, VERSAO_PACOTE } from './nucleo.js';
import { acompanharGps, simularCaminhada, criarBussola } from './sensores.js';
import { ler, gravar, apagarTudo, PREFS_PADRAO, filaAdicionar, filaRemover, novoId } from './estado.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null) e.append(f);
  return e;
};

const app = {
  prefs: { ...PREFS_PADRAO, ...ler('prefs', {}) },
  pacote: null,
  pos: null,
  passeioAtivo: false,
  pararGps: null,
  simulador: null,
  emFoco: null, // ponto atual da conversa
  conversa: ler('conversa', []),
  servidorIa: null,
};
const bussola = criarBussola();
bussola.ligar(); // Android não pede permissão; no iOS só funciona depois do toque em "Começar passeio"

// ---------- Rede ----------
const online = () => navigator.onLine !== false;
async function api(caminho, corpo, ms = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(caminho, corpo ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: ctl.signal } : { signal: ctl.signal });
    if (r.status === 204) return null;
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(dados.erro || `Erro ${r.status}`); e.status = r.status; throw e; }
    return dados;
  } finally { clearTimeout(t); }
}
const falhaDeRede = (e) => !e.status; // sem status = não chegou ao servidor

function atualizarSelos() {
  const rede = $('#selo-rede');
  rede.textContent = online() ? (app.servidorIa ? 'online · IA' : 'online') : 'offline';
  rede.className = `selo ${online() ? 'ok' : 'aviso'}`;
  const p = $('#selo-pos');
  if (!app.pos) { p.textContent = app.passeioAtivo ? 'buscando GPS' : 'sem GPS'; p.className = 'selo'; }
  else if (app.pos.simulada) { p.textContent = 'simulação'; p.className = 'selo aviso'; }
  else { p.textContent = `GPS ±${Math.round(app.pos.precisao || 0)} m`; p.className = 'selo ok'; }
}

// ---------- Voz ----------
let vozPt = null;
function escolherVoz() {
  const vozes = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  vozPt = vozes.find((v) => v.lang === 'pt-BR') || vozes.find((v) => v.lang && v.lang.startsWith('pt')) || null;
}
if ('speechSynthesis' in window) { escolherVoz(); speechSynthesis.addEventListener?.('voiceschanged', escolherVoz); }
function falar(texto, forcar = false) {
  if (!('speechSynthesis' in window) || (!app.prefs.voz && !forcar)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR'; if (vozPt) u.voice = vozPt; u.rate = 1.02;
  speechSynthesis.speak(u);
}

// ---------- Navegação ----------
function ir(tela) {
  document.querySelectorAll('.tela').forEach((t) => { t.hidden = t.dataset.tela !== tela; });
  document.querySelectorAll('.abas button').forEach((b) => (b.dataset.ir === tela ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (tela === 'conversa') { renderConversa(); setTimeout(() => $('#entrada-conversa').focus({ preventScroll: true }), 50); }
  if (tela === 'viagem') renderDestinos();
  window.scrollTo({ top: 0 });
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-ir]'); if (b) ir(b.dataset.ir); });

// ---------- Pacote ----------
function ativarPacote(p) {
  app.pacote = p;
  gravar('pacoteAtivo', p.id);
  $('#sem-pacote').hidden = true;
  $('#passeio').hidden = false;
  if (app.prefs.simulacao) ligarSimulacao(); else desligarSimulacao();
  renderPerto();
}
function pacoteSalvo(id) {
  const p = ler(`pacote.${id}`, null);
  return p && p.versao === VERSAO_PACOTE ? p : null;
}
async function baixarPacote(id) {
  const p = await api(`/api/pacotes/${id}`);
  if (!gravar(`pacote.${id}`, p)) throw new Error('Sem espaço no aparelho para guardar o pacote.');
  return p;
}

async function renderDestinos() {
  const ul = $('#lista-destinos');
  let lista = ler('destinos', []);
  if (online()) {
    try { lista = await api('/api/pacotes', null, 10000); gravar('destinos', lista); } catch { /* usa a lista guardada */ }
  }
  ul.replaceChildren(...(lista.length ? lista : []).map((d) => {
    const salvo = pacoteSalvo(d.id);
    const ativo = app.pacote && app.pacote.id === d.id;
    const btn = el('button', { class: `btn ${salvo ? '' : 'primario'}`, onclick: async () => {
      btn.disabled = true; btn.textContent = 'Baixando...';
      try { const p = salvo && !online() ? salvo : await baixarPacote(d.id); ativarPacote(p); ir('passeio'); }
      catch (e) { btn.disabled = false; btn.textContent = 'Tentar de novo'; alertaFaixa(e.message || 'Não foi possível baixar.'); }
    } }, salvo ? (ativo ? 'Atualizar e usar' : 'Usar este destino') : `Baixar para usar offline · ${Math.max(1, Math.round(d.bytes / 1024))} KB`);
    return el('li', { class: `destino ${ativo ? 'ativo' : ''}` },
      el('h4', {}, d.nome),
      el('p', { class: 'dica' }, `${d.pontos} pontos · ${salvo ? 'disponível offline' : 'ainda não baixado'}`),
      el('div', { class: 'acoes' }, btn));
  }));
  if (!lista.length) ul.replaceChildren(el('li', { class: 'dica' }, online() ? 'Nenhum destino disponível.' : 'Sem internet e sem destinos baixados.'));
}

// ---------- Passeio ----------
function iniciarPasseio() {
  app.passeioAtivo = true;
  bussola.pedirPermissao();
  if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance('')); // libera a voz no iOS (precisa de toque)
  if (!app.prefs.simulacao) {
    app.pararGps = acompanharGps(aoMudarPosicao, (msg) => { alertaFaixa(`${msg} Você pode ativar a simulação em Viagem.`); });
  } else if (app.simulador) aoMudarPosicao(app.simulador.posicao());
  const b = $('#btn-passeio'); b.textContent = 'Pausar passeio'; b.classList.add('ligado'); b.setAttribute('aria-pressed', 'true');
  $('#dica-passeio').textContent = app.prefs.simulacao ? 'Simulação ligada: use o botão abaixo para andar.' : 'Pode guardar o celular no bolso: o guia avisa quando houver algo por perto.';
  atualizarSelos();
}
function pausarPasseio() {
  app.passeioAtivo = false;
  if (app.pararGps) app.pararGps(); app.pararGps = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const b = $('#btn-passeio'); b.textContent = 'Começar passeio'; b.classList.remove('ligado'); b.setAttribute('aria-pressed', 'false');
  $('#dica-passeio').textContent = 'O guia fala sozinho quando você chega perto de um ponto.';
  atualizarSelos();
}
$('#btn-passeio').addEventListener('click', () => (app.passeioAtivo ? pausarPasseio() : iniciarPasseio()));

function ligarSimulacao() {
  if (!app.pacote) return;
  if (app.simulador) app.simulador.parar();
  app.simulador = simularCaminhada(app.pacote, aoMudarPosicao);
  $('#simulacao').hidden = false;
  $('#sim-onde').textContent = `Próximo: ${app.simulador.proximo().nome}`;
}
function desligarSimulacao() {
  if (app.simulador) app.simulador.parar();
  app.simulador = null;
  $('#simulacao').hidden = true;
  if (app.pos && app.pos.simulada) app.pos = null;
}
$('#btn-avancar').addEventListener('click', () => {
  if (!app.passeioAtivo) iniciarPasseio();
  const alvo = app.simulador.avancar();
  $('#sim-onde').textContent = `Caminhando até ${alvo.nome}... depois: ${app.simulador.proximo().nome}`;
});

function aoMudarPosicao(p) {
  if (p.simulada && !app.prefs.simulacao) return;
  app.pos = p;
  atualizarSelos();
  renderPerto();
  if (!app.passeioAtivo || !app.pacote) return;
  const estado = ler(`narracao.${app.pacote.id}`, { narrados: {}, ultimaNarracao: 0 });
  const r = decidirNarracao({ pois: app.pacote.pois, pos: p, estado, frequencia: app.prefs.frequencia });
  if (!r) return;
  estado.narrados[r.poi.id] = Date.now(); estado.ultimaNarracao = Date.now();
  gravar(`narracao.${app.pacote.id}`, estado);
  mostrarAgora(r.poi, true);
}

function textoNivel(poi, nivel = app.prefs.nivel) { return poi.narrativa[nivel] || poi.narrativa.medio; }

function mostrarAgora(poi, falarJa) {
  app.emFoco = poi;
  const c = $('#cartao-agora');
  c.hidden = false;
  $('#agora-nome').textContent = poi.nome;
  const t = textoNivel(poi);
  $('#agora-texto').textContent = t;
  $('#agora-curiosidades').replaceChildren(...(poi.curiosidades || []).slice(0, 2).map((x) => el('li', {}, x)));
  if (falarJa) { falar(t); if (navigator.vibrate) navigator.vibrate(120); }
  renderPerto();
}
$('#agora-ouvir').addEventListener('click', () => app.emFoco && falar($('#agora-texto').textContent, true));
$('#agora-mais').addEventListener('click', () => {
  if (!app.emFoco) return;
  const t = app.emFoco.narrativa.longo;
  $('#agora-texto').textContent = t; falar(t, true);
});
$('#agora-perguntar').addEventListener('click', () => { ir('conversa'); $('#entrada-conversa').placeholder = `Pergunte sobre ${app.emFoco?.nome || 'este lugar'}...`; });

const SETA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 5 20l7-4 7 4-7-18Z"/></svg>';
function renderPerto() {
  if (!app.pacote) return;
  const narrados = ler(`narracao.${app.pacote.id}`, { narrados: {} }).narrados;
  const lista = app.pos ? proximos(app.pacote.pois, app.pos) : app.pacote.pois.map((poi) => ({ poi, distancia: null, rumo: null }));
  const dir = bussola.direcao();
  $('#lista-perto').replaceChildren(...lista.slice(0, 12).map(({ poi, distancia, rumo: r }) => {
    const seta = el('span', { class: 'seta' });
    seta.innerHTML = SETA;
    if (r != null) seta.firstChild.style.transform = `rotate(${Math.round(r - (dir ?? 0))}deg)`;
    else seta.style.visibility = 'hidden';
    const dist = distancia == null ? '' : distancia < 1000 ? `${Math.round(distancia / 5) * 5} m` : `${(distancia / 1000).toFixed(1)} km`;
    return el('li', {}, el('button', { class: `ponto ${narrados[poi.id] ? 'narrado' : ''}`, onclick: () => { mostrarAgora(poi, true); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
      seta,
      el('div', {}, el('strong', {}, poi.nome), el('span', {}, narrados[poi.id] ? 'já ouvido · toque para ouvir de novo' : poi.categoria)),
      el('span', { class: 'dist' }, dist)));
  }));
}

// ---------- Avaliação ----------
function avaliar(contexto) {
  const caixa = el('div', { class: 'avaliar' });
  const enviar = async (tipo) => {
    caixa.replaceChildren(el('span', { class: 'motor' }, tipo === 'util' ? 'Obrigado!' : 'Obrigado, vamos revisar este conteúdo.'));
    const item = { id: novoId(), pacoteId: app.pacote.id, tipo, ...contexto };
    try { await api('/api/feedback', item, 10000); } catch { filaAdicionar({ id: item.id, tipo: 'feedback', corpo: item }); }
  };
  caixa.append(el('button', { type: 'button', onclick: () => enviar('util') }, 'Útil'), el('button', { type: 'button', onclick: () => enviar('errado') }, 'Isso está errado'));
  return caixa;
}
const rotuloMotor = (r) => (r.motor === 'ia' ? 'Resposta da IA' : 'Resposta do conteúdo offline');

// ---------- Conversa ----------
function renderConversa() {
  const ol = $('#mensagens');
  if (!app.conversa.length) {
    ol.replaceChildren(el('li', { class: 'msg guia' }, `Olá! Sou seu guia${app.pacote ? ` em ${app.pacote.cidade}` : ''}. Pergunte o que quiser sobre o lugar onde você está, a história, a comida ou o que ver por perto.`));
    return;
  }
  ol.replaceChildren(...app.conversa.map((m) => {
    const li = el('li', { class: `msg ${m.papel}${m.pendente ? ' pendente' : ''}` }, m.texto);
    if (m.papel === 'guia' && !m.pendente) {
      li.append(el('br'), el('button', { class: 'ouvir', type: 'button', onclick: () => falar(m.texto, true) }, 'Ouvir'));
      if (m.motor) li.append(el('div', { class: 'motor' }, rotuloMotor(m)));
      if (app.pacote) li.append(avaliar({ poiId: m.poiId, motor: m.motor, resposta: m.texto }));
    }
    return li;
  }));
  ol.lastElementChild?.scrollIntoView({ block: 'end' });
}
function addMensagem(m) {
  app.conversa.push(m);
  app.conversa = app.conversa.slice(-60);
  gravar('conversa', app.conversa);
  renderConversa();
}

async function perguntar(texto) {
  if (!app.pacote) { addMensagem({ papel: 'guia', texto: 'Escolha um destino em Viagem para eu poder te guiar.' }); return; }
  const historico = app.conversa.filter((m) => !m.pendente).slice(-8).map(({ papel, texto: t }) => ({ papel, texto: t }));
  addMensagem({ papel: 'usuario', texto });
  const corpo = { pacoteId: app.pacote.id, mensagem: texto, pos: app.pos, poiId: app.emFoco?.id, historico, nivel: app.prefs.nivel };
  const pensando = { papel: 'guia', texto: 'Pensando...', pendente: true, temporario: true };
  addMensagem(pensando);
  let r;
  if (online()) {
    try { r = await api('/api/conversa', corpo, 50000); }
    catch (e) { if (!falhaDeRede(e)) r = { texto: e.message, motor: 'local' }; }
  }
  app.conversa = app.conversa.filter((m) => !m.temporario);
  if (!r) { // offline: responde com o pacote e, se não souber, guarda para quando a internet voltar
    const local = responderLocal(app.pacote, texto, app.emFoco?.id);
    if (local) r = { ...local, motor: 'local' };
    else {
      const id = novoId();
      filaAdicionar({ id, tipo: 'conversa', corpo, pacoteId: app.pacote.id });
      r = { texto: 'Estou sem internet e não tenho essa resposta no conteúdo baixado. Guardei sua pergunta e respondo assim que a conexão voltar.', motor: 'local', pendenteId: id };
      atualizarFila();
    }
  }
  addMensagem({ papel: 'guia', texto: r.texto, motor: r.motor, poiId: r.poiId || null });
  if (app.prefs.voz && document.visibilityState === 'visible') falar(r.texto);
}
$('#form-conversa').addEventListener('submit', (e) => {
  e.preventDefault();
  const i = $('#entrada-conversa'); const t = i.value.trim();
  if (!t) return; i.value = ''; perguntar(t);
});

// Ditado por voz (quando o navegador oferece)
const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Reconhecimento) $('#btn-voz').hidden = true;
else {
  $('#btn-voz').addEventListener('click', () => {
    const rec = new Reconhecimento();
    rec.lang = 'pt-BR'; rec.interimResults = false; rec.maxAlternatives = 1;
    const b = $('#btn-voz'); b.classList.add('gravando');
    rec.onresult = (e) => { const t = e.results[0][0].transcript; if (t) perguntar(t); };
    rec.onend = () => b.classList.remove('gravando');
    rec.onerror = () => { b.classList.remove('gravando'); };
    rec.start();
  });
}

// ---------- Foto ----------
async function reduzirFoto(arquivo, lado = 1280, qualidade = 0.78) {
  const img = await createImageBitmap(arquivo).catch(() => null);
  if (!img) throw new Error('Não consegui abrir esta foto.');
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', qualidade);
}

function renderResultadoFoto(r) {
  const art = $('#resultado-foto');
  art.hidden = false;
  art.replaceChildren(
    el('p', { class: 'rotulo' }, r.identificado ? 'Identificado' : 'Resultado'),
    el('h2', {}, r.titulo),
    el('p', {}, r.explicacao),
    el('ul', { class: 'curiosidades' }, (r.curiosidades || []).map((c) => el('li', {}, c))),
    (r.alternativas || []).length ? el('p', { class: 'dica' }, `Pode ser também: ${r.alternativas.map((a) => a.nome).join(', ')}.`) : null,
    el('div', { class: 'acoes' },
      el('button', { class: 'btn', onclick: () => falar(`${r.titulo}. ${r.explicacao}`, true) }, 'Ouvir'),
      el('button', { class: 'btn', onclick: () => { const poi = app.pacote.pois.find((p) => p.id === r.poiId); if (poi) app.emFoco = poi; ir('conversa'); } }, 'Perguntar sobre isso')),
    el('div', { class: 'motor' }, rotuloMotor(r)),
    avaliar({ poiId: r.poiId, motor: r.motor, resposta: `${r.titulo}: ${r.explicacao}` }),
  );
  if (r.identificado) falar(`${r.titulo}. ${r.explicacao}`);
}

$('#entrada-foto').addEventListener('change', async (e) => {
  const arquivo = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  if (!app.pacote) { alertaFaixa('Escolha um destino em Viagem primeiro.'); return; }
  const art = $('#resultado-foto');
  art.hidden = false; art.replaceChildren(el('p', { class: 'carregando' }, 'Olhando a sua foto...'));
  let imagem;
  try { imagem = await reduzirFoto(arquivo); } catch (er) { art.replaceChildren(el('p', {}, er.message)); return; }
  $('#previa').hidden = false; $('#previa-img').src = imagem;
  const corpo = { pacoteId: app.pacote.id, imagem, pos: app.pos, direcao: bussola.direcao(), pergunta: $('#pergunta-foto').value.trim() };
  let r;
  if (online()) {
    try { r = await api('/api/foto', corpo, 60000); }
    catch (er) { if (!falhaDeRede(er)) { art.replaceChildren(el('p', {}, er.message)); return; } }
  }
  if (!r) { // offline: posição + bússola contra os pontos do pacote
    const [melhor, ...outros] = app.pos ? candidatosFoto({ pois: app.pacote.pois, pos: app.pos, direcao: corpo.direcao }) : [];
    if (melhor && melhor.confianca >= 0.45) {
      r = { identificado: true, poiId: melhor.poi.id, titulo: melhor.poi.nome, explicacao: textoNivel(melhor.poi), curiosidades: melhor.poi.curiosidades || [], alternativas: outros.map((c) => ({ nome: c.poi.nome })), motor: 'local' };
    } else {
      const guardou = filaAdicionar({ id: novoId(), tipo: 'foto', corpo, pacoteId: app.pacote.id });
      r = { identificado: false, titulo: 'Não identifiquei sem internet', explicacao: guardou ? 'Sem conexão eu reconheço só os pontos turísticos desta viagem, pela sua posição e direção da câmera. Guardei a foto e explico quando a internet voltar.' : 'Sem conexão eu reconheço só os pontos turísticos desta viagem. A fila de fotos está cheia: tente de novo quando tiver internet.', curiosidades: [], motor: 'local' };
      atualizarFila();
    }
  }
  renderResultadoFoto(r);
});

// ---------- Fila de pendências ----------
function atualizarFila() {
  const fila = ler('fila', []).filter((f) => f.tipo !== 'feedback');
  const faixa = $('#faixa-fila');
  faixa.hidden = !fila.length;
  faixa.textContent = fila.length ? `${fila.length} ${fila.length === 1 ? 'pergunta ou foto aguardando' : 'perguntas ou fotos aguardando'} internet.` : '';
}
let processando = false;
async function processarFila() {
  if (processando || !online()) return;
  processando = true;
  try {
    for (const item of ler('fila', [])) {
      try {
        if (item.tipo === 'feedback') { await api('/api/feedback', item.corpo, 10000); }
        else if (item.tipo === 'conversa') {
          const r = await api('/api/conversa', item.corpo, 50000);
          addMensagem({ papel: 'guia', texto: `Sobre "${item.corpo.mensagem}": ${r.texto}`, motor: r.motor, poiId: r.poiId || null });
        } else if (item.tipo === 'foto') {
          const r = await api('/api/foto', item.corpo, 60000);
          addMensagem({ papel: 'guia', texto: `Sobre a foto que você tirou: ${r.titulo}. ${r.explicacao}`, motor: r.motor, poiId: r.poiId || null });
        }
        filaRemover(item.id);
      } catch (e) {
        if (falhaDeRede(e)) break; // ainda sem conexão: tenta depois
        filaRemover(item.id); // o servidor recusou (ex.: pacote removido): não adianta repetir
      }
    }
  } finally { processando = false; atualizarFila(); }
  if (ler('fila', []).length === 0 && document.querySelector('#tela-conversa').hidden === false) renderConversa();
}

function alertaFaixa(msg) {
  const f = $('#faixa-fila');
  f.hidden = false; f.textContent = msg;
  clearTimeout(alertaFaixa.t); alertaFaixa.t = setTimeout(atualizarFila, 6000);
}

// ---------- Preferências ----------
function aplicarPrefs() {
  $('#pref-frequencia').value = app.prefs.frequencia;
  $('#pref-nivel').value = app.prefs.nivel;
  $('#pref-voz').checked = app.prefs.voz;
  $('#pref-simulacao').checked = app.prefs.simulacao;
}
for (const [id, chave, tipo] of [['#pref-frequencia', 'frequencia'], ['#pref-nivel', 'nivel'], ['#pref-voz', 'voz', 'check'], ['#pref-simulacao', 'simulacao', 'check']]) {
  $(id).addEventListener('change', (e) => {
    app.prefs[chave] = tipo === 'check' ? e.target.checked : e.target.value;
    gravar('prefs', app.prefs);
    if (chave === 'simulacao') {
      const ativo = app.passeioAtivo; if (ativo) pausarPasseio();
      if (app.prefs.simulacao) ligarSimulacao(); else desligarSimulacao();
      if (ativo) iniciarPasseio();
      atualizarSelos(); renderPerto();
    }
    if (chave === 'voz' && !app.prefs.voz && 'speechSynthesis' in window) speechSynthesis.cancel();
  });
}
$('#btn-apagar').addEventListener('click', () => {
  pausarPasseio(); apagarTudo();
  app.prefs = { ...PREFS_PADRAO }; app.conversa = []; app.pacote = null; app.emFoco = null; app.pos = null;
  aplicarPrefs(); desligarSimulacao();
  $('#cartao-agora').hidden = true; $('#passeio').hidden = true; $('#sem-pacote').hidden = false;
  atualizarFila(); atualizarSelos(); renderDestinos();
  alertaFaixa('Dados apagados deste aparelho.');
});

// ---------- Início ----------
window.addEventListener('online', () => { atualizarSelos(); processarFila(); });
window.addEventListener('offline', atualizarSelos);
setInterval(renderPerto, 4000); // atualiza as setas com a bússola

async function iniciar() {
  aplicarPrefs();
  const salvo = ler('pacoteAtivo', null);
  const p = salvo && pacoteSalvo(salvo);
  if (p) ativarPacote(p); else { $('#sem-pacote').hidden = false; }
  atualizarFila(); atualizarSelos();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (online()) {
    try {
      const h = await api('/api/health', null, 8000);
      app.servidorIa = h.ia;
      $('#sobre').textContent = `GuIA Brasil · MVP de teste · ${h.ia ? 'IA ligada' : 'IA desligada no servidor (respostas do conteúdo curado)'}`;
    } catch { /* offline de fato */ }
    atualizarSelos();
    processarFila();
  }
}
iniciar();
