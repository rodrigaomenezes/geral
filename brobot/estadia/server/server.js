'use strict';
// Servidor HTTP do Estadia: API REST + eventos em tempo real (SSE) + arquivos estáticos.
// Sem dependências externas: requer apenas Node.js 20+.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventStore, sha256 } = require('./store');
const { Directory, publicUser } = require('./auth');
const D = require('./domain');
const { seed } = require('./seed');

const MAX_BODY = 8 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

const normPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function createApp({ dataDir, publicDir = path.join(__dirname, '..', 'public'), seedIfEmpty = true, quiet = false } = {}) {
  const store = new EventStore(dataDir);
  const dir = new Directory(dataDir);
  if (dir.empty && seedIfEmpty) seed(dir, store, { quiet });

  const system = { userId: 'sistema', name: 'Plataforma Estadia', role: 'sistema', orgId: 'brobot' };
  const actorOf = (u) => ({ userId: u.id, name: u.nome, role: u.role, orgId: u.orgId });

  // ---------- leitura / permissões ----------
  const stateOf = (opId) => D.project(store.forOp(opId));

  function canSee(user, state) {
    if (!state) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'destino') return state.op.destinoOrgId === user.orgId;
    if (user.role === 'tac') return state.op.tacUserId === user.id;
    if (user.role === 'advocacia') return !!(state.encaminhado && state.encaminhado.payload.advocaciaOrgId === user.orgId);
    return false;
  }

  function summary(state) {
    const ap = D.apurar(state);
    const pend = Object.keys(D.CONFIRMATIONS).filter((t) => state.milestones[t] && !state.confirmations[state.milestones[t].id]);
    return {
      id: state.op.id, codigo: state.op.codigo, placa: state.op.placa, localNome: state.op.localNome,
      destinoNome: state.op.destinoNome, tacNome: state.op.tacNome || null, status: state.status,
      encerrada: state.encerrada, chegadaEm: state.milestones.CHEGADA ? state.milestones.CHEGADA.occurredAt : null,
      permanenciaMin: ap ? ap.permanenciaMin : null, excedenteMin: ap ? ap.excedenteMin : null, emCurso: ap ? ap.emCurso : null,
      pendentes: pend.map((t) => D.CONFIRMATIONS[t].label), divergenciasAbertas: state.divergenciasAbertas.length,
      statusJuridico: state.statusJuridico, criadaEm: state.op.criadaEm,
    };
  }

  function timeline(events) {
    return events.map((e) => ({
      id: e.id, seq: e.seq, type: e.type, label: D.labelOf(e.type), kind: D.kindOf(e.type),
      occurredAt: e.occurredAt, receivedAt: e.receivedAt, actor: e.actor, refEventId: e.refEventId,
      payload: e.payload, hash: e.hash,
    }));
  }

  function detail(state, user) {
    const events = store.forOp(state.op.id);
    return {
      op: state.op, resumo: summary(state), timeline: timeline(events),
      apuracao: D.apurar(state), alertas: D.alertas(state),
      acoes: D.nextActions(state, user),
      dossies: state.dossies.map((d) => ({ hash: d.payload.hash, geradoEm: d.occurredAt, por: d.actor.name })),
      juridico: { elegivel: D.elegivelJuridico(state), status: state.statusJuridico, historico: timeline(state.juridico) },
      divergenciasAbertas: state.divergenciasAbertas.map((d) => d.id),
    };
  }

  function recordApuracao(state, by = system) {
    const ap = D.apurar(state);
    if (!ap) return null;
    return store.append({ opId: state.op.id, type: 'APURACAO', actor: by, payload: ap }).event;
  }

  function buildDossie(state, user) {
    const events = store.forOp(state.op.id);
    const chain = store.verify();
    const content = {
      formato: 'estadia-dossie/1',
      geradoEm: new Date().toISOString(),
      geradoPor: { nome: user.nome, perfil: user.role, organizacao: (dir.org(user.orgId) || {}).nome || null },
      operacao: state.op,
      status: state.status,
      marcos: D.SEQUENCE.filter((t) => state.milestones[t]).map((t) => {
        const m = state.milestones[t];
        const c = state.confirmations[m.id];
        return {
          marco: D.labelOf(t), ocorridoEm: m.occurredAt, recebidoEm: m.receivedAt, registradoPor: m.actor,
          gps: (m.payload && m.payload.gps) || null, foto: (m.payload && m.payload.photo) || null,
          confirmacao: c ? { tipo: D.labelOf(c.type), em: c.occurredAt, por: c.actor, observacao: (c.payload && c.payload.note) || null } : null,
          divergencias: state.divergences.filter((d) => d.refEventId === m.id).map((d) => ({
            em: d.occurredAt, por: d.actor, descricao: d.payload.note, alegadoEm: d.payload.alegadoEm || null,
            tratamento: state.treatments[d.id] ? { em: state.treatments[d.id].occurredAt, por: state.treatments[d.id].actor, resolucao: state.treatments[d.id].payload.resolucao, descricao: state.treatments[d.id].payload.note } : null,
          })),
          eventoHash: m.hash,
        };
      }),
      alertas: D.alertas(state),
      apuracao: D.apurar(state),
      trilhaAuditoria: events.map((e) => ({ seq: e.seq, tipo: D.labelOf(e.type), categoria: D.kindOf(e.type), ocorridoEm: e.occurredAt, recebidoEm: e.receivedAt, autor: e.actor.name, perfil: e.actor.role, hash: e.hash })),
      integridade: { cadeiaValida: chain.ok, ultimoHashDaCadeia: store.lastHash, eventosNaOperacao: events.length },
      ressalva: 'Este dossiê organiza fatos registrados pelas partes. Não constitui conclusão jurídica.',
    };
    const hash = store.saveDossie(content);
    store.append({ opId: state.op.id, type: 'DOSSIE_GERADO', actor: actorOf(user), payload: { hash, eventos: events.length } });
    return hash;
  }

  // Apura automaticamente operações encerradas que ainda não têm apuração (ex.: dados semeados).
  function apurarPendentes() {
    for (const id of store.opIds()) {
      const st = stateOf(id);
      if (st && st.encerrada && !st.apuracoes.length) recordApuracao(st);
    }
  }
  apurarPendentes();

  // Reinício da demonstração: apaga tudo e recria os dados iniciais.
  const demoResetEnabled = process.env.ESTADIA_DEMO_RESET !== '0';
  function resetDemo() {
    store.reset();
    dir.reset();
    seed(dir, store, { quiet: true });
    apurarPendentes();
  }

  // ---------- SSE ----------
  const streams = new Set();
  store.on('append', (ev) => {
    const st = ev.opId ? stateOf(ev.opId) : null;
    for (const s of streams) {
      if ((st && canSee(s.user, st)) || (!st && s.user.role === 'admin')) s.res.write(`data: ${JSON.stringify({ opId: ev.opId, type: ev.type })}\n\n`);
    }
  });
  store.on('reset', () => {
    for (const s of streams) { s.res.write(`data: ${JSON.stringify({ reset: true })}\n\n`); s.res.end(); }
    streams.clear();
  });
  const ping = setInterval(() => { for (const s of streams) s.res.write(': ping\n\n'); }, 25000);
  ping.unref();

  // ---------- HTTP helpers ----------
  const send = (res, status, body, headers = {}) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(data);
  };
  const fail = (res, status, code, message) => send(res, status, { erro: code, mensagem: message });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new D.DomainError(413, 'MUITO_GRANDE', 'Envio maior que o permitido (8 MB).')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new D.DomainError(400, 'JSON_INVALIDO', 'Corpo da requisição inválido.')); }
      });
      req.on('error', reject);
    });
  }

  function authUser(req, url) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
    return dir.verify(token);
  }

  function parsePhoto(dataUrl) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new D.DomainError(400, 'FOTO_INVALIDA', 'Formato de foto inválido (use JPEG, PNG ou WebP).');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 5 * 1024 * 1024) throw new D.DomainError(413, 'FOTO_GRANDE', 'Foto maior que 5 MB.');
    return store.savePhoto(buf, m[1]);
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir)) return fail(res, 403, 'PROIBIDO', 'Caminho inválido.');
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : (path.extname(rel) ? null : path.join(publicDir, 'index.html'));
    if (!target) return fail(res, 404, 'NAO_ENCONTRADO', 'Arquivo não encontrado.');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(target).pipe(res);
  }

  // ---------- rotas ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (!p.startsWith('/api/')) return serveStatic(req, res, url);

    if (p === '/api/health') return send(res, 200, { ok: true, eventos: store.events.length });

    if (p === '/api/login' && req.method === 'POST') {
      const { email, senha } = await readBody(req);
      const r = dir.login(email, senha);
      return r ? send(res, 200, r) : fail(res, 401, 'CREDENCIAIS', 'E-mail ou senha incorretos.');
    }

    const user = authUser(req, url);
    if (!user) return fail(res, 401, 'NAO_AUTENTICADO', 'Sessão expirada. Entre novamente.');

    if (p === '/api/me') return send(res, 200, publicUser(user, dir.org(user.orgId)));

    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      const s = { res, user };
      streams.add(s);
      req.on('close', () => streams.delete(s));
      return;
    }

    if (p === '/api/operations' && req.method === 'GET') {
      const list = store.opIds().map(stateOf).filter((st) => canSee(user, st)).map(summary).reverse();
      return send(res, 200, list);
    }

    if (p === '/api/operations' && req.method === 'POST') {
      if (!['destino', 'admin'].includes(user.role)) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não cadastra operações.');
      const b = await readBody(req);
      const placa = normPlaca(b.placa);
      if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) return fail(res, 400, 'PLACA', 'Placa inválida. Use o formato ABC1D23 ou ABC1234.');
      const carga = Number(b.cargaToneladas);
      if (!(carga > 0 && carga < 100)) return fail(res, 400, 'CARGA', 'Informe a carga em toneladas.');
      const codigo = b.codigo ? String(b.codigo).trim().toUpperCase().slice(0, 30) : `OP-${new Date().getFullYear()}-${String(store.opIds().length + 1).padStart(4, '0')}`;
      if (store.opIds().map(stateOf).some((st) => st.op.codigo === codigo)) return fail(res, 409, 'DUPLICADA', `Já existe a operação ${codigo}.`);
      const lat = b.lat === '' || b.lat == null ? null : Number(b.lat), lng = b.lng === '' || b.lng == null ? null : Number(b.lng);
      const org = user.role === 'destino' ? dir.org(user.orgId) : dir.org(b.destinoOrgId) || dir.org(user.orgId);
      const opId = crypto.randomUUID();
      store.append({ opId, type: 'OPERACAO_CRIADA', actor: actorOf(user), payload: {
        destinoOrgId: org.id, destinoNome: org.nome, codigo, placa, cargaToneladas: carga,
        nf: String(b.nf || '').slice(0, 60), origem: String(b.origem || '').slice(0, 80), localNome: String(b.localNome || org.nome).slice(0, 80),
        lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null, raioM: Number(b.raioM) || 300,
      } });
      return send(res, 201, detail(stateOf(opId), user));
    }

    if (p === '/api/operations/identify' && req.method === 'POST') {
      if (user.role !== 'tac') return fail(res, 403, 'SEM_PERMISSAO', 'Somente o TAC identifica a operação.');
      const b = await readBody(req);
      const codigo = String(b.codigo || '').trim().toUpperCase();
      const placa = normPlaca(b.placa || user.placa);
      const st = store.opIds().map(stateOf).find((s) => s.op.codigo === codigo);
      if (!st || st.op.placa !== placa) return fail(res, 404, 'NAO_ENCONTRADA', 'Nenhuma operação com este código para esta placa.');
      if (st.op.tacUserId && st.op.tacUserId !== user.id) return fail(res, 409, 'VINCULADA', 'Esta operação já está vinculada a outro motorista.');
      if (!st.op.tacUserId) {
        store.append({ opId: st.op.id, type: 'OPERACAO_IDENTIFICADA', actor: actorOf(user), clientEventId: b.clientEventId,
          occurredAt: b.occurredAt ? new Date(Math.min(Date.parse(b.occurredAt) || Date.now(), Date.now())).toISOString() : undefined, payload: { placa } });
      }
      return send(res, 200, detail(stateOf(st.op.id), user));
    }

    let m;
    if ((m = /^\/api\/operations\/([0-9a-f-]{36})(\/[a-z-]+)?$/.exec(p))) {
      const st = stateOf(m[1]);
      if (!canSee(user, st)) return fail(res, 404, 'NAO_ENCONTRADA', 'Operação não encontrada.');
      const sub = m[2] || '';

      if (!sub && req.method === 'GET') return send(res, 200, detail(st, user));

      if (sub === '/events' && req.method === 'POST') {
        const b = await readBody(req);
        if (b.clientEventId && store.byClientId.has(b.clientEventId)) {
          return send(res, 200, { duplicado: true, evento: store.byClientId.get(b.clientEventId), detalhe: detail(stateOf(st.op.id), user) });
        }
        const v = D.validateEvent(st, user, { ...b, hasPhoto: !!b.photo });
        const payload = {};
        if (v.gps) payload.gps = v.gps;
        if (v.note) payload.note = v.note;
        if (v.alegadoEm) payload.alegadoEm = v.alegadoEm;
        if (v.resolucao) payload.resolucao = v.resolucao;
        if (b.photo) payload.photo = parsePhoto(b.photo);
        const { event } = store.append({ opId: st.op.id, type: v.type, actor: actorOf(user), occurredAt: v.occurredAt, refEventId: v.refEventId, clientEventId: b.clientEventId, payload });
        let after = stateOf(st.op.id);
        if (v.type === 'SAIDA') { recordApuracao(after); after = stateOf(st.op.id); }
        return send(res, 201, { duplicado: false, evento: event, detalhe: detail(after, user) });
      }

      if (sub === '/apuracao' && req.method === 'POST') {
        if (!['destino', 'admin'].includes(user.role)) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não solicita apuração.');
        if (!recordApuracao(st, actorOf(user))) return fail(res, 409, 'SEM_MARCO', 'Ainda não há chegada registrada para apurar.');
        return send(res, 201, detail(stateOf(st.op.id), user));
      }

      if (sub === '/dossie' && req.method === 'POST') {
        if (!['destino', 'admin'].includes(user.role)) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não gera dossiês.');
        if (!st.milestones.CHEGADA) return fail(res, 409, 'SEM_MARCO', 'Não há registros suficientes para o dossiê.');
        const hash = buildDossie(st, user);
        return send(res, 201, { hash, detalhe: detail(stateOf(st.op.id), user) });
      }

      if (sub === '/encaminhar' && req.method === 'POST') {
        if (!['destino', 'admin'].includes(user.role)) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não encaminha dossiês.');
        const el = D.elegivelJuridico(st);
        if (!el.apto) return fail(res, 409, 'NAO_APTO', el.motivos.join(' '));
        const adv = dir.data.orgs.find((o) => o.tipo === 'advocacia');
        const last = st.dossies[st.dossies.length - 1];
        store.append({ opId: st.op.id, type: 'ENCAMINHADO_JURIDICO', actor: actorOf(user), payload: { dossieHash: last.payload.hash, advocaciaOrgId: adv.id, advocaciaNome: adv.nome } });
        return send(res, 201, detail(stateOf(st.op.id), user));
      }

      if (sub === '/juridico-status' && req.method === 'POST') {
        if (user.role !== 'advocacia') return fail(res, 403, 'SEM_PERMISSAO', 'Somente a advocacia atualiza este status.');
        const b = await readBody(req);
        const status = ['RECEBIDO', 'EM_ANALISE', 'CONCLUIDO'].includes(b.status) ? b.status : null;
        if (!status) return fail(res, 400, 'STATUS', 'Status inválido.');
        store.append({ opId: st.op.id, type: 'JURIDICO_STATUS', actor: actorOf(user), payload: { status, note: String(b.note || '').slice(0, 1000) } });
        return send(res, 201, detail(stateOf(st.op.id), user));
      }
    }

    if ((m = /^\/api\/photos\/([a-f0-9]{64}\.(?:jpg|png|webp))$/.exec(p))) {
      const owner = store.events.find((e) => e.payload && e.payload.photo && e.payload.photo.file === m[1]);
      if (!owner || !canSee(user, stateOf(owner.opId))) return fail(res, 404, 'NAO_ENCONTRADA', 'Foto não encontrada.');
      const file = store.photoPath(m[1]);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'private, max-age=86400' });
      return fs.createReadStream(file).pipe(res);
    }

    if ((m = /^\/api\/dossies\/([a-f0-9]{64})$/.exec(p))) {
      const doc = store.loadDossie(m[1]);
      const owner = doc && store.events.find((e) => e.type === 'DOSSIE_GERADO' && e.payload.hash === m[1]);
      if (!owner || !canSee(user, stateOf(owner.opId))) return fail(res, 404, 'NAO_ENCONTRADO', 'Dossiê não encontrado.');
      return send(res, 200, doc);
    }

    if (p === '/api/admin/reset-demo' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, 'SEM_PERMISSAO', 'Somente administradores.');
      if (!demoResetEnabled) return fail(res, 403, 'DESATIVADO', 'O reinício da demonstração está desativado neste ambiente.');
      resetDemo();
      return send(res, 200, { ok: true, mensagem: 'Demonstração reiniciada.' });
    }

    if (p === '/api/admin/integrity') {
      if (user.role !== 'admin') return fail(res, 403, 'SEM_PERMISSAO', 'Somente administradores.');
      return send(res, 200, store.verify());
    }

    if (p === '/api/admin/users' && req.method === 'GET') {
      if (user.role !== 'admin') return fail(res, 403, 'SEM_PERMISSAO', 'Somente administradores.');
      return send(res, 200, { orgs: dir.data.orgs, users: dir.data.users.map((u) => publicUser(u, dir.org(u.orgId))) });
    }

    if (p === '/api/admin/users' && req.method === 'POST') {
      if (user.role !== 'admin') return fail(res, 403, 'SEM_PERMISSAO', 'Somente administradores.');
      const b = await readBody(req);
      if (!['tac', 'destino', 'advocacia', 'admin'].includes(b.role)) return fail(res, 400, 'PERFIL', 'Perfil inválido.');
      if (!dir.org(b.orgId)) return fail(res, 400, 'ORG', 'Organização inválida.');
      if (!/^\S+@\S+\.\S+$/.test(String(b.email || ''))) return fail(res, 400, 'EMAIL', 'E-mail inválido.');
      if (String(b.senha || '').length < 6) return fail(res, 400, 'SENHA', 'A senha precisa de ao menos 6 caracteres.');
      const nu = dir.addUser({ email: b.email, senha: b.senha, nome: String(b.nome || b.email).slice(0, 80), role: b.role, orgId: b.orgId, placa: b.placa ? normPlaca(b.placa) : undefined });
      store.append({ type: 'USUARIO_CRIADO', actor: actorOf(user), payload: { userId: nu.id, email: nu.email, role: nu.role, orgId: nu.orgId } });
      return send(res, 201, publicUser(nu, dir.org(nu.orgId)));
    }

    return fail(res, 404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof D.DomainError || err.status) return fail(res, err.status || 400, err.code || 'ERRO', err.message);
      console.error(err);
      fail(res, 500, 'ERRO_INTERNO', 'Erro inesperado no servidor.');
    });
  });
  server.on('close', () => { clearInterval(ping); for (const s of streams) s.res.end(); });
  return { server, store, dir };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const dataDir = path.resolve(process.env.ESTADIA_DATA || path.join(__dirname, '..', 'data'));
  const { server } = createApp({ dataDir });
  server.listen(port, () => {
    console.log(`Estadia rodando em http://localhost:${port}`);
    console.log(`Dados em ${dataDir}`);
  });
}

module.exports = { createApp, sha256 };
