/* Estadia BR — aplicativo web (TAC, destino, transportadora, jurídico e administração). */
(function () {
  'use strict';

  // ---------------- utilidades ----------------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/Sao_Paulo';
  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—');
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—');
  const diaHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—');
  const dur = (min) => { if (min == null) return '—'; min = Math.max(0, Math.round(min)); return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`; };
  const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const num = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }));
  const placaFmt = (p) => (p ? `${p.slice(0, 3)}-${p.slice(3)}` : '');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
  const ROLE = { tac: 'TAC · caminhoneiro', destino: 'Embarcador / destinatário', transportadora: 'Transportadora', advocacia: 'Jurídico', admin: 'Administrador', sistema: 'Sistema' };
  const ORIGEM = { app: 'app', portal: 'portal web', link_whatsapp: 'link WhatsApp', amelia: 'Amélia', sistema: 'automático' };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
  };

  let toastT;
  function toast(msg, bad = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => (el.className = 'toast'), 3600);
  }

  // ---------------- sessão e API ----------------
  const S = { token: store.get('estadia.token'), user: JSON.parse(store.get('estadia.user') || 'null'), simOffline: store.get('estadia.simOffline') === '1', config: null };
  class ApiError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new ApiError(0, 'Sem conexão com o servidor.', 'REDE'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/login') { logout(); throw new ApiError(401, data.mensagem || 'Sessão expirada.'); }
    if (!res.ok) throw new ApiError(res.status, data.mensagem || 'Erro inesperado.', data.erro);
    return data;
  }

  function logout() {
    S.token = null; S.user = null; S.config = null;
    store.set('estadia.token', null); store.set('estadia.user', null);
    if (sse) { sse.close(); sse = null; }
    location.hash = '#/';
    render();
  }
  const online = () => navigator.onLine && !S.simOffline;
  const can = (perm) => S.user && (S.user.permissoes || []).includes(perm);

  // ---------------- fila offline (IndexedDB) ----------------
  const Q = {
    db: null, mem: [],
    async open() {
      if (this.db || !('indexedDB' in window)) return this.db;
      this.db = await new Promise((resolve) => {
        const r = indexedDB.open('estadia', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'clientEventId' });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      });
      return this.db;
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => { const t = db.transaction('fila', mode); fn(t.objectStore('fila')); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); });
    },
    async all() {
      const db = await this.open();
      if (!db) return this.mem.slice();
      return new Promise((resolve) => { const r = db.transaction('fila').objectStore('fila').getAll(); r.onsuccess = () => resolve((r.result || []).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))); r.onerror = () => resolve([]); });
    },
    async put(item) { if (!(await this.open())) { this.mem = this.mem.filter((x) => x.clientEventId !== item.clientEventId).concat(item); return; } await this.run('readwrite', (st) => st.put(item)); },
    async del(id) { if (!(await this.open())) { this.mem = this.mem.filter((x) => x.clientEventId !== id); return; } await this.run('readwrite', (st) => st.delete(id)); },
    async clear() { if (!(await this.open())) { this.mem = []; return; } await this.run('readwrite', (st) => st.clear()); },
  };
  let fila = [];
  async function refreshFila() { fila = S.user ? (await Q.all()).filter((x) => x.userId === S.user.id) : []; }

  let flushing = false;
  async function flush() {
    if (flushing || !online() || !S.token) return;
    flushing = true;
    let enviados = 0;
    try {
      await refreshFila();
      for (const item of fila) {
        try { await api('POST', `/api/operations/${item.opId}/events`, item.body); await Q.del(item.clientEventId); enviados++; }
        catch (e) { if (e.code === 'REDE') break; item.erro = e.message; await Q.put(item); }
      }
    } finally {
      flushing = false;
      await refreshFila();
      if (enviados) { toast(`${enviados} registro(s) sincronizado(s). Horário original preservado.`); refresh(); } else renderBar();
    }
  }
  window.addEventListener('online', flush);
  window.addEventListener('offline', () => renderBar());
  setInterval(flush, 15000);

  // ---------------- tempo real (SSE) ----------------
  let sse = null, refreshT;
  function connectSSE() {
    if (sse || !S.token || !('EventSource' in window)) return;
    sse = new EventSource(`/api/stream?token=${encodeURIComponent(S.token)}`);
    sse.onmessage = (m) => {
      try { if (JSON.parse(m.data).reset) { toast('A demonstração foi reiniciada. Entre novamente.'); setTimeout(logout, 1500); return; } } catch { /* mensagem comum */ }
      clearTimeout(refreshT); refreshT = setTimeout(softRefresh, 250);
    };
    sse.onerror = () => { sse.close(); sse = null; setTimeout(connectSSE, 5000); };
  }

  // ---------------- localização, foto e áudio ----------------
  function getGps() {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve({ erro: 'Aparelho sem GPS' });
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }),
        (err) => resolve({ erro: err.code === 1 ? 'Permissão de localização negada' : err.code === 3 ? 'Tempo esgotado ao obter GPS' : 'Localização indisponível' }),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });
  }

  function compressImage(file, max = 1600) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
      img.src = url;
    });
  }
  const blobToDataUrl = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });

  const fileUrl = (f) => (f ? `/api/evidencias/${f.file}?token=${encodeURIComponent(S.token)}` : '');
  const mapLink = (g) => (g && g.lat != null ? `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=17/${g.lat}/${g.lng}` : null);
  const gpsTxt = (g) => (!g ? 'sem localização' : g.erro ? g.erro : `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} ±${g.acc ?? '?'} m`);

  // ---------------- envio de eventos ----------------
  async function sendEvent(opId, body) {
    body.clientEventId = body.clientEventId || uuid();
    const item = { clientEventId: body.clientEventId, opId, body, userId: S.user.id, criadoEm: new Date().toISOString() };
    if (!online()) { await Q.put(item); await refreshFila(); toast('Sem sinal: registro salvo no aparelho. Será enviado quando a conexão voltar.'); return { offline: true }; }
    try {
      const r = await api('POST', `/api/operations/${opId}/events`, body);
      toast(r.duplicado ? 'Registro já havia sido recebido.' : `Registrado às ${hhmm(r.evento.occurredAt)}.`);
      return r;
    } catch (e) {
      if (e.code === 'REDE') { await Q.put(item); await refreshFila(); toast('Conexão falhou: registro salvo no aparelho para envio posterior.'); return { offline: true }; }
      throw e;
    }
  }

  function sheet(html) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) bg.remove(); });
    return bg;
  }

  // Folha de captura: horário do toque + GPS + foto, conforme o marco.
  function captureSheet(opId, action) {
    const occurredAt = new Date().toISOString();
    const st = { gps: null, photo: null, sending: false };
    const photoTitle = action.photoLabel || (action.type === 'LIBERACAO' ? 'Documento de liberação (se houver)' : 'Foto');
    const bg = sheet(`<div class="card-h"><h2>${esc(action.label)}</h2><button class="btn small" data-x>Cancelar</button></div>
      ${action.aviso ? `<div class="alert atencao"><b>!</b><span>${esc(action.aviso)}</span></div>` : ''}
      <div class="capt"><div>Horário<b>${hhmm(occurredAt)}</b></div><div>GPS<b id="sh-gps">${action.gps === 'capturar' ? 'obtendo…' : action.gps ? 'se disponível' : 'não exigido'}</b></div><div>Foto<b>${action.photo === 'required' ? 'obrigatória' : action.photo ? 'opcional' : '—'}</b></div></div>
      ${action.photo ? `<label class="photo-drop" for="sh-file"><span id="sh-prev"><b>${esc(photoTitle)}</b><br><span class="muted small">Toque para abrir a câmera</span></span></label><input type="file" id="sh-file" accept="image/*" capture="environment" hidden>` : ''}
      <div class="field"><label class="label" for="sh-note">Observação (opcional)</label><textarea id="sh-note" maxlength="500"></textarea></div>
      <p class="err" id="sh-err" hidden></p>
      <button class="big" id="sh-go">Confirmar registro<small>Horário registrado: ${hhmm(occurredAt)}, momento em que você tocou no botão</small></button>`);
    const showErr = (m) => { const el = $('#sh-err', bg); el.textContent = m; el.hidden = false; };
    if (action.gps) getGps().then((g) => { st.gps = g; const el = $('#sh-gps', bg); if (el) el.textContent = g.erro ? (action.gps === 'opcional' ? 'indisponível' : g.erro) : `±${g.acc} m`; });
    const file = $('#sh-file', bg);
    if (file) file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try { st.photo = await compressImage(file.files[0]); $('#sh-prev', bg).innerHTML = `<img src="${st.photo}" alt="Foto capturada"><br><span class="muted small">Toque para trocar</span>`; } catch (e) { showErr(e.message); }
    });
    $('#sh-go', bg).addEventListener('click', async () => {
      if (st.sending) return;
      if (action.photo === 'required' && !st.photo) return showErr(`${photoTitle}: obrigatória para concluir o registro.`);
      st.sending = true; $('#sh-go', bg).disabled = true;
      if (action.gps === 'capturar' && !st.gps) st.gps = await getGps();
      const gps = st.gps && !(st.gps.erro && action.gps === 'opcional') ? st.gps : undefined;
      try {
        await sendEvent(opId, { type: action.type, occurredAt, gps, photo: st.photo || undefined, note: $('#sh-note', bg).value.trim() || undefined, refEventId: action.refEventId });
        bg.remove(); refresh();
      } catch (e) { st.sending = false; $('#sh-go', bg).disabled = false; showErr(e.message); }
    });
  }

  function divergenceSheet(opId, action, refEvent) {
    const bg = sheet(`<div class="card-h"><h2>Registrar divergência</h2><button class="btn small" data-x>Cancelar</button></div>
      <p class="small muted">Registro contestado: <b>${esc(refEvent.label)}</b> às ${hhmm(refEvent.occurredAt)} por ${esc(refEvent.actor.name)}. O registro original continua preservado; a divergência vira uma ocorrência para análise.</p>
      <div class="field"><label class="label" for="dv-note">O que diverge?</label><textarea id="dv-note" placeholder="Ex.: início efetivo na doca às 11:05, conforme apontamento da equipe."></textarea></div>
      <div class="field"><label class="label" for="dv-time">Horário que você reconhece (opcional)</label><input type="time" id="dv-time"></div>
      <p class="err" id="dv-err" hidden></p><button class="btn danger" id="dv-go">Registrar divergência</button>`);
    $('#dv-go', bg).addEventListener('click', async () => {
      const t = $('#dv-time', bg).value;
      let alegadoEm;
      if (t) { const day = new Date(refEvent.occurredAt).toLocaleDateString('en-CA', { timeZone: TZ }); alegadoEm = new Date(`${day}T${t}:00-03:00`).toISOString(); }
      try { await sendEvent(opId, { type: 'DIVERGENCIA', occurredAt: new Date().toISOString(), refEventId: action.refEventId, note: $('#dv-note', bg).value.trim(), alegadoEm }); bg.remove(); refresh(); }
      catch (e) { const el = $('#dv-err', bg); el.textContent = e.message; el.hidden = false; }
    });
  }

  // ---------------- roteamento ----------------
  const route = () => { const h = location.hash.replace(/^#\/?/, '').split('/'); return { name: h[0] || 'home', id: h[1] }; };
  window.addEventListener('hashchange', () => render());
  let liveT, monitorT;

  async function render() {
    clearInterval(liveT); clearInterval(monitorT);
    if (!S.token) return renderLogin();
    connectSSE();
    if (!S.config) { try { S.config = await api('GET', '/api/config'); const me = await api('GET', '/api/me'); S.user = me; store.set('estadia.user', JSON.stringify(me)); } catch (e) { if (e.status === 401) return; } }
    await refreshFila();
    renderShell();
    const r = route();
    try {
      if (r.name === 'op' && r.id) await viewOp(r.id);
      else if (r.name === 'dossie' && r.id) await viewDossie(r.id);
      else if (r.name === 'relatorios' && can('relatorios')) await viewRelatorios();
      else if (r.name === 'admin' && S.user.role === 'admin') await viewAdmin();
      else await viewHome();
    } catch (e) {
      if (e.status !== 401) $('#main').innerHTML = `<div class="card"><h2>Não foi possível carregar</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/">Voltar ao início</a></div>`;
    }
    flush();
  }
  const refresh = () => render();
  function softRefresh() {
    const a = document.activeElement;
    const busy = document.querySelector('.sheet-bg') || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || document.querySelector('details[open]') || recorder.active;
    if (busy || route().name === 'dossie') { clearTimeout(refreshT); refreshT = setTimeout(softRefresh, 3000); return; }
    render();
  }

  function renderShell() {
    if (!$('#main')) $('#app').innerHTML = `<header class="bar" id="bar"></header><main class="page" id="main"></main>`;
    renderBar();
  }

  function renderBar() {
    const bar = $('#bar'); if (!bar || !S.user) return;
    const pend = fila.length;
    const nav = (href, label) => `<a class="navlink" href="${href}">${label}</a>`;
    bar.innerHTML = `<a class="brand" href="#/"><span class="mark"></span><b>Estadia BR</b></a>
      <nav class="nav">${nav('#/', 'Operações')}${can('relatorios') ? nav('#/relatorios', 'Relatórios') : ''}${S.user.role === 'admin' ? nav('#/admin', 'Administração') : ''}</nav>
      <span class="net ${online() ? '' : 'off'}"><i></i>${online() ? 'Online' : 'Sem sinal'}${pend ? ` · ${pend} a enviar` : ''}</span>
      ${S.user.role === 'tac' ? `<button id="simoff" title="Simula a perda de sinal para demonstrar o modo offline">${S.simOffline ? 'Reativar sinal' : 'Simular sem sinal'}</button>` : ''}
      <span class="who">${esc(S.user.nome)}<small>${esc(ROLE[S.user.role])} · ${esc(S.user.orgNome || '')}</small></span>
      <button id="logout">Sair</button>`;
    $('#logout').onclick = logout;
    const so = $('#simoff');
    if (so) so.onclick = () => { S.simOffline = !S.simOffline; store.set('estadia.simOffline', S.simOffline ? '1' : null); renderBar(); if (!S.simOffline) flush(); else refresh(); };
  }

  // ---------------- login ----------------
  const DEMO = [
    ['joao@tac.demo', 'João Batista Ferreira', 'TAC · placa RTB-4F27'],
    ['operacao@rodoviasul.demo', 'Carla Mendes', 'Transportadora · Rodovia Sul'],
    ['portaria@serraazul.demo', 'Marina Coelho', 'Destinatário · Serra Azul (portaria)'],
    ['doca@serraazul.demo', 'Rafael Toledo', 'Destinatário · Serra Azul (doca)'],
    ['cd@horizonte.demo', 'Paulo Reis', 'Destinatário · Mercado Horizonte'],
    ['juridico@andradeprado.demo', 'Dra. Helena Andrade', 'Jurídico'],
    ['admin@estadiabr.demo', 'Administração', 'Estadia BR'],
  ];
  function renderLogin() {
    $('#app').innerHTML = `<div class="login">
      <section class="hero"><div class="mark"></div><h1>Estadia BR</h1>
        <p>Registro, confirmação e comprovação dos eventos de carga e descarga. Cada marco tem autor, horário, local e evidência, e a apuração da estadia sai automaticamente.</p>
        <p class="small">Registrar · confirmar · comprovar · apurar · conciliar · rastrear</p></section>
      <section class="card"><h2>Entrar</h2>
        <form id="lf" class="form" style="grid-template-columns:1fr">
          <div class="field"><label class="label" for="lf-e">E-mail</label><input id="lf-e" type="email" autocomplete="username" required></div>
          <div class="field"><label class="label" for="lf-s">Senha</label><input id="lf-s" type="password" autocomplete="current-password" required></div>
          <p class="err" id="lf-err" hidden></p><button class="btn primary" type="submit">Entrar</button>
        </form>
        <div class="demo-users"><span class="label">Contas de demonstração · senha estadia123</span>
          ${DEMO.map(([e, n, r]) => `<button type="button" data-e="${e}"><b>${esc(n)}</b><span class="muted small">${esc(r)}</span></button>`).join('')}</div>
      </section></div>`;
    const go = async (email, senha) => {
      try {
        const r = await api('POST', '/api/login', { email, senha });
        S.token = r.token; S.user = r.user; S.config = null;
        store.set('estadia.token', r.token); store.set('estadia.user', JSON.stringify(r.user));
        location.hash = '#/'; render();
      } catch (e) { const el = $('#lf-err'); el.textContent = e.message; el.hidden = false; }
    };
    $('#lf').onsubmit = (e) => { e.preventDefault(); go($('#lf-e').value, $('#lf-s').value); };
    $$('[data-e]').forEach((b) => (b.onclick = () => go(b.dataset.e, 'estadia123')));
  }

  // ---------------- pills e rótulos ----------------
  const STATUS_TOM = {
    CRIADA: '', AGUARDANDO_CHEGADA: '', AGUARDANDO_CONFIRMACAO_CHEGADA: 'warn', CHEGADA_CONFIRMADA: 'acc', OPERACAO_INICIADA: 'warn', INICIO_CONFIRMADO: 'acc',
    OPERACAO_FINALIZADA: 'warn', TERMINO_CONFIRMADO: 'acc', LIBERADA: 'warn', LIBERACAO_CONFIRMADA: 'acc', SAIDA_REGISTRADA: 'acc', APURADA: 'ok',
    AGUARDANDO_PAGAMENTO: 'warn', PAGAMENTO_PARCIAL: 'warn', PAGO: 'ok', VALOR_DIVERGENTE: 'crit', EM_TRATATIVA: 'sys', ENCAMINHADA_JURIDICO: 'sys', ENCERRADA: 'ok',
  };
  const statusPill = (o) => `<span class="pill ${STATUS_TOM[o.statusCode] || ''}">${esc(o.status)}</span>`;
  const tipoPill = (t) => `<span class="pill tipo-${(t || '').toLowerCase()}">${t === 'CARGA' ? 'Carga' : 'Descarga'}</span>`;
  const jurLabel = (s) => ({ ENVIADO: 'enviado', RECEBIDO: 'recebido', EM_ANALISE: 'em análise', CONCLUIDO: 'concluído' }[s] || s);

  // ---------------- início por perfil ----------------
  async function viewHome() {
    const main = $('#main');
    let ops = [];
    try { ops = await api('GET', '/api/operations'); store.set('estadia.cache.ops.' + S.user.id, JSON.stringify(ops)); }
    catch (e) { if (e.code !== 'REDE') throw e; ops = JSON.parse(store.get('estadia.cache.ops.' + S.user.id) || '[]'); }
    if (S.user.role === 'tac') return homeTac(main, ops);
    if (S.user.role === 'advocacia') return homeAdv(main, ops);
    return homePortal(main, ops);
  }

  // Amélia: gravação de áudio + transcrição do navegador quando disponível.
  const recorder = { active: false, media: null, chunks: [], rec: null, audio: null };
  function homeTac(main, ops) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    main.innerHTML = `<div class="card amelia"><div class="card-h"><div class="row"><span class="ava">A</span><div><h2>Amélia</h2><span class="small muted">Assistente da operação</span></div></div></div>
        <p>Me conte os dados da sua operação por texto ou áudio. Por exemplo: <i>“Placa RTB4F27, carreta sider, descarga de 28 toneladas de açúcar no CD Jundiaí, nota fiscal 35261000184552.”</i></p>
        <div class="field"><label class="label" for="am-txt">Sua mensagem</label><textarea id="am-txt" rows="3" placeholder="Digite ou toque em Gravar áudio"></textarea></div>
        <div class="row"><button class="btn" id="am-mic" type="button"><span class="recdot"></span><span id="am-mic-l">Gravar áudio</span></button>
          <button class="btn primary" id="am-go" type="button">Interpretar</button><span class="small muted" id="am-st"></span></div>
        <audio id="am-audio" controls hidden></audio>
        <div id="am-res"></div>
        ${SR ? '' : '<p class="small muted">Este navegador não transcreve áudio automaticamente. O áudio é guardado como evidência; digite o texto principal.</p>'}</div>
      <details class="card"><summary style="cursor:pointer"><b>Identificar pelo código</b> <span class="muted small">se preferir digitar</span></summary>
        <form id="idf" class="form" style="margin-top:10px">
          <div class="field"><label class="label" for="id-c">Código da operação</label><input id="id-c" placeholder="OP-2026-0001" required autocapitalize="characters"></div>
          <div class="field"><label class="label" for="id-p">Placa</label><input id="id-p" value="${esc(placaFmt(S.user.placa))}" required autocapitalize="characters"></div>
          <div class="field" style="justify-content:flex-end"><button class="btn" type="submit">Identificar</button></div>
        </form><p class="err" id="id-err" hidden></p></details>
      <div class="card-h"><h2>Minhas operações</h2><span class="pill">${ops.length}</span></div>
      ${ops.length ? ops.map(opCard).join('') : '<p class="muted">Nenhuma operação vinculada ainda.</p>'}`;

    $('#idf').onsubmit = async (e) => {
      e.preventDefault();
      try { const d = await api('POST', '/api/operations/identify', { codigo: $('#id-c').value, placa: $('#id-p').value, clientEventId: uuid(), occurredAt: new Date().toISOString() }); toast('Operação identificada e vinculada a você.'); location.hash = `#/op/${d.op.id}`; }
      catch (err) { const el = $('#id-err'); el.textContent = err.message; el.hidden = false; }
    };

    const st = $('#am-st'), txt = $('#am-txt');
    $('#am-mic').onclick = async () => {
      if (recorder.active) return stopRec();
      recorder.chunks = []; recorder.audio = null;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recorder.media = new MediaRecorder(stream);
        recorder.media.ondataavailable = (ev) => ev.data.size && recorder.chunks.push(ev.data);
        recorder.media.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(recorder.chunks, { type: (recorder.media.mimeType || 'audio/webm').split(';')[0] });
          if (blob.size > 5 * 1024 * 1024) { st.textContent = 'Áudio muito longo; grave uma mensagem mais curta.'; return; }
          recorder.audio = await blobToDataUrl(blob);
          const a = $('#am-audio'); if (a) { a.src = URL.createObjectURL(blob); a.hidden = false; }
          st.textContent = SR ? 'Áudio gravado. Confira o texto transcrito e toque em Interpretar.' : 'Áudio gravado. Digite o texto e toque em Interpretar.';
        };
        recorder.media.start();
      } catch { st.textContent = 'Não foi possível acessar o microfone. Verifique a permissão do navegador.'; return; }
      if (SR) {
        recorder.rec = new SR(); recorder.rec.lang = 'pt-BR'; recorder.rec.continuous = true; recorder.rec.interimResults = true;
        const base = txt.value ? txt.value.trim() + ' ' : '';
        recorder.rec.onresult = (ev) => { txt.value = base + [...ev.results].map((r) => r[0].transcript).join(' '); };
        recorder.rec.onerror = () => { st.textContent = 'A transcrição falhou; o áudio continua sendo gravado. Digite o texto se necessário.'; };
        try { recorder.rec.start(); } catch { /* transcrição opcional */ }
      }
      recorder.active = true; $('#am-mic').classList.add('rec'); $('#am-mic-l').textContent = 'Parar gravação'; st.textContent = 'Gravando… fale os dados da operação.';
    };
    function stopRec() {
      recorder.active = false; $('#am-mic').classList.remove('rec'); $('#am-mic-l').textContent = 'Gravar novamente';
      try { recorder.rec && recorder.rec.stop(); } catch { /* ok */ }
      try { recorder.media && recorder.media.state !== 'inactive' && recorder.media.stop(); } catch { /* ok */ }
    }

    $('#am-go').onclick = async () => {
      if (recorder.active) stopRec();
      const texto = txt.value.trim();
      const res = $('#am-res');
      if (!texto) { res.innerHTML = '<p class="err">Escreva ou grave os dados da operação primeiro.</p>'; return; }
      try {
        const r = await api('POST', '/api/amelia/interpretar', { texto });
        if (!r.compreendido) { res.innerHTML = `<div class="alert atencao"><b>?</b><span>${esc(r.mensagem)}</span></div>`; return; }
        const cand = r.candidatos;
        const tabela = (ents) => `<div class="tablewrap"><table><thead><tr><th>Dado</th><th>Entendi</th><th>Do trecho</th><th>Cadastro</th></tr></thead><tbody>
          ${ents.map((e) => `<tr><td>${esc(e.label)}</td><td><b>${esc(e.campo === 'placa' ? placaFmt(e.valor) : e.valor)}</b></td><td class="muted small">“${esc(e.trecho)}”</td>
          <td>${e.cadastrado == null ? '<span class="muted small">—</span>' : e.confere ? '<span class="pill ok">confere</span>' : `<span class="pill warn">cadastro: ${esc(e.cadastrado)}</span>`}</td></tr>`).join('')}</tbody></table></div>`;
        res.innerHTML = `<div class="amelia-res"><p class="small"><b>Amélia:</b> ${cand.length ? 'entendi estes dados. Confira e confirme uma única vez.' : esc(r.mensagem)}</p>
          ${tabela(cand.length ? cand[0].comparacao : r.entidades)}
          ${cand.length > 1 ? `<div class="field"><label class="label" for="am-op">Operação</label><select id="am-op">${cand.map((c) => `<option value="${c.id}">${esc(c.codigo)} · ${c.tipo === 'CARGA' ? 'Carga' : 'Descarga'} · ${esc(c.localNome)}</option>`).join('')}</select></div>`
            : cand.length ? `<p class="small">Operação encontrada: <b>${esc(cand[0].codigo)}</b> · ${cand[0].tipo === 'CARGA' ? 'carga' : 'descarga'} em ${esc(cand[0].localNome)} (${esc(cand[0].destinoNome)}).</p>` : ''}
          ${cand.length ? `<div class="row"><button class="btn primary" id="am-ok">Confirmar dados</button><button class="btn" id="am-edit">Corrigir mensagem</button></div>
          <p class="small muted">Dados diferentes do cadastro ficam registrados como informados por você, sem alterar o cadastro da transportadora.</p>` : ''}</div>`;
        const ok = $('#am-ok');
        if (ok) ok.onclick = async () => {
          ok.disabled = true;
          try {
            const opId = $('#am-op') ? $('#am-op').value : cand[0].id;
            const d = await api('POST', '/api/amelia/confirmar', { opId, texto, audio: recorder.audio || undefined, clientEventId: uuid() });
            recorder.audio = null; toast('Dados confirmados. Operação vinculada a você.'); location.hash = `#/op/${d.op.id}`;
          } catch (e) { ok.disabled = false; toast(e.message, true); }
        };
        const ed = $('#am-edit'); if (ed) ed.onclick = () => txt.focus();
      } catch (e) { res.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    };
  }

  function opCard(o) {
    return `<a class="card opcard" href="#/op/${o.id}"><div class="card-h"><span class="row"><span class="mono">${esc(o.codigo)}</span>${tipoPill(o.tipo)}</span>${statusPill(o)}</div>
      <h3>${esc(o.localNome)}</h3><dl class="kv"><dt>Destino</dt><dd>${esc(o.destinoNome)}</dd><dt>Placa</dt><dd class="mono">${esc(placaFmt(o.placa))}</dd>
      ${o.limite ? `<dt>Estadia</dt><dd class="mono">${dur(o.limite.tempoMin)}${o.limite.emCurso ? ' (em curso)' : ''}</dd>` : ''}
      ${o.financeiro.devido != null ? `<dt>Valor devido</dt><dd class="mono">${brl(o.financeiro.devido)} · saldo ${brl(o.financeiro.saldo)}</dd>` : ''}</dl></a>`;
  }

  function homePortal(main, ops) {
    const fim = ['SAIDA_REGISTRADA', 'APURADA', 'AGUARDANDO_PAGAMENTO', 'PAGAMENTO_PARCIAL', 'PAGO', 'VALOR_DIVERGENTE', 'EM_TRATATIVA', 'ENCAMINHADA_JURIDICO', 'ENCERRADA'];
    const noLocal = ops.filter((o) => o.chegadaEm && !fim.includes(o.statusCode));
    const pend = noLocal.filter((o) => o.pendentes.length);
    const acima = ops.filter((o) => o.limite && o.limite.excedeu);
    const saldo = ops.reduce((s, o) => s + (o.financeiro.saldo || 0), 0);
    main.innerHTML = `<div class="kpis">
        <div class="kpi"><span class="label">No local agora</span><b>${noLocal.length}</b></div>
        <div class="kpi"><span class="label">Aguardando confirmação</span><b>${pend.length}</b></div>
        <div class="kpi"><span class="label">Acima de 5h</span><b>${acima.length}</b></div>
        <div class="kpi"><span class="label">Saldo pendente</span><b>${brl(saldo)}</b></div></div>
      ${can('criar') ? newOpForm() : ''}
      <div class="card"><div class="card-h"><h2>Operações</h2><span class="muted small">Atualiza sozinho</span></div>
        <div class="tablewrap"><table><thead><tr><th>Código</th><th>Tipo</th><th>Placa</th><th>Destino</th><th>Situação</th><th>Estadia</th><th>Devido</th><th>Saldo</th><th>Pendências</th></tr></thead><tbody>
        ${ops.map((o) => `<tr class="click" data-op="${o.id}"><td class="mono">${esc(o.codigo)}</td><td>${tipoPill(o.tipo)}</td><td class="mono">${esc(placaFmt(o.placa))}</td><td>${esc(o.destinoNome)}</td>
          <td>${statusPill(o)}</td><td class="mono" ${o.limite && o.limite.excedeu ? 'style="color:var(--crit);font-weight:600"' : ''}>${o.limite ? dur(o.limite.tempoMin) : '—'}</td>
          <td class="mono">${brl(o.financeiro.devido)}</td><td class="mono">${brl(o.financeiro.saldo)}</td>
          <td>${o.pendentes.map((p) => `<span class="pill warn">${esc(p)}</span>`).join(' ')}${o.divergenciasAbertas ? ` <span class="pill crit">divergência</span>` : ''}${o.deslocamentos ? ` <span class="pill crit">deslocamento</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Nenhuma operação.</td></tr>'}
        </tbody></table></div></div>`;
    $$('[data-op]', main).forEach((tr) => (tr.onclick = () => (location.hash = `#/op/${tr.dataset.op}`)));
    bindNewOp();
  }

  function newOpForm() {
    const dest = (S.config && S.config.destinos) || [];
    return `<details class="card" id="newop"><summary style="cursor:pointer"><b>Nova operação</b> <span class="muted small">carga e descarga são operações independentes</span></summary>
      <form id="nf" class="form" style="margin-top:12px">
        <div class="field"><label class="label" for="nf-tipo">Tipo</label><select id="nf-tipo"><option value="DESCARGA">Descarga</option><option value="CARGA">Carga</option></select></div>
        <div class="field"><label class="label" for="nf-dest">Embarcador / destinatário</label><select id="nf-dest">${dest.map((d) => `<option value="${d.id}">${esc(d.nome)}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="nf-placa">Placa</label><input id="nf-placa" required placeholder="ABC1D23" autocapitalize="characters"></div>
        <div class="field"><label class="label" for="nf-imp">Implemento</label><input id="nf-imp" placeholder="carreta sider"></div>
        <div class="field"><label class="label" for="nf-cap">Capacidade do veículo (t)</label><input id="nf-cap" type="number" step="0.1" min="0.1" required value="30"></div>
        <div class="field"><label class="label" for="nf-peso">Peso (t)</label><input id="nf-peso" type="number" step="0.1"></div>
        <div class="field"><label class="label" for="nf-merc">Carga</label><input id="nf-merc" placeholder="açúcar cristal"></div>
        <div class="field"><label class="label" for="nf-vol">Volume</label><input id="nf-vol" placeholder="560 sacas"></div>
        <div class="field"><label class="label" for="nf-nfe">NF-e</label><input id="nf-nfe"></div>
        <div class="field"><label class="label" for="nf-cte">CT-e</label><input id="nf-cte"></div>
        <div class="field"><label class="label" for="nf-mdfe">MDF-e</label><input id="nf-mdfe"></div>
        <div class="field"><label class="label" for="nf-orig">Origem</label><input id="nf-orig" placeholder="Cidade/UF"></div>
        <div class="field"><label class="label" for="nf-local">Local / doca</label><input id="nf-local" placeholder="CD · Doca"></div>
        <div class="field"><label class="label" for="nf-prev">Data prevista</label><input id="nf-prev" type="datetime-local"></div>
        <div class="field"><label class="label" for="nf-rn">Responsável no destino</label><input id="nf-rn" placeholder="Nome"></div>
        <div class="field"><label class="label" for="nf-rt">WhatsApp do responsável</label><input id="nf-rt" type="tel" placeholder="+55 11 99999-9999"></div>
        <div class="field"><label class="label" for="nf-lat">Latitude do local</label><input id="nf-lat" inputmode="decimal"></div>
        <div class="field"><label class="label" for="nf-lng">Longitude do local</label><input id="nf-lng" inputmode="decimal"></div>
        <div class="field full"><label class="label" for="nf-obs">Observações</label><input id="nf-obs"></div>
        <div class="field full row"><button type="button" class="btn" id="nf-here">Usar minha localização como local</button><button class="btn primary" type="submit">Criar operação</button></div>
        <p class="err field full" id="nf-err" hidden></p>
      </form></details>`;
  }
  function bindNewOp() {
    const nf = $('#nf'); if (!nf) return;
    $('#nf-here').onclick = async () => { const g = await getGps(); if (g.erro) return toast(g.erro, true); $('#nf-lat').value = g.lat; $('#nf-lng').value = g.lng; toast(`Local definido (±${g.acc} m). Limite de deslocamento: 300 m.`); };
    nf.onsubmit = async (e) => {
      e.preventDefault();
      const v = (id) => $(id).value;
      try {
        const d = await api('POST', '/api/operations', { tipo: v('#nf-tipo'), destinoOrgId: v('#nf-dest'), placa: v('#nf-placa'), implemento: v('#nf-imp'), capacidadeToneladas: v('#nf-cap'),
          pesoToneladas: v('#nf-peso'), mercadoria: v('#nf-merc'), volume: v('#nf-vol'), nfe: v('#nf-nfe'), cte: v('#nf-cte'), mdfe: v('#nf-mdfe'), origem: v('#nf-orig'),
          localNome: v('#nf-local'), dataPrevista: v('#nf-prev') || undefined, responsavelNome: v('#nf-rn'), responsavelTelefone: v('#nf-rt'), lat: v('#nf-lat'), lng: v('#nf-lng'), observacoes: v('#nf-obs') });
        toast(`Operação ${d.op.codigo} criada. Informe o código ao motorista.`);
        location.hash = `#/op/${d.op.id}`;
      } catch (err) { const el = $('#nf-err'); el.textContent = err.message; el.hidden = false; }
    };
  }

  function homeAdv(main, ops) {
    main.innerHTML = `<div class="card"><div class="card-h"><h2>Casos recebidos</h2><span class="pill">${ops.length}</span></div>
      <p class="small muted">Somente operações encaminhadas ao jurídico aparecem aqui.</p>
      <div class="tablewrap"><table><thead><tr><th>Código</th><th>Tipo</th><th>Destino</th><th>Devido</th><th>Saldo</th><th>Status</th></tr></thead><tbody>
      ${ops.map((o) => `<tr class="click" data-op="${o.id}"><td class="mono">${esc(o.codigo)}</td><td>${tipoPill(o.tipo)}</td><td>${esc(o.destinoNome)}</td><td class="mono">${brl(o.financeiro.devido)}</td><td class="mono">${brl(o.financeiro.saldo)}</td><td><span class="pill sys">${esc(jurLabel(o.statusJuridico))}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum caso encaminhado ainda.</td></tr>'}
      </tbody></table></div></div>`;
    $$('[data-op]', main).forEach((tr) => (tr.onclick = () => (location.hash = `#/op/${tr.dataset.op}`)));
  }

  // ---------------- operação ----------------
  async function viewOp(id) {
    let d;
    try { d = await api('GET', `/api/operations/${id}`); store.set('estadia.cache.op.' + id, JSON.stringify(d)); }
    catch (e) { if (e.code !== 'REDE') throw e; d = JSON.parse(store.get('estadia.cache.op.' + id) || 'null'); if (!d) throw e; }
    const main = $('#main');
    const role = S.user.role;
    const myPending = fila.filter((x) => x.opId === id);
    const evById = Object.fromEntries(d.timeline.map((e) => [e.id, e]));
    const o = d.op, r = d.resumo, ap = d.apuracao;

    let acoes = d.acoes.slice();
    if (role === 'tac' && (myPending.length || !online())) {
      const done = new Set(d.timeline.map((e) => e.type).concat(myPending.map((x) => x.body.type)));
      const seq = [['CHEGADA', 'Chegada', 'capturar', 'required', 'OPERACAO_IDENTIFICADA'], ['INICIO', 'Início', 'capturar', null, 'CHEGADA'], ['TERMINO', 'Término', 'capturar', 'optional', 'INICIO'], ['SAIDA', 'Saída', 'opcional', 'required', 'TERMINO']];
      const local = seq.filter(([t, , , , req]) => !done.has(t) && done.has(req)).slice(0, 1)
        .map(([type, label, gps, photo]) => ({ type, label, gps, photo, kind: 'registro', photoLabel: type === 'SAIDA' ? 'Foto do documento/comprovante de liberação ou saída' : null }));
      acoes = local.concat(acoes.filter((a) => a.kind !== 'registro' && !done.has(a.type)));
    }
    const registros = acoes.filter((a) => a.kind === 'registro');
    const confs = acoes.filter((a) => a.kind === 'confirmacao');
    const ms = Object.fromEntries(d.timeline.filter((e) => e.kind === 'registro').map((e) => [e.type, e]));
    const monitorando = role === 'tac' && ms.CHEGADA && !ms.SAIDA && o.tacUserId === S.user.id;

    main.innerHTML = `<a href="#/" class="small">← Voltar</a>
      <div class="card"><div class="card-h"><div><span class="row"><span class="label">${esc(o.codigo)}</span>${tipoPill(o.tipo)}</span><h1>${esc(o.localNome || o.destinoNome)}</h1></div>${statusPill(r)}</div>
        <dl class="kvgrid">${[
          ['Embarcador/destinatário', o.destinoNome], ['Transportadora', o.transportadoraNome], ['TAC', o.tacNome || 'não identificado'], ['Placa', placaFmt(o.placa)],
          ['Implemento', o.implemento], ['Capacidade', o.capacidadeToneladas != null ? `${num(o.capacidadeToneladas)} t` : null], ['Peso', o.pesoToneladas != null ? `${num(o.pesoToneladas)} t` : null],
          ['Carga', o.mercadoria], ['Volume', o.volume], ['NF-e', o.nfe], ['CT-e', o.cte], ['MDF-e', o.mdfe], ['Origem', o.origem], ['Data prevista', o.dataPrevista ? dataHora(o.dataPrevista) : null],
          ['Responsável no destino', o.responsavelNome ? `${o.responsavelNome}${o.responsavelTelefone ? ' · ' + o.responsavelTelefone : ''}` : null], ['Observações', o.observacoes],
        ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        ${limiteHtml(ap)}</div>
      <div class="grid2"><div class="col">
        ${myPending.length ? `<div class="card" style="border-color:var(--warn)"><div class="card-h"><h3>Salvos no aparelho</h3><span class="pill warn">${myPending.length} a enviar</span></div>
          ${myPending.map((p) => `<div class="row between small"><span>${esc(p.body.type)} · <span class="mono">${hhmm(p.body.occurredAt)}</span></span>${p.erro ? `<span class="err">${esc(p.erro)}</span> <button class="btn small danger" data-discard="${p.clientEventId}">Descartar</button>` : '<span class="muted">aguardando sinal</span>'}</div>`).join('')}
          ${online() ? '<button class="btn small" id="sync">Enviar agora</button>' : ''}</div>` : ''}
        ${confs.map((a) => pendingBox(a, evById[a.refEventId], acoes)).join('')}
        ${registros.filter((a) => role === 'tac' || a.type === 'LIBERACAO').map((a) => `<button class="big" data-act="${a.type}">${esc(a.label)}<small>${a.photo === 'required' ? (a.type === 'SAIDA' ? 'Foto do comprovante · GPS não obrigatório' : 'Captura horário, GPS e foto') : a.gps ? 'Captura horário e GPS' : 'Registra o horário deste momento'}</small></button>`).join('')}
        ${role !== 'tac' && registros.some((a) => a.type !== 'LIBERACAO') ? `<div class="card"><span class="label">Registrar pelo operador do destino</span><div class="row">${registros.filter((a) => a.type !== 'LIBERACAO').map((a) => `<button class="btn" data-act="${a.type}">${esc(a.label)}</button>`).join('')}</div></div>` : ''}
        ${linksHtml(d)}
        ${monitorando ? `<div class="card" id="monitor"><div class="card-h"><h3>Limite de Deslocamento do Local</h3><span class="pill">${d.limiteDeslocamentoM} m</span></div>
          <p class="small" id="mon-txt">Monitorando sua posição a cada 2 minutos enquanto esta tela estiver aberta.</p>
          <div class="row"><button class="btn small" id="mon-now">Enviar posição agora</button>${d.demo ? '<button class="btn small" id="mon-sim">Simular afastamento de 450 m (demo)</button>' : ''}</div></div>` : ''}
        ${role === 'tac' && !registros.length && !confs.length && !ms.SAIDA && o.tacUserId ? `<div class="card"><p class="muted">Aguardando o destino. Você será avisado aqui quando houver novidade.</p></div>` : ''}
        ${d.alertas.length ? `<div class="card"><h3>Ocorrências e alertas</h3>${d.alertas.map((a) => `<div class="alert ${a.nivel}"><b>${a.nivel === 'atencao' ? '!' : 'i'}</b><span>${a.codigo === 'DESLOCAMENTO_FORA_DO_LIMITE' ? '<span class="mono small">DESLOCAMENTO_FORA_DO_LIMITE</span> ' : ''}${esc(a.texto)}</span></div>`).join('')}
          <p class="small muted">Ocorrências são para análise humana. Não indicam fraude ou responsabilidade por si só.</p></div>` : ''}
        ${treatBoxes(d, evById)}
        <div class="card"><div class="card-h"><h2>Linha do tempo</h2><span class="pill">${d.timeline.length} eventos</span></div>${timelineHtml(d, myPending)}</div>
      </div><div class="col">
        ${apuracaoHtml(d)}
        ${financeiroHtml(d)}
        ${dossieHtml(d)}
        ${ameliaHtml(d)}
        ${retificarHtml(d)}
      </div></div>`;

    $$('[data-act]', main).forEach((b) => (b.onclick = () => captureSheet(id, acoes.find((a) => a.type === b.dataset.act))));
    $$('[data-confirm]', main).forEach((b) => (b.onclick = async () => {
      const a = acoes.find((x) => x.type === b.dataset.confirm); b.disabled = true;
      try { await sendEvent(id, { type: a.type, occurredAt: new Date().toISOString(), refEventId: a.refEventId }); refresh(); } catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    $$('[data-contest]', main).forEach((b) => (b.onclick = () => { const a = acoes.find((x) => x.kind === 'divergencia' && x.refEventId === b.dataset.contest); divergenceSheet(id, a, evById[a.refEventId]); }));
    $$('[data-discard]', main).forEach((b) => (b.onclick = async () => { await Q.del(b.dataset.discard); refresh(); }));
    $$('[data-treat]', main).forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      try { await sendEvent(id, { type: 'OCORRENCIA_TRATADA', occurredAt: new Date().toISOString(), refEventId: f.dataset.treat, resolucao: f.querySelector('select').value, note: f.querySelector('textarea').value.trim() }); refresh(); } catch (err) { toast(err.message, true); }
    }));
    $$('[data-wa]', main).forEach((a) => (a.onclick = () => { api('POST', `/api/operations/${id}/links/${a.dataset.wa}/enviado`).catch(() => {}); }));
    $$('[data-copy]', main).forEach((b) => (b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copiado.'); }
      catch { const i = document.createElement('input'); i.value = b.dataset.copy; b.after(i); i.select(); toast('Selecione e copie o link.'); }
    }));
    const sync = $('#sync'); if (sync) sync.onclick = flush;
    const bind = (sel, fn) => { const el = $(sel); if (el) el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { toast(e.message, true); el.disabled = false; } }; };
    bind('#novolink', async () => { await api('POST', `/api/operations/${id}/links`); toast('Novo link de confirmação gerado.'); refresh(); });
    bind('#apurar', async () => { await api('POST', `/api/operations/${id}/apuracao`); toast('Nova apuração registrada. Histórico preservado.'); refresh(); });
    bind('#gerar', async () => { const x = await api('POST', `/api/operations/${id}/dossie`); toast('Dossiê gerado.'); location.hash = `#/dossie/${x.hash}`; });
    bind('#encaminhar', async () => { await api('POST', `/api/operations/${id}/encaminhar`, { note: ($('#enc-note') || {}).value }); toast('Dossiê encaminhado ao jurídico.'); refresh(); });
    $$('[data-sit]', main).forEach((b) => (b.onclick = async () => { try { await sendEvent(id, { type: 'SITUACAO_FINANCEIRA', occurredAt: new Date().toISOString(), situacao: b.dataset.sit, note: ($('#sit-note') || {}).value || undefined }); refresh(); } catch (e) { toast(e.message, true); } }));
    const pf = $('#payf');
    if (pf) pf.onsubmit = async (e) => {
      e.preventDefault();
      const dia = $('#pay-data').value;
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
      const quando = !dia || dia === hoje ? new Date().toISOString() : new Date(`${dia}T12:00:00-03:00`).toISOString();
      try { await sendEvent(id, { type: 'PAGAMENTO_REGISTRADO', occurredAt: quando, valor: $('#pay-valor').value, origem: $('#pay-orig').value, note: $('#pay-note').value.trim() || undefined }); toast('Pagamento registrado.'); refresh(); }
      catch (err) { toast(err.message, true); }
    };
    bind('#encerrar', async () => {
      const row = $('#enc-row');
      row.innerHTML = '<span class="small"><b>Encerrar a operação?</b> Depois disso ela não aceita novos registros.</span><button class="btn danger" id="enc-yes">Encerrar</button><button class="btn" id="enc-no">Cancelar</button>';
      $('#enc-no').onclick = refresh;
      $('#enc-yes').onclick = async () => { try { await api('POST', `/api/operations/${id}/encerrar`, {}); toast('Operação encerrada.'); refresh(); } catch (e) { toast(e.message, true); } };
    });
    $$('[data-jur]', main).forEach((b) => (b.onclick = async () => {
      try { await api('POST', `/api/operations/${id}/juridico-status`, { status: b.dataset.jur, note: ($('#jur-note') || {}).value || '', resultado: ($('#jur-res') || {}).value || '' }); toast('Retorno registrado.'); refresh(); } catch (e) { toast(e.message, true); }
    }));
    const rf = $('#retf');
    if (rf) rf.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', `/api/operations/${id}/retificar`, { campo: $('#ret-campo').value, novo: $('#ret-novo').value, motivo: $('#ret-motivo').value }); toast('Retificação registrada. Valor anterior preservado.'); refresh(); }
      catch (err) { toast(err.message, true); }
    };

    // Monitoramento de deslocamento (épico 05)
    if (monitorando) {
      const monTxt = (x) => { const el = $('#mon-txt'); if (el) el.innerHTML = x.distanciaM == null ? 'Sem ponto de referência ainda.' : `Última posição a <b>${x.distanciaM} m</b> do local (limite ${x.limiteM} m)${x.foraDoLimite ? ` · <span style="color:var(--crit);font-weight:600">fora do limite${x.registrada ? ', ocorrência registrada' : ''}</span>` : ' · dentro do limite'}.`; };
      const enviar = async (simulado) => {
        if (!online()) return;
        let pos;
        if (simulado) { const ref = d.referencia; if (!ref) return toast('Sem ponto de referência.', true); pos = { lat: ref.lat + 0.004, lng: ref.lng, acc: 10, simulado: true }; }
        else { const g = await getGps(); if (g.erro) { const el = $('#mon-txt'); if (el) el.textContent = `GPS: ${g.erro}.`; return; } pos = g; }
        try { const x = await api('POST', `/api/operations/${id}/posicao`, pos); monTxt(x); if (x.registrada) refresh(); } catch (e) { toast(e.message, true); }
      };
      bind('#mon-now', () => enviar(false));
      bind('#mon-sim', () => enviar(true));
      enviar(false);
      monitorT = setInterval(() => enviar(false), 120000);
    }
    if (ap && !ap.pendente && ap.emCurso) liveT = setInterval(() => { const m = $('#limite-live'); if (m) m.outerHTML = limiteHtml(liveApur(ap)); }, 30000);
  }

  function liveApur(ap) {
    const t = Math.max(0, Math.round((Date.now() - Date.parse(ap.marcoInicial)) / 60000));
    return { ...ap, tempoMin: t, excedeu: t > ap.regra.limiteMin };
  }

  function limiteHtml(ap) {
    if (!ap || ap.pendente) return `<div id="limite-live" class="limite"><span class="label">Limite de Estadia · 5 horas</span><p class="small muted">${esc(ap ? ap.motivo : '')} O limite começa a contar na confirmação da chegada pelo destino.</p></div>`;
    const lim = ap.regra.limiteMin, scale = Math.max(12 * 60, ap.tempoMin * 1.1);
    const w = Math.min(100, (ap.tempoMin / scale) * 100), lp = (lim / scale) * 100;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => `<span>${Math.round((scale * k) / 60)}h</span>`).join('');
    const rest = lim - ap.tempoMin;
    return `<div id="limite-live" class="limite"><div class="row between small"><span><span class="label">Limite de Estadia</span> desde ${hhmm(ap.marcoInicial)} (confirmação da chegada) · <b class="mono">${dur(ap.tempoMin)}</b> ${ap.emCurso ? 'em curso' : 'até a liberação'}</span>
      ${ap.excedeu ? `<span style="color:var(--crit);font-weight:600">limite excedido · valor calculado sobre o tempo total</span>` : `<span class="muted">${ap.emCurso ? `restam ${dur(rest)} (vence ${hhmm(ap.limiteEm)})` : 'dentro do limite'}</span>`}</div>
      <div class="meter"><div class="fill ${ap.excedeu ? 'over' : ''}" style="width:${w}%"></div><div class="tick" style="left:${lp}%"><span>5h</span></div></div><div class="scale">${ticks}</div></div>`;
  }

  function pendingBox(a, ref, acoes) {
    if (!ref) return '';
    const contest = acoes.find((x) => x.kind === 'divergencia' && x.refEventId === ref.id);
    const p = ref.payload || {};
    const title = { CHEGADA_CONFIRMADA: 'Confirmar chegada do veículo', INICIO_CONFIRMADO: 'Confirmar início da operação', TERMINO_CONFIRMADO: 'Confirmar término da operação', LIBERACAO_CONFIRMADA: 'Você foi liberado para viagem' }[a.type] || a.label;
    return `<div class="pending"><div class="card-h"><h3>${esc(title)}</h3><span class="pill acc">pendente</span></div>
      <div class="evid">${p.photo ? `<img src="${fileUrl(p.photo)}" alt="Foto: ${esc(ref.label)}" loading="lazy">` : `<div class="kpi"><span class="label">Sem foto</span></div>`}
        <dl class="kv"><dt>Registro</dt><dd>${esc(ref.label)}</dd><dt>Por</dt><dd>${esc(ref.actor.name)}</dd><dt>Ocorrido</dt><dd class="mono">${dataHora(ref.occurredAt)}</dd>
        ${p.gps ? `<dt>Local</dt><dd class="mono">${esc(gpsTxt(p.gps))} ${mapLink(p.gps) ? `<a href="${mapLink(p.gps)}" target="_blank" rel="noopener">mapa</a>` : ''}</dd>` : ''}
        ${p.note ? `<dt>Obs.</dt><dd>${esc(p.note)}</dd>` : ''}</dl></div>
      <div class="row"><button class="btn ok" data-confirm="${a.type}">${a.type === 'LIBERACAO_CONFIRMADA' ? 'Confirmar liberação' : 'Confirmar'}</button>
      ${contest ? `<button class="btn danger" data-contest="${ref.id}">Não reconheço este registro</button>` : ''}</div>
      <p class="small muted">A confirmação fica registrada com seu nome e horário próprios, sem alterar o horário do registro.</p></div>`;
  }

  function linksHtml(d) {
    const pendDestino = d.timeline.filter((e) => e.kind === 'registro' && e.actor.role === 'tac' && ['CHEGADA', 'INICIO', 'TERMINO'].includes(e.type) && !d.timeline.some((c) => c.kind === 'confirmacao' && c.refEventId === e.id));
    if (!pendDestino.length || d.timeline.some((e) => e.type === 'SAIDA') || !['tac', 'destino', 'transportadora', 'admin'].includes(S.user.role)) return '';
    const renov = d.timeline.filter((e) => e.type === 'LINK_RENOVACAO_SOLICITADA').pop();
    const lastGen = d.timeline.filter((e) => e.type === 'LINK_GERADO').pop();
    const pediuNovo = renov && (!lastGen || Date.parse(renov.occurredAt) > Date.parse(lastGen.occurredAt));
    return `<div class="card wa"><div class="card-h"><h3>Confirmação pelo destino via WhatsApp</h3><span class="pill warn">${pendDestino.length} pendente${pendDestino.length > 1 ? 's' : ''}</span></div>
      ${pediuNovo ? '<div class="alert atencao"><b>!</b><span>O destino pediu um novo link (o anterior expirou).</span></div>' : ''}
      ${d.links.map((l) => `<div class="linkbox"><div class="row between"><b>${esc(l.label)}</b><span class="small muted">expira ${diaHora(l.expiraEm)}</span></div>
        <span class="small">Para ${esc(l.destinatario.nome)}${l.destinatario.telefone ? ` · ${esc(l.destinatario.telefone)}` : ''}</span>
        <div class="row"><a class="btn wa-btn" href="${esc(l.whatsappUrl)}" target="_blank" rel="noopener" data-wa="${l.id}">Enviar pelo WhatsApp</a>
          <button class="btn small" data-copy="${esc(l.url)}">Copiar link</button><a class="btn small" href="${esc(l.url)}" target="_blank" rel="noopener">Abrir página de confirmação</a></div></div>`).join('')
        || '<p class="small muted">Nenhum link ativo (expirado ou já usado).</p>'}
      <button class="btn small" id="novolink">Gerar novo link</button>
      <p class="small muted">O link é único, expira e só permite a confirmação daquele registro. O envio automático depende do provedor oficial de WhatsApp (a validar pelo time técnico); nesta versão o envio é feito pelo próprio WhatsApp do usuário.</p></div>`;
  }

  function treatBoxes(d, evById) {
    if (!can('tratar_divergencia') || !d.divergenciasAbertas.length) return '';
    return d.divergenciasAbertas.map((id) => {
      const dv = evById[id];
      return `<form class="card" data-treat="${id}"><div class="card-h"><h3>Tratar divergência</h3><span class="pill crit">aberta</span></div>
        <p class="small">${esc(dv.payload.note)}</p>
        <div class="form"><div class="field"><label class="label">Resolução</label><select><option value="acordo">Acordo entre as partes</option><option value="procedente">Divergência procedente</option><option value="improcedente">Divergência improcedente</option></select></div>
        <div class="field full"><label class="label">Justificativa</label><textarea required></textarea></div></div>
        <button class="btn" type="submit">Registrar tratamento</button><p class="small muted">Os eventos originais não são alterados.</p></form>`;
    }).join('');
  }

  const KIND = { registro: ['Registro', ''], confirmacao: ['Confirmação', 'ok'], divergencia: ['Divergência', 'crit'], ocorrencia: ['Ocorrência', 'crit'], apuracao: ['Apuração', 'acc'], financeiro: ['Financeiro', 'ok'],
    dossie: ['Dossiê', 'sys'], juridico: ['Jurídico', 'sys'], cadastro: ['Cadastro', ''], tratamento: ['Tratamento', 'sys'], notificacao: ['Notificação', 'sys'] };
  function timelineHtml(d, myPending) {
    const subs = {}, main = [];
    for (const e of d.timeline) {
      if (e.refEventId && ['confirmacao', 'divergencia', 'tratamento'].includes(e.kind)) (subs[e.refEventId] = subs[e.refEventId] || []).push(e);
      else main.push(e);
    }
    const subHtml = (e) => (subs[e.id] || []).map((x) => {
      const cls = x.kind === 'divergencia' ? 'div' : x.kind === 'tratamento' ? 'trat' : '';
      const extra = x.kind === 'divergencia'
        ? `<span>${esc(x.payload.note)}</span>${x.payload.alegadoEm ? `<span class="meta">horário reconhecido pela parte: ${hhmm(x.payload.alegadoEm)}</span>` : ''}<span class="meta">registro original de ${hhmm(e.occurredAt)} preservado</span>`
        : x.kind === 'tratamento' ? `<span>${esc(x.payload.resolucao)}: ${esc(x.payload.note)}</span>`
          : `${x.payload && x.payload.note ? `<span>${esc(x.payload.note)}</span>` : ''}<span class="meta">não altera o horário do registro (${hhmm(e.occurredAt)}) · via ${esc(ORIGEM[x.origem] || x.origem)}</span>`;
      return `<div class="sub ${cls}"><div class="row between"><b>${esc(x.label)}</b><span class="mono">${diaHora(x.occurredAt)}</span></div><span>${esc(x.actor.name)}</span>${extra}${subHtml(x)}</div>`;
    }).join('');
    const items = main.map((e) => {
      const p = e.payload || {};
      let body = `<span class="small muted">${esc(e.actor.name)} · ${esc(ROLE[e.actor.role] || e.actor.role)} · via ${esc(ORIGEM[e.origem] || e.origem)}</span>`;
      if (e.kind === 'registro') {
        if (p.gps) body += `<div class="meta"><span>${esc(gpsTxt(p.gps))}</span>${mapLink(p.gps) ? `<a href="${mapLink(p.gps)}" target="_blank" rel="noopener">ver no mapa</a>` : ''}</div>`;
        if (p.photo) body += `<a href="${fileUrl(p.photo)}" target="_blank" rel="noopener"><img class="thumb" src="${fileUrl(p.photo)}" alt="Foto: ${esc(e.label)}" loading="lazy"></a>`;
        if (p.note) body += `<span class="small">${esc(p.note)}</span>`;
        if ((Date.parse(e.receivedAt) - Date.parse(e.occurredAt)) / 60000 >= 2) body += `<div class="meta"><span>ocorrido ${hhmm(e.occurredAt)} · sincronizado ${hhmm(e.receivedAt)}</span></div>`;
      } else if (e.kind === 'ocorrencia') {
        body += e.type === 'DESLOCAMENTO_FORA_DO_LIMITE' ? `<span class="small"><span class="mono">DESLOCAMENTO_FORA_DO_LIMITE</span> · ${p.distanciaM} m do local (limite ${p.limiteM} m)${p.simulado ? ' · simulado' : ''}</span>` : `<span class="small">${esc(p.marco)}: ${esc(p.motivo)}</span>`;
      } else if (e.kind === 'apuracao') {
        body += `<span class="small">${esc(p.memoria)} · regra ${esc(p.regra.id)} v${esc(p.regra.versao)}</span>`;
      } else if (e.type === 'PAGAMENTO_REGISTRADO') {
        body += `<span class="small">${brl(p.valor)} · ${esc((d.financeiro.origens || {})[p.origem] || p.origem)}${p.note ? ' · ' + esc(p.note) : ''}</span>`;
      } else if (e.type === 'SITUACAO_FINANCEIRA') {
        body += `<span class="small">${esc(p.situacao)}${p.note ? ' · ' + esc(p.note) : ''}</span>`;
      } else if (e.kind === 'dossie') {
        body += `<a class="small" href="#/dossie/${p.hash}">Abrir dossiê ${p.hash.slice(0, 12)}…</a>`;
      } else if (e.kind === 'juridico') {
        body += `<span class="small">${p.status ? esc(jurLabel(p.status)) : esc(p.advocaciaNome || '')}${p.note ? ': ' + esc(p.note) : ''}${p.resultado ? ` · resultado: ${esc(p.resultado)}` : ''}</span>`;
      } else if (e.type === 'OPERACAO_RETIFICADA') {
        body += `<span class="small">${esc(p.rotulo)}: ${esc(p.anterior ?? '—')} → <b>${esc(p.novo)}</b> · motivo: ${esc(p.motivo)}</span>`;
      } else if (e.type === 'DADOS_INFORMADOS') {
        body += `<span class="small">“${esc(p.texto)}”${p.audio ? ' · com áudio' : ''}</span>`;
      } else if (e.kind === 'notificacao' && p.destinatario) {
        body += `<span class="small">Para ${esc(p.destinatario.nome)}${p.destinatario.telefone ? ' · ' + esc(p.destinatario.telefone) : ''} · expira ${diaHora(p.expiraEm)}</span>`;
      }
      const [kl, kc] = KIND[e.kind] || ['Sistema', ''];
      return `<div class="ev k-${e.kind}"><span class="dot"></span><div class="ev-c"><div class="row between"><span class="pill ${kc}">${kl}</span><span class="mono">${diaHora(e.occurredAt)}</span></div>
        <h4>${esc(e.label)}</h4>${body}${subHtml(e)}<span class="meta" title="Hash do evento na cadeia">#${e.seq} · ${e.hash.slice(0, 10)}</span></div></div>`;
    });
    for (const p of myPending) items.push(`<div class="ev pend"><span class="dot"></span><div class="ev-c"><div class="row between"><span class="pill warn">Aguardando envio</span><span class="mono">${diaHora(p.body.occurredAt)}</span></div><h4>${esc(p.body.type)}</h4><span class="small muted">Salvo no aparelho. O horário original será mantido no envio.</span></div></div>`);
    return `<div class="tl">${items.join('')}</div>`;
  }

  function apuracaoHtml(d) {
    const ap = d.apuracao;
    const regra = ap.regra;
    const regraBox = `<div class="rule"><b>Regra ${esc(regra.id)} · versão ${esc(regra.versao)} · vigente desde ${esc(regra.vigenteDesde.split('-').reverse().join('/'))}</b><span>${esc(regra.descricaoFormula)}</span><span class="muted">${esc(regra.fonte)}</span></div>`;
    if (ap.pendente) return `<div class="card"><div class="card-h"><h2>Apuração</h2><span class="pill">aguardando</span></div><p class="small muted">${esc(ap.motivo)}</p>${regraBox}</div>`;
    const ret = d.timeline.filter((e) => e.type === 'OPERACAO_RETIFICADA').pop();
    const ultAp = d.timeline.filter((e) => e.type === 'APURACAO').pop();
    return `<div class="card"><div class="card-h"><h2>Apuração</h2><span class="pill ${ap.emCurso ? 'warn' : 'ok'}">${ap.emCurso ? 'prévia em curso' : `${d.apuracoes} registrada${d.apuracoes > 1 ? 's' : ''}`}</span></div>
      <div class="row between"><div><span class="label">Valor devido</span><div class="bignum">${brl(ap.valorDevido)}</div></div><div style="text-align:right"><span class="label">Tempo efetivo</span><div class="bignum" style="font-size:32px">${dur(ap.tempoMin)}</div></div></div>
      <div class="calc"><span>Marco inicial · chegada confirmada</span><span class="v">${diaHora(ap.marcoInicial)}</span>
        <span>Marco final · liberação</span><span class="v">${ap.marcoFinal ? diaHora(ap.marcoFinal) : 'em aberto'}</span>
        <span>Limite de Estadia</span><span class="v">${dur(regra.limiteMin)}</span><span>Capacidade do veículo</span><span class="v">${num(ap.capacidadeToneladas)} t</span>
</div>
      <div class="memoria"><span class="label">Memória de cálculo</span><span class="mono">${esc(ap.memoria)}</span></div>
      ${ap.cenarios.length > 1 ? `<span class="label">Cenários com outros marcos (informativo)</span>${ap.cenarios.map((c) => `<div class="alt ${c.ativo ? 'on' : ''}"><span>${esc(c.label)}</span><span class="mono">${dur(c.minutos)}</span></div>`).join('')}` : ''}
      ${regraBox}
      ${ret && ultAp && Date.parse(ret.receivedAt) > Date.parse(ultAp.receivedAt) ? '<div class="alert atencao"><b>!</b><span>Dados retificados depois da última apuração registrada. Registre uma nova apuração.</span></div>' : ''}
      ${can('gerar_dossie') && d.resumo.statusCode !== 'ENCERRADA' ? '<button class="btn small" id="apurar">Registrar nova apuração</button>' : ''}</div>`;
  }

  function financeiroHtml(d) {
    const f = d.financeiro;
    if (f.devido == null) return `<div class="card"><div class="card-h"><h2>Conciliação financeira</h2></div><p class="small muted">Disponível depois da saída e da apuração.</p></div>`;
    const podePagar = can('registrar_pagamento') && (S.user.role !== 'tac' || d.op.tacUserId === S.user.id) && d.resumo.statusCode !== 'ENCERRADA';
    const STF = { APURADA: ['Sem valor devido', 'ok'], AGUARDANDO_PAGAMENTO: ['Aguardando pagamento', 'warn'], PAGAMENTO_PARCIAL: ['Pagamento parcial', 'warn'], PAGO: ['Pago', 'ok'], VALOR_DIVERGENTE: ['Valor divergente', 'crit'], EM_TRATATIVA: ['Em tratativa', 'sys'] };
    const [sl, sc] = STF[f.status] || [f.status, ''];
    return `<div class="card"><div class="card-h"><h2>Conciliação financeira</h2><span class="pill ${sc}">${esc(sl)}</span></div>
      <div class="fin"><div><span class="label">Valor devido</span><b>${brl(f.devido)}</b></div><div><span class="label">Valor pago</span><b>${brl(f.pago)}</b></div><div><span class="label">Saldo pendente</span><b ${f.saldo > 0 ? 'style="color:var(--crit)"' : ''}>${brl(f.saldo)}</b></div></div>
      ${f.percentualRecebido != null ? `<div class="meter thin"><div class="fill" style="width:${Math.min(100, f.percentualRecebido)}%"></div></div><span class="small muted">${num(f.percentualRecebido)}% recebido</span>` : ''}
      ${f.pagamentos.length ? `<span class="label">Pagamentos</span>${f.pagamentos.map((p) => `<div class="row between small"><span>${brl(p.payload.valor)} · ${esc(f.origens[p.payload.origem] || p.payload.origem)}${p.payload.note ? ' · ' + esc(p.payload.note) : ''}</span><span class="mono">${diaHora(p.occurredAt)} · ${esc(p.actor.name)}</span></div>`).join('')}` : ''}
      ${podePagar ? `<details><summary style="cursor:pointer"><b>Registrar valor recebido</b></summary><form id="payf" class="form" style="margin-top:10px">
        <div class="field"><label class="label" for="pay-valor">Valor (R$)</label><input id="pay-valor" inputmode="decimal" required placeholder="0,00"></div>
        <div class="field"><label class="label" for="pay-orig">Origem</label><select id="pay-orig">${Object.entries(f.origens).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="pay-data">Data</label><input id="pay-data" type="date" value="${new Date().toLocaleDateString('en-CA', { timeZone: TZ })}"></div>
        <div class="field full"><label class="label" for="pay-note">Observação</label><input id="pay-note"></div>
        <div class="field full"><button class="btn primary" type="submit">Registrar pagamento</button></div></form></details>
        <div class="field"><label class="label" for="sit-note">Negociação (observação opcional)</label><input id="sit-note"></div>
        <div class="row"><button class="btn small" data-sit="EM_TRATATIVA">Marcar em tratativa</button><button class="btn small" data-sit="VALOR_DIVERGENTE">Marcar valor divergente</button>${f.situacao !== 'NORMAL' ? '<button class="btn small" data-sit="NORMAL">Remover marcação</button>' : ''}</div>` : ''}
      ${can('encerrar') && d.resumo.statusCode !== 'ENCERRADA' ? '<div class="row" id="enc-row"><button class="btn small" id="encerrar">Encerrar operação</button><span class="small muted">Gerar o dossiê não encerra a operação.</span></div>' : ''}</div>`;
  }

  function dossieHtml(d) {
    const j = d.juridico;
    return `<div class="card"><div class="card-h"><h2>Dossiê digital</h2>${j.status ? `<span class="pill sys">Jurídico: ${esc(jurLabel(j.status))}</span>` : ''}</div>
      ${d.dossies.length ? d.dossies.slice().reverse().map((x, i) => `<a class="row between small" href="#/dossie/${x.hash}"><span>${i === 0 ? '<b>Versão atual</b> · ' : ''}gerado ${diaHora(x.geradoEm)} por ${esc(x.por)}</span><span class="mono">${x.hash.slice(0, 10)}…</span></a>`).join('') : '<p class="small muted">Gerado automaticamente após a saída.</p>'}
      ${can('gerar_dossie') && d.timeline.some((e) => e.type === 'CHEGADA') ? '<button class="btn small" id="gerar">Gerar nova versão</button>' : ''}
      ${can('encaminhar') && !j.status ? (j.elegivel.apto ? '<div class="field"><label class="label" for="enc-note">Observação para o jurídico</label><input id="enc-note"></div><button class="btn primary" id="encaminhar">Encaminhar ao jurídico</button>' : `<p class="small muted">Encaminhamento jurídico: ${esc(j.elegivel.motivos.join(' '))}</p>`) : ''}
      ${j.historico.length ? `<span class="label">Encaminhamento e retorno</span>${j.historico.map((h) => `<div class="row between small"><span>${esc(h.type === 'ENCAMINHADO_JURIDICO' ? 'Enviado a ' + h.payload.advocaciaNome : jurLabel(h.payload.status))}${h.payload.note ? ' · ' + esc(h.payload.note) : ''}${h.payload.resultado ? ' · resultado: ' + esc(h.payload.resultado) : ''}</span><span class="mono">${diaHora(h.occurredAt)}</span></div>`).join('')}` : ''}
      ${S.user.role === 'advocacia' ? `<div class="field"><label class="label" for="jur-note">Observação</label><input id="jur-note"></div><div class="field"><label class="label" for="jur-res">Resultado (retorno jurídico)</label><input id="jur-res"></div>
        <div class="row">${['RECEBIDO', 'EM_ANALISE', 'CONCLUIDO'].map((s) => `<button class="btn small" data-jur="${s}">Marcar ${jurLabel(s)}</button>`).join('')}</div>` : ''}</div>`;
  }

  function ameliaHtml(d) {
    const e = d.timeline.find((x) => x.type === 'DADOS_INFORMADOS');
    if (!e) return '';
    const p = e.payload;
    return `<div class="card"><div class="card-h"><h3>Dados informados pelo TAC</h3><span class="pill">${p.canal === 'audio' ? 'áudio + texto' : 'texto'} · Amélia</span></div>
      <p class="small">“${esc(p.texto)}”</p>${p.audio ? `<audio controls src="${fileUrl(p.audio)}"></audio>` : ''}
      <div class="tablewrap"><table><thead><tr><th>Dado</th><th>Informado</th><th>Cadastro</th></tr></thead><tbody>${(p.entidades || []).map((x) => `<tr><td>${esc(x.label)}</td><td>${esc(x.valor)}</td><td>${x.cadastrado == null ? '—' : x.confere ? '<span class="pill ok">confere</span>' : `<span class="pill warn">${esc(x.cadastrado)}</span>`}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function retificarHtml(d) {
    if (!can('editar') || d.resumo.statusCode === 'ENCERRADA') return '';
    const rets = d.timeline.filter((e) => e.type === 'OPERACAO_RETIFICADA');
    return `<details class="card"><summary style="cursor:pointer"><b>Retificar dados da operação</b> <span class="small muted">com motivo e histórico</span></summary>
      <form id="retf" class="form" style="margin-top:10px"><div class="field"><label class="label" for="ret-campo">Campo</label><select id="ret-campo">${Object.entries(d.campos).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="field"><label class="label" for="ret-novo">Novo valor</label><input id="ret-novo" required></div>
        <div class="field full"><label class="label" for="ret-motivo">Motivo</label><input id="ret-motivo" required></div>
        <div class="field full"><button class="btn" type="submit">Registrar retificação</button></div></form>
      ${rets.map((r) => `<div class="small">${diaHora(r.occurredAt)} · ${esc(r.actor.name)}: ${esc(r.payload.rotulo)} ${esc(r.payload.anterior ?? '—')} → <b>${esc(r.payload.novo)}</b> (${esc(r.payload.motivo)})</div>`).join('')}</details>`;
  }

  // ---------------- dossiê ----------------
  async function viewDossie(hash) {
    const { content: c } = await api('GET', `/api/dossies/${hash}`);
    const main = $('#main');
    const o = c.operacao, ap = c.apuracao, f = c.financeiro;
    const linha = (k, v) => (v ? `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>` : '');
    main.innerHTML = `<div class="row noprint"><a href="#/op/${o.id}" class="small">← Voltar à operação</a><span style="flex:1"></span><button class="btn" id="verify">Verificar integridade</button><button class="btn" id="dl">Baixar arquivo</button><button class="btn primary" id="print">Imprimir / salvar PDF</button></div>
      <p class="noprint small" id="vres"></p>
      <article class="doc">
        <div class="doc-h"><div><span class="label">Estadia BR · Dossiê digital</span><h1>${esc(o.codigo)}</h1><span class="muted small">${o.tipo === 'CARGA' ? 'Operação de carga' : 'Operação de descarga'} · ${esc(o.destinoNome)} · ${esc(placaFmt(o.placa))}</span></div>
          <div style="text-align:right"><span class="label">Gerado em</span><div class="mono">${dataHora(c.geradoEm)}</div><span class="small muted">${esc(c.geradoPor.nome)} · situação: ${esc(c.status.descricao)}</span></div></div>
        <div class="kpis"><div class="kpi"><span class="label">Tempo efetivo</span><b>${ap && !ap.pendente ? dur(ap.tempoMin) : '—'}</b></div><div class="kpi"><span class="label">Valor devido</span><b>${brl(f.devido)}</b></div>
          <div class="kpi"><span class="label">Valor pago</span><b>${brl(f.pago)}</b></div><div class="kpi"><span class="label">Saldo</span><b>${brl(f.saldo)}</b></div></div>
        <section><span class="label">Dados da operação</span><dl class="kvgrid">${linha('Transportadora', o.transportadoraNome)}${linha('Embarcador/destinatário', o.destinoNome)}${linha('TAC', o.tacNome)}${linha('Veículo', `${placaFmt(o.placa)}${o.implemento ? ' · ' + o.implemento : ''}`)}
          ${linha('Capacidade', o.capacidadeToneladas && `${num(o.capacidadeToneladas)} t`)}${linha('Peso', o.pesoToneladas && `${num(o.pesoToneladas)} t`)}${linha('Carga', o.mercadoria)}${linha('Volume', o.volume)}${linha('NF-e', o.nfe)}${linha('CT-e', o.cte)}${linha('MDF-e', o.mdfe)}${linha('Local', o.localNome)}</dl></section>
        ${c.dadosInformados ? `<section><span class="label">Dados informados pelo TAC (Amélia · ${esc(c.dadosInformados.canal)})</span><p class="small">“${esc(c.dadosInformados.texto)}” · ${dataHora(c.dadosInformados.em)}</p></section>` : ''}
        <section><span class="label">Marcos e confirmações</span><div class="tablewrap"><table><thead><tr><th>Marco</th><th>Ocorrido</th><th>Registrado por</th><th>Local</th><th>Confirmação</th></tr></thead><tbody>
          ${c.marcos.map((m) => `<tr><td>${esc(m.marco)}${m.divergencias.length ? ' <span class="pill crit">divergência</span>' : ''}</td><td class="mono">${dataHora(m.em)}${Date.parse(m.recebidoEm) - Date.parse(m.em) > 120000 ? `<br><span class="muted small">recebido ${hhmm(m.recebidoEm)}</span>` : ''}</td>
            <td>${esc(m.por)}<br><span class="small muted">via ${esc(ORIGEM[m.origem] || m.origem)}</span></td><td class="mono small">${m.gps ? esc(gpsTxt(m.gps)) : '—'}</td><td>${m.confirmacao ? `${esc(m.confirmacao.por)}<br><span class="mono small">${dataHora(m.confirmacao.em)} · ${esc(ORIGEM[m.confirmacao.origem] || m.confirmacao.origem)}</span>` : '—'}</td></tr>`).join('')}
        </tbody></table></div></section>
        ${c.marcos.some((m) => m.foto) ? `<section><span class="label">Evidências fotográficas</span><div class="photos">${c.marcos.filter((m) => m.foto).map((m) => `<figure><img src="${fileUrl(m.foto)}" alt="${esc(m.marco)}"><figcaption>${esc(m.marco)} · ${dataHora(m.em)}<br><span class="mono">sha256 ${m.foto.sha256.slice(0, 16)}…</span></figcaption></figure>`).join('')}</div></section>` : ''}
        ${c.ocorrencias.length || c.marcos.some((m) => m.divergencias.length) ? `<section><span class="label">Ocorrências e divergências</span>
          ${c.ocorrencias.map((x) => `<p class="small" style="margin:4px 0"><span class="mono">${esc(x.codigo)}</span> · ${dataHora(x.em)} · ${x.codigo === 'DESLOCAMENTO_FORA_DO_LIMITE' ? `${x.dados.distanciaM} m do local (limite ${x.dados.limiteM} m)${x.dados.simulado ? ' · simulado' : ''}` : esc(x.dados.motivo || '')}</p>`).join('')}
          ${c.marcos.flatMap((m) => m.divergencias.map((dv) => `<p class="small" style="margin:4px 0"><b>${esc(m.marco)}</b> · ${esc(dv.por)} em ${dataHora(dv.em)}: ${esc(dv.descricao)}${dv.alegadoEm ? ` (horário reconhecido: ${hhmm(dv.alegadoEm)})` : ''} · ${dv.tratamento ? `tratada: ${esc(dv.tratamento.resolucao)}, ${esc(dv.tratamento.descricao)}` : '<b>em aberto</b>'}</p>`)).join('')}</section>` : ''}
        ${ap && !ap.pendente ? `<section><span class="label">Apuração</span><div class="calc" style="max-width:620px"><span>Tempo efetivo (${diaHora(ap.marcoInicial)} → ${ap.marcoFinal ? diaHora(ap.marcoFinal) : 'em aberto'})</span><span class="v">${dur(ap.tempoMin)}</span>
          <span>Limite de Estadia</span><span class="v">${dur(ap.regra.limiteMin)}</span><span>Capacidade utilizada</span><span class="v">${num(ap.capacidadeToneladas)} t</span><span>Valor por t·h</span><span class="v">${brl(ap.regra.valorTonHora)}</span>
          <span>Memória de cálculo</span><span class="v">${esc(ap.memoria)}</span><span><b>Valor devido</b></span><span class="v"><b>${brl(ap.valorDevido)}</b></span></div>
          <p class="small muted" style="margin-top:6px">Regra ${esc(ap.regra.id)} v${esc(ap.regra.versao)}, vigente desde ${esc(ap.regra.vigenteDesde)}. ${esc(ap.regra.descricaoFormula)}. ${esc(ap.regra.fonte)}</p></section>` : ''}
        <section><span class="label">Conciliação financeira</span>
          ${f.pagamentos.length ? f.pagamentos.map((p) => `<p class="small" style="margin:4px 0">${brl(p.valor)} · ${esc(p.origem)} · ${dataHora(p.em)} · ${esc(p.por)}${p.observacao ? ' · ' + esc(p.observacao) : ''}</p>`).join('') : '<p class="small muted">Nenhum pagamento registrado.</p>'}
          ${f.negociacoes.map((n) => `<p class="small" style="margin:4px 0">Negociação: ${esc(n.situacao)} · ${dataHora(n.em)}${n.observacao ? ' · ' + esc(n.observacao) : ''}</p>`).join('')}</section>
        ${c.notificacoes.length ? `<section><span class="label">Notificações e links</span>${c.notificacoes.map((n) => `<p class="small" style="margin:3px 0">${dataHora(n.em)} · ${esc(n.tipo)}${n.destinatario ? ` · ${esc(n.destinatario.nome)}` : ''} · ${esc(n.por)}</p>`).join('')}</section>` : ''}
        ${c.retificacoes.length ? `<section><span class="label">Retificações</span>${c.retificacoes.map((r) => `<p class="small" style="margin:3px 0">${dataHora(r.em)} · ${esc(r.por)}: ${esc(r.campo)} ${esc(r.anterior ?? '—')} → ${esc(r.novo)} · motivo: ${esc(r.motivo)}</p>`).join('')}</section>` : ''}
        ${c.juridico.length ? `<section><span class="label">Jurídico</span>${c.juridico.map((j) => `<p class="small" style="margin:3px 0">${dataHora(j.em)} · ${esc(j.tipo)} · ${esc(jurLabel(j.status))}${j.observacao ? ' · ' + esc(j.observacao) : ''}${j.resultado ? ' · resultado: ' + esc(j.resultado) : ''}</p>`).join('')}</section>` : ''}
        <section><span class="label">Trilha de auditoria</span><div class="tablewrap"><table><thead><tr><th>#</th><th>Ocorrido</th><th>Evento</th><th>Autor</th><th>Origem</th><th>Hash</th></tr></thead><tbody>
          ${c.trilhaAuditoria.map((t) => `<tr><td class="mono">${t.seq}</td><td class="mono">${diaHora(t.ocorridoEm)}</td><td>${esc(t.tipo)}</td><td>${esc(t.autor)}</td><td class="small">${esc(ORIGEM[t.origem] || t.origem)}${t.ip ? `<br><span class="mono muted">${esc(t.ip)}</span>` : ''}</td><td class="mono small">${t.hash.slice(0, 12)}</td></tr>`).join('')}</tbody></table></div></section>
        <section><span class="label">Integridade</span><div class="hash">Hash do dossiê (SHA-256): ${esc(hash)}</div>
          <p class="small muted" style="margin-top:6px">Cadeia de eventos ${c.integridade.cadeiaValida ? 'íntegra' : 'com falha'} no momento da geração · último hash ${esc(c.integridade.ultimoHashDaCadeia.slice(0, 16))}…</p></section>
        <p class="disclaimer">${esc(c.ressalva)}</p>
      </article>`;
    $('#print').onclick = () => window.print();
    $('#dl').onclick = async () => {
      const doc = await api('GET', `/api/dossies/${hash}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
      a.download = `dossie-${o.codigo}-${hash.slice(0, 8)}.json`; a.click();
    };
    $('#verify').onclick = async () => {
      const el = $('#vres');
      try {
        const doc = await api('GET', `/api/dossies/${hash}`);
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(doc.content)));
        const h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
        el.innerHTML = h === hash ? '<span class="pill ok">Conteúdo íntegro</span> O hash recalculado no seu navegador confere com o registrado.' : '<span class="pill crit">Divergente</span> O conteúdo não confere com o hash registrado.';
      } catch (e) { el.textContent = 'Não foi possível verificar: ' + e.message; }
    };
  }

  // ---------------- relatórios ----------------
  async function viewRelatorios() {
    const r = await api('GET', '/api/relatorios');
    const t = r.totais;
    const k = (label, v) => `<div class="kpi"><span class="label">${label}</span><b>${v}</b></div>`;
    $('#main').innerHTML = `<h1>Relatórios</h1>
      <span class="label">Operacionais</span><div class="kpis">${k('Operações', t.operacoes)}${k('Concluídas', t.concluidas)}${k('Tempo médio', dur(t.tempoMedioMin))}${k('Acima de 5 horas', t.acimaDoLimite)}
        ${k('Chegada → confirmação', dur(t.tempoMedioConfirmacaoMin))}${k('Chegada → início', dur(t.tempoMedioChegadaInicioMin))}${k('Início → término', dur(t.tempoMedioInicioTerminoMin))}</div>
      <span class="label">Financeiros</span><div class="kpis">${k('Valor devido', brl(t.devido))}${k('Valor pago', brl(t.pago))}${k('Saldo pendente', brl(t.saldo))}${k('Recuperado', t.percentualRecuperado == null ? '—' : num(t.percentualRecuperado) + '%')}</div>
      <span class="label">Evidências e jurídico</span><div class="kpis">${k('Com foto na chegada', t.comFoto)}${k('Com GPS na chegada', t.comGps)}${k('Sem confirmação', t.semConfirmacao)}${k('Deslocamentos > 300 m', t.deslocamentos)}${k('Com divergência', t.comDivergencia)}${k('Dossiês gerados', t.dossies)}${k('Encaminhadas ao jurídico', t.encaminhadas)}</div>
      <div class="card"><h2>Por operação</h2><div class="tablewrap"><table><thead><tr><th>Código</th><th>Tipo</th><th>Destino</th><th>Situação</th><th>Tempo</th><th>Devido</th><th>Pago</th><th>Saldo</th><th>Chegada→conf.</th><th>Desloc.</th></tr></thead><tbody>
        ${r.operacoes.map((o) => `<tr class="click" data-op="${o.id}"><td class="mono">${esc(o.codigo)}</td><td>${tipoPill(o.tipo)}</td><td>${esc(o.destinoNome)}</td><td>${statusPill(o)}</td><td class="mono">${dur(o.tempoMin)}</td><td class="mono">${brl(o.devido)}</td><td class="mono">${o.devido == null ? '—' : brl(o.pago)}</td><td class="mono">${brl(o.saldo)}</td><td class="mono">${dur(o.chegadaConfirmacaoMin)}</td><td class="mono">${o.deslocamentos || ''}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="card"><h2>Relação carga × descarga</h2><p class="small muted">Operações independentes relacionadas apenas para análise, pela mesma NF-e. Não há dependência operacional entre elas.</p>
        ${r.relacoesCargaDescarga.length ? r.relacoesCargaDescarga.map((g) => `<div class="rel"><span class="label">NF-e ${esc(g.nfe)}</span>${g.operacoes.map((o) => `<a class="row between small" href="#/op/${o.id}"><span>${tipoPill(o.tipo)} <span class="mono">${esc(o.codigo)}</span> · ${esc(o.destinoNome)}</span><span class="mono">${dur(o.tempoMin)} · ${brl(o.devido)}</span></a>`).join('')}</div>`).join('') : '<p class="small muted">Nenhuma relação encontrada.</p>'}</div>`;
    $$('[data-op]').forEach((tr) => (tr.onclick = () => (location.hash = `#/op/${tr.dataset.op}`)));
  }

  // ---------------- administração ----------------
  async function viewAdmin() {
    const [dirData, integ] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/integrity')]);
    const perms = ['visualizar', 'criar', 'editar', 'registrar', 'confirmar', 'tratar_divergencia', 'registrar_pagamento', 'gerar_dossie', 'encaminhar', 'encerrar', 'exportar', 'relatorios', 'registrar_juridico', 'administrar'];
    const cfg = S.config || {};
    $('#main').innerHTML = `<h1>Administração</h1>
      ${cfg.demo ? `<div class="card" style="border-color:var(--crit)"><div class="card-h"><h2>Reiniciar demonstração</h2><span class="pill crit">apaga tudo</span></div>
        <p class="small">Apaga operações, registros, fotos, áudios e dossiês e recria os dados iniciais. Todos os usuários conectados precisarão entrar de novo.</p>
        <div class="row" id="rst-row"><button class="btn danger" id="rst">Reiniciar demonstração</button></div></div>` : ''}
      <div class="card"><div class="card-h"><h2>Integridade da cadeia de eventos</h2>${integ.ok ? '<span class="pill ok">Íntegra</span>' : '<span class="pill crit">Quebrada</span>'}</div>
        <p class="small">${integ.ok ? `${integ.eventos} eventos verificados. Último hash: <span class="mono">${esc(integ.ultimoHash.slice(0, 24))}…</span>` : `Falha no evento #${integ.seq}: ${esc(integ.motivo)}`}</p></div>
      <div class="card"><h2>Parâmetros versionados</h2><div class="tablewrap"><table><thead><tr><th>Regra</th><th>Vigência</th><th>Limite</th><th>R$/t·h</th><th>Marco inicial</th><th>Marco final</th><th>Fórmula</th></tr></thead><tbody>
        ${(cfg.regras || []).map((x) => `<tr><td class="mono">${esc(x.id)} v${esc(x.versao)}</td><td class="mono">${esc(x.vigenteDesde)}</td><td>${dur(x.limiteMin)}</td><td class="mono">${brl(x.valorTonHora)}</td><td class="small">${esc(x.marcoInicial)}</td><td class="small">${esc(x.marcoFinal)}</td><td class="small">${esc(x.descricaoFormula)}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">Limite de Deslocamento do Local: ${cfg.limiteDeslocamentoM} m.</p></div>
      <div class="card"><h2>Permissões por perfil</h2><div class="tablewrap"><table><thead><tr><th>Permissão</th>${Object.keys(dirData.permissoes).map((x) => `<th>${esc(ROLE[x])}</th>`).join('')}</tr></thead><tbody>
        ${perms.map((p) => `<tr><td>${esc(p.replace(/_/g, ' '))}</td>${Object.values(dirData.permissoes).map((list) => `<td>${list.includes(p) ? '<span class="pill ok">sim</span>' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h2>Usuários</h2><div class="tablewrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Organização</th></tr></thead><tbody>
        ${dirData.users.map((u) => `<tr><td>${esc(u.nome)}</td><td class="mono small">${esc(u.email)}</td><td>${esc(ROLE[u.role])}</td><td>${esc(u.orgNome)}</td></tr>`).join('')}</tbody></table></div>
        <details><summary style="cursor:pointer"><b>Novo usuário</b></summary><form id="uf" class="form" style="margin-top:10px">
          <div class="field"><label class="label" for="uf-n">Nome</label><input id="uf-n" required></div>
          <div class="field"><label class="label" for="uf-e">E-mail</label><input id="uf-e" type="email" required></div>
          <div class="field"><label class="label" for="uf-s">Senha</label><input id="uf-s" type="password" minlength="6" required></div>
          <div class="field"><label class="label" for="uf-r">Perfil</label><select id="uf-r">${Object.keys(dirData.permissoes).map((x) => `<option value="${x}">${esc(ROLE[x])}</option>`).join('')}</select></div>
          <div class="field"><label class="label" for="uf-o">Organização</label><select id="uf-o">${dirData.orgs.map((x) => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></div>
          <div class="field"><label class="label" for="uf-p">Placa (TAC)</label><input id="uf-p"></div>
          <div class="field full"><button class="btn primary" type="submit">Criar usuário</button></div><p class="err field full" id="uf-err" hidden></p></form></details></div>`;
    const rst = $('#rst');
    if (rst) rst.onclick = () => {
      $('#rst-row').innerHTML = '<span class="small"><b>Tem certeza?</b> Isso não pode ser desfeito.</span><button class="btn danger" id="rst-yes">Sim, apagar e recriar</button><button class="btn" id="rst-no">Cancelar</button>';
      $('#rst-no').onclick = () => viewAdmin();
      $('#rst-yes').onclick = async () => { try { await api('POST', '/api/admin/reset-demo'); await Q.clear(); toast('Demonstração reiniciada. Entre novamente.'); setTimeout(logout, 1200); } catch (err) { toast(err.message, true); } };
    };
    $('#uf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/admin/users', { nome: $('#uf-n').value, email: $('#uf-e').value, senha: $('#uf-s').value, role: $('#uf-r').value, orgId: $('#uf-o').value, placa: $('#uf-p').value }); toast('Usuário criado.'); refresh(); }
      catch (err) { const el = $('#uf-err'); el.textContent = err.message; el.hidden = false; }
    };
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  render();
})();
