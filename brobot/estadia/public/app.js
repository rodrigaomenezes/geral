/* Estadia · Brobot — aplicativo web (TAC, destino, advocacia e administração). */
(function () {
  'use strict';

  // ---------------- utilidades ----------------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'America/Sao_Paulo';
  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—');
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—');
  const diaHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—');
  const dur = (min) => { min = Math.max(0, Math.round(min || 0)); return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`; };
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const placaFmt = (p) => (p ? `${p.slice(0, 3)}-${p.slice(3)}` : '');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));
  const ROLE = { tac: 'TAC · caminhoneiro', destino: 'Destino', advocacia: 'Advocacia', admin: 'Administrador' };
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
    toastT = setTimeout(() => (el.className = 'toast'), 3200);
  }

  // ---------------- sessão e API ----------------
  const S = { token: store.get('estadia.token'), user: JSON.parse(store.get('estadia.user') || 'null'), simOffline: store.get('estadia.simOffline') === '1' };

  class ApiError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'Sem conexão com o servidor.', 'REDE');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/login') { logout(); throw new ApiError(401, data.mensagem || 'Sessão expirada.'); }
    if (!res.ok) throw new ApiError(res.status, data.mensagem || 'Erro inesperado.', data.erro);
    return data;
  }

  function logout() {
    S.token = null; S.user = null;
    store.set('estadia.token', null); store.set('estadia.user', null);
    if (sse) { sse.close(); sse = null; }
    location.hash = '#/';
    render();
  }

  const online = () => navigator.onLine && !S.simOffline;

  // ---------------- fila offline (IndexedDB) ----------------
  const Q = {
    db: null,
    mem: [],
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
    async tx(mode, fn) {
      const db = await this.open();
      if (!db) return fn(null);
      return new Promise((resolve, reject) => {
        const t = db.transaction('fila', mode);
        const st = t.objectStore('fila');
        let out;
        Promise.resolve(fn(st)).then((v) => (out = v));
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
      });
    },
    async all() {
      const db = await this.open();
      if (!db) return this.mem.slice();
      return new Promise((resolve) => {
        const r = db.transaction('fila').objectStore('fila').getAll();
        r.onsuccess = () => resolve((r.result || []).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm)));
        r.onerror = () => resolve([]);
      });
    },
    async put(item) { const db = await this.open(); if (!db) { this.mem = this.mem.filter((x) => x.clientEventId !== item.clientEventId).concat(item); return; } await this.tx('readwrite', (st) => st.put(item)); },
    async del(id) { const db = await this.open(); if (!db) { this.mem = this.mem.filter((x) => x.clientEventId !== id); return; } await this.tx('readwrite', (st) => st.delete(id)); },
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
        try {
          await api('POST', `/api/operations/${item.opId}/events`, item.body);
          await Q.del(item.clientEventId);
          enviados++;
        } catch (e) {
          if (e.code === 'REDE') break;
          item.erro = e.message; // validação recusada: mantém o registro local para decisão do usuário
          await Q.put(item);
        }
      }
    } finally {
      flushing = false;
      await refreshFila();
      if (enviados) { toast(`${enviados} registro(s) sincronizado(s). Horário original preservado.`); refresh(); }
      else renderBar();
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
    sse.onmessage = () => { clearTimeout(refreshT); refreshT = setTimeout(softRefresh, 250); };
    sse.onerror = () => { sse.close(); sse = null; setTimeout(connectSSE, 5000); };
  }

  // ---------------- localização e foto ----------------
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

  const photoUrl = (photo) => (photo ? `/api/photos/${photo.file}?token=${encodeURIComponent(S.token)}` : '');
  const mapLink = (g) => (g && g.lat != null ? `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=17/${g.lat}/${g.lng}` : null);
  const gpsTxt = (g) => (!g ? 'sem localização' : g.erro ? g.erro : `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} ±${g.acc ?? '?'} m`);

  // ---------------- envio de eventos ----------------
  async function sendEvent(opId, body) {
    body.clientEventId = body.clientEventId || uuid();
    const item = { clientEventId: body.clientEventId, opId, body, userId: S.user.id, criadoEm: new Date().toISOString() };
    if (!online()) {
      await Q.put(item); await refreshFila();
      toast('Sem sinal: registro salvo no aparelho. Será enviado quando a conexão voltar.');
      return { offline: true };
    }
    try {
      const r = await api('POST', `/api/operations/${opId}/events`, body);
      toast(r.duplicado ? 'Registro já havia sido recebido.' : `Registrado às ${hhmm(r.evento.occurredAt)}.`);
      return r;
    } catch (e) {
      if (e.code === 'REDE') {
        await Q.put(item); await refreshFila();
        toast('Conexão falhou: registro salvo no aparelho para envio posterior.');
        return { offline: true };
      }
      throw e;
    }
  }

  // Folha de captura: horário do toque + GPS + foto (quando aplicável).
  function captureSheet(opId, action) {
    const occurredAt = new Date().toISOString();
    const st = { gps: null, photo: null, sending: false };
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh-t">
      <div class="card-h"><h2 id="sh-t">${esc(action.label)}</h2><button class="btn small" data-x>Cancelar</button></div>
      ${action.aviso ? `<div class="alert atencao"><b>!</b><span>${esc(action.aviso)}</span></div>` : ''}
      <div class="capt"><div>Horário<b>${hhmm(occurredAt)}</b></div><div>GPS<b id="sh-gps">${action.gps ? 'obtendo…' : 'não exigido'}</b></div><div>Foto<b>${action.photo === 'required' ? 'obrigatória' : action.photo ? 'opcional' : '—'}</b></div></div>
      ${action.photo ? `<label class="photo-drop" for="sh-file"><span id="sh-prev"><b>Tirar foto</b><br><span class="muted small">Toque para abrir a câmera</span></span></label>
        <input type="file" id="sh-file" accept="image/*" capture="environment" hidden>` : ''}
      <div class="field"><label class="label" for="sh-note">Observação (opcional)</label><textarea id="sh-note" maxlength="500"></textarea></div>
      <p class="err" id="sh-err" hidden></p>
      <button class="big" id="sh-go">Confirmar registro<small>O horário registrado é ${hhmm(occurredAt)}, momento em que você tocou no botão</small></button>
    </div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) close(); });
    if (action.gps) getGps().then((g) => { st.gps = g; const el = $('#sh-gps', bg); if (el) el.textContent = g.erro ? g.erro : `±${g.acc} m`; });
    const file = $('#sh-file', bg);
    if (file) file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      try { st.photo = await compressImage(file.files[0]); $('#sh-prev', bg).innerHTML = `<img src="${st.photo}" alt="Foto capturada"><br><span class="muted small">Toque para trocar</span>`; }
      catch (e) { showErr(e.message); }
    });
    const showErr = (m) => { const el = $('#sh-err', bg); el.textContent = m; el.hidden = false; };
    $('#sh-go', bg).addEventListener('click', async () => {
      if (st.sending) return;
      if (action.photo === 'required' && !st.photo) return showErr('Tire a foto para concluir o registro.');
      st.sending = true;
      $('#sh-go', bg).disabled = true;
      if (action.gps && !st.gps) st.gps = await getGps();
      try {
        await sendEvent(opId, { type: action.type, occurredAt, gps: st.gps || undefined, photo: st.photo || undefined, note: $('#sh-note', bg).value.trim() || undefined, refEventId: action.refEventId });
        close(); refresh();
      } catch (e) { st.sending = false; $('#sh-go', bg).disabled = false; showErr(e.message); }
    });
  }

  function divergenceSheet(opId, action, refEvent) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <div class="card-h"><h2>Registrar divergência</h2><button class="btn small" data-x>Cancelar</button></div>
      <p class="small muted">Registro contestado: <b>${esc(refEvent.label)}</b> às ${hhmm(refEvent.occurredAt)} por ${esc(refEvent.actor.name)}. O registro original continua preservado; a divergência vira uma ocorrência para análise.</p>
      <div class="field"><label class="label" for="dv-note">O que diverge?</label><textarea id="dv-note" placeholder="Ex.: veículo não localizado na portaria neste horário; entrada registrada na cancela às 06:31."></textarea></div>
      <div class="field"><label class="label" for="dv-time">Horário que você reconhece (opcional)</label><input type="time" id="dv-time"></div>
      <p class="err" id="dv-err" hidden></p>
      <button class="btn danger" id="dv-go">Registrar divergência</button>
    </div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-x]')) bg.remove(); });
    $('#dv-go', bg).addEventListener('click', async () => {
      const t = $('#dv-time', bg).value;
      let alegadoEm;
      if (t) { // mesmo dia (horário de Brasília) do registro contestado
        const day = new Date(refEvent.occurredAt).toLocaleDateString('en-CA', { timeZone: TZ });
        alegadoEm = new Date(`${day}T${t}:00-03:00`).toISOString();
      }
      try {
        await sendEvent(opId, { type: 'DIVERGENCIA', occurredAt: new Date().toISOString(), refEventId: action.refEventId, note: $('#dv-note', bg).value.trim(), alegadoEm });
        bg.remove(); refresh();
      } catch (e) { const el = $('#dv-err', bg); el.textContent = e.message; el.hidden = false; }
    });
  }

  // ---------------- roteamento ----------------
  const route = () => { const h = location.hash.replace(/^#\/?/, '').split('/'); return { name: h[0] || 'home', id: h[1] }; };
  window.addEventListener('hashchange', () => render());
  let current = { view: null, data: null };
  let liveT;

  async function render() {
    clearInterval(liveT);
    if (!S.token) return renderLogin();
    connectSSE();
    await refreshFila();
    renderShell();
    const r = route();
    try {
      if (r.name === 'op' && r.id) await viewOp(r.id);
      else if (r.name === 'dossie' && r.id) await viewDossie(r.id);
      else if (r.name === 'admin' && S.user.role === 'admin') await viewAdmin();
      else await viewHome();
    } catch (e) {
      if (e.status !== 401) $('#main').innerHTML = `<div class="card"><h2>Não foi possível carregar</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/">Voltar ao início</a></div>`;
    }
    flush();
  }
  const refresh = () => render();
  // Atualização vinda do servidor: não interrompe quem está digitando ou com a folha de captura aberta.
  function softRefresh() {
    const a = document.activeElement;
    const busy = document.querySelector('.sheet-bg') || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || document.querySelector('details[open]');
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
    bar.innerHTML = `<a class="brand" href="#/"><span class="mark"></span><span><b>Estadia</b><br><span>Brobot Tecnologia</span></span></a>
      <span class="net ${online() ? '' : 'off'}"><i></i>${online() ? 'Online' : 'Sem sinal'}${pend ? ` · ${pend} a enviar` : ''}</span>
      ${S.user.role === 'tac' ? `<button id="simoff" title="Simula a perda de sinal para demonstrar o modo offline">${S.simOffline ? 'Reativar sinal' : 'Simular sem sinal'}</button>` : ''}
      ${S.user.role === 'admin' ? '<a class="btn small" href="#/admin" style="background:transparent;color:inherit;border-color:rgba(255,255,255,.3)">Administração</a>' : ''}
      <span class="who">${esc(S.user.nome)}<small>${esc(ROLE[S.user.role])} · ${esc(S.user.orgNome || '')}</small></span>
      <button id="logout">Sair</button>`;
    $('#logout').onclick = logout;
    const so = $('#simoff');
    if (so) so.onclick = () => { S.simOffline = !S.simOffline; store.set('estadia.simOffline', S.simOffline ? '1' : null); renderBar(); if (!S.simOffline) flush(); else refresh(); };
  }

  // ---------------- login ----------------
  const DEMO = [
    ['joao@tac.demo', 'João Batista Ferreira', 'TAC · placa RTB-4F27'],
    ['portaria@serraazul.demo', 'Marina Coelho', 'Destino · Serra Azul (portaria)'],
    ['doca@serraazul.demo', 'Rafael Toledo', 'Destino · Serra Azul (doca)'],
    ['cd@horizonte.demo', 'Paulo Reis', 'Destino · Mercado Horizonte'],
    ['juridico@andradeprado.demo', 'Dra. Helena Andrade', 'Advocacia'],
    ['admin@brobot.demo', 'Administrador', 'Brobot'],
  ];
  function renderLogin() {
    $('#app').innerHTML = `<div class="login">
      <section class="hero"><div class="mark"></div><h1>Estadia</h1>
        <p>Registro e comprovação dos marcos de carga e descarga. Cada evento tem autor, horário, local e evidência, e é confirmado pela outra parte.</p>
        <p class="small">Projeto Estadia · Brobot Tecnologia · versão de demonstração</p></section>
      <section class="card">
        <h2>Entrar</h2>
        <form id="lf" class="form" style="grid-template-columns:1fr">
          <div class="field"><label class="label" for="lf-e">E-mail</label><input id="lf-e" type="email" autocomplete="username" required></div>
          <div class="field"><label class="label" for="lf-s">Senha</label><input id="lf-s" type="password" autocomplete="current-password" required></div>
          <p class="err" id="lf-err" hidden></p>
          <button class="btn primary" type="submit">Entrar</button>
        </form>
        <div class="demo-users"><span class="label">Contas de demonstração · senha estadia123</span>
          ${DEMO.map(([e, n, r]) => `<button type="button" data-e="${e}"><b>${esc(n)}</b><span class="muted small">${esc(r)}</span></button>`).join('')}
        </div>
      </section></div>`;
    const go = async (email, senha) => {
      try {
        const r = await api('POST', '/api/login', { email, senha });
        S.token = r.token; S.user = r.user;
        store.set('estadia.token', r.token); store.set('estadia.user', JSON.stringify(r.user));
        location.hash = '#/'; render();
      } catch (e) { const el = $('#lf-err'); el.textContent = e.message; el.hidden = false; }
    };
    $('#lf').onsubmit = (e) => { e.preventDefault(); go($('#lf-e').value, $('#lf-s').value); };
    document.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => { $('#lf-e').value = b.dataset.e; $('#lf-s').value = 'estadia123'; go(b.dataset.e, 'estadia123'); }));
  }

  // ---------------- início por perfil ----------------
  async function viewHome() {
    const main = $('#main');
    let ops = [];
    try { ops = await api('GET', '/api/operations'); store.set('estadia.cache.ops.' + S.user.id, JSON.stringify(ops)); }
    catch (e) { if (e.code !== 'REDE') throw e; ops = JSON.parse(store.get('estadia.cache.ops.' + S.user.id) || '[]'); }
    if (S.user.role === 'tac') return homeTac(main, ops);
    if (S.user.role === 'advocacia') return homeAdv(main, ops);
    return homeDestino(main, ops);
  }

  function homeTac(main, ops) {
    main.innerHTML = `<div class="card"><h2>Identificar operação</h2>
      <p class="small muted">Use o código da ordem de carga informado pelo embarcador.</p>
      <form id="idf" class="form">
        <div class="field"><label class="label" for="id-c">Código da operação</label><input id="id-c" placeholder="OP-2026-0001" required autocapitalize="characters"></div>
        <div class="field"><label class="label" for="id-p">Placa</label><input id="id-p" value="${esc(placaFmt(S.user.placa))}" required autocapitalize="characters"></div>
        <div class="field" style="justify-content:flex-end"><button class="btn primary" type="submit">Identificar</button></div>
      </form><p class="err" id="id-err" hidden></p></div>
      <div class="card-h"><h2>Minhas operações</h2><span class="pill">${ops.length}</span></div>
      ${ops.length ? ops.map(opCard).join('') : '<p class="muted">Nenhuma operação vinculada ainda.</p>'}`;
    $('#idf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const d = await api('POST', '/api/operations/identify', { codigo: $('#id-c').value, placa: $('#id-p').value, clientEventId: uuid(), occurredAt: new Date().toISOString() });
        toast('Operação identificada e vinculada a você.');
        location.hash = `#/op/${d.op.id}`;
      } catch (err) { const el = $('#id-err'); el.textContent = err.message; el.hidden = false; }
    };
  }

  function opCard(o) {
    return `<a class="card opcard" href="#/op/${o.id}"><div class="card-h"><span class="mono">${esc(o.codigo)}</span>${statusPill(o)}</div>
      <h3>${esc(o.localNome)}</h3><dl class="kv"><dt>Destino</dt><dd>${esc(o.destinoNome)}</dd><dt>Placa</dt><dd class="mono">${esc(placaFmt(o.placa))}</dd>
      ${o.permanenciaMin != null ? `<dt>Permanência</dt><dd class="mono">${dur(o.permanenciaMin)}${o.emCurso ? ' (em curso)' : ''}</dd>` : ''}</dl></a>`;
  }

  function statusPill(o) {
    if (o.statusJuridico) return `<span class="pill sys">Jurídico: ${esc(jurLabel(o.statusJuridico))}</span>`;
    if (o.divergenciasAbertas) return `<span class="pill crit">${esc(o.status)}</span>`;
    if (o.encerrada) return `<span class="pill ok">${esc(o.status)}</span>`;
    if (o.pendentes && o.pendentes.length) return `<span class="pill warn">${esc(o.status)}</span>`;
    return `<span class="pill acc">${esc(o.status)}</span>`;
  }
  const jurLabel = (s) => ({ ENVIADO: 'enviado', RECEBIDO: 'recebido', EM_ANALISE: 'em análise', CONCLUIDO: 'concluído' }[s] || s);

  function homeDestino(main, ops) {
    const noPatio = ops.filter((o) => o.chegadaEm && !o.encerrada);
    const pend = ops.filter((o) => o.pendentes.length && !o.encerrada);
    const exced = ops.filter((o) => o.excedenteMin > 0);
    const canCreate = ['destino', 'admin'].includes(S.user.role);
    main.innerHTML = `<div class="kpis">
        <div class="kpi"><span class="label">No pátio agora</span><b>${noPatio.length}</b></div>
        <div class="kpi"><span class="label">Aguardando você</span><b>${pend.length}</b></div>
        <div class="kpi"><span class="label">Acima da franquia</span><b>${exced.length}</b></div>
        <div class="kpi"><span class="label">Operações</span><b>${ops.length}</b></div></div>
      ${canCreate ? `<details class="card" id="newop"><summary style="cursor:pointer"><b>Nova operação</b> <span class="muted small">cadastrar veículo esperado</span></summary>
        <form id="nf" class="form" style="margin-top:12px">
          <div class="field"><label class="label" for="nf-placa">Placa</label><input id="nf-placa" required placeholder="ABC1D23" autocapitalize="characters"></div>
          <div class="field"><label class="label" for="nf-carga">Carga (t)</label><input id="nf-carga" type="number" step="0.1" min="0.1" required value="28"></div>
          <div class="field"><label class="label" for="nf-nf">Nota fiscal</label><input id="nf-nf" placeholder="NF-e"></div>
          <div class="field"><label class="label" for="nf-orig">Origem</label><input id="nf-orig" placeholder="Cidade/UF"></div>
          <div class="field"><label class="label" for="nf-local">Local / doca</label><input id="nf-local" placeholder="CD · Doca"></div>
          <div class="field"><label class="label" for="nf-raio">Cerca (m)</label><input id="nf-raio" type="number" value="300" min="50"></div>
          <div class="field"><label class="label" for="nf-lat">Latitude</label><input id="nf-lat" inputmode="decimal"></div>
          <div class="field"><label class="label" for="nf-lng">Longitude</label><input id="nf-lng" inputmode="decimal"></div>
          <div class="field full row"><button type="button" class="btn" id="nf-here">Usar minha localização como destino</button><button class="btn primary" type="submit">Cadastrar operação</button></div>
          <p class="err field full" id="nf-err" hidden></p>
        </form></details>` : ''}
      <div class="card"><div class="card-h"><h2>Operações</h2><span class="muted small">Atualiza sozinho</span></div>
        <div class="tablewrap"><table><thead><tr><th>Código</th><th>Placa</th><th>Motorista</th><th>Situação</th><th>Chegada</th><th>Permanência</th><th>Pendências</th></tr></thead><tbody>
        ${ops.map((o) => `<tr class="click" data-op="${o.id}"><td class="mono">${esc(o.codigo)}</td><td class="mono">${esc(placaFmt(o.placa))}</td><td>${esc(o.tacNome || '—')}</td>
          <td>${statusPill(o)}</td><td class="mono">${diaHora(o.chegadaEm)}</td>
          <td class="mono" ${o.excedenteMin > 0 ? 'style="color:var(--crit);font-weight:600"' : ''}>${o.permanenciaMin != null ? dur(o.permanenciaMin) : '—'}</td>
          <td>${o.pendentes.map((p) => `<span class="pill warn">${esc(p)}</span>`).join(' ')}${o.divergenciasAbertas ? ` <span class="pill crit">${o.divergenciasAbertas} divergência</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma operação.</td></tr>'}
        </tbody></table></div></div>`;
    main.querySelectorAll('[data-op]').forEach((tr) => (tr.onclick = () => (location.hash = `#/op/${tr.dataset.op}`)));
    const nf = $('#nf');
    if (nf) {
      $('#nf-here').onclick = async () => { const g = await getGps(); if (g.erro) return toast(g.erro, true); $('#nf-lat').value = g.lat; $('#nf-lng').value = g.lng; toast(`Localização definida (±${g.acc} m).`); };
      nf.onsubmit = async (e) => {
        e.preventDefault();
        try {
          const d = await api('POST', '/api/operations', { placa: $('#nf-placa').value, cargaToneladas: $('#nf-carga').value, nf: $('#nf-nf').value, origem: $('#nf-orig').value, localNome: $('#nf-local').value, raioM: $('#nf-raio').value, lat: $('#nf-lat').value, lng: $('#nf-lng').value });
          toast(`Operação ${d.op.codigo} cadastrada. Informe o código ao motorista.`);
          location.hash = `#/op/${d.op.id}`;
        } catch (err) { const el = $('#nf-err'); el.textContent = err.message; el.hidden = false; }
      };
    }
  }

  function homeAdv(main, ops) {
    main.innerHTML = `<div class="card"><div class="card-h"><h2>Dossiês recebidos</h2><span class="pill">${ops.length}</span></div>
      <p class="small muted">Somente operações encaminhadas ao escritório aparecem aqui.</p>
      <div class="tablewrap"><table><thead><tr><th>Código</th><th>Destino</th><th>Placa</th><th>Excedente</th><th>Status</th></tr></thead><tbody>
      ${ops.map((o) => `<tr class="click" data-op="${o.id}"><td class="mono">${esc(o.codigo)}</td><td>${esc(o.destinoNome)}</td><td class="mono">${esc(placaFmt(o.placa))}</td><td class="mono">${dur(o.excedenteMin)}</td><td>${statusPill(o)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum dossiê encaminhado ainda.</td></tr>'}
      </tbody></table></div></div>`;
    main.querySelectorAll('[data-op]').forEach((tr) => (tr.onclick = () => (location.hash = `#/op/${tr.dataset.op}`)));
  }

  // ---------------- operação ----------------
  async function viewOp(id) {
    let d;
    try { d = await api('GET', `/api/operations/${id}`); store.set('estadia.cache.op.' + id, JSON.stringify(d)); }
    catch (e) { if (e.code !== 'REDE') throw e; d = JSON.parse(store.get('estadia.cache.op.' + id) || 'null'); if (!d) throw e; }
    current = { view: 'op', data: d };
    const main = $('#main');
    const role = S.user.role;
    const myPending = fila.filter((x) => x.opId === id);
    const evById = Object.fromEntries(d.timeline.map((e) => [e.id, e]));

    // Ações: do servidor; offline o TAC segue a sequência localmente.
    let acoes = d.acoes.slice();
    if (role === 'tac' && (myPending.length || !online())) {
      const done = new Set(d.timeline.map((e) => e.type).concat(myPending.map((x) => x.body.type)));
      const seq = [['CHEGADA', 'Chegada no destino', true, 'required', 'OPERACAO_IDENTIFICADA'], ['INICIO', 'Início da carga/descarga', true, null, 'CHEGADA'], ['TERMINO', 'Término da carga/descarga', false, 'optional', 'INICIO'], ['SAIDA', 'Saída do local', true, null, 'TERMINO']];
      const local = seq.filter(([t, , , , req]) => !done.has(t) && done.has(req)).slice(0, 1).map(([type, label, gps, photo]) => ({ type, label, gps, photo, kind: 'registro' }));
      acoes = local.concat(acoes.filter((a) => a.kind !== 'registro' && !done.has(a.type)));
    }
    const registros = acoes.filter((a) => a.kind === 'registro');
    const confs = acoes.filter((a) => a.kind === 'confirmacao');

    const ap = d.apuracao, o = d.op, r = d.resumo;
    main.innerHTML = `<a href="#/" class="small">← Voltar</a>
      <div class="card"><div class="card-h"><div><span class="label">${esc(o.codigo)}</span><h1>${esc(o.localNome || o.destinoNome)}</h1></div>${statusPill(r)}</div>
        <dl class="kv"><dt>Destino</dt><dd>${esc(o.destinoNome)}</dd><dt>Placa</dt><dd class="mono">${esc(placaFmt(o.placa))}</dd>
        <dt>Motorista</dt><dd>${esc(o.tacNome || 'não identificado')}</dd><dt>Carga</dt><dd class="mono">${esc(o.cargaToneladas)} t ${o.nf ? '· ' + esc(o.nf) : ''}</dd>
        ${o.origem ? `<dt>Origem</dt><dd>${esc(o.origem)}</dd>` : ''}</dl>
        ${ap ? meter(ap) : ''}</div>
      <div class="grid2"><div class="col">
        ${myPending.length ? `<div class="card" style="border-color:var(--warn)"><div class="card-h"><h3>Salvos no aparelho</h3><span class="pill warn">${myPending.length} a enviar</span></div>
          ${myPending.map((p) => `<div class="row between small"><span>${esc(labelLocal(p.body.type))} · <span class="mono">${hhmm(p.body.occurredAt)}</span></span>${p.erro ? `<span class="err">${esc(p.erro)}</span> <button class="btn small danger" data-discard="${p.clientEventId}">Descartar</button>` : '<span class="muted">aguardando sinal</span>'}</div>`).join('')}
          ${online() ? '<button class="btn small" id="sync">Enviar agora</button>' : ''}</div>` : ''}
        ${confs.map((a) => pendingBox(a, evById[a.refEventId], acoes)).join('')}
        ${registros.filter((a) => role === 'tac' || a.type === 'LIBERACAO').map((a) => `<button class="big" data-act="${a.type}">${esc(a.label)}<small>${a.photo === 'required' ? 'Captura horário, GPS e foto' : a.gps ? 'Captura horário e GPS' : 'Registra o horário deste momento'}</small></button>`).join('')}
        ${role !== 'tac' && registros.some((a) => a.type !== 'LIBERACAO') ? `<div class="card"><span class="label">Registrar pela doca, se o motorista não registrar</span><div class="row">${registros.filter((a) => a.type !== 'LIBERACAO').map((a) => `<button class="btn" data-act="${a.type}">${esc(a.label)}</button>`).join('')}</div></div>` : ''}
        ${role === 'tac' && !registros.length && !confs.length && !r.encerrada && d.op.tacUserId ? `<div class="card"><p class="muted">Aguardando o destino. Você será avisado aqui quando houver novidade.</p></div>` : ''}
        ${d.alertas.length ? `<div class="card"><h3>Pontos de atenção</h3>${d.alertas.map((a) => `<div class="alert ${a.nivel}"><b>${a.nivel === 'atencao' ? '!' : 'i'}</b><span>${esc(a.texto)}</span></div>`).join('')}
          <p class="small muted">Alertas são para análise humana. Não indicam irregularidade por si só.</p></div>` : ''}
        ${treatBoxes(d, evById)}
        <div class="card"><div class="card-h"><h2>Linha do tempo</h2><span class="pill">${d.timeline.length} eventos</span></div>${timelineHtml(d, myPending)}</div>
      </div><div class="col">
        ${apuracaoHtml(ap, role)}
        ${dossieHtml(d, role)}
      </div></div>`;

    main.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => captureSheet(id, acoes.find((a) => a.type === b.dataset.act))));
    main.querySelectorAll('[data-confirm]').forEach((b) => (b.onclick = async () => {
      const a = acoes.find((x) => x.type === b.dataset.confirm);
      b.disabled = true;
      try { await sendEvent(id, { type: a.type, occurredAt: new Date().toISOString(), refEventId: a.refEventId }); refresh(); } catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    main.querySelectorAll('[data-contest]').forEach((b) => (b.onclick = () => { const a = acoes.find((x) => x.kind === 'divergencia' && x.refEventId === b.dataset.contest); divergenceSheet(id, a, evById[a.refEventId]); }));
    main.querySelectorAll('[data-discard]').forEach((b) => (b.onclick = async () => { await Q.del(b.dataset.discard); refresh(); }));
    main.querySelectorAll('[data-treat]').forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      try { await sendEvent(id, { type: 'OCORRENCIA_TRATADA', occurredAt: new Date().toISOString(), refEventId: f.dataset.treat, resolucao: f.querySelector('select').value, note: f.querySelector('textarea').value.trim() }); refresh(); }
      catch (err) { toast(err.message, true); }
    }));
    const sync = $('#sync'); if (sync) sync.onclick = flush;
    const bind = (sel, fn) => { const el = $(sel); if (el) el.onclick = async () => { el.disabled = true; try { await fn(); } catch (e) { toast(e.message, true); el.disabled = false; } }; };
    bind('#apurar', async () => { await api('POST', `/api/operations/${id}/apuracao`); toast('Nova apuração registrada. Histórico preservado.'); refresh(); });
    bind('#gerar', async () => { const x = await api('POST', `/api/operations/${id}/dossie`); toast('Dossiê gerado.'); location.hash = `#/dossie/${x.hash}`; });
    bind('#encaminhar', async () => { await api('POST', `/api/operations/${id}/encaminhar`); toast('Dossiê encaminhado à advocacia.'); refresh(); });
    main.querySelectorAll('[data-jur]').forEach((b) => (b.onclick = async () => {
      try { await api('POST', `/api/operations/${id}/juridico-status`, { status: b.dataset.jur, note: ($('#jur-note') || {}).value || '' }); toast('Status atualizado.'); refresh(); } catch (e) { toast(e.message, true); }
    }));
    if (ap && ap.emCurso) liveT = setInterval(() => { const m = $('#meter-live'); if (m) m.outerHTML = meter(liveApur(ap)); }, 30000);
  }

  const LOCAL_LABELS = { CHEGADA: 'Chegada no destino', INICIO: 'Início da carga/descarga', TERMINO: 'Término da carga/descarga', SAIDA: 'Saída do local', LIBERACAO_CIENCIA: 'Ciência da liberação', DIVERGENCIA: 'Divergência' };
  const labelLocal = (t) => LOCAL_LABELS[t] || t;

  function liveApur(ap) {
    const perm = Math.max(0, Math.round((Date.now() - Date.parse(ap.marcoInicial)) / 60000));
    return { ...ap, permanenciaMin: perm, excedenteMin: Math.max(0, perm - ap.regra.franquiaMin) };
  }

  function meter(ap) {
    const fr = ap.regra.franquiaMin, scale = Math.max(12 * 60, ap.permanenciaMin * 1.1);
    const w = Math.min(100, (ap.permanenciaMin / scale) * 100), frp = (fr / scale) * 100;
    const over = ap.permanenciaMin > fr;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => `<span>${Math.round((scale * k) / 60)}h</span>`).join('');
    return `<div id="meter-live"><div class="row between small"><span><b class="mono">${dur(ap.permanenciaMin)}</b> de permanência ${ap.emCurso ? '(em curso)' : ''}</span>
      ${over ? `<span style="color:var(--crit);font-weight:600">franquia excedida em ${dur(ap.excedenteMin)}</span>` : `<span class="muted">franquia ${dur(fr)}</span>`}</div>
      <div class="meter"><div class="fill ${over ? 'over' : ''}" style="width:${w}%;--fr:${over ? (fr / ap.permanenciaMin) * 100 : 100}%"></div><div class="tick" style="left:${frp}%"><span>franquia</span></div></div>
      <div class="scale">${ticks}</div></div>`;
  }

  function pendingBox(a, ref, acoes) {
    if (!ref) return '';
    const contest = acoes.find((x) => x.kind === 'divergencia' && x.refEventId === ref.id);
    const p = ref.payload || {};
    const isLib = a.type === 'LIBERACAO_CIENCIA';
    const title = { CHEGADA_CONFIRMADA: 'Confirmar chegada do veículo', INICIO_CONFIRMADO: 'Confirmar início da carga/descarga', TERMINO_CONFIRMADO: 'Confirmar término da carga/descarga', LIBERACAO_CIENCIA: 'Você foi liberado para viagem' }[a.type] || a.label;
    return `<div class="pending"><div class="card-h"><h3>${esc(title)}</h3><span class="pill acc">pendente</span></div>
      <div class="evid">${p.photo ? `<img src="${photoUrl(p.photo)}" alt="Foto: ${esc(ref.label)}" loading="lazy">` : `<div class="kpi"><span class="label">Sem foto</span></div>`}
        <dl class="kv"><dt>Registro</dt><dd>${esc(ref.label)}</dd><dt>Por</dt><dd>${esc(ref.actor.name)}</dd><dt>Ocorrido</dt><dd class="mono">${dataHora(ref.occurredAt)}</dd>
        ${ref.receivedAt && Math.abs(Date.parse(ref.receivedAt) - Date.parse(ref.occurredAt)) > 120000 ? `<dt>Recebido</dt><dd class="mono">${dataHora(ref.receivedAt)}</dd>` : ''}
        ${p.gps ? `<dt>Local</dt><dd class="mono">${esc(gpsTxt(p.gps))} ${mapLink(p.gps) ? `<a href="${mapLink(p.gps)}" target="_blank" rel="noopener">mapa</a>` : ''}</dd>` : ''}
        ${p.note ? `<dt>Obs.</dt><dd>${esc(p.note)}</dd>` : ''}</dl></div>
      <div class="row"><button class="btn ok" data-confirm="${a.type}">${isLib ? 'Confirmar ciência' : 'Confirmar'}</button>
      ${contest ? `<button class="btn danger" data-contest="${ref.id}">Não reconheço este registro</button>` : ''}</div>
      <p class="small muted">Sua confirmação fica registrada com seu nome e horário, separada do registro original.</p></div>`;
  }

  function treatBoxes(d, evById) {
    if (!['destino', 'admin'].includes(S.user.role) || !d.divergenciasAbertas.length) return '';
    return d.divergenciasAbertas.map((id) => {
      const dv = evById[id];
      return `<form class="card" data-treat="${id}"><div class="card-h"><h3>Tratar ocorrência</h3><span class="pill crit">aberta</span></div>
        <p class="small">${esc(dv.payload.note)}</p>
        <div class="form"><div class="field"><label class="label">Resolução</label><select><option value="acordo">Acordo entre as partes</option><option value="procedente">Divergência procedente</option><option value="improcedente">Divergência improcedente</option></select></div>
        <div class="field full"><label class="label">Justificativa</label><textarea required></textarea></div></div>
        <button class="btn" type="submit">Registrar tratamento</button><p class="small muted">Os eventos originais não são alterados.</p></form>`;
    }).join('');
  }

  function timelineHtml(d, myPending) {
    const subs = {};
    const main = [];
    for (const e of d.timeline) {
      if (e.refEventId && ['confirmacao', 'divergencia', 'tratamento'].includes(e.kind)) (subs[e.refEventId] = subs[e.refEventId] || []).push(e);
      else main.push(e);
    }
    const subHtml = (e) => (subs[e.id] || []).map((x) => {
      const cls = x.kind === 'divergencia' ? 'div' : x.kind === 'tratamento' ? 'trat' : '';
      const extra = x.kind === 'divergencia'
        ? `<span>${esc(x.payload.note)}</span>${x.payload.alegadoEm ? `<span class="meta">horário reconhecido pela parte: ${hhmm(x.payload.alegadoEm)}</span>` : ''}<span class="meta">registro original de ${hhmm(e.occurredAt)} preservado</span>`
        : x.kind === 'tratamento' ? `<span>${esc(x.payload.resolucao)}: ${esc(x.payload.note)}</span>`
        : `${x.payload && x.payload.note ? `<span>${esc(x.payload.note)}</span>` : ''}<span class="meta">não altera o horário do registro (${hhmm(e.occurredAt)})</span>`;
      return `<div class="sub ${cls}"><div class="row between"><b>${esc(x.label)}</b><span class="mono">${diaHora(x.occurredAt)}</span></div><span>${esc(x.actor.name)}</span>${extra}${subHtml(x)}</div>`;
    }).join('');
    const items = main.map((e) => {
      const p = e.payload || {};
      let body = `<span class="small muted">${esc(e.actor.name)} · ${esc(ROLE[e.actor.role] || e.actor.role)}</span>`;
      if (e.kind === 'registro') {
        if (p.gps) body += `<div class="meta"><span>${esc(gpsTxt(p.gps))}</span>${mapLink(p.gps) ? `<a href="${mapLink(p.gps)}" target="_blank" rel="noopener">ver no mapa</a>` : ''}</div>`;
        if (p.photo) body += `<a href="${photoUrl(p.photo)}" target="_blank" rel="noopener"><img class="thumb" src="${photoUrl(p.photo)}" alt="Foto: ${esc(e.label)}" loading="lazy"></a>`;
        if (p.note) body += `<span class="small">${esc(p.note)}</span>`;
        const delay = (Date.parse(e.receivedAt) - Date.parse(e.occurredAt)) / 60000;
        if (delay >= 2) body += `<div class="meta"><span>ocorrido ${hhmm(e.occurredAt)} · sincronizado ${hhmm(e.receivedAt)}</span></div>`;
      } else if (e.kind === 'apuracao') {
        body += `<span class="small">Permanência ${dur(p.permanenciaMin)} · excedente ${dur(p.excedenteMin)} · regra ${esc(p.regra.id)} v${esc(p.regra.versao)}</span>`;
      } else if (e.kind === 'dossie') {
        body += `<a class="small" href="#/dossie/${p.hash}">Abrir dossiê ${p.hash.slice(0, 12)}…</a>`;
      } else if (e.kind === 'juridico' && p.status) {
        body += `<span class="small">${esc(jurLabel(p.status))}${p.note ? ': ' + esc(p.note) : ''}</span>`;
      }
      return `<div class="ev k-${e.kind}"><span class="dot"></span><div class="ev-c"><div class="row between"><span class="pill ${pillFor(e.kind)}">${kindLabel(e.kind)}</span><span class="mono">${diaHora(e.occurredAt)}</span></div>
        <h4>${esc(e.label)}</h4>${body}${subHtml(e)}<span class="meta" title="Hash do evento na cadeia">#${e.seq} · ${e.hash.slice(0, 10)}</span></div></div>`;
    });
    for (const p of myPending) {
      items.push(`<div class="ev pend"><span class="dot"></span><div class="ev-c"><div class="row between"><span class="pill warn">Aguardando envio</span><span class="mono">${diaHora(p.body.occurredAt)}</span></div>
        <h4>${esc(labelLocal(p.body.type))}</h4><span class="small muted">Salvo no aparelho. O horário original será mantido no envio.</span></div></div>`);
    }
    return `<div class="tl">${items.join('')}</div>`;
  }
  const kindLabel = (k) => ({ registro: 'Registro', confirmacao: 'Confirmação', divergencia: 'Divergência', apuracao: 'Apuração', dossie: 'Dossiê', juridico: 'Jurídico', cadastro: 'Cadastro', tratamento: 'Tratamento' }[k] || 'Sistema');
  const pillFor = (k) => ({ confirmacao: 'ok', divergencia: 'crit', apuracao: 'acc', dossie: 'sys', juridico: 'sys' }[k] || '');

  function apuracaoHtml(ap, role) {
    if (!ap) return `<div class="card"><h2>Apuração</h2><p class="muted small">Começa quando a chegada for registrada.</p></div>`;
    return `<div class="card"><div class="card-h"><h2>Apuração</h2><span class="pill ${ap.emCurso ? 'warn' : 'ok'}">${ap.emCurso ? 'prévia em curso' : 'marcos fechados'}</span></div>
      <div><span class="label">Excedente sobre a franquia</span><div class="bignum">${dur(ap.excedenteMin)}</div></div>
      <div class="calc"><span>Marco inicial · chegada</span><span class="v">${diaHora(ap.marcoInicial)}</span>
        <span>Marco final · liberação</span><span class="v">${ap.marcoFinal ? diaHora(ap.marcoFinal) : 'em aberto'}</span>
        <span>Permanência</span><span class="v">${dur(ap.permanenciaMin)}</span><span>Franquia</span><span class="v">− ${dur(ap.regra.franquiaMin)}</span>
        <span class="sep"></span><span>Estimativa (${ap.cargaToneladas} t × ${brl(ap.regra.valorTonHora)} por t·h)</span><span class="v">${brl(ap.valorEstimado)}</span></div>
      ${ap.cenarios.length > 1 ? `<span class="label">Cenários com outros marcos</span>${ap.cenarios.map((c) => `<div class="alt ${c.ativo ? 'on' : ''}"><span>${esc(c.label)}</span><span class="mono">${dur(c.minutos)}</span></div>`).join('')}` : ''}
      <div class="rule"><b>Regra ${esc(ap.regra.id)} · versão ${esc(ap.regra.versao)}</b><span class="muted">${esc(ap.regra.fonte)}</span><span class="muted">${esc(ap.ressalva)}</span></div>
      ${['destino', 'admin'].includes(role) ? '<button class="btn small" id="apurar">Registrar nova apuração</button>' : ''}</div>`;
  }

  function dossieHtml(d, role) {
    const canGen = ['destino', 'admin'].includes(role) && d.timeline.some((e) => e.type === 'CHEGADA');
    const j = d.juridico;
    return `<div class="card"><div class="card-h"><h2>Dossiê digital</h2>${j.status ? `<span class="pill sys">Jurídico: ${esc(jurLabel(j.status))}</span>` : ''}</div>
      ${d.dossies.length ? d.dossies.slice().reverse().map((x) => `<a class="row between small" href="#/dossie/${x.hash}"><span>Gerado ${diaHora(x.geradoEm)} por ${esc(x.por)}</span><span class="mono">${x.hash.slice(0, 10)}…</span></a>`).join('') : '<p class="small muted">Nenhum dossiê gerado ainda.</p>'}
      ${canGen ? '<button class="btn primary" id="gerar">Gerar dossiê agora</button>' : ''}
      ${['destino', 'admin'].includes(role) && !j.status ? (j.elegivel.apto ? '<button class="btn" id="encaminhar">Encaminhar para advocacia</button>' : `<p class="small muted">Encaminhamento jurídico: ${esc(j.elegivel.motivos.join(' '))}</p>`) : ''}
      ${j.historico.length ? `<span class="label">Encaminhamento</span>${j.historico.map((h) => `<div class="row between small"><span>${esc(h.type === 'ENCAMINHADO_JURIDICO' ? 'Enviado a ' + h.payload.advocaciaNome : jurLabel(h.payload.status))}${h.payload.note ? ' · ' + esc(h.payload.note) : ''}</span><span class="mono">${diaHora(h.occurredAt)}</span></div>`).join('')}` : ''}
      ${role === 'advocacia' ? `<div class="field"><label class="label" for="jur-note">Nota (opcional)</label><input id="jur-note"></div>
        <div class="row">${['RECEBIDO', 'EM_ANALISE', 'CONCLUIDO'].map((s) => `<button class="btn small" data-jur="${s}">Marcar ${jurLabel(s)}</button>`).join('')}</div>` : ''}</div>`;
  }

  // ---------------- dossiê ----------------
  async function viewDossie(hash) {
    const { content: c } = await api('GET', `/api/dossies/${hash}`);
    const main = $('#main');
    const o = c.operacao, ap = c.apuracao;
    main.innerHTML = `<div class="row noprint"><a href="#/op/${o.id}" class="small">← Voltar à operação</a><span style="flex:1"></span><button class="btn" id="verify">Verificar integridade</button><button class="btn primary" id="print">Imprimir / salvar PDF</button></div>
      <p class="noprint small" id="vres"></p>
      <article class="doc">
        <div class="doc-h"><div><span class="label">Dossiê digital da estadia</span><h1>${esc(o.codigo)}</h1><span class="muted small">${esc(o.destinoNome)} · ${esc(o.localNome)} · ${esc(placaFmt(o.placa))} · ${esc(o.nf || '')}</span></div>
          <div style="text-align:right"><span class="label">Gerado em</span><div class="mono">${dataHora(c.geradoEm)}</div><span class="small muted">${esc(c.geradoPor.nome)} · ${esc(c.geradoPor.organizacao || '')}</span></div></div>
        <div class="kpis"><div class="kpi"><span class="label">Marcos</span><b>${c.marcos.length}</b></div><div class="kpi"><span class="label">Confirmados</span><b>${c.marcos.filter((m) => m.confirmacao).length}</b></div>
          <div class="kpi"><span class="label">Divergências</span><b>${c.marcos.reduce((n, m) => n + m.divergencias.length, 0)}</b></div><div class="kpi"><span class="label">Excedente</span><b>${ap ? dur(ap.excedenteMin) : '—'}</b></div></div>
        <section><span class="label">Marcos e confirmações</span><div class="tablewrap"><table><thead><tr><th>Marco</th><th>Ocorrido</th><th>Registrado por</th><th>Local</th><th>Confirmação</th></tr></thead><tbody>
          ${c.marcos.map((m) => `<tr><td>${esc(m.marco)}${m.divergencias.length ? ' <span class="pill crit">divergência</span>' : ''}</td><td class="mono">${dataHora(m.ocorridoEm)}${Date.parse(m.recebidoEm) - Date.parse(m.ocorridoEm) > 120000 ? `<br><span class="muted small">recebido ${hhmm(m.recebidoEm)}</span>` : ''}</td>
            <td>${esc(m.registradoPor.name)}</td><td class="mono small">${m.gps ? esc(gpsTxt(m.gps)) : '—'}</td><td>${m.confirmacao ? `${esc(m.confirmacao.por.name)}<br><span class="mono small">${dataHora(m.confirmacao.em)}</span>` : '—'}</td></tr>`).join('')}
        </tbody></table></div></section>
        ${c.marcos.some((m) => m.foto) ? `<section><span class="label">Evidências fotográficas</span><div class="photos">${c.marcos.filter((m) => m.foto).map((m) => `<figure><img src="${photoUrl(m.foto)}" alt="${esc(m.marco)}"><figcaption>${esc(m.marco)} · ${dataHora(m.ocorridoEm)}<br><span class="mono">sha256 ${m.foto.sha256.slice(0, 16)}…</span></figcaption></figure>`).join('')}</div></section>` : ''}
        ${c.marcos.some((m) => m.divergencias.length) ? `<section><span class="label">Ocorrências</span>${c.marcos.flatMap((m) => m.divergencias.map((dv) => `<p class="small" style="margin:6px 0"><b>${esc(m.marco)}</b> · ${esc(dv.por.name)} em ${dataHora(dv.em)}: ${esc(dv.descricao)}${dv.alegadoEm ? ` (horário reconhecido: ${hhmm(dv.alegadoEm)})` : ''} — ${dv.tratamento ? `tratada: ${esc(dv.tratamento.resolucao)}, ${esc(dv.tratamento.descricao)}` : '<b>em aberto</b>'}</p>`)).join('')}</section>` : ''}
        ${c.alertas.length ? `<section><span class="label">Alertas automáticos</span>${c.alertas.map((a) => `<p class="small" style="margin:4px 0">• ${esc(a.texto)}</p>`).join('')}</section>` : ''}
        ${ap ? `<section><span class="label">Apuração</span><div class="calc" style="max-width:560px"><span>Permanência (${diaHora(ap.marcoInicial)} → ${ap.marcoFinal ? diaHora(ap.marcoFinal) : 'em aberto'})</span><span class="v">${dur(ap.permanenciaMin)}</span>
          <span>Franquia</span><span class="v">${dur(ap.regra.franquiaMin)}</span><span>Excedente</span><span class="v">${dur(ap.excedenteMin)}</span><span>Estimativa ilustrativa</span><span class="v">${brl(ap.valorEstimado)}</span></div>
          <p class="small muted" style="margin-top:6px">Regra ${esc(ap.regra.id)} v${esc(ap.regra.versao)}. ${esc(ap.regra.fonte)}</p></section>` : ''}
        <section><span class="label">Trilha de auditoria</span><div class="tablewrap"><table><thead><tr><th>#</th><th>Ocorrido</th><th>Evento</th><th>Autor</th><th>Hash</th></tr></thead><tbody>
          ${c.trilhaAuditoria.map((t) => `<tr><td class="mono">${t.seq}</td><td class="mono">${diaHora(t.ocorridoEm)}</td><td>${esc(t.tipo)}</td><td>${esc(t.autor)}</td><td class="mono small">${t.hash.slice(0, 12)}</td></tr>`).join('')}</tbody></table></div></section>
        <section><span class="label">Integridade</span><div class="hash">Hash do dossiê (SHA-256): ${esc(hash)}</div>
          <p class="small muted" style="margin-top:6px">Cadeia de eventos ${c.integridade.cadeiaValida ? 'íntegra' : 'com falha'} no momento da geração · último hash ${esc(c.integridade.ultimoHashDaCadeia.slice(0, 16))}…</p></section>
        <p class="disclaimer">${esc(c.ressalva)}</p>
      </article>`;
    $('#print').onclick = () => window.print();
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

  // ---------------- administração ----------------
  async function viewAdmin() {
    const [dirData, integ, ops] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/integrity'), api('GET', '/api/operations')]);
    const main = $('#main');
    main.innerHTML = `<a href="#/" class="small">← Operações</a>
      <div class="card"><div class="card-h"><h2>Integridade da cadeia de eventos</h2>${integ.ok ? '<span class="pill ok">Íntegra</span>' : '<span class="pill crit">Quebrada</span>'}</div>
        <p class="small">${integ.ok ? `${integ.eventos} eventos verificados. Último hash: <span class="mono">${esc(integ.ultimoHash.slice(0, 24))}…</span>` : `Falha no evento #${integ.seq}: ${esc(integ.motivo)}`}</p></div>
      <div class="card"><h2>Usuários</h2><div class="tablewrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Organização</th></tr></thead><tbody>
        ${dirData.users.map((u) => `<tr><td>${esc(u.nome)}</td><td class="mono small">${esc(u.email)}</td><td>${esc(ROLE[u.role])}</td><td>${esc(u.orgNome)}</td></tr>`).join('')}</tbody></table></div>
        <details><summary style="cursor:pointer"><b>Novo usuário</b></summary><form id="uf" class="form" style="margin-top:10px">
          <div class="field"><label class="label" for="uf-n">Nome</label><input id="uf-n" required></div>
          <div class="field"><label class="label" for="uf-e">E-mail</label><input id="uf-e" type="email" required></div>
          <div class="field"><label class="label" for="uf-s">Senha</label><input id="uf-s" type="password" minlength="6" required></div>
          <div class="field"><label class="label" for="uf-r">Perfil</label><select id="uf-r">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
          <div class="field"><label class="label" for="uf-o">Organização</label><select id="uf-o">${dirData.orgs.map((o) => `<option value="${o.id}">${esc(o.nome)}</option>`).join('')}</select></div>
          <div class="field"><label class="label" for="uf-p">Placa (TAC)</label><input id="uf-p"></div>
          <div class="field full"><button class="btn primary" type="submit">Criar usuário</button></div><p class="err field full" id="uf-err" hidden></p></form></details></div>
      <div class="card"><h2>Todas as operações</h2>${ops.map((o) => `<a class="row between small" href="#/op/${o.id}"><span class="mono">${esc(o.codigo)}</span><span>${esc(o.destinoNome)}</span>${statusPill(o)}</a>`).join('')}</div>`;
    $('#uf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/admin/users', { nome: $('#uf-n').value, email: $('#uf-e').value, senha: $('#uf-s').value, role: $('#uf-r').value, orgId: $('#uf-o').value, placa: $('#uf-p').value }); toast('Usuário criado.'); refresh(); }
      catch (err) { const el = $('#uf-err'); el.textContent = err.message; el.hidden = false; }
    };
  }

  // ---------------- início ----------------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  render();
})();
