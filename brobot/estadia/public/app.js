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
      const tac = S.user.role === 'tac';
      document.body.classList.toggle('motorista', tac);
      if (r.name === 'op' && r.id) await (tac ? viewOpMotorista(r.id) : viewOp(r.id));
      else if (r.name === 'det' && r.id) await viewOp(r.id);
      else if (r.name === 'amelia' && tac) await viewAmelia(r.id);
      else if (tac) await homeMotorista();
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
    if (S.user.role === 'tac') {
      bar.innerHTML = `<a class="brand" href="#/"><span class="mark"></span><b>Estadia BR</b></a>
        <span class="net ${online() ? '' : 'off'}"><i></i>${online() ? 'Conectado' : 'Sem internet'}${pend ? ` · ${pend} para enviar` : ''}</span>
        <button id="logout" class="bar-sair">Sair</button>`;
      $('#logout').onclick = logout;
      return;
    }
    bar.innerHTML = `<a class="brand" href="#/"><span class="mark"></span><b>Estadia BR</b></a>
      <nav class="nav">${nav('#/', 'Operações')}${can('relatorios') ? nav('#/relatorios', 'Relatórios') : ''}${S.user.role === 'admin' ? nav('#/admin', 'Administração') : ''}</nav>
      <span class="net ${online() ? '' : 'off'}"><i></i>${online() ? 'Online' : 'Sem sinal'}${pend ? ` · ${pend} a enviar` : ''}</span>
      <span class="who">${esc(S.user.nome)}<small>${esc(ROLE[S.user.role])} · ${esc(S.user.orgNome || '')}</small></span>
      <button id="logout">Sair</button>`;
    $('#logout').onclick = logout;
  }

  // ---------------- login ----------------
  const DEMO = [
    ['operacao@rodoviasul.demo', 'Carla Mendes', 'Transportadora · Rodovia Sul'],
    ['portaria@serraazul.demo', 'Marina Coelho', 'Destinatário · Serra Azul (portaria)'],
    ['doca@serraazul.demo', 'Rafael Toledo', 'Destinatário · Serra Azul (doca)'],
    ['cd@horizonte.demo', 'Paulo Reis', 'Destinatário · Mercado Horizonte'],
    ['juridico@andradeprado.demo', 'Dra. Helena Andrade', 'Jurídico'],
    ['admin@estadiabr.demo', 'Administração', 'Estadia BR'],
  ];
  function renderLogin() {
    const aba = store.get('estadia.aba') || 'motorista';
    $('#app').innerHTML = `<div class="login">
      <section class="hero"><div class="mark"></div><h1>Estadia BR</h1>
        <p>Registre cada etapa da carga e descarga com um toque. A confirmação chega pelo WhatsApp e o tempo de estadia é calculado sozinho.</p></section>
      <section class="card login-card">
        <div class="tabs" role="tablist"><button role="tab" data-aba="motorista" aria-selected="${aba === 'motorista'}">Sou motorista</button><button role="tab" data-aba="empresa" aria-selected="${aba === 'empresa'}">Sou da empresa</button></div>
        <form id="lm" class="login-m" ${aba === 'motorista' ? '' : 'hidden'}>
          <label for="lm-t">Seu celular</label><input id="lm-t" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 99999-9999" required>
          <label for="lm-p">Seu código de 4 números</label><input id="lm-p" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" placeholder="••••" required>
          <p class="err" id="lm-err" hidden></p>
          <button class="drv-big" type="submit">ENTRAR</button>
          <p class="small muted">Você continua conectado neste celular. Não precisa entrar de novo toda vez.</p>
          <div class="demo-users"><span class="label">Demonstração</span>
            <button type="button" data-tel="11988880001"><b>João Batista Ferreira</b><span class="muted small">(11) 98888-0001 · código 1234 · RTB-4F27</span></button>
            <button type="button" data-tel="11988880002"><b>Ana Lúcia Prado</b><span class="muted small">(11) 98888-0002 · código 1234 · QPE-2H91</span></button></div>
        </form>
        <form id="lf" class="form" style="grid-template-columns:1fr" ${aba === 'empresa' ? '' : 'hidden'}>
          <div class="field"><label class="label" for="lf-e">E-mail</label><input id="lf-e" type="email" autocomplete="username" required></div>
          <div class="field"><label class="label" for="lf-s">Senha</label><input id="lf-s" type="password" autocomplete="current-password" required></div>
          <p class="err" id="lf-err" hidden></p><button class="btn primary" type="submit">Entrar</button>
          <div class="demo-users"><span class="label">Contas de demonstração · senha estadia123</span>
            ${DEMO.map(([e, n, r]) => `<button type="button" data-e="${e}"><b>${esc(n)}</b><span class="muted small">${esc(r)}</span></button>`).join('')}</div>
        </form>
      </section></div>`;
    const entrar = async (body, errSel) => {
      try {
        const r = await api('POST', '/api/login', body);
        S.token = r.token; S.user = r.user; S.config = null;
        store.set('estadia.token', r.token); store.set('estadia.user', JSON.stringify(r.user));
        location.hash = '#/'; render();
      } catch (e) { const el = $(errSel); el.textContent = e.message; el.hidden = false; }
    };
    $$('[data-aba]').forEach((t) => (t.onclick = () => { store.set('estadia.aba', t.dataset.aba); renderLogin(); }));
    $('#lm').onsubmit = (e) => { e.preventDefault(); entrar({ telefone: $('#lm-t').value, pin: $('#lm-p').value }, '#lm-err'); };
    $$('[data-tel]').forEach((b) => (b.onclick = () => entrar({ telefone: b.dataset.tel, pin: '1234' }, '#lm-err')));
    $('#lf').onsubmit = (e) => { e.preventDefault(); entrar({ email: $('#lf-e').value, senha: $('#lf-s').value }, '#lf-err'); };
    $$('[data-e]').forEach((b) => (b.onclick = () => entrar({ email: b.dataset.e, senha: 'estadia123' }, '#lf-err')));
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
  async function viewAmelia(opId) {
    let ops = [];
    try { ops = await api('GET', '/api/operations'); } catch { /* sem internet */ }
    homeTac($('#main'), ops, opId);
  }
  function homeTac(main, ops, voltarOp) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    main.innerHTML = `<a class="drv-back" href="${voltarOp ? `#/op/${voltarOp}` : '#/'}">← Voltar</a><div class="card amelia"><div class="card-h"><div class="row"><span class="ava">A</span><div><h2>Amélia</h2><span class="small muted">Assistente da operação</span></div></div></div>
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
`;

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

  // ================= MODO MOTORISTA (TAC) =================
  // Uma tela, um passo de cada vez, botões grandes e frases do dia a dia.
  const tipoTxt = (op) => (op.tipo === 'CARGA' ? 'carga' : 'descarga');
  const primeiro = (n) => { const p = String(n || '').split(/[\s(]+/).filter(Boolean); return /^(sr|sra|dr|dra|seu|dona|d)\.?$/i.test(p[0] || '') && p[1] ? `${p[0]} ${p[1]}` : p[0] || ''; };
  const vibrar = (p = 200) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* opcional */ } };
  const ICON = {
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M10 8.5l5.5 3.5-5.5 3.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
    doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/></svg>',
    truck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 6h11v10H2zM13 10h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>',
    cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    zap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 1a4 4 0 0 1-2.9-2.9l1-1-1-2z"/></svg>',
  };

  // Texto honesto sobre o aviso: no modo manual nada sai sozinho.
  function avisoTxt(p, antes) {
    const manual = !S.config || S.config.zapModo === 'manual';
    if (p.k === 'SAIDA' && manual) return 'A transportadora acompanha pelo sistema.';
    if (manual) return antes ? `Depois você avisa ${p.avisa} pelo seu WhatsApp.` : '';
    return `Avisamos ${p.avisa} pelo WhatsApp.`;
  }
  function passos(op) {
    const t = tipoTxt(op), T = t.toUpperCase();
    return [
      { k: 'CHEGADA', titulo: 'Cheguei no local', botao: 'CHEGUEI', icon: 'pin', pergunta: `Você chegou em ${op.localNome}?`, foto: 'required', fotoTxt: 'Tire uma foto do caminhão no local', gps: 'capturar', avisa: 'a portaria' },
      { k: 'INICIO', titulo: `Começou a ${t}`, botao: `COMEÇOU A ${T}`, icon: 'play', pergunta: `A ${t} começou agora?`, gps: 'capturar', avisa: 'a portaria' },
      { k: 'TERMINO', titulo: `Terminou a ${t}`, botao: `TERMINOU A ${T}`, icon: 'stop', pergunta: `A ${t} terminou agora?`, gps: 'capturar', avisa: 'a portaria' },
      { k: 'LIBERACAO', titulo: 'Fui liberado para viajar', botao: 'FUI LIBERADO', icon: 'doc', pergunta: 'Você foi liberado para seguir viagem?', foto: 'optional', fotoTxt: 'Foto do documento de liberação, se tiver', avisa: 'a portaria' },
      { k: 'SAIDA', titulo: 'Saí do local', botao: 'SAÍ DO LOCAL', icon: 'truck', pergunta: `Você está saindo de ${op.localNome}?`, foto: 'required', fotoTxt: 'Foto do comprovante ou documento de saída', gps: 'opcional', avisa: 'a transportadora' },
    ];
  }

  async function homeMotorista() {
    const main = $('#main');
    let v;
    try { v = await api('GET', '/api/tac/viagens'); store.set('estadia.cache.viagens.' + S.user.id, JSON.stringify(v)); }
    catch (e) { if (e.code !== 'REDE') throw e; v = JSON.parse(store.get('estadia.cache.viagens.' + S.user.id) || '{"minhas":[],"disponiveis":[]}'); }
    const ativa = v.minhas.find((o) => !['SAIDA_REGISTRADA', 'APURADA', 'AGUARDANDO_PAGAMENTO', 'PAGAMENTO_PARCIAL', 'PAGO', 'VALOR_DIVERGENTE', 'EM_TRATATIVA', 'ENCAMINHADA_JURIDICO', 'ENCERRADA'].includes(o.statusCode));
    if (ativa && !sessionStorage.getItem('estadia.naoAbrirAtiva')) { location.hash = `#/op/${ativa.id}`; return; }
    const viagem = (o) => `<div class="drv-card trip"><span class="drv-tag">${o.tipo === 'CARGA' ? 'CARGA' : 'DESCARGA'}</span>
      <h2>${esc(o.localNome)}</h2><p class="drv-muted">${esc(o.destinoNome)}</p>
      <p>${[o.mercadoria, o.pesoToneladas != null ? `${num(o.pesoToneladas)} toneladas` : null, o.dataPrevista ? `previsto ${diaHora(o.dataPrevista)}` : null].filter(Boolean).map(esc).join(' · ')}</p>
      <button class="drv-big" data-comecar="${esc(o.codigo)}">É ESSA · COMEÇAR</button></div>`;
    main.innerHTML = `<div class="drv">
      <h1 class="drv-hello">Olá, ${esc(primeiro(S.user.nome))}</h1>
      <p class="drv-muted">Caminhão <b class="mono">${esc(placaFmt(S.user.placa))}</b></p>
      ${ativa ? `<a class="drv-card drv-cont" href="#/op/${ativa.id}"><b>Continuar viagem em andamento</b><span>${esc(ativa.localNome)}</span></a>` : ''}
      ${v.disponiveis.length ? `<h2 class="drv-h">${v.disponiveis.length > 1 ? 'Viagens para você' : 'Sua próxima viagem'}</h2>${v.disponiveis.map(viagem).join('')}`
        : !ativa ? `<div class="drv-card"><h2>Nenhuma viagem cadastrada para ${esc(placaFmt(S.user.placa))}</h2><p class="drv-muted">Peça para a transportadora cadastrar, ou informe você mesmo:</p>
          <a class="drv-big alt" href="#/amelia">FALAR COM A AMÉLIA</a><a class="drv-link" href="#/amelia">Digitar o código da viagem</a></div>` : ''}
      ${v.disponiveis.length ? '<a class="drv-link" href="#/amelia">Não é nenhuma dessas? Fale com a Amélia</a>' : ''}
      ${v.minhas.length ? `<h2 class="drv-h">Viagens anteriores</h2>${v.minhas.filter((o) => o !== ativa).slice(0, 6).map((o) => `<a class="drv-row" href="#/op/${o.id}"><span><b>${esc(o.localNome)}</b><br><span class="drv-muted">${esc(o.status)}</span></span><span class="mono">${o.financeiro.devido != null ? brl(o.financeiro.devido) : ''}</span></a>`).join('')}` : ''}
      ${ajudaHtml(null)}${demoToolsHtml(null)}
    </div>`;
    $$('[data-comecar]').forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.textContent = 'ABRINDO…';
      try { const d = await api('POST', '/api/operations/identify', { codigo: b.dataset.comecar, placa: S.user.placa, clientEventId: uuid(), occurredAt: new Date().toISOString() }); sessionStorage.removeItem('estadia.naoAbrirAtiva'); location.hash = `#/op/${d.op.id}`; }
      catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'É ESSA · COMEÇAR'; }
    }));
    bindDemoTools(null);
  }

  function ajudaHtml(d) {
    const tel = d && d.contatos && d.contatos.transportadora && d.contatos.transportadora.telefone;
    const msg = encodeURIComponent(`Olá, aqui é ${S.user.nome} (placa ${placaFmt(S.user.placa)}). Preciso de ajuda${d ? ` na viagem ${d.op.codigo}` : ''}.`);
    return `<a class="drv-help" href="https://wa.me/${tel || ''}?text=${msg}" target="_blank" rel="noopener">${ICON.zap}<span>Precisa de ajuda? <b>Falar com a transportadora</b></span></a>`;
  }

  function demoToolsHtml(d) {
    if (!(S.config && S.config.demo)) return '';
    return `<details class="drv-demo"><summary>Ferramentas da demonstração · WhatsApp: ${esc({ manual: 'pelo celular do motorista', simulado: 'simulador', api: 'API oficial' }[S.config.zapModo] || S.config.zapModo)}</summary>
      <div class="row"><button class="btn small" id="dm-off">${S.simOffline ? 'Reativar sinal' : 'Simular sem sinal'}</button>
      ${d && d.referencia ? '<button class="btn small" id="dm-desl">Simular afastamento de 450 m</button>' : ''}
      ${S.config.zapModo === 'simulado' ? '<a class="btn small" href="/whatsapp.html" target="_blank" rel="noopener">Abrir celular do destino (simulador)</a>' : ''}
      ${d ? `<a class="btn small" href="#/det/${d.op.id}">Ver tela completa</a>` : ''}</div></details>`;
  }
  function bindDemoTools(d, opId) {
    const off = $('#dm-off');
    if (off) off.onclick = () => { S.simOffline = !S.simOffline; store.set('estadia.simOffline', S.simOffline ? '1' : null); if (!S.simOffline) flush(); refresh(); };
    const desl = $('#dm-desl');
    if (desl) desl.onclick = async () => {
      const ref = d.referencia;
      try { const x = await api('POST', `/api/operations/${opId}/posicao`, { lat: ref.lat + 0.004, lng: ref.lng, acc: 10, simulado: true }); toast(`Posição simulada a ${x.distanciaM} m do local.`); refresh(); } catch (e) { toast(e.message, true); }
    };
  }

  function zapStatus(m, confirmado) {
    const nome = primeiro(m.para.nome);
    if (confirmado) return ['ok', `${nome} confirmou${confirmado.occurredAt ? ' às ' + hhmm(confirmado.occurredAt) : ''}`];
    const r = m.ultimaResposta;
    if (r && r.interpretacao === 'SIM') return ['ok', m.finalidade === 'INFORMAR' ? `${nome} recebeu (${hhmm(r.em)})` : `${nome} confirmou às ${hhmm(r.em)}`];
    if (r && r.interpretacao === 'NAO') return ['crit', `${nome} respondeu NÃO: “${r.texto}”`];
    if (r) return ['warn', `${nome} respondeu: “${r.texto}”`];
    return {
      aguardando_envio: ['warn', 'Falta avisar pelo WhatsApp'],
      enviada: m.modo === 'simulado' ? ['', `Enviado ao simulador de ${nome} (demonstração)`] : ['', `Enviado para ${nome} ✓`],
      enviada_manual: m.linkAbertoEm ? ['ok', `${nome} recebeu e abriu o link · esperando confirmar`]
        : ['warn', `Abrimos o seu WhatsApp para enviar a ${nome}. Se a mensagem não foi, toque em enviar de novo.`],
      entregue: ['', `Chegou no celular de ${nome} ✓✓ · esperando resposta`], lida: ['sys', `${nome} leu ✓✓ · esperando resposta`], falha: ['crit', `Não foi enviado para ${nome}`],
    }[m.status] || ['', m.status];
  }

  // Bloco de envio pelo WhatsApp do motorista: número já preenchido, trocar na hora ou escolher contato.
  const MSG_CACHE = new Map();
  function envioBloco(m) {
    MSG_CACHE.set(m.id, m);
    const quem = m.para.papel === 'destino' ? 'a portaria' : 'a transportadora';
    const temNum = !!m.para.telefone;
    const semNumUrl = `https://wa.me/?text=${encodeURIComponent(m.texto)}`;
    return `<div class="envio" data-envio="${m.id}">
      ${temNum ? `<p class="envio-para">Enviar para <b>${esc(m.para.nome)}</b><br><span class="mono">${esc(m.telefoneFmt)}</span></p>
        <a class="drv-mid zapbtn" href="${esc(m.whatsappUrl)}" target="_blank" rel="noopener" data-manual="${m.id}">${ICON.zap} ENVIAR NO WHATSAPP</a>`
        : `<p class="envio-para">Não temos o número de ${quem}. Escolha o contato no seu WhatsApp ou digite o número abaixo.</p>
        <a class="drv-mid zapbtn" href="${esc(semNumUrl)}" target="_blank" rel="noopener" data-manual="${m.id}">${ICON.zap} ESCOLHER CONTATO NO WHATSAPP</a>`}
      <button type="button" class="drv-link" data-trocar="${m.id}">${temNum ? 'Mandar para outra pessoa / trocar número' : 'Digitar o número'}</button>
      <form class="drv-tel" data-dest="${m.id}" hidden>
        <label for="dn-${m.id}">Número de quem vai receber</label>
        <input id="dn-${m.id}" type="tel" inputmode="tel" autocomplete="off" placeholder="(11) 99999-9999" required>
        <input type="text" placeholder="Nome (ex.: Portaria, Sr. Carlos)" aria-label="Nome de quem vai receber">
        <label class="chk"><input type="checkbox" checked> Usar este número nas próximas mensagens</label>
        <button class="drv-mid" type="submit">${ICON.zap} ENVIAR PARA ESTE NÚMERO</button>
        ${temNum ? `<a class="drv-link" href="${esc(semNumUrl)}" target="_blank" rel="noopener" data-manual="${m.id}">Ou escolher o contato no WhatsApp</a>` : ''}
      </form></div>`;
  }
  function bindEnvio(root, opId, depois) {
    $$('[data-trocar]', root).forEach((b) => (b.onclick = () => { const f = $(`form[data-dest="${b.dataset.trocar}"]`, root); f.hidden = false; b.hidden = true; f.querySelector('input').focus(); }));
    $$('a[data-manual]', root).forEach((a) => (a.onclick = () => { api('POST', `/api/operations/${opId}/whatsapp/${a.dataset.manual}/enviada`).catch(() => {}); if (depois) setTimeout(depois, 600); }));
    // Enviar para outro número: abre o WhatsApp do motorista NO MESMO TOQUE (senão o celular bloqueia) e depois registra.
    $$('form[data-dest]', root).forEach((f) => (f.onsubmit = (e) => {
      e.preventDefault();
      const [tel, nome, chk] = f.querySelectorAll('input');
      let num = tel.value.replace(/\D/g, '');
      if (num && num.length <= 11) num = '55' + num.replace(/^0+/, '');
      if (num.length < 12 || num.length > 13) { toast('Número incompleto. Digite com DDD, por exemplo (11) 99999-9999.', true); tel.focus(); return; }
      const m = MSG_CACHE.get(f.dataset.dest);
      const url = `https://wa.me/${num}?text=${encodeURIComponent((m && (m.textoManual || m.texto)) || '')}`;
      const w = window.open(url, '_blank');
      if (!w) location.href = url;
      const btn = f.querySelector('button'); btn.disabled = true;
      api('POST', `/api/operations/${opId}/whatsapp/destinatario`, { mensagemId: f.dataset.dest, telefone: num, nome: nome.value, salvar: chk.checked, viaMotorista: true })
        .then(() => { toast('Abrimos o seu WhatsApp. Confira e toque em enviar lá.'); if (depois) setTimeout(depois, 600); else refresh(); })
        .catch((err) => { toast(err.message, true); btn.disabled = false; });
    }));
  }

  async function viewOpMotorista(id) {
    let d;
    try { d = await api('GET', `/api/operations/${id}`); store.set('estadia.cache.op.' + id, JSON.stringify(d)); }
    catch (e) { if (e.code !== 'REDE') throw e; d = JSON.parse(store.get('estadia.cache.op.' + id) || 'null'); if (!d) throw e; }
    const main = $('#main');
    const op = d.op;
    const pend = fila.filter((x) => x.opId === id);
    const reg = {};
    for (const e of d.timeline) if (e.kind === 'registro') reg[e.type] = e;
    for (const p of pend) if (!reg[p.body.type]) reg[p.body.type] = { type: p.body.type, occurredAt: p.body.occurredAt, pendente: true };
    const conf = (ev) => ev && !ev.pendente && d.timeline.find((c) => c.kind === 'confirmacao' && c.refEventId === ev.id);
    const div = (ev) => ev && !ev.pendente && d.timeline.find((c) => c.kind === 'divergencia' && c.refEventId === ev.id);
    const ps = passos(op);
    const atual = ps.find((p) => !reg[p.k]);
    const idx = atual ? ps.indexOf(atual) : ps.length;
    const ap = d.apuracao;
    const encerradoTac = !!reg.SAIDA;
    const confLibPortal = d.acoes.find((a) => a.type === 'LIBERACAO_CONFIRMADA');

    // Avisos de confirmações recebidas desde a última visita (vibra o celular).
    const chave = 'estadia.conf.' + id;
    const nConf = d.timeline.filter((e) => e.kind === 'confirmacao').length;
    const antes = Number(store.get(chave) || nConf);
    if (nConf > antes) { const ult = d.timeline.filter((e) => e.kind === 'confirmacao').pop(); toast(`${primeiro(ult.actor.name)} confirmou: ${ult.label}`); vibrar([120, 60, 120]); }
    store.set(chave, String(nConf));

    // Tempo de estadia
    let tempo = '';
    if (reg.CHEGADA && !ap.pendente) {
      const t = ap.emCurso ? Math.max(0, Math.round((Date.now() - Date.parse(ap.marcoInicial)) / 60000)) : ap.tempoMin;
      const passou = t > ap.regra.limiteMin;
      tempo = `<div class="drv-timer ${passou ? 'over' : ''}"><span class="drv-label">${ap.emCurso ? 'Tempo de espera' : 'Tempo total de estadia'}</span><b id="drv-t">${dur(t)}</b>
        <span>${passou ? 'Passou de 5 horas: o tempo todo conta para a estadia.' : ap.emCurso ? `Limite de 5 horas às ${hhmm(ap.limiteEm)}` : 'Dentro das 5 horas'}</span></div>`;
    } else if (reg.CHEGADA) {
      tempo = `<div class="drv-timer wait"><span class="drv-label">Tempo de espera</span><b>—</b><span>O tempo começa quando a portaria confirmar sua chegada.</span></div>`;
    }

    // Mensagens ligadas a cada passo
    const msgsDe = (ev) => (ev && !ev.pendente ? d.mensagens.filter((m) => m.refEventId === ev.id && !m.reenviada) : []);
    const linhaZap = (m, ev) => {
      MSG_CACHE.set(m.id, m);
      const c = m.finalidade === 'CONFIRMAR' ? conf(ev) : null;
      const [tom, txt] = zapStatus(m, c);
      const aberto = m.finalidade === 'CONFIRMAR' && !c && !(m.ultimaResposta && m.ultimaResposta.interpretacao !== 'OUTRO');
      const semNumero = m.status === 'falha' && /sem número/i.test(m.erro || '');
      const minutos = Math.round((Date.now() - Date.parse(m.enviadaEm)) / 60000);
      return `<div class="zap ${tom}"><span class="zap-ico">${ICON.zap}</span><div class="zap-b"><span>${esc(txt)}</span>
        ${aberto && semNumero ? `<form class="drv-tel" data-tel="${m.para.papel}"><label for="tel-${m.id}">Qual o WhatsApp ${m.para.papel === 'destino' ? 'da portaria' : 'da transportadora'}?</label>
          <input id="tel-${m.id}" type="tel" inputmode="tel" placeholder="(11) 99999-9999" required><input type="text" placeholder="Nome (opcional)" aria-label="Nome do contato"><button class="drv-mid" type="submit">ENVIAR AVISO</button></form>` : ''}
        ${aberto && m.status === 'aguardando_envio' ? envioBloco(m) : ''}
        ${aberto && m.status !== 'aguardando_envio' && !semNumero ? `<button type="button" class="drv-link left" data-trocar="${m.id}">Mandar para outra pessoa</button><form class="drv-tel" data-dest="${m.id}" hidden><label for="dn-${m.id}">Número de quem vai receber</label><input id="dn-${m.id}" type="tel" inputmode="tel" placeholder="(11) 99999-9999" required><input type="text" placeholder="Nome (opcional)" aria-label="Nome"><label class="chk"><input type="checkbox" checked> Usar nas próximas mensagens</label><button class="drv-mid" type="submit">${ICON.zap} ENVIAR PARA ESTE NÚMERO</button></form>` : ''}
        ${aberto && m.status !== 'aguardando_envio' && !semNumero && (minutos >= 5 || m.status === 'falha' || m.modo === 'manual' || S.config.zapModo === 'manual') ? `${minutos >= 5 && m.status !== 'aguardando_envio' ? `<b>Ninguém confirmou ainda (${dur(minutos)}).</b>` : ''}<div class="zap-acts">
          ${m.modo === 'manual' || S.config.zapModo === 'manual' ? `<a class="drv-mid zapbtn" href="${esc(m.whatsappUrl || '#')}" target="_blank" rel="noopener" data-manual="${m.id}">${ICON.zap} ENVIAR DE NOVO NO WHATSAPP</a>` : ''}
          ${m.status !== 'aguardando_envio' && (minutos >= 5 || m.status === 'falha') ? `<button class="btn" data-reenviar="${m.id}">Mandar de novo</button>` : ''}
          ${m.status !== 'aguardando_envio' && S.config.zapModo !== 'manual' && m.whatsappUrl ? `<a class="btn" href="${esc(m.whatsappUrl)}" target="_blank" rel="noopener">Mandar pelo meu WhatsApp</a>` : ''}
          <button class="btn" data-print="${m.id}">Responderam no meu WhatsApp</button></div>` : ''}</div></div>`;
    };

    // Lista de passos (checklist)
    const lista = ps.map((p, i) => {
      const ev = reg[p.k];
      const c = conf(ev), dv = div(ev);
      const msgs = msgsDe(ev).filter((m) => m.finalidade === 'CONFIRMAR');
      return `<li class="${ev ? 'done' : i === idx ? 'now' : ''}"><span class="drv-dot">${ev ? ICON.check : i + 1}</span><div><b>${esc(p.titulo)}</b>
        ${ev ? `<span class="drv-muted">${hhmm(ev.occurredAt)}${ev.pendente ? ' · guardado no celular, envia quando tiver sinal' : ''}</span>` : ''}
        ${c ? `<span class="drv-ok">${ICON.check} Confirmado por ${esc(primeiro(c.actor.name))} às ${hhmm(c.occurredAt)}</span>` : dv ? `<span class="drv-bad">Não confirmado: ${esc(dv.payload.note)}</span>` : ''}
        ${!c && !dv ? msgs.map((m) => linhaZap(m, ev)).join('') : ''}</div></li>`;
    }).join('');

    // Cartão principal
    let agora = '';
    if (op.tacUserId !== S.user.id) {
      agora = '';
    } else if (confLibPortal) {
      const lib = reg.LIBERACAO;
      agora = `<div class="drv-card now"><span class="drv-step">A portaria informou</span><h2>Você foi liberado às ${hhmm(lib.occurredAt)}?</h2>
        <button class="drv-big ok" data-conflib="1">SIM, FUI LIBERADO</button><button class="drv-big alt" data-naolib="1">NÃO</button></div>`;
    } else if (!d.timeline.some((e) => e.type === 'DADOS_INFORMADOS') && !reg.CHEGADA && !sessionStorage.getItem('estadia.pularDados.' + id)) {
      const linha = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
      agora = `<div class="drv-card now"><span class="drv-step">Antes de começar</span><h2>Confira sua carga</h2>
        <dl class="drv-dados">${linha('Placa', placaFmt(op.placa))}${linha('Carga', op.mercadoria)}${linha('Peso', op.pesoToneladas != null ? `${num(op.pesoToneladas)} toneladas` : null)}${linha('Nota fiscal', op.nfe)}${linha('Destino', op.localNome)}</dl>
        <button class="drv-big ok" id="dados-ok">ESTÁ CERTO</button><a class="drv-big alt" href="#/amelia/${op.id}">TEM ERRO · FALAR COM A AMÉLIA</a>
        <button class="drv-link" id="dados-pular">Conferir depois</button></div>`;
    } else if (atual) {
      agora = `<div class="drv-card now"><span class="drv-step">Passo ${idx + 1} de ${ps.length}</span>
        <button class="drv-giant" data-passo="${atual.k}">${ICON[atual.icon]}<span>${esc(atual.botao)}</span></button>
        <p class="drv-muted center">${atual.foto === 'required' ? `${ICON.cam} Vai abrir a câmera. ` : ''}${avisoTxt(atual, true)}</p></div>`;
    } else {
      const f = d.financeiro;
      agora = `<div class="drv-card done-card"><span class="drv-ok-big">${ICON.check}</span><h2>Viagem concluída</h2>
        ${!ap.pendente ? `<div class="drv-sum"><div><span class="drv-label">Tempo de estadia</span><b>${dur(ap.tempoMin)}</b></div><div><span class="drv-label">Valor da estadia</span><b>${brl(f.devido != null ? f.devido : ap.valorDevido)}</b></div>
          ${f.devido ? `<div><span class="drv-label">Você recebeu</span><b>${brl(f.pago)}</b></div><div><span class="drv-label">Falta receber</span><b>${brl(f.saldo)}</b></div>` : ''}</div>` : ''}
        ${f.devido > 0 && f.saldo > 0 ? '<button class="drv-big" id="recebi">RECEBI UM VALOR</button>' : ''}
        <a class="drv-big alt" href="#/" id="inicio">VOLTAR AO INÍCIO</a></div>`;
    }

    const desl = d.alertas.find((a) => a.codigo === 'DESLOCAMENTO_FORA_DO_LIMITE');
    main.innerHTML = `<div class="drv">
      <a href="#/" class="drv-back" id="voltar">← Início</a>
      ${!online() ? '<div class="drv-off">Sem internet. Pode continuar: guardamos tudo no celular e enviamos quando o sinal voltar.</div>' : ''}
      <div class="drv-head"><span class="drv-tag">${op.tipo === 'CARGA' ? 'CARGA' : 'DESCARGA'}</span><h1>${esc(op.localNome)}</h1><span class="drv-muted">${esc(op.destinoNome)} · ${esc(op.codigo)}</span></div>
      ${desl && !encerradoTac ? `<div class="drv-warn"><b>Atenção:</b> seu caminhão foi visto longe do local. Fique a menos de ${d.limiteDeslocamentoM} metros.</div>` : ''}
      ${encerradoTac ? '' : tempo}
      ${agora}
      <h2 class="drv-h">Sua viagem</h2><ol class="drv-steps">${lista}</ol>
      ${encerradoTac ? msgsDe(reg.SAIDA).map((m) => linhaZap(m, reg.SAIDA)).join('') : ''}
      ${ajudaHtml(d)}
      <a class="drv-link" href="#/det/${op.id}">Ver todos os detalhes e documentos</a>
      ${demoToolsHtml(d)}
    </div>`;

    // Ações
    $('#voltar').onclick = () => sessionStorage.setItem('estadia.naoAbrirAtiva', '1');
    const inicio = $('#inicio'); if (inicio) inicio.onclick = () => sessionStorage.setItem('estadia.naoAbrirAtiva', '1');
    const passoBtn = $('[data-passo]');
    if (passoBtn) passoBtn.onclick = () => executarPasso(d, ps.find((p) => p.k === passoBtn.dataset.passo), reg);
    const ok = $('#dados-ok');
    if (ok) ok.onclick = async () => { ok.disabled = true; try { await api('POST', `/api/operations/${id}/dados-conferidos`); refresh(); } catch (e) { toast(e.message, true); ok.disabled = false; } };
    const pular = $('#dados-pular');
    if (pular) pular.onclick = () => { sessionStorage.setItem('estadia.pularDados.' + id, '1'); refresh(); };
    const cl = $('[data-conflib]');
    if (cl) cl.onclick = async () => { cl.disabled = true; try { await sendEvent(id, { type: 'LIBERACAO_CONFIRMADA', occurredAt: new Date().toISOString(), refEventId: confLibPortal.refEventId }); refresh(); } catch (e) { toast(e.message, true); cl.disabled = false; } };
    const nl = $('[data-naolib]');
    if (nl) nl.onclick = () => divergenceSheet(id, d.acoes.find((a) => a.kind === 'divergencia' && a.refEventId === confLibPortal.refEventId) || { refEventId: confLibPortal.refEventId }, reg.LIBERACAO);
    $$('[data-reenviar]').forEach((b) => (b.onclick = async () => { b.disabled = true; try { await api('POST', `/api/operations/${id}/whatsapp/reenviar`, { mensagemId: b.dataset.reenviar }); toast('Mensagem enviada de novo.'); refresh(); } catch (e) { toast(e.message, true); b.disabled = false; } }));
    bindEnvio(main, id, () => refresh());
    $$('[data-print]').forEach((b) => (b.onclick = () => printSheet(id, d.mensagens.find((m) => m.id === b.dataset.print))));
    $$('form[data-tel]').forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const [tel, nome] = f.querySelectorAll('input');
      try { await api('POST', `/api/operations/${id}/contato`, { papel: f.dataset.tel, telefone: tel.value, nome: nome.value }); toast('Número salvo. Aviso enviado.'); refresh(); } catch (err) { toast(err.message, true); }
    }));
    const rec = $('#recebi');
    if (rec) rec.onclick = () => recebiSheet(id, d);
    bindDemoTools(d, id);

    // Tempo ao vivo e monitoramento de deslocamento (silencioso)
    if (reg.CHEGADA && !ap.pendente && ap.emCurso) liveT = setInterval(() => { const el = $('#drv-t'); if (el) el.textContent = dur((Date.now() - Date.parse(ap.marcoInicial)) / 60000); }, 30000);
    if (reg.CHEGADA && !reg.SAIDA && op.tacUserId === S.user.id) {
      const enviar = async () => { if (!online()) return; const g = await getGps(); if (g.erro) return; try { const x = await api('POST', `/api/operations/${id}/posicao`, g); if (x.registrada) refresh(); } catch { /* silencioso */ } };
      enviar(); monitorT = setInterval(enviar, 120000);
    }
  }

  // Executa um passo: câmera direto quando a foto é obrigatória; senão, uma pergunta simples.
  function executarPasso(d, p, reg) {
    const occurredAt = new Date().toISOString();
    const gpsP = p.gps ? getGps() : Promise.resolve(null);
    const enviar = async (photo, bg) => {
      const go = $('#ps-go', bg); if (go) { go.disabled = true; go.textContent = 'ENVIANDO…'; }
      let gps = await gpsP;
      if (gps && gps.erro && p.gps === 'opcional') gps = undefined;
      try {
        const r = await sendEvent(d.op.id, { type: p.k, occurredAt, gps: gps || undefined, photo: photo || undefined });
        vibrar(80);
        const pendente = !r.offline && r.detalhe && r.detalhe.mensagens.find((m) => m.refEventId === r.evento.id && m.status === 'aguardando_envio');
        if (pendente) {
          $('.sheet', bg).innerHTML = `<div class="drv-done">${ICON.check}<h2>Registrado às ${hhmm(occurredAt)}</h2></div>
            <div class="drv-sheet"><h2>Agora avise ${esc(p.avisa)}</h2><p class="drv-muted">A mensagem já está pronta. Ela leva um link para a pessoa confirmar com um toque.</p>
            ${envioBloco(pendente)}<button class="drv-link" data-x>Avisar depois</button></div>`;
          bindEnvio(bg, d.op.id, () => { bg.remove(); refresh(); });
          bg.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) refresh(); });
          return;
        }
        $('.sheet', bg).innerHTML = `<div class="drv-done">${ICON.check}<h2>Pronto!</h2><p>${esc(p.titulo)} às <b>${hhmm(occurredAt)}</b>.</p>
          <p class="drv-muted">${r.offline ? 'Sem internet: guardamos no celular e enviamos sozinho quando o sinal voltar.' : avisoTxt(p)}</p></div>`;
        setTimeout(() => { bg.remove(); refresh(); }, 2200);
      } catch (e) { if (go) { go.disabled = false; go.textContent = 'ENVIAR'; } toast(e.message, true); }
    };
    const confirmar = (photo) => {
      const bg = sheet(`<div class="drv-sheet"><h2>${esc(p.pergunta)}</h2><p class="drv-muted">Horário: <b>${hhmm(occurredAt)}</b></p>
        ${photo ? `<img class="drv-prev" src="${photo}" alt="Foto tirada">` : ''}
        <button class="drv-big ok" id="ps-go">SIM, ENVIAR</button>
        ${photo ? '<button class="drv-big alt" id="ps-again">TIRAR OUTRA FOTO</button>' : ''}
        ${p.foto === 'optional' && !photo ? '<button class="drv-big alt" id="ps-foto">TIRAR FOTO ANTES</button>' : ''}
        <button class="drv-link" data-x>Voltar</button></div>`);
      $('#ps-go', bg).onclick = () => enviar(photo, bg);
      const again = $('#ps-again', bg); if (again) again.onclick = () => { bg.remove(); abrirCamera(); };
      const foto = $('#ps-foto', bg); if (foto) foto.onclick = () => { bg.remove(); abrirCamera(); };
    };
    const abrirCamera = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment'; inp.hidden = true;
      document.body.appendChild(inp);
      inp.onchange = async () => { const f = inp.files[0]; inp.remove(); if (!f) return; try { confirmar(await compressImage(f)); } catch (e) { toast(e.message, true); } };
      inp.click();
    };
    if (p.foto === 'required') abrirCamera(); // abre a câmera no mesmo toque
    else confirmar(null);
  }

  function printSheet(opId, m) {
    let photo = null;
    const bg = sheet(`<div class="drv-sheet"><h2>${esc(primeiro(m.para.nome))} respondeu no seu WhatsApp?</h2>
      <p class="drv-muted">Tire um print da conversa e envie aqui. O print fica guardado como prova.</p>
      <label class="photo-drop" for="pr-file"><span id="pr-prev"><b>ESCOLHER O PRINT</b></span></label><input type="file" id="pr-file" accept="image/*" hidden>
      <button class="drv-big ok" id="pr-sim" disabled>RESPONDEU SIM</button><button class="drv-big alt" id="pr-nao" disabled>RESPONDEU NÃO</button>
      <button class="drv-link" data-x>Voltar</button></div>`);
    $('#pr-file', bg).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      photo = await compressImage(f, 1800);
      $('#pr-prev', bg).innerHTML = `<img src="${photo}" alt="Print da conversa">`;
      $('#pr-sim', bg).disabled = false; $('#pr-nao', bg).disabled = false;
    };
    const go = async (resposta) => {
      try { await api('POST', `/api/operations/${opId}/whatsapp/print`, { mensagemId: m.id, resposta, photo }); bg.remove(); toast('Resposta registrada com o print.'); refresh(); } catch (e) { toast(e.message, true); }
    };
    $('#pr-sim', bg).onclick = () => go('SIM');
    $('#pr-nao', bg).onclick = () => go('NAO');
  }

  function recebiSheet(opId, d) {
    const bg = sheet(`<div class="drv-sheet"><h2>Quanto você recebeu?</h2>
      <div class="drv-money"><span>R$</span><input id="rc-v" inputmode="decimal" placeholder="0,00" aria-label="Valor recebido"></div>
      <p class="drv-muted">Falta receber ${brl(d.financeiro.saldo)}.</p>
      <button class="drv-big ok" id="rc-go">CONFIRMAR VALOR</button><button class="drv-link" data-x>Voltar</button></div>`);
    $('#rc-v', bg).focus();
    $('#rc-go', bg).onclick = async () => {
      try { await sendEvent(opId, { type: 'PAGAMENTO_REGISTRADO', occurredAt: new Date().toISOString(), valor: $('#rc-v', bg).value, origem: 'acordo_direto', note: 'Informado pelo motorista' }); bg.remove(); refresh(); } catch (e) { toast(e.message, true); }
    };
  }

  function mensagensHtml(d) {
    if (!d.mensagens || !d.mensagens.length) return '';
    const evs = Object.fromEntries(d.timeline.map((e) => [e.id, e]));
    return `<div class="card wa"><div class="card-h"><h3>Mensagens de WhatsApp</h3><span class="pill">${esc({ simulado: 'modo demonstração', api: 'API oficial', manual: 'envio manual' }[d.zapModo] || d.zapModo)}</span></div>
      ${d.mensagens.slice().reverse().map((m) => {
        const ref = evs[m.refEventId];
        const c = m.finalidade === 'CONFIRMAR' && ref && d.timeline.find((x) => x.kind === 'confirmacao' && x.refEventId === ref.id);
        const [tom, txt] = zapStatus(m, c);
        return `<div class="linkbox"><div class="row between"><b>${m.finalidade === 'CONFIRMAR' ? 'Pedido de confirmação' : 'Aviso'} · ${esc(ref ? ref.label : '')}</b><span class="mono small">${diaHora(m.enviadaEm)}</span></div>
          <span class="small">Para ${esc(m.para.nome)} · ${esc(m.telefoneFmt || 'sem número')} ${m.reenvioDe ? '· reenvio' : ''}</span>
          <span class="pill ${tom}">${esc(txt)}</span>
          ${m.respostas.map((r) => `<span class="small">Resposta ${hhmm(r.em)}: “${esc(r.texto)}” ${r.origem === 'print_whatsapp' ? '(print enviado pelo motorista)' : ''}</span>`).join('')}
          ${m.finalidade === 'CONFIRMAR' && !c && !m.reenviada ? `<div class="row"><button class="btn small" data-reenviar="${m.id}">Reenviar</button>${m.whatsappUrl ? `<a class="btn small" href="${esc(m.whatsappUrl)}" target="_blank" rel="noopener">Abrir no WhatsApp</a>` : ''}</div>` : ''}</div>`;
      }).join('')}
      <p class="small muted">A resposta SIM/OK da pessoa confirma o evento ou o recebimento. NÃO vira divergência para análise.</p></div>`;
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
        ${mensagensHtml(d)}
        ${monitorando ? `<div class="card" id="monitor"><div class="card-h"><h3>Limite de Deslocamento do Local</h3><span class="pill">${d.limiteDeslocamentoM} m</span></div>
          <p class="small" id="mon-txt">Monitorando sua posição a cada 2 minutos enquanto esta tela estiver aberta.</p>
          <div class="row"><button class="btn small" id="mon-now">Enviar posição agora</button>${d.demo ? '<button class="btn small" id="mon-sim">Simular afastamento de 450 m (demo)</button>' : ''}</div></div>` : ''}
        ${role === 'tac' && !registros.length && !confs.length && !ms.SAIDA && o.tacUserId ? `<div class="card"><p class="muted">Aguardando o destino. Você será avisado aqui quando houver novidade.</p></div>` : ''}
        ${d.alertas.length ? `<div class="card"><h3>Ocorrências e alertas</h3>${d.alertas.map((a) => `<div class="alert ${a.nivel}"><b>${a.nivel === 'atencao' ? '!' : 'i'}</b><span>${a.codigo === 'DESLOCAMENTO_FORA_DO_LIMITE' ? '<span class="mono small">DESLOCAMENTO_FORA_DO_LIMITE</span> ' : ''}${esc(a.texto)}</span></div>`).join('')}
          <p class="small muted">Ocorrências são para análise humana. Não indicam fraude ou responsabilidade por si só.</p></div>` : ''}
        ${treatBoxes(d, evById)}
        <div class="card"><div class="card-h"><h2>Linha do tempo</h2><span class="pill">${d.timeline.filter((e) => !e.type.startsWith('WHATSAPP_')).length} eventos</span></div>${timelineHtml(d, myPending)}</div>
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
    $$('[data-reenviar]', main).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await api('POST', `/api/operations/${id}/whatsapp/reenviar`, { mensagemId: b.dataset.reenviar }); toast('Mensagem reenviada.'); refresh(); } catch (e) { toast(e.message, true); b.disabled = false; } }));
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
      if (e.type.startsWith('WHATSAPP_')) continue; // mensagens ficam no quadro "Mensagens de WhatsApp"
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
        ${(c.mensagensWhatsApp || []).length ? `<section><span class="label">Mensagens de WhatsApp</span><div class="tablewrap"><table><thead><tr><th>Enviada</th><th>Para</th><th>Assunto</th><th>Situação</th><th>Resposta</th></tr></thead><tbody>
          ${c.mensagensWhatsApp.map((m) => `<tr><td class="mono">${diaHora(m.enviadaEm)}</td><td>${esc(m.para.nome)}<br><span class="small muted">${esc(m.para.papel)}</span></td><td>${m.finalidade === 'CONFIRMAR' ? 'Pedido de confirmação' : 'Aviso'}: ${esc(m.assunto)}</td>
            <td class="small">${esc(m.status)}${m.erro ? ' · ' + esc(m.erro) : ''}</td><td class="small">${m.respostas.map((r) => `${hhmm(r.em)} “${esc(r.texto)}”${r.origem === 'print_whatsapp' ? ' (print)' : ''}`).join('<br>') || '—'}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
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
