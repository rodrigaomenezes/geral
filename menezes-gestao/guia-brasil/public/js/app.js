// Interface do GuIA Brasil. Regras ficam em nucleo.js; aqui só tela, sensores, voz e rede.
import { proximos, responderLocal, candidatosFoto, VERSAO_PACOTE, anexarAoTrajeto, rumoDaCaminhada, proximoAlerta, registrarAlerta, resumoCaminhada, ROTULO_ALERTA } from './nucleo.js';
import { acompanharGps, localizarUmaVez, simularCaminhada, criarBussola, ehIOS } from './sensores.js';
import { ler, gravar, apagarTudo, PREFS_PADRAO, filaAdicionar, filaRemover, novoId } from './estado.js';
import * as plat from './plataforma.js';
import * as minhaIa from './minhaia.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null) e.append(f);
  return e;
};

function carregarPrefs() {
  const salvas = ler('prefs', {});
  return { ...PREFS_PADRAO, ...salvas, avisos: { ...plat.AVISOS_PADRAO, ...(salvas.avisos || {}) } };
}

const app = {
  prefs: carregarPrefs(),
  pacote: null,
  pos: null,
  passeioAtivo: false,
  pararGps: null,
  simulador: null,
  emFoco: null, // ponto atual da conversa
  trajeto: [],
  rumoCaminhada: null,
  inicioCaminhada: 0,
  conversa: ler('conversa', []),
  servidorIa: null,
};
const bussola = criarBussola();
bussola.ligar(); // Android não pede permissão; no iOS só funciona depois do toque em "Começar a caminhar"

// ---------- Rede ----------
const online = () => navigator.onLine !== false;
async function api(caminho, corpo, ms = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    // Conversa e foto levam a conexão com a IA da pessoa, se ela conectou (a chave fica só no aparelho).
    const extra = caminho === '/api/conversa' || caminho === '/api/foto' ? minhaIa.cabecalhos() : {};
    const r = await fetch(caminho, corpo ? { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(corpo), signal: ctl.signal } : { signal: ctl.signal });
    if (r.status === 204) return null;
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(dados.erro || `Erro ${r.status}`); e.status = r.status; throw e; }
    avisarSobreMinhaIa(dados);
    return dados;
  } finally { clearTimeout(t); }
}
const falhaDeRede = (e) => !e.status; // sem status = não chegou ao servidor

/** A OpenRouter recusou a conexão da pessoa (401) ou ela está sem créditos (402): avisa e, se inválida, desconecta. */
function avisarSobreMinhaIa(r) {
  if (!r || !r.iaUsuario) return;
  if (r.iaUsuario === 'invalida') { minhaIa.desconectar(); renderMinhaIa(); alertaFaixa('A conexão com a sua IA expirou. Conecte de novo em Viagem.'); }
  if (r.iaUsuario === 'sem-creditos') alertaFaixa('Sua conta OpenRouter está sem créditos. Respondi com o conteúdo da viagem.');
}

function atualizarSelos() {
  const rede = $('#selo-rede');
  rede.textContent = online() ? (app.servidorIa || minhaIa.conexao() ? 'online · IA' : 'online') : 'offline';
  rede.className = `selo ${online() ? 'ok' : 'aviso'}`;
  const p = $('#selo-pos');
  if (!app.pos) { p.textContent = app.passeioAtivo ? 'buscando GPS' : 'sem GPS'; p.className = 'selo'; }
  else if (app.pos.simulada) { p.textContent = 'simulação'; p.className = 'selo aviso'; }
  else { p.textContent = `GPS ±${Math.round(app.pos.precisao || 0)} m`; p.className = 'selo ok'; }
}

// ---------- Voz ----------
function falar(texto, forcar = false) {
  if (!app.prefs.voz && !forcar) return;
  plat.falar(texto);
  // No iPhone a voz de sites fica muda com o modo silencioso: avisa uma vez quando a pessoa toca em "Ouvir".
  if (forcar && ehIOS() && !plat.ehAppNativo() && !ler('dicaSilencioso', false)) {
    gravar('dicaSilencioso', true);
    alertaFaixa('Sem som? No iPhone a voz do app fica muda com o modo silencioso ligado (chave na lateral). Desligue o silencioso e aumente o volume.', 12000);
  }
}

// ---------- Navegação ----------
function ir(tela) {
  document.querySelectorAll('.tela').forEach((t) => { t.hidden = t.dataset.tela !== tela; });
  document.querySelectorAll('.abas button').forEach((b) => (b.dataset.ir === tela ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (tela === 'conversa') { renderConversa(); setTimeout(() => $('#entrada-conversa').focus({ preventScroll: true }), 50); }
  if (tela === 'viagem') renderDestinos();
  if (tela === 'passeio') localizarAgora();
  window.scrollTo({ top: 0 });
}

function estadoGps(t) { $('#estado-gps').textContent = t; }

/** Mostra onde a pessoa está ao abrir o Passeio, sem ligar o acompanhamento (que só começa em "Começar a caminhar").
 *  `forcar` = toque no botão: lê de novo na hora (e, no iPhone, o toque garante o pedido de permissão). */
let ultimaLocalizacao = 0;
function localizarAgora(forcar = false) {
  if (app.passeioAtivo) return;
  if (app.prefs.simulacao) { estadoGps('Simulação ligada: o GPS real está desligado.'); return; }
  if (!forcar && Date.now() - ultimaLocalizacao < 30000) return;
  ultimaLocalizacao = Date.now();
  $('#selo-pos').textContent = 'buscando GPS';
  estadoGps('Procurando você...');
  localizarUmaVez((p) => {
    if (app.passeioAtivo || app.prefs.simulacao) return;
    app.pos = p;
    estadoGps(`Localização encontrada (precisão de ${Math.round(p.precisao || 0)} m).`);
    atualizarSelos(); renderPerto(); mostrarOndeEstou(p);
  }, (msg, codigo) => {
    estadoGps(codigo === 1 ? 'Localização bloqueada (veja o aviso no topo).' : codigo === 3 ? 'O GPS demorou. Toque para tentar de novo.' : 'Não consegui ler o GPS.');
    atualizarSelos(); alertaFaixa(msg, codigo === 1 ? 15000 : 8000);
  });
}
$('#btn-localizar').addEventListener('click', () => localizarAgora(true));
$('#btn-sair-simulacao').addEventListener('click', () => {
  const ativo = app.passeioAtivo; if (ativo) encerrarPasseio({ resumo: false });
  app.prefs.simulacao = false; gravar('prefs', app.prefs); aplicarPrefs();
  desligarSimulacao(); atualizarSelos(); renderPerto();
  localizarAgora(true);
});

const CATEGORIAS = { praca: 'praça', historico: 'patrimônio histórico', cultura: 'cultura', natureza: 'natureza', lugar: 'lugar' };

/** "Você está em Mercado de Arte Popular · Centro · Feira de Santana": nome do lugar pelo mapa (só online). */
async function mostrarOndeEstou(p) {
  if (!p || p.simulada || !online()) return;
  const chave = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  if (!app.onde || app.onde.chave !== chave) {
    try {
      const o = await api(`/api/onde?${new URLSearchParams({ lat: String(p.lat), lng: String(p.lng) })}`, null, 10000);
      app.onde = { ...o, chave };
    } catch { return; } // sem nome: fica só a linha do GPS
  }
  if (app.prefs.simulacao) return;
  const e = $('#onde-estou');
  e.textContent = `Você está em ${app.onde.texto}`;
  e.hidden = false;
  renderDistanciaDestino();
}

/** Longe de todos os pontos (ex.: testando fora de Salvador): explica e oferece a simulação. */
function renderDistanciaDestino() {
  const c = $('#cartao-longe');
  if (!app.pacote || !app.pos || app.pos.simulada || app.prefs.simulacao) { c.hidden = true; return; }
  const [maisPerto] = proximos(app.pacote.pois, app.pos);
  if (!maisPerto || maisPerto.distancia < 2000) { c.hidden = true; return; }
  const km = maisPerto.distancia / 1000;
  const dist = km < 100 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km).toLocaleString('pt-BR')} km`;
  const aqui = app.onde && app.onde.cidade && app.onde.cidade !== app.pacote.cidade ? app.onde.cidade : '';
  $('#longe-texto').textContent = aqui
    ? `Você está em ${aqui}, a ${dist} dos pontos de ${app.pacote.cidade}. Quer o guia de ${aqui}? Ou ligue a simulação para testar ${app.pacote.cidade}.`
    : `O GPS encontrou você, a ${dist} de ${app.pacote.cidade}. Quer o guia daqui? Ou ligue a simulação para testar ${app.pacote.cidade}.`;
  const b = $('#btn-guia-aqui');
  if (!b.disabled) b.textContent = aqui ? `Guia de ${aqui}` : 'Guia de onde estou';
  c.hidden = false;
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

/** Sem destino e com um só disponível: baixa sozinho (no iPhone o atalho da tela inicial não vê o que o Safari baixou). */
async function baixarDestinoUnico() {
  try {
    const lista = await api('/api/pacotes', null, 10000);
    if (lista.length !== 1) return;
    ativarPacote(await baixarPacote(lista[0].id));
    alertaFaixa(`Baixei o destino ${lista[0].nome} para usar também sem internet.`);
    if (!$('#tela-passeio').hidden) localizarAgora();
  } catch { /* segue sem destino; a pessoa escolhe em Viagem */ }
}

// ---------- Qualquer lugar (G-017) ----------
/** Guarda um destino gerado no aparelho, lembra em "meus lugares" e passa a usá-lo. */
function usarDestinoGerado(p) {
  if (!gravar(`pacote.${p.id}`, p)) throw new Error('Sem espaço no aparelho para guardar este destino.');
  const meus = ler('meusLugares', []).filter((x) => x.id !== p.id);
  meus.unshift({ id: p.id, nome: p.nome, pontos: p.pois.length, bytes: JSON.stringify(p).length, gerado: true, em: Date.now() });
  gravar('meusLugares', meus.slice(0, 10));
  ativarPacote(p);
  app.pos = app.pos && !app.pos.simulada ? app.pos : null;
  ir('passeio');
  alertaFaixa(`Pronto: ${p.pois.length} pontos em ${p.cidade}, guardados para usar também sem internet.`, 8000);
}

async function gerarDestino({ lat, lng, nome }, botao) {
  if (!online()) { alertaFaixa('Para montar um destino novo é preciso internet.'); return; }
  const texto = botao ? botao.textContent : '';
  if (botao) { botao.disabled = true; botao.textContent = 'Montando o roteiro...'; }
  try {
    const q = new URLSearchParams({ lat: String(lat), lng: String(lng), ...(nome ? { nome } : {}) });
    usarDestinoGerado(await api(`/api/perto?${q}`, null, 60000));
  } catch (e) {
    alertaFaixa(e.message || 'Não consegui montar o roteiro agora.', 10000);
  } finally { if (botao) { botao.disabled = false; botao.textContent = texto; } }
}

/** Lê o GPS (com o toque da pessoa) e monta o guia ao redor. */
function guiaDeOndeEstou(botao) {
  estadoGps('Procurando você...');
  localizarUmaVez((p) => {
    app.pos = p; atualizarSelos(); estadoGps(`Encontrado (precisão de ${Math.round(p.precisao || 0)} m).`);
    mostrarOndeEstou(p);
    gerarDestino({ lat: p.lat, lng: p.lng }, botao);
  }, (msg, codigo) => { estadoGps(codigo === 1 ? 'Localização bloqueada.' : 'Não consegui ler o GPS.'); alertaFaixa(msg, 15000); });
}
$('#btn-guia-aqui').addEventListener('click', (e) => guiaDeOndeEstou(e.currentTarget));
$('#btn-guia-aqui-viagem').addEventListener('click', (e) => guiaDeOndeEstou(e.currentTarget));

$('#form-busca').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#entrada-busca').value.trim();
  const ul = $('#resultados-busca');
  if (q.length < 2) return;
  if (!online()) { alertaFaixa('Para buscar um lugar novo é preciso internet.'); return; }
  $('#entrada-busca').blur();
  ul.replaceChildren(el('li', { class: 'carregando' }, 'Buscando...'));
  try {
    const lista = await api(`/api/lugares?${new URLSearchParams({ q })}`, null, 20000);
    ul.replaceChildren(...(lista.length ? lista.map((l) => {
      const b = el('button', { class: 'resultado', type: 'button', onclick: () => gerarDestino(l, b) }, el('strong', {}, l.nome), el('span', {}, l.detalhe));
      return el('li', {}, b);
    }) : [el('li', { class: 'dica' }, 'Não encontrei esse lugar. Tente o nome da cidade.')]));
  } catch (er) { ul.replaceChildren(el('li', { class: 'dica' }, er.message || 'Não consegui buscar agora.')); }
});

async function renderDestinos() {
  const ul = $('#lista-destinos');
  let lista = ler('destinos', []);
  if (online()) {
    try { lista = await api('/api/pacotes', null, 10000); gravar('destinos', lista); } catch { /* usa a lista guardada */ }
  }
  // Destinos gerados (qualquer lugar) que a pessoa já usou: ficam no aparelho e funcionam sem internet.
  const meus = ler('meusLugares', []).filter((m) => pacoteSalvo(m.id));
  lista = [...meus, ...lista.filter((d) => !meus.some((m) => m.id === d.id))];
  ul.replaceChildren(...(lista.length ? lista : []).map((d) => {
    const salvo = pacoteSalvo(d.id);
    const ativo = app.pacote && app.pacote.id === d.id;
    const btn = el('button', { class: `btn ${salvo ? '' : 'primario'}`, onclick: async () => {
      btn.disabled = true; btn.textContent = 'Baixando...';
      try { const p = d.gerado || (salvo && !online()) ? salvo : await baixarPacote(d.id); ativarPacote(p); ir('passeio'); }
      catch (e) { btn.disabled = false; btn.textContent = 'Tentar de novo'; alertaFaixa(e.message || 'Não foi possível baixar.'); }
    } }, salvo ? (ativo && !d.gerado ? 'Atualizar e usar' : ativo ? 'Em uso' : 'Usar este destino') : `Baixar para usar offline · ${Math.max(1, Math.round(d.bytes / 1024))} KB`);
    const remover = d.gerado ? el('button', { class: 'btn', onclick: () => {
      gravar(`pacote.${d.id}`, null); gravar('meusLugares', ler('meusLugares', []).filter((m) => m.id !== d.id));
      if (ativo) { app.pacote = null; gravar('pacoteAtivo', null); $('#passeio').hidden = true; $('#sem-pacote').hidden = false; }
      renderDestinos();
    } }, 'Remover') : null;
    return el('li', { class: `destino ${ativo ? 'ativo' : ''}` },
      d.gerado ? el('p', { class: 'gerado' }, 'Montado na hora · Wikipédia') : null,
      el('h4', {}, d.nome),
      el('p', { class: 'dica' }, `${d.pontos} pontos · ${salvo ? 'disponível offline' : 'ainda não baixado'}`),
      el('div', { class: 'acoes' }, btn, remover));
  }));
  if (!lista.length) ul.replaceChildren(el('li', { class: 'dica' }, online() ? 'Nenhum destino disponível.' : 'Sem internet e sem destinos baixados.'));
}

// ---------- Companheiro de caminhada ----------
// Acompanha o trajeto e avisa sozinho (nucleo.proximoAlerta). Estado por pacote, só no aparelho.
const chaveEstado = () => `companheiro.${app.pacote.id}`;
const lerEstado = () => ler(chaveEstado(), { narrados: {}, anunciados: {}, avisos: {} });
let wakeLock = null;
let placarTimer = null;

async function manterTelaAcesa() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } }
  catch { /* sem permissão ou sem suporte: segue com a tela podendo apagar */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && app.passeioAtivo) manterTelaAcesa(); });

function iniciarPasseio() {
  if (!app.pacote) return;
  app.passeioAtivo = true;
  app.inicioCaminhada = Date.now();
  app.trajeto = [];
  bussola.pedirPermissao();
  plat.liberarVoz(); // iPhone: a voz só funciona depois de um toque
  manterTelaAcesa();
  if (!app.prefs.simulacao) {
    // No app Android o GPS vem do serviço nativo (segue com a tela bloqueada); no navegador, da página.
    app.pararGps = plat.acompanharGpsNativo(aoMudarPosicao, () => { if (app.passeioAtivo) encerrarPasseio(); })
      || acompanharGps(aoMudarPosicao, (msg, codigo) => { alertaFaixa(codigo === 1 ? msg : `${msg} Você pode ativar a simulação em Viagem.`, 15000); });
  } else if (app.simulador) aoMudarPosicao(app.simulador.posicao());
  const b = $('#btn-passeio'); b.textContent = 'Encerrar caminhada'; b.classList.add('ligado'); b.setAttribute('aria-pressed', 'true');
  $('#dica-passeio').textContent = app.prefs.simulacao
    ? 'Simulação ligada: use o botão abaixo para andar.'
    : 'Pode seguir andando: eu aviso quando houver algo interessante por perto. Deixe o app aberto.';
  $('#cartao-resumo').hidden = true;
  $('#placar').hidden = false;
  atualizarPlacar();
  placarTimer = setInterval(atualizarPlacar, 15000);
  atualizarSelos();
}

function encerrarPasseio({ resumo = true } = {}) {
  const estava = app.passeioAtivo;
  app.passeioAtivo = false;
  if (app.pararGps) app.pararGps(); app.pararGps = null;
  plat.pararFala();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  clearInterval(placarTimer);
  const b = $('#btn-passeio'); b.textContent = 'Começar a caminhar'; b.classList.remove('ligado'); b.setAttribute('aria-pressed', 'false');
  $('#dica-passeio').textContent = 'Eu acompanho o seu trajeto e aviso sozinho quando houver algo interessante por perto.';
  $('#placar').hidden = true;
  if (estava && resumo && app.pacote) mostrarResumo();
  atualizarSelos();
}
$('#btn-passeio').addEventListener('click', () => (app.passeioAtivo ? encerrarPasseio() : iniciarPasseio()));

function formatarKm(m) { return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`; }
function atualizarPlacar() {
  if (!app.pacote) return;
  const r = resumoCaminhada(app.trajeto, lerEstado(), app.inicioCaminhada);
  const min = Math.round((Date.now() - app.inicioCaminhada) / 60000);
  $('#placar').textContent = `${formatarKm(r.metros)} · ${r.lugares} ${r.lugares === 1 ? 'lugar' : 'lugares'} · ${min} min`;
}

function mostrarResumo() {
  const estado = lerEstado();
  const r = resumoCaminhada(app.trajeto, estado, app.inicioCaminhada);
  const min = Math.max(1, Math.round((Date.now() - app.inicioCaminhada) / 60000));
  const nomes = Object.entries(estado.narrados || {}).filter(([, t]) => t >= app.inicioCaminhada).sort((a, b) => a[1] - b[1])
    .map(([id]) => app.pacote.pois.find((p) => p.id === id)?.nome).filter(Boolean);
  const frase = r.lugares
    ? `Você caminhou ${formatarKm(r.metros)} em ${min} min e conheceu ${r.lugares} ${r.lugares === 1 ? 'lugar' : 'lugares'}.`
    : `Você caminhou ${formatarKm(r.metros)} em ${min} min. Ainda não passamos por nenhum ponto do roteiro.`;
  $('#resumo-texto').textContent = frase;
  $('#resumo-lugares').replaceChildren(...nomes.map((n) => el('li', {}, n)));
  $('#cartao-resumo').hidden = false;
  $('#cartao-agora').hidden = true;
  falar(`Caminhada encerrada. ${frase}`);
}

function ligarSimulacao() {
  if (!app.pacote) return;
  if (app.simulador) app.simulador.parar();
  app.simulador = simularCaminhada(app.pacote, aoMudarPosicao);
  $('#simulacao').hidden = false;
  $('#onde-estou').hidden = true;
  $('#sim-onde').textContent = `Próximo: ${app.simulador.proximo().nome}`;
}
function desligarSimulacao() {
  if (app.simulador) app.simulador.parar();
  app.simulador = null;
  $('#simulacao').hidden = true;
  if (app.pos && app.pos.simulada) app.pos = null;
}
$('#btn-ligar-simulacao').addEventListener('click', () => {
  app.prefs.simulacao = true; gravar('prefs', app.prefs); aplicarPrefs();
  ligarSimulacao(); app.pos = null; atualizarSelos(); renderPerto();
  $('#simulacao').scrollIntoView({ block: 'center', behavior: 'smooth' });
});
$('#btn-avancar').addEventListener('click', () => {
  if (!app.passeioAtivo) iniciarPasseio();
  const alvo = app.simulador.avancar();
  $('#sim-onde').textContent = `Caminhando até ${alvo.nome}... depois: ${app.simulador.proximo().nome}`;
});


function aoMudarPosicao(p) {
  if (p.simulada && !app.prefs.simulacao) return;
  app.pos = p;
  atualizarSelos();
  if (app.passeioAtivo) {
    app.trajeto = anexarAoTrajeto(app.trajeto, p);
    app.rumoCaminhada = rumoDaCaminhada(app.trajeto);
    if (app.trajeto.length % 10 === 0) gravar('trajeto', app.trajeto); // só no aparelho (privacidade)
    atualizarPlacar();
  }
  renderPerto();
  if (!app.passeioAtivo || !app.pacote || plat.falando()) return; // não fala por cima de si mesmo
  const estado = lerEstado();
  // Em segundo plano só valem os tipos marcados para notificar; o limite por hora poupa só o importante.
  const alerta = proximoAlerta({ pacote: app.pacote, pos: p, rumoCaminhada: app.rumoCaminhada, estado, frequencia: app.prefs.frequencia,
    tipos: plat.tiposAtivos(app.prefs.avisos), maxPorHora: app.prefs.maxPorHora });
  if (!alerta) return;
  gravar(chaveEstado(), registrarAlerta(estado, alerta));
  mostrarAlerta(alerta);
}

function textoNivel(poi, nivel = app.prefs.nivel) { return poi.narrativa[nivel] || poi.narrativa.medio; }

const VIBRACAO = { importante: [200, 100, 200, 100, 200], chegada: [120], 'a-caminho': [60, 60, 60], dica: [60], novidade: [60, 60, 60] };

/** Mostra (e fala) um alerta do companheiro. Para "chegada" usa a narrativa no nível escolhido. */
function mostrarAlerta(alerta) {
  const c = $('#cartao-agora');
  c.hidden = false;
  c.dataset.tipo = alerta.tipo;
  $('#cartao-resumo').hidden = true;
  $('#agora-rotulo').textContent = ROTULO_ALERTA[alerta.tipo];
  $('#agora-nome').textContent = alerta.titulo;
  const poi = alerta.poi || null;
  if (poi) app.emFoco = poi;
  const texto = alerta.tipo === 'chegada' ? textoNivel(poi) : alerta.texto;
  $('#agora-texto').textContent = texto;
  $('#agora-curiosidades').replaceChildren(...(alerta.tipo === 'chegada' ? (poi.curiosidades || []).slice(0, 2) : []).map((x) => el('li', {}, x)));
  $('#agora-mais').hidden = !poi;
  $('#agora-perguntar').hidden = !poi && !app.emFoco;
  mostrarFonte(poi);
  falar(alerta.tipo === 'chegada' ? `${poi.nome}. ${texto}` : alerta.tipo === 'a-caminho' ? texto : `${ROTULO_ALERTA[alerta.tipo]}. ${texto}`);
  if (navigator.vibrate) navigator.vibrate(VIBRACAO[alerta.tipo] || [100]);
  const curto = alerta.tipo === 'chegada' ? (poi.teaser || poi.narrativa.curto) : alerta.texto;
  plat.notificar({ ...alerta, textoCurto: curto }, app.prefs.avisos[alerta.tipo]);
  renderPerto();
}

/** Toque numa notificação: abre o Passeio com o ponto ou o aviso dela. */
plat.aoAbrirAlerta((id) => {
  if (!app.pacote) return;
  ir('passeio');
  const poi = app.pacote.pois.find((x) => x.id === id);
  if (poi) { mostrarAgora(poi, false); return; }
  const aviso = (app.pacote.avisos || []).find((x) => x.id === id);
  if (!aviso) return;
  const c = $('#cartao-agora');
  c.hidden = false; c.dataset.tipo = aviso.tipo;
  $('#agora-rotulo').textContent = ROTULO_ALERTA[aviso.tipo];
  $('#agora-nome').textContent = aviso.titulo || ROTULO_ALERTA[aviso.tipo];
  $('#agora-texto').textContent = aviso.texto;
  $('#agora-curiosidades').replaceChildren();
  $('#agora-mais').hidden = true;
});

/** Atribuição do texto (Wikipédia, CC BY-SA) quando o ponto veio de um destino montado na hora. */
function mostrarFonte(poi) {
  const a = $('#agora-fonte');
  if (poi && poi.fonte) { a.hidden = false; a.href = poi.fonte.url; a.textContent = `Fonte: ${poi.fonte.nome} (CC BY-SA)`; }
  else a.hidden = true;
}

function mostrarAgora(poi, falarJa) {
  const c = $('#cartao-agora');
  c.hidden = false;
  c.dataset.tipo = 'ponto';
  $('#agora-rotulo').textContent = 'Sobre este lugar';
  app.emFoco = poi;
  $('#agora-nome').textContent = poi.nome;
  const t = textoNivel(poi);
  $('#agora-texto').textContent = t;
  $('#agora-curiosidades').replaceChildren(...(poi.curiosidades || []).slice(0, 2).map((x) => el('li', {}, x)));
  $('#agora-mais').hidden = false; $('#agora-perguntar').hidden = false;
  mostrarFonte(poi);
  if (falarJa) falar(t, true);
  renderPerto();
}
$('#agora-ouvir').addEventListener('click', () => falar($('#agora-texto').textContent, true));
$('#agora-mais').addEventListener('click', () => {
  if (!app.emFoco) return;
  const t = app.emFoco.narrativa.longo;
  $('#agora-nome').textContent = app.emFoco.nome;
  $('#agora-texto').textContent = t; falar(t, true);
});
$('#agora-perguntar').addEventListener('click', () => { ir('conversa'); $('#entrada-conversa').placeholder = `Pergunte sobre ${app.emFoco?.nome || 'este lugar'}...`; });

const SETA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 5 20l7-4 7 4-7-18Z"/></svg>';
function renderPerto() {
  if (!app.pacote) return;
  const narrados = lerEstado().narrados || {};
  const lista = app.pos ? proximos(app.pacote.pois, app.pos) : app.pacote.pois.map((poi) => ({ poi, distancia: null, rumo: null }));
  renderDistanciaDestino();
  // Seta relativa a quem segura o celular: bússola; sem bússola, a direção em que está andando.
  const dir = bussola.direcao() ?? app.rumoCaminhada ?? 0;
  $('#lista-perto').replaceChildren(...lista.slice(0, 12).map(({ poi, distancia, rumo: r }) => {
    const seta = el('span', { class: 'seta' });
    seta.innerHTML = SETA;
    if (r != null) seta.firstChild.style.transform = `rotate(${Math.round(r - dir)}deg)`;
    else seta.style.visibility = 'hidden';
    const dist = distancia == null ? '' : distancia < 1000 ? `${Math.round(distancia / 5) * 5} m` : `${(distancia / 1000).toFixed(1)} km`;
    return el('li', {}, el('button', { class: `ponto ${narrados[poi.id] ? 'narrado' : ''}`, onclick: () => { mostrarAgora(poi, true); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
      seta,
      el('div', {}, el('strong', {}, poi.nome), el('span', {}, narrados[poi.id] ? 'já visitado · toque para ouvir de novo' : (CATEGORIAS[poi.categoria] || poi.categoria))),
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
const rotuloMotor = (r) => {
  if (r.motor !== 'ia') return 'Resposta do conteúdo da viagem';
  return r.provedor === 'openrouter' ? `Resposta da sua IA${r.modelo ? ` (${r.modelo})` : ''}` : 'Resposta da IA';
};

// ---------- Conversa ----------
function renderConversa() {
  const ol = $('#mensagens');
  if (!app.conversa.length) {
    ol.replaceChildren(el('li', { class: 'msg guia' }, `Olá! Sou seu guia${app.pacote ? ` em ${app.pacote.cidade}` : ''}. Pergunte o que quiser sobre o lugar onde você está, a história, a comida ou o que ver por perto.`));
    renderSugestoes(true);
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
  renderSugestoes(!!app.conversa.at(-1)?.semResposta);
  rolarAteFim();
}

/** Leva a tela até a última mensagem. A caixa de digitação e as abas ficam por cima do fim da lista,
 *  então rolamos a página até o fim (não basta scrollIntoView: a resposta ficava escondida no iPhone). */
function rolarAteFim() {
  requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
}

/** Perguntas que o guia sabe responder com o conteúdo da viagem: do ponto em foco primeiro, depois as gerais. */
function sugestoesDePerguntas(max = 3) {
  if (!app.pacote) return [];
  const feitas = new Set(app.conversa.filter((m) => m.papel === 'usuario').map((m) => m.texto.trim().toLowerCase()));
  const doFoco = app.emFoco ? (app.emFoco.perguntas || []).map((f) => f.p) : [];
  const gerais = (app.pacote.perguntasGerais || []).map((f) => f.p);
  const dosPontos = app.pacote.pois.map((poi) => (poi.perguntas || [])[0]?.p).filter(Boolean);
  return [...new Set([...doFoco, ...gerais, ...dosPontos])].filter((q) => !feitas.has(q.toLowerCase())).slice(0, max);
}
function renderSugestoes(mostrar) {
  const lista = mostrar ? sugestoesDePerguntas() : [];
  const caixa = $('#sugestoes');
  caixa.hidden = !lista.length;
  caixa.replaceChildren(...lista.map((q) => el('button', { type: 'button', class: 'sugestao', onclick: () => perguntar(q) }, q)));
  // Sem IA nenhuma, a saída para perguntas livres é conectar a IA da própria pessoa.
  if (mostrar && !app.servidorIa && !minhaIa.conexao()) {
    caixa.hidden = false;
    caixa.append(el('button', { type: 'button', class: 'sugestao destaque-ia', onclick: () => { ir('viagem'); $('#cartao-minha-ia').scrollIntoView({ block: 'center' }); } }, 'Conectar minha IA para perguntas livres'));
  }
}
function addMensagem(m) {
  app.conversa.push(m);
  app.conversa = app.conversa.slice(-60);
  gravar('conversa', app.conversa);
  renderConversa();
}

async function perguntar(texto) {
  // Sem destino a conversa segue: com IA (do servidor ou da pessoa) a resposta vem pelo conhecimento geral e pela posição.
  const historico = app.conversa.filter((m) => !m.pendente).slice(-8).map(({ papel, texto: t }) => ({ papel, texto: t }));
  addMensagem({ papel: 'usuario', texto });
  const corpo = { pacoteId: app.pacote?.id, mensagem: texto, pos: app.pos, poiId: app.emFoco?.id, historico, nivel: app.prefs.nivel };
  const pensando = { papel: 'guia', texto: 'Pensando...', pendente: true, temporario: true };
  addMensagem(pensando);
  let r;
  if (online()) {
    try { r = await api('/api/conversa', corpo, 50000); }
    catch (e) { if (!falhaDeRede(e)) r = { texto: e.message, motor: 'local' }; }
  }
  app.conversa = app.conversa.filter((m) => !m.temporario);
  if (!r) { // offline: responde com o pacote e, se não souber, guarda para quando a internet voltar
    const local = app.pacote ? responderLocal(app.pacote, texto, app.emFoco?.id) : null;
    if (local) r = { ...local, motor: 'local' };
    else {
      const id = novoId();
      filaAdicionar({ id, tipo: 'conversa', corpo, pacoteId: app.pacote?.id });
      r = { texto: 'Estou sem internet e não tenho essa resposta no conteúdo baixado. Guardei sua pergunta e respondo assim que a conexão voltar.', motor: 'local', pendenteId: id };
      atualizarFila();
    }
  }
  addMensagem({ papel: 'guia', texto: r.texto, motor: r.motor, provedor: r.provedor, modelo: r.modelo, poiId: r.poiId || null, semResposta: !!r.semResposta });
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
      el('button', { class: 'btn', onclick: () => { const poi = app.pacote?.pois.find((p) => p.id === r.poiId); if (poi) app.emFoco = poi; ir('conversa'); } }, 'Perguntar sobre isso')),
    el('div', { class: 'motor' }, rotuloMotor(r)),
    app.pacote ? avaliar({ poiId: r.poiId, motor: r.motor, resposta: `${r.titulo}: ${r.explicacao}` }) : null,
  );
  if (r.identificado) falar(`${r.titulo}. ${r.explicacao}`);
}

$('#entrada-foto').addEventListener('change', async (e) => {
  const arquivo = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  if (!app.pacote && !online()) { alertaFaixa('Sem internet, a foto só é reconhecida com um destino baixado em Viagem.'); return; }
  const art = $('#resultado-foto');
  art.hidden = false; art.replaceChildren(el('p', { class: 'carregando' }, 'Olhando a sua foto...'));
  let imagem;
  try { imagem = await reduzirFoto(arquivo); } catch (er) { art.replaceChildren(el('p', {}, er.message)); return; }
  $('#previa').hidden = false; $('#previa-img').src = imagem;
  const corpo = { pacoteId: app.pacote?.id, imagem, pos: app.pos, direcao: bussola.direcao(), pergunta: $('#pergunta-foto').value.trim() };
  let r;
  if (online()) {
    try { r = await api('/api/foto', corpo, 60000); }
    catch (er) { if (!falhaDeRede(er)) { art.replaceChildren(el('p', {}, er.message)); return; } }
  }
  if (!r) { // offline: posição + bússola contra os pontos do pacote
    const [melhor, ...outros] = app.pos && app.pacote ? candidatosFoto({ pois: app.pacote.pois, pos: app.pos, direcao: corpo.direcao }) : [];
    if (melhor && melhor.confianca >= 0.45) {
      r = { identificado: true, poiId: melhor.poi.id, titulo: melhor.poi.nome, explicacao: textoNivel(melhor.poi), curiosidades: melhor.poi.curiosidades || [], alternativas: outros.map((c) => ({ nome: c.poi.nome })), motor: 'local' };
    } else {
      const guardou = filaAdicionar({ id: novoId(), tipo: 'foto', corpo, pacoteId: app.pacote?.id });
      r = { identificado: false, titulo: 'Não identifiquei sem internet', explicacao: guardou ? 'Sem conexão eu reconheço só os pontos turísticos desta viagem, pela sua posição e direção da câmera. Guardei a foto e explico quando a internet voltar.' : 'Sem conexão eu reconheço só os pontos turísticos desta viagem. A fila de fotos está cheia: tente de novo quando tiver internet.', curiosidades: [], motor: 'local' };
      atualizarFila();
    }
  }
  renderResultadoFoto(r);
});

// ---------- Fila de pendências ----------
function atualizarFila() {
  if (Date.now() < (alertaFaixa.ate || 0)) return; // um aviso está na tela: a fila volta a aparecer quando ele sair
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

function alertaFaixa(msg, duracaoMs = 6000) {
  const f = $('#faixa-fila');
  f.hidden = false; f.textContent = msg;
  alertaFaixa.ate = Date.now() + duracaoMs;
  clearTimeout(alertaFaixa.t); alertaFaixa.t = setTimeout(atualizarFila, duracaoMs + 50);
}

// ---------- Preferências ----------
function renderAvisos() {
  $('#lista-avisos').replaceChildren(...plat.TIPOS_CONFIGURAVEIS.map(({ tipo, nome, exemplo }) => {
    const sel = el('select', { id: `aviso-${tipo}`, 'aria-label': `Como avisar: ${nome}`, onchange: (e) => {
      app.prefs.avisos = { ...app.prefs.avisos, [tipo]: e.target.value };
      gravar('prefs', app.prefs);
      if (e.target.value === 'notificar') pedirNotificacoesSePreciso();
    } }, Object.entries(plat.MODOS).map(([v, rotulo]) => el('option', { value: v }, rotulo)));
    sel.value = app.prefs.avisos[tipo];
    return el('label', { class: 'aviso-linha' }, el('strong', {}, nome, ' ', el('span', {}, `· ${exemplo}`)), sel);
  }));
  renderEstadoNotificacoes();
}

function renderEstadoNotificacoes() {
  const estado = plat.estadoNotificacoes();
  const algumNotifica = Object.values(app.prefs.avisos).includes('notificar');
  const txt = plat.ehAppNativo()
    ? 'App Android: os avisos marcados para notificar chegam mesmo com a tela bloqueada, enquanto a caminhada estiver ativa.'
    : {
      concedida: 'Notificações permitidas. No navegador elas chegam quando você troca de app, enquanto ele mantiver a página ativa; com a tela bloqueada, só no app Android.',
      perguntar: 'Para receber notificações quando sair do app, permita as notificações.',
      negada: 'As notificações estão bloqueadas nas configurações do navegador para este site.',
      indisponivel: 'Este navegador não oferece notificações. Os avisos aparecem com o app aberto.',
    }[estado];
  $('#estado-notificacoes').textContent = algumNotifica ? txt : 'Nenhum tipo está marcado para notificar.';
  $('#btn-notificacoes').hidden = !(algumNotifica && estado === 'perguntar');
}
async function pedirNotificacoesSePreciso() {
  if (plat.estadoNotificacoes() === 'perguntar') await plat.pedirNotificacoes();
  renderEstadoNotificacoes();
}
$('#btn-notificacoes').addEventListener('click', pedirNotificacoesSePreciso);
$('#pref-limite').addEventListener('change', (e) => {
  app.prefs.maxPorHora = e.target.value ? Number(e.target.value) : null;
  gravar('prefs', app.prefs);
});

function aplicarPrefs() {
  $('#pref-limite').value = app.prefs.maxPorHora ? String(app.prefs.maxPorHora) : '';
  renderAvisos();
  $('#pref-frequencia').value = app.prefs.frequencia;
  $('#pref-nivel').value = app.prefs.nivel;
  $('#pref-voz').checked = app.prefs.voz;
  $('#pref-simulacao').checked = app.prefs.simulacao;
  $('#pref-auto').checked = app.prefs.auto;
}
for (const [id, chave, tipo] of [['#pref-frequencia', 'frequencia'], ['#pref-nivel', 'nivel'], ['#pref-voz', 'voz', 'check'], ['#pref-simulacao', 'simulacao', 'check'], ['#pref-auto', 'auto', 'check']]) {
  $(id).addEventListener('change', (e) => {
    app.prefs[chave] = tipo === 'check' ? e.target.checked : e.target.value;
    gravar('prefs', app.prefs);
    if (chave === 'simulacao') {
      const ativo = app.passeioAtivo; if (ativo) encerrarPasseio({ resumo: false });
      if (app.prefs.simulacao) ligarSimulacao(); else desligarSimulacao();
      if (ativo) iniciarPasseio();
      atualizarSelos(); renderPerto();
    }
    if (chave === 'voz' && !app.prefs.voz) plat.pararFala();
  });
}
$('#btn-apagar').addEventListener('click', () => {
  encerrarPasseio({ resumo: false }); apagarTudo();
  app.prefs = carregarPrefs(); app.conversa = []; app.pacote = null; app.emFoco = null; app.pos = null; app.trajeto = []; app.rumoCaminhada = null;
  aplicarPrefs(); desligarSimulacao();
  $('#cartao-agora').hidden = true; $('#cartao-resumo').hidden = true; $('#passeio').hidden = true; $('#sem-pacote').hidden = false;
  atualizarFila(); atualizarSelos(); renderDestinos();
  alertaFaixa('Dados apagados deste aparelho.');
});

// ---------- Início ----------
window.addEventListener('online', () => { atualizarSelos(); processarFila(); });
window.addEventListener('offline', atualizarSelos);
setInterval(renderPerto, 4000); // atualiza as setas com a bússola

// ---------- Sua IA (OpenRouter) ----------
function renderMinhaIa() {
  const c = minhaIa.conexao();
  $('#minha-ia-status').textContent = c
    ? `Conectada à sua conta OpenRouter. O uso é cobrado dos seus créditos; a conexão fica só neste aparelho.`
    : app.servidorIa
      ? 'O app já tem IA. Se preferir usar a sua (e escolher o modelo), conecte sua conta OpenRouter.'
      : 'Sem IA, o guia responde só sobre o conteúdo da viagem. Conecte sua conta OpenRouter para perguntas livres e para explicar qualquer foto: você entra lá, autoriza e pronto, sem copiar chave. O uso é cobrado dos seus créditos.';
  $('#btn-conectar-ia').hidden = !!c;
  $('#btn-desconectar-ia').hidden = !c;
  $('#minha-ia-modelo-rotulo').hidden = !c;
  if (c) $('#minha-ia-modelo').value = c.modelo || minhaIa.MODELO_PADRAO;
  atualizarSelos();
}
$('#btn-conectar-ia').addEventListener('click', async () => {
  if (!online()) { alertaFaixa('Para conectar sua IA é preciso internet.'); return; }
  const destino = `${location.origin}${location.pathname}`;
  location.href = await minhaIa.urlDeLogin(destino);
});
$('#btn-desconectar-ia').addEventListener('click', () => { minhaIa.desconectar(); renderMinhaIa(); alertaFaixa('Sua IA foi desconectada deste aparelho.'); });
$('#minha-ia-modelo').addEventListener('change', (e) => {
  const v = e.target.value.trim() || minhaIa.MODELO_PADRAO;
  if (!minhaIa.definirModelo(v)) { alertaFaixa('Nome de modelo inválido. Ex.: openrouter/auto'); renderMinhaIa(); return; }
  alertaFaixa(`Modelo da sua IA: ${v}`);
});

/** Volta do login da OpenRouter (?code=…): troca o código pela conexão e limpa o endereço. */
async function concluirLoginSeVoltou() {
  const params = new URLSearchParams(location.search);
  if (!minhaIa.ehRetornoDeLogin(params)) return;
  history.replaceState(null, '', location.pathname);
  try {
    await minhaIa.concluirLogin(params);
    alertaFaixa('Pronto! Sua IA está conectada. Pergunte o que quiser na Conversa.');
  } catch (e) {
    alertaFaixa(e.message);
  }
  ir('viagem');
  renderMinhaIa();
}

async function iniciar() {
  aplicarPrefs();
  renderMinhaIa();
  const salvo = ler('pacoteAtivo', null);
  const p = salvo && pacoteSalvo(salvo);
  if (p) { ativarPacote(p); localizarAgora(); } else { $('#sem-pacote').hidden = false; }
  atualizarFila(); atualizarSelos();
  await concluirLoginSeVoltou(); // depois da faixa da fila, para o aviso de conexão não ser apagado
  // Modo companheiro ao abrir: começa a acompanhar o trajeto sem precisar de toque (a voz pode pedir um toque no iPhone).
  if (p && app.prefs.auto) iniciarPasseio();
  // Aberto pelo toque numa notificação com o app fechado.
  const alertaUrl = new URLSearchParams(location.search).get('alerta');
  if (p && alertaUrl && window.guiaAbrirAlerta) window.guiaAbrirAlerta(alertaUrl);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (online()) {
    try {
      const h = await api('/api/health', null, 8000);
      app.servidorIa = h.ia;
      renderMinhaIa();
      if (!app.pacote) await baixarDestinoUnico();
      $('#sobre').textContent = `GuIA Brasil · MVP de teste · ${h.ia ? 'IA ligada' : 'IA desligada no servidor (respostas do conteúdo curado)'}`;
    } catch { /* offline de fato */ }
    atualizarSelos();
    processarFila();
  }
}
iniciar();

// iPhone: ao abrir o teclado a tela encolhe; mantém a última mensagem à vista.
$('#entrada-conversa').addEventListener('focus', () => setTimeout(rolarAteFim, 300));
