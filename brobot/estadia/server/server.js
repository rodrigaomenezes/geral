'use strict';
// Servidor HTTP do Estadia BR: API REST, página pública de confirmação, eventos em tempo real (SSE)
// e arquivos estáticos. Sem dependências externas: requer apenas Node.js 20+.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventStore, sha256 } = require('./store');
const { Directory, publicUser } = require('./auth');
const D = require('./domain');
const Amelia = require('./amelia');
const { seed } = require('./seed');

const MAX_BODY = 12 * 1024 * 1024;
const LINK_TTL_H = Number(process.env.ESTADIA_LINK_TTL_HORAS) || 24;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
};
const normPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digits = (s) => String(s || '').replace(/\D/g, '');

function createApp({ dataDir, publicDir = path.join(__dirname, '..', 'public'), seedIfEmpty = true, quiet = false } = {}) {
  const store = new EventStore(dataDir);
  const dir = new Directory(dataDir);
  const demo = process.env.ESTADIA_DEMO_RESET !== '0';
  const SYS = { userId: 'sistema', name: 'Estadia BR', role: 'sistema', orgId: 'estadia-br' };
  const actorOf = (u) => ({ userId: u.id, name: u.nome, role: u.role, orgId: u.orgId });
  const origemDe = (u) => (u.role === 'tac' ? 'app' : 'portal');
  const stateOf = (opId) => D.project(store.forOp(opId));
  const allStates = () => store.opIds().map(stateOf).filter(Boolean);

  function canSee(user, st) {
    if (!st) return false;
    switch (user.role) {
      case 'admin': return true;
      case 'transportadora': return st.op.transportadoraOrgId === user.orgId;
      case 'destino': return st.op.destinoOrgId === user.orgId;
      case 'tac': return st.op.tacUserId === user.id;
      case 'advocacia': return !!(st.encaminhado && st.encaminhado.payload.advocaciaOrgId === user.orgId);
      default: return false;
    }
  }

  // ---------- apuração, dossiê e links ----------
  function recordApuracao(st, by = SYS, occurredAt) {
    const ap = D.apurar(st, occurredAt);
    if (ap.pendente) return null;
    return store.append({ opId: st.op.id, type: 'APURACAO', actor: by, origem: by === SYS ? 'sistema' : 'portal', occurredAt, payload: ap }).event;
  }

  function buildDossie(st, by, occurredAt) {
    const events = store.forOp(st.op.id);
    const chain = store.verify();
    const ap = st.apuracoes.length ? st.apuracoes[st.apuracoes.length - 1].payload : D.apurar(st);
    const ev = (e) => (e ? { em: e.occurredAt, recebidoEm: e.receivedAt, por: e.actor.name, perfil: e.actor.role, origem: e.origem, hash: e.hash } : null);
    const content = {
      formato: 'estadia-br-dossie/2',
      geradoEm: occurredAt || new Date().toISOString(),
      geradoPor: { nome: by.name || by.nome, perfil: by.role },
      operacao: st.op,
      status: { codigo: st.statusCode, descricao: st.status },
      dadosInformados: st.dadosInformados ? { em: st.dadosInformados.occurredAt, canal: st.dadosInformados.payload.canal, texto: st.dadosInformados.payload.texto, entidades: st.dadosInformados.payload.entidades, audio: st.dadosInformados.payload.audio || null } : null,
      marcos: D.SEQUENCE.filter((t) => st.milestones[t]).map((t) => {
        const m = st.milestones[t];
        return {
          tipo: t, marco: D.labelOf(t), ...ev(m), gps: m.payload.gps || null, foto: m.payload.photo || null, observacao: m.payload.note || null,
          confirmacao: st.confirmations[m.id] ? { tipo: D.labelOf(st.confirmations[m.id].type), ...ev(st.confirmations[m.id]) } : null,
          divergencias: st.divergences.filter((d) => d.refEventId === m.id).map((d) => ({ ...ev(d), descricao: d.payload.note, alegadoEm: d.payload.alegadoEm || null,
            tratamento: st.treatments[d.id] ? { ...ev(st.treatments[d.id]), resolucao: st.treatments[d.id].payload.resolucao, descricao: st.treatments[d.id].payload.note } : null })),
        };
      }),
      ocorrencias: st.ocorrencias.map((o) => ({ codigo: o.type, descricao: D.labelOf(o.type), ...ev(o), dados: o.payload })),
      notificacoes: st.links.map((l) => ({ tipo: D.labelOf(l.type), ...ev(l), canal: l.payload.canal || null, destinatario: l.payload.destinatario || null })),
      retificacoes: st.retificacoes.map((r) => ({ ...ev(r), campo: r.payload.campo, anterior: r.payload.anterior, novo: r.payload.novo, motivo: r.payload.motivo })),
      alertas: D.alertas(st),
      apuracao: ap,
      historicoApuracoes: st.apuracoes.map((a) => ({ ...ev(a), regra: `${a.payload.regra.id} v${a.payload.regra.versao}`, tempoMin: a.payload.tempoMin, valorDevido: a.payload.valorDevido })),
      financeiro: { ...st.financeiro, pagamentos: st.pagamentos.map((p) => ({ ...ev(p), valor: p.payload.valor, origem: D.ORIGENS_PAGAMENTO[p.payload.origem], observacao: p.payload.note || null })),
        negociacoes: st.situacoes.map((s) => ({ ...ev(s), situacao: s.payload.situacao, observacao: s.payload.note || null })) },
      juridico: st.juridico.map((j) => ({ tipo: D.labelOf(j.type), ...ev(j), status: j.payload.status || 'ENVIADO', observacao: j.payload.note || null, resultado: j.payload.resultado || null })),
      trilhaAuditoria: events.map((e) => ({ seq: e.seq, tipo: D.labelOf(e.type), categoria: D.kindOf(e.type), ocorridoEm: e.occurredAt, recebidoEm: e.receivedAt, autor: e.actor.name, perfil: e.actor.role, origem: e.origem, ip: e.ip, dispositivo: e.dispositivo, hash: e.hash })),
      integridade: { cadeiaValida: chain.ok, ultimoHashDaCadeia: store.lastHash, eventosNaOperacao: events.length },
      ressalva: 'Este dossiê é um conjunto estruturado de evidências e registros para apoiar análise administrativa, negociação ou jurídica. Não constitui conclusão jurídica.',
    };
    const hash = store.saveDossie(content);
    store.append({ opId: st.op.id, type: 'DOSSIE_GERADO', actor: by.userId ? by : actorOf(by), origem: by === SYS ? 'sistema' : 'portal', occurredAt, payload: { hash, eventos: events.length } });
    return hash;
  }

  function createLink(st, refEvent, confirmType, by = SYS) {
    const links = store.loadLinks();
    const token = crypto.randomBytes(24).toString('base64url');
    const id = crypto.randomUUID();
    const criadoEm = new Date().toISOString();
    const expiraEm = new Date(Date.now() + LINK_TTL_H * 3600000).toISOString();
    const destinatario = { nome: st.op.responsavelNome || st.op.destinoNome, telefone: st.op.responsavelTelefone || null };
    links[token] = { id, opId: st.op.id, refEventId: refEvent.id, confirmType, criadoEm, expiraEm, usadoEm: null, destinatario };
    store.saveLinks(links);
    store.append({ opId: st.op.id, type: 'LINK_GERADO', actor: by, origem: 'sistema', payload: {
      linkId: id, refEventId: refEvent.id, confirmType, canal: 'whatsapp', modo: 'manual', destinatario, expiraEm, tokenHash: sha256(token) } });
    return token;
  }

  function linksAtivos(st, baseUrl) {
    const now = Date.now();
    return Object.entries(store.loadLinks())
      .filter(([, l]) => l.opId === st.op.id && !l.usadoEm && Date.parse(l.expiraEm) > now && !st.confirmations[l.refEventId])
      .map(([token, l]) => {
        const url = `${baseUrl}/c/${token}`;
        const msg = `Estadia BR · ${st.op.codigo}\nVeículo ${st.op.placa} (${st.op.tacNome || 'TAC'}) aguarda sua confirmação: ${D.labelOf(D.CONFIRMATION_OF[l.confirmType])}.\nConfirme aqui: ${url}`;
        return { id: l.id, confirmType: l.confirmType, label: D.labelOf(l.confirmType), expiraEm: l.expiraEm, destinatario: l.destinatario, url,
          mensagem: msg, whatsappUrl: l.destinatario.telefone ? `https://wa.me/${digits(l.destinatario.telefone)}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}` };
      });
  }

  // Após registros do TAC que dependem do destino: gera link de confirmação (épico 04/21).
  function aposRegistro(st, ev) {
    if (ev.actor.role === 'tac' && ['CHEGADA', 'INICIO', 'TERMINO'].includes(ev.type)) {
      createLink(st, ev, D.CONFIRMATIONS[ev.type].type);
    }
    if (ev.type === 'CHEGADA' && ev.payload.gps && ev.payload.gps.erro) {
      store.append({ opId: st.op.id, type: 'GPS_INDISPONIVEL', actor: SYS, refEventId: ev.id, payload: { marco: D.labelOf(ev.type), motivo: ev.payload.gps.erro } });
    }
    if (ev.payload.gps) checarDeslocamento(stateOf(st.op.id), ev.payload.gps, ev.occurredAt);
    if (ev.type === 'SAIDA') {
      const s2 = stateOf(st.op.id);
      recordApuracao(s2);
      buildDossie(stateOf(st.op.id), SYS);
    }
  }

  function checarDeslocamento(st, gps, occurredAt, extra = {}) {
    const r = D.verificarDeslocamento(st, gps);
    if (!r) return { foraDoLimite: false };
    const ultimo = st.ocorrencias.filter((o) => o.type === 'DESLOCAMENTO_FORA_DO_LIMITE').pop();
    if (ultimo && Date.now() - Date.parse(ultimo.receivedAt) < 30 * 60000) return { foraDoLimite: true, distanciaM: r.distanciaM, registrada: false };
    store.append({ opId: st.op.id, type: 'DESLOCAMENTO_FORA_DO_LIMITE', actor: SYS, occurredAt, payload: { ...r, ...extra } });
    return { foraDoLimite: true, distanciaM: r.distanciaM, registrada: true };
  }

  // ---------- visões ----------
  function summary(st) {
    const ap = D.apurar(st);
    const pend = Object.keys(D.CONFIRMATIONS).filter((t) => st.milestones[t] && !st.confirmations[st.milestones[t].id]);
    return {
      id: st.op.id, codigo: st.op.codigo, tipo: st.op.tipo, placa: st.op.placa, localNome: st.op.localNome, destinoNome: st.op.destinoNome,
      transportadoraNome: st.op.transportadoraNome, tacNome: st.op.tacNome || null, statusCode: st.statusCode, status: st.status,
      chegadaEm: st.milestones.CHEGADA ? st.milestones.CHEGADA.occurredAt : null,
      limite: ap.pendente ? null : { inicio: ap.marcoInicial, limiteEm: ap.limiteEm, tempoMin: ap.tempoMin, excedeu: ap.excedeu, emCurso: ap.emCurso },
      pendentes: pend.map((t) => D.CONFIRMATIONS[t].label), divergenciasAbertas: st.divergenciasAbertas.length,
      deslocamentos: st.ocorrencias.filter((o) => o.type === 'DESLOCAMENTO_FORA_DO_LIMITE').length,
      financeiro: st.financeiro, statusJuridico: st.statusJuridico, criadaEm: st.op.criadaEm, nfe: st.op.nfe || null,
    };
  }

  const timeline = (events) => events.map((e) => ({
    id: e.id, seq: e.seq, type: e.type, label: D.labelOf(e.type), kind: D.kindOf(e.type), occurredAt: e.occurredAt, receivedAt: e.receivedAt,
    actor: e.actor, refEventId: e.refEventId, origem: e.origem, payload: e.payload, hash: e.hash,
  }));

  function detail(st, user, baseUrl) {
    const parte = ['tac', 'destino', 'transportadora', 'admin'].includes(user.role);
    return {
      op: st.op, resumo: summary(st), timeline: timeline(store.forOp(st.op.id)),
      apuracao: D.apurar(st), apuracoes: st.apuracoes.length, alertas: D.alertas(st), acoes: D.nextActions(st, user),
      financeiro: { ...st.financeiro, pagamentos: timeline(st.pagamentos), origens: D.ORIGENS_PAGAMENTO },
      links: parte && baseUrl ? linksAtivos(st, baseUrl) : [],
      dossies: st.dossies.map((d) => ({ hash: d.payload.hash, geradoEm: d.occurredAt, por: d.actor.name })),
      juridico: { elegivel: D.elegivelJuridico(st), status: st.statusJuridico, historico: timeline(st.juridico) },
      divergenciasAbertas: st.divergenciasAbertas.map((d) => d.id),
      referencia: D.pontoReferencia(st), limiteDeslocamentoM: D.LIMITE_DESLOCAMENTO_M,
      pode: Object.fromEntries(D.PERMISSOES[user.role].map((p) => [p, true])),
      campos: D.CAMPOS_RETIFICAVEIS, demo,
    };
  }

  function relatorios(user) {
    const sts = allStates().filter((st) => canSee(user, st));
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    const mins = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60000) : null);
    const rows = sts.map((st) => {
      const ms = st.milestones, conf = (t) => ms[t] && st.confirmations[ms[t].id];
      const ap = st.apuracoes.length ? st.apuracoes[st.apuracoes.length - 1].payload : null;
      return {
        id: st.op.id, codigo: st.op.codigo, tipo: st.op.tipo, destinoNome: st.op.destinoNome, placa: st.op.placa, nfe: st.op.nfe || null,
        statusCode: st.statusCode, status: st.status, tempoMin: ap ? ap.tempoMin : null, excedeu: ap ? ap.excedeu : null,
        devido: st.financeiro.devido, pago: st.financeiro.pago, saldo: st.financeiro.saldo,
        divergencias: st.divergences.length, deslocamentos: st.ocorrencias.filter((o) => o.type === 'DESLOCAMENTO_FORA_DO_LIMITE').length,
        chegadaConfirmacaoMin: mins(ms.CHEGADA && ms.CHEGADA.occurredAt, conf('CHEGADA') && conf('CHEGADA').occurredAt),
        chegadaInicioMin: mins(ms.CHEGADA && ms.CHEGADA.occurredAt, ms.INICIO && ms.INICIO.occurredAt),
        inicioTerminoMin: mins(ms.INICIO && ms.INICIO.occurredAt, ms.TERMINO && ms.TERMINO.occurredAt),
        comFoto: !!(ms.CHEGADA && ms.CHEGADA.payload.photo), comGps: !!(ms.CHEGADA && ms.CHEGADA.payload.gps && !ms.CHEGADA.payload.gps.erro),
        semConfirmacao: Object.keys(D.CONFIRMATIONS).some((t) => ms[t] && !st.confirmations[ms[t].id]),
        encaminhada: !!st.encaminhado, statusJuridico: st.statusJuridico, dossies: st.dossies.length,
      };
    });
    const ap = rows.filter((r) => r.tempoMin != null);
    const sum = (k) => D.round2(rows.reduce((s, r) => s + (r[k] || 0), 0));
    const devido = sum('devido'), pago = sum('pago');
    const nn = (k) => rows.map((r) => r[k]).filter((v) => v != null);
    const porNf = {};
    for (const r of rows) if (r.nfe) (porNf[r.nfe] = porNf[r.nfe] || []).push(r);
    return {
      totais: {
        operacoes: rows.length, concluidas: sts.filter((s) => s.saida).length, tempoMedioMin: avg(ap.map((r) => r.tempoMin)),
        acimaDoLimite: ap.filter((r) => r.excedeu).length, devido, pago, saldo: D.round2(devido - pago),
        percentualRecuperado: devido ? Math.round((Math.min(pago, devido) / devido) * 1000) / 10 : null,
        comDivergencia: rows.filter((r) => r.divergencias).length, deslocamentos: sum('deslocamentos'),
        tempoMedioConfirmacaoMin: avg(nn('chegadaConfirmacaoMin')), tempoMedioChegadaInicioMin: avg(nn('chegadaInicioMin')), tempoMedioInicioTerminoMin: avg(nn('inicioTerminoMin')),
        encaminhadas: rows.filter((r) => r.encaminhada).length, comFoto: rows.filter((r) => r.comFoto).length, comGps: rows.filter((r) => r.comGps).length,
        semConfirmacao: rows.filter((r) => r.semConfirmacao).length, dossies: sum('dossies'),
      },
      operacoes: rows,
      relacoesCargaDescarga: Object.entries(porNf).filter(([, rs]) => rs.some((r) => r.tipo === 'CARGA') && rs.some((r) => r.tipo === 'DESCARGA'))
        .map(([nfe, rs]) => ({ nfe, operacoes: rs.map((r) => ({ id: r.id, codigo: r.codigo, tipo: r.tipo, destinoNome: r.destinoNome, tempoMin: r.tempoMin, devido: r.devido })) })),
    };
  }

  // ---------- SSE ----------
  const streams = new Set();
  store.on('append', (ev) => {
    const st = ev.opId ? stateOf(ev.opId) : null;
    for (const s of streams) if ((st && canSee(s.user, st)) || (!st && s.user.role === 'admin')) s.res.write(`data: ${JSON.stringify({ opId: ev.opId, type: ev.type })}\n\n`);
  });
  store.on('reset', () => { for (const s of streams) { s.res.write(`data: ${JSON.stringify({ reset: true })}\n\n`); s.res.end(); } streams.clear(); });
  const ping = setInterval(() => { for (const s of streams) s.res.write(': ping\n\n'); }, 25000);
  ping.unref();

  // ---------- dados iniciais ----------
  function seedAll() {
    const info = seed(dir, store, { quiet });
    const { ops, users, at } = info;
    const carla = users.carla;
    // Operações históricas: apuração, dossiê, pagamento parcial e encerramento.
    recordApuracao(stateOf(ops.op4), SYS, at(-2, 10, 51));
    buildDossie(stateOf(ops.op4), SYS, at(-2, 10, 51));
    store.append({ opId: ops.op4, type: 'OPERACAO_ENCERRADA', actor: actorOf(carla), origem: 'portal', occurredAt: at(-2, 14, 0), payload: { note: 'Carga dentro do Limite de Estadia. Sem valor devido.' } });
    recordApuracao(stateOf(ops.op3), SYS, at(-1, 17, 42));
    buildDossie(stateOf(ops.op3), SYS, at(-1, 17, 42));
    store.append({ opId: ops.op3, type: 'PAGAMENTO_REGISTRADO', actor: actorOf(carla), origem: 'portal', occurredAt: at(0, 8, 30) < new Date().toISOString() ? at(0, 8, 30) : new Date().toISOString(),
      payload: { valor: 400, origem: 'pagamento_comercial', note: 'Pagamento parcial informado pelo destinatário.' } });
  }
  if (dir.empty && seedIfEmpty) seedAll();
  function resetDemo() { store.reset(); dir.reset(); seedAll(); }
  // Dados de demonstração da versão 1.0 (sem transportadora) são recriados no formato 2.0.
  if (demo && !dir.empty && !dir.data.orgs.some((o) => o.tipo === 'transportadora')) {
    if (!quiet) console.log('Dados da versão anterior encontrados: recriando a demonstração no formato 2.0.');
    resetDemo();
  }

  // ---------- HTTP ----------
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const fail = (res, status, code, message) => send(res, status, { erro: code, mensagem: message });
  const meta = (req) => ({ ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || null, dispositivo: String(req.headers['user-agent'] || '').slice(0, 200) || null });
  const baseUrlOf = (req) => process.env.ESTADIA_BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new D.DomainError(413, 'MUITO_GRANDE', 'Envio maior que o permitido.')); req.destroy(); return; } chunks.push(c); });
      req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new D.DomainError(400, 'JSON_INVALIDO', 'Corpo da requisição inválido.')); } });
      req.on('error', reject);
    });
  }

  function parseFile(dataUrl, kinds = ['image']) {
    const m = /^data:((image\/(?:jpeg|png|webp))|(audio\/(?:webm|ogg|mp4|mpeg)))(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m || !kinds.some((k) => m[1].startsWith(k))) throw new D.DomainError(400, 'ARQUIVO_INVALIDO', kinds.includes('audio') ? 'Formato de áudio inválido.' : 'Formato de foto inválido (use JPEG, PNG ou WebP).');
    const buf = Buffer.from(m[4], 'base64');
    if (buf.length > 6 * 1024 * 1024) throw new D.DomainError(413, 'ARQUIVO_GRANDE', 'Arquivo maior que 6 MB.');
    return store.savePhoto(buf, m[1]);
  }

  function serveFile(res, file) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (/^\/c\/[A-Za-z0-9_-]{20,}$/.test(rel)) return serveFile(res, path.join(publicDir, 'confirmar.html'));
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir)) return fail(res, 403, 'PROIBIDO', 'Caminho inválido.');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file);
    if (path.extname(rel)) return fail(res, 404, 'NAO_ENCONTRADO', 'Arquivo não encontrado.');
    return serveFile(res, path.join(publicDir, 'index.html'));
  }

  // ---------- página pública do link (sem login) ----------
  async function handlePublic(req, res, token, action) {
    const links = store.loadLinks();
    const link = links[token];
    if (!link) return fail(res, 404, 'LINK_INVALIDO', 'Link inválido. Confira se copiou o endereço completo.');
    const st = stateOf(link.opId);
    const ref = Object.values(st.milestones).find((e) => e.id === link.refEventId);
    const conf = st.confirmations[link.refEventId];
    const expirado = Date.parse(link.expiraEm) < Date.now();
    const m = meta(req);
    const viaLink = { userId: `link:${link.id}`, name: `${link.destinatario.nome} (via link)`, role: 'destino', orgId: st.op.destinoOrgId };

    if (action === 'foto') {
      const file = ref && ref.payload.photo && store.photoPath(ref.payload.photo.file);
      if (!file || expirado) return fail(res, 404, 'SEM_FOTO', 'Foto indisponível.');
      return serveFile(res, file);
    }
    if (action === 'renovar' && req.method === 'POST') {
      const recente = st.links.some((l) => l.type === 'LINK_RENOVACAO_SOLICITADA' && l.payload.linkId === link.id && Date.now() - Date.parse(l.receivedAt) < 3600000);
      if (!recente) store.append({ opId: st.op.id, type: 'LINK_RENOVACAO_SOLICITADA', actor: viaLink, origem: 'link_whatsapp', ...m, payload: { linkId: link.id } });
      return send(res, 200, { ok: true, mensagem: 'Pedido registrado. A transportadora ou o motorista enviará um novo link.' });
    }
    const info = {
      operacao: { codigo: st.op.codigo, tipo: st.op.tipo, placa: st.op.placa, implemento: st.op.implemento || null, tac: st.op.tacNome || null, localNome: st.op.localNome, destinoNome: st.op.destinoNome },
      acao: D.labelOf(link.confirmType), botao: { CHEGADA_CONFIRMADA: 'Confirmar chegada', INICIO_CONFIRMADO: 'Confirmar início', TERMINO_CONFIRMADO: 'Confirmar término' }[link.confirmType] || 'Confirmar', registro: ref ? { label: ref.type === 'CHEGADA' ? 'Chegada registrada pelo motorista' : D.labelOf(ref.type), em: ref.occurredAt, gps: ref.payload.gps || null, temFoto: !!ref.payload.photo } : null,
      expiraEm: link.expiraEm, destinatario: link.destinatario.nome,
      confirmado: conf ? { em: conf.occurredAt, por: conf.actor.name } : null,
    };
    if (expirado && !conf) {
      if (!st.links.some((l) => l.type === 'LINK_EXPIRADO_ACESSO' && l.payload.linkId === link.id)) store.append({ opId: st.op.id, type: 'LINK_EXPIRADO_ACESSO', actor: viaLink, origem: 'link_whatsapp', ...m, payload: { linkId: link.id } });
      return send(res, 410, { erro: 'LINK_EXPIRADO', mensagem: 'Este link expirou.', ...info });
    }
    if (action === 'confirmar' && req.method === 'POST') {
      if (conf) return send(res, 200, info);
      const b = await readBody(req);
      const nome = String(b.nome || '').trim().slice(0, 80);
      const actor = nome ? { ...viaLink, name: `${nome} (via link)` } : viaLink;
      store.append({ opId: st.op.id, type: link.confirmType, actor, origem: 'link_whatsapp', ...m, refEventId: link.refEventId, payload: { linkId: link.id } });
      link.usadoEm = new Date().toISOString();
      store.saveLinks(links);
      const s2 = stateOf(st.op.id);
      return send(res, 201, { ...info, confirmado: { em: s2.confirmations[link.refEventId].occurredAt, por: s2.confirmations[link.refEventId].actor.name } });
    }
    if (!st.links.some((l) => l.type === 'LINK_VISUALIZADO' && l.payload.linkId === link.id)) {
      store.append({ opId: st.op.id, type: 'LINK_VISUALIZADO', actor: viaLink, origem: 'link_whatsapp', ...m, payload: { linkId: link.id } });
    }
    return send(res, 200, info);
  }

  // ---------- rotas autenticadas ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (!p.startsWith('/api/')) return serveStatic(req, res, url);
    if (p === '/api/health') return send(res, 200, { ok: true, eventos: store.events.length });

    let m;
    if ((m = /^\/api\/public\/link\/([A-Za-z0-9_-]{20,})(?:\/(foto|confirmar|renovar))?$/.exec(p))) return handlePublic(req, res, m[1], m[2]);

    if (p === '/api/login' && req.method === 'POST') {
      const { email, senha } = await readBody(req);
      const r = dir.login(email, senha);
      return r ? send(res, 200, r) : fail(res, 401, 'CREDENCIAIS', 'E-mail ou senha incorretos.');
    }

    const h = req.headers.authorization || '';
    const user = dir.verify(h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token'));
    if (!user) return fail(res, 401, 'NAO_AUTENTICADO', 'Sessão expirada. Entre novamente.');
    const mt = meta(req);
    const append = (data) => store.append({ actor: actorOf(user), origem: origemDe(user), ...mt, ...data }).event;
    const baseUrl = baseUrlOf(req);

    if (p === '/api/me') return send(res, 200, { ...publicUser(user, dir.org(user.orgId)), permissoes: D.PERMISSOES[user.role] });

    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      const s = { res, user };
      streams.add(s);
      req.on('close', () => streams.delete(s));
      return;
    }

    if (p === '/api/config') {
      return send(res, 200, { demo, regraAtual: D.ruleFor(), regras: D.RULES, limiteDeslocamentoM: D.LIMITE_DESLOCAMENTO_M, status: D.STATUS,
        destinos: dir.data.orgs.filter((o) => o.tipo === 'destino').map((o) => ({ id: o.id, nome: o.nome })), permissoes: D.PERMISSOES });
    }

    if (p === '/api/operations' && req.method === 'GET') return send(res, 200, allStates().filter((st) => canSee(user, st)).map(summary).reverse());

    if (p === '/api/operations' && req.method === 'POST') {
      if (!D.can(user, 'criar')) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não cadastra operações.');
      const b = await readBody(req);
      const placa = normPlaca(b.placa);
      if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) return fail(res, 400, 'PLACA', 'Placa inválida. Use o formato ABC1D23 ou ABC1234.');
      if (!['CARGA', 'DESCARGA'].includes(b.tipo)) return fail(res, 400, 'TIPO', 'Informe se é operação de carga ou descarga.');
      const cap = Number(String(b.capacidadeToneladas).replace(',', '.'));
      if (!(cap > 0 && cap < 100)) return fail(res, 400, 'CAPACIDADE', 'Informe a capacidade do veículo em toneladas.');
      const dest = dir.org(b.destinoOrgId);
      if (!dest || dest.tipo !== 'destino') return fail(res, 400, 'DESTINO', 'Selecione o embarcador/destinatário.');
      const codigo = b.codigo ? String(b.codigo).trim().toUpperCase().slice(0, 30) : `OP-${new Date().getFullYear()}-${String(store.opIds().length + 1).padStart(4, '0')}`;
      if (allStates().some((st) => st.op.codigo === codigo)) return fail(res, 409, 'DUPLICADA', `Já existe a operação ${codigo}.`);
      const transp = user.role === 'transportadora' ? dir.org(user.orgId) : (dir.data.orgs.find((o) => o.tipo === 'transportadora') || dir.org(user.orgId));
      const numOrNull = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return v === '' || v == null || !Number.isFinite(n) ? null : n; };
      const s = (v, n = 80) => String(v || '').trim().slice(0, n) || null;
      const opId = crypto.randomUUID();
      append({ opId, type: 'OPERACAO_CRIADA', payload: {
        codigo, tipo: b.tipo, transportadoraOrgId: transp.id, transportadoraNome: transp.nome, destinoOrgId: dest.id, destinoNome: dest.nome,
        placa, implemento: s(b.implemento, 40), capacidadeToneladas: cap, pesoToneladas: numOrNull(b.pesoToneladas), volume: s(b.volume, 40), mercadoria: s(b.mercadoria, 60),
        nfe: s(b.nfe, 60), cte: s(b.cte, 60), mdfe: s(b.mdfe, 60), origem: s(b.origem), localNome: s(b.localNome) || dest.nome,
        lat: numOrNull(b.lat), lng: numOrNull(b.lng), dataPrevista: b.dataPrevista ? new Date(b.dataPrevista).toISOString() : null,
        responsavelNome: s(b.responsavelNome), responsavelTelefone: s(b.responsavelTelefone, 30), observacoes: s(b.observacoes, 500),
      } });
      return send(res, 201, detail(stateOf(opId), user, baseUrl));
    }

    if (p === '/api/operations/identify' && req.method === 'POST') {
      if (user.role !== 'tac') return fail(res, 403, 'SEM_PERMISSAO', 'Somente o TAC identifica a operação.');
      const b = await readBody(req);
      const codigo = String(b.codigo || '').trim().toUpperCase();
      const placa = normPlaca(b.placa || user.placa);
      const st = allStates().find((x) => x.op.codigo === codigo);
      if (!st || st.op.placa !== placa) return fail(res, 404, 'NAO_ENCONTRADA', 'Nenhuma operação com este código para esta placa.');
      if (st.op.tacUserId && st.op.tacUserId !== user.id) return fail(res, 409, 'VINCULADA', 'Esta operação já está vinculada a outro motorista.');
      if (!st.op.tacUserId) append({ opId: st.op.id, type: 'OPERACAO_IDENTIFICADA', clientEventId: b.clientEventId, occurredAt: b.occurredAt ? new Date(Math.min(Date.parse(b.occurredAt) || Date.now(), Date.now())).toISOString() : undefined, payload: { placa, via: 'codigo' } });
      return send(res, 200, detail(stateOf(st.op.id), user, baseUrl));
    }

    // Amélia: interpretar e confirmar (épico 02)
    if (p === '/api/amelia/interpretar' && req.method === 'POST') {
      if (user.role !== 'tac') return fail(res, 403, 'SEM_PERMISSAO', 'A Amélia atende o TAC.');
      const b = await readBody(req);
      const r = Amelia.interpretar(b.texto);
      if (!r.compreendido) return send(res, 200, { ...r, candidatos: [], mensagem: 'Não consegui identificar dados da operação. Tente informar a placa, o tipo (carga ou descarga) e a nota fiscal.' });
      const placa = (r.entidades.find((e) => e.campo === 'placa') || {}).valor || user.placa;
      const codigo = (r.entidades.find((e) => e.campo === 'codigo') || {}).valor;
      const candidatos = allStates().filter((st) => !st.encerrada && !st.saida && st.op.placa === placa && (!st.op.tacUserId || st.op.tacUserId === user.id) && (!codigo || st.op.codigo === codigo))
        .map((st) => ({ id: st.op.id, codigo: st.op.codigo, tipo: st.op.tipo, localNome: st.op.localNome, destinoNome: st.op.destinoNome, dataPrevista: st.op.dataPrevista || null, comparacao: Amelia.comparar(r.entidades, st.op) }));
      return send(res, 200, { ...r, placaConsiderada: placa, candidatos, mensagem: candidatos.length ? null : `Nenhuma operação aberta encontrada para a placa ${placa}. Confira os dados ou fale com a transportadora.` });
    }

    if (p === '/api/amelia/confirmar' && req.method === 'POST') {
      if (user.role !== 'tac') return fail(res, 403, 'SEM_PERMISSAO', 'A Amélia atende o TAC.');
      const b = await readBody(req);
      const st = stateOf(b.opId);
      if (!st || st.encerrada) return fail(res, 404, 'NAO_ENCONTRADA', 'Operação não encontrada.');
      if (st.op.tacUserId && st.op.tacUserId !== user.id) return fail(res, 409, 'VINCULADA', 'Esta operação já está vinculada a outro motorista.');
      const r = Amelia.interpretar(b.texto);
      if (!r.entidades.some((e) => e.campo === 'placa' && e.valor === st.op.placa) && st.op.placa !== user.placa) return fail(res, 409, 'PLACA', 'A placa informada não corresponde à operação.');
      if (b.clientEventId && store.byClientId.has(b.clientEventId)) return send(res, 200, detail(st, user, baseUrl));
      const audio = b.audio ? parseFile(b.audio, ['audio']) : null;
      if (!st.op.tacUserId) append({ opId: st.op.id, type: 'OPERACAO_IDENTIFICADA', origem: 'amelia', payload: { placa: st.op.placa, via: 'amelia' } });
      append({ opId: st.op.id, type: 'DADOS_INFORMADOS', origem: 'amelia', clientEventId: b.clientEventId, payload: {
        canal: audio ? 'audio' : 'texto', texto: r.texto, entidades: Amelia.comparar(r.entidades, st.op), audio } });
      return send(res, 200, detail(stateOf(st.op.id), user, baseUrl));
    }

    if (p === '/api/relatorios') {
      if (!D.can(user, 'relatorios')) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não acessa relatórios.');
      return send(res, 200, relatorios(user));
    }

    if ((m = /^\/api\/operations\/([0-9a-f-]{36})(\/[a-z-]+)?(?:\/([0-9a-f-]{36})\/(enviado))?$/.exec(p))) {
      const st = stateOf(m[1]);
      if (!canSee(user, st)) return fail(res, 404, 'NAO_ENCONTRADA', 'Operação não encontrada.');
      const sub = m[2] || '';
      const opId = st.op.id;
      const fresh = () => detail(stateOf(opId), user, baseUrl);

      if (!sub && req.method === 'GET') return send(res, 200, detail(st, user, baseUrl));

      if (sub === '/events' && req.method === 'POST') {
        const b = await readBody(req);
        if (b.clientEventId && store.byClientId.has(b.clientEventId)) return send(res, 200, { duplicado: true, evento: store.byClientId.get(b.clientEventId), detalhe: fresh() });
        const v = D.validateEvent(st, user, { ...b, hasPhoto: !!b.photo });
        const payload = {};
        for (const k of ['gps', 'note', 'alegadoEm', 'resolucao', 'valor', 'origem', 'situacao']) if (v[k] !== undefined && v[k] !== null) payload[k] = v[k];
        if (b.photo) payload.photo = parseFile(b.photo);
        const ev = append({ opId, type: v.type, occurredAt: v.occurredAt, refEventId: v.refEventId, clientEventId: b.clientEventId, payload });
        aposRegistro(stateOf(opId), ev);
        return send(res, 201, { duplicado: false, evento: ev, detalhe: fresh() });
      }

      if (sub === '/posicao' && req.method === 'POST') {
        if (user.role !== 'tac' || st.op.tacUserId !== user.id) return fail(res, 403, 'SEM_PERMISSAO', 'Somente o TAC da operação envia posição.');
        const b = await readBody(req);
        if (b.simulado && !demo) return fail(res, 403, 'DESATIVADO', 'Simulação desativada.');
        const gps = { lat: Number(b.lat), lng: Number(b.lng), acc: Number(b.acc) || null };
        if (!Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) return fail(res, 400, 'GPS', 'Posição inválida.');
        const ref = D.pontoReferencia(st);
        const r = checarDeslocamento(st, gps, undefined, b.simulado ? { simulado: true } : {});
        return send(res, 200, { ...r, distanciaM: ref ? D.haversineM(gps, ref) : null, limiteM: D.LIMITE_DESLOCAMENTO_M });
      }

      if (m[4] === 'enviado' && sub === '/links' && req.method === 'POST') {
        append({ opId, type: 'LINK_ENVIADO', payload: { linkId: m[3], canal: 'whatsapp', modo: 'manual' } });
        return send(res, 201, { ok: true });
      }

      if (sub === '/links' && req.method === 'POST') {
        if (!['tac', 'destino', 'transportadora', 'admin'].includes(user.role)) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não envia links.');
        const pend = ['CHEGADA', 'INICIO', 'TERMINO'].map((t) => st.milestones[t]).filter((e) => e && e.actor.role === 'tac' && !st.confirmations[e.id]);
        if (!pend.length) return fail(res, 409, 'SEM_PENDENCIA', 'Não há confirmação pendente do destino.');
        for (const e of pend) createLink(st, e, D.CONFIRMATIONS[e.type].type, actorOf(user));
        return send(res, 201, fresh());
      }

      if (sub === '/apuracao' && req.method === 'POST') {
        if (!D.can(user, 'gerar_dossie')) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não solicita apuração.');
        if (!recordApuracao(st, actorOf(user))) return fail(res, 409, 'SEM_MARCO', 'A apuração começa na confirmação da chegada.');
        return send(res, 201, fresh());
      }

      if (sub === '/dossie' && req.method === 'POST') {
        if (!D.can(user, 'gerar_dossie')) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não gera dossiês.');
        if (!st.milestones.CHEGADA) return fail(res, 409, 'SEM_MARCO', 'Não há registros suficientes para o dossiê.');
        return send(res, 201, { hash: buildDossie(st, user), detalhe: fresh() });
      }

      if (sub === '/encaminhar' && req.method === 'POST') {
        if (!D.can(user, 'encaminhar')) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não encaminha ao jurídico.');
        const el = D.elegivelJuridico(st);
        if (!el.apto) return fail(res, 409, 'NAO_APTO', el.motivos.join(' '));
        const b = await readBody(req);
        const adv = dir.data.orgs.find((o) => o.tipo === 'advocacia');
        append({ opId, type: 'ENCAMINHADO_JURIDICO', payload: { dossieHash: st.dossies[st.dossies.length - 1].payload.hash, advocaciaOrgId: adv.id, advocaciaNome: adv.nome,
          valorEncaminhado: st.financeiro.saldo, note: String(b.note || '').slice(0, 500) || undefined } });
        return send(res, 201, fresh());
      }

      if (sub === '/juridico-status' && req.method === 'POST') {
        if (user.role !== 'advocacia') return fail(res, 403, 'SEM_PERMISSAO', 'Somente o jurídico registra o retorno.');
        const b = await readBody(req);
        const status = ['RECEBIDO', 'EM_ANALISE', 'CONCLUIDO'].includes(b.status) ? b.status : null;
        if (!status) return fail(res, 400, 'STATUS', 'Status inválido.');
        append({ opId, type: 'JURIDICO_STATUS', payload: { status, note: String(b.note || '').slice(0, 1000) || undefined, resultado: String(b.resultado || '').slice(0, 1000) || undefined } });
        return send(res, 201, fresh());
      }

      if (sub === '/retificar' && req.method === 'POST') {
        if (!D.can(user, 'editar')) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não retifica dados.');
        if (st.encerrada) return fail(res, 409, 'ENCERRADA', 'Operação encerrada.');
        const b = await readBody(req);
        if (!D.CAMPOS_RETIFICAVEIS[b.campo]) return fail(res, 400, 'CAMPO', 'Campo não pode ser retificado.');
        const motivo = String(b.motivo || '').trim();
        if (motivo.length < 5) return fail(res, 400, 'MOTIVO', 'Informe o motivo da retificação.');
        let novo = String(b.novo ?? '').trim().slice(0, 200);
        if (['capacidadeToneladas', 'pesoToneladas'].includes(b.campo)) { novo = Number(novo.replace(',', '.')); if (!(novo > 0 && novo < 100)) return fail(res, 400, 'VALOR', 'Informe um valor em toneladas.'); }
        append({ opId, type: 'OPERACAO_RETIFICADA', payload: { campo: b.campo, rotulo: D.CAMPOS_RETIFICAVEIS[b.campo], anterior: st.op[b.campo] ?? null, novo, motivo: motivo.slice(0, 500) } });
        return send(res, 201, fresh());
      }

      if (sub === '/encerrar' && req.method === 'POST') {
        if (!D.can(user, 'encerrar')) return fail(res, 403, 'SEM_PERMISSAO', 'Seu perfil não encerra operações.');
        if (st.encerrada) return fail(res, 409, 'ENCERRADA', 'Operação já encerrada.');
        if (!st.saida || !st.apuracoes.length) return fail(res, 409, 'NAO_APTA', 'Encerre depois da saída e da apuração.');
        const b = await readBody(req);
        append({ opId, type: 'OPERACAO_ENCERRADA', payload: { note: String(b.note || '').slice(0, 500) || undefined, statusAnterior: st.statusCode, saldo: st.financeiro.saldo } });
        return send(res, 201, fresh());
      }
    }

    if ((m = /^\/api\/(?:photos|evidencias)\/([a-f0-9]{64}\.(?:jpg|png|webp|webm|ogg|m4a|mp3))$/.exec(p))) {
      const owner = store.events.find((e) => e.payload && ((e.payload.photo && e.payload.photo.file === m[1]) || (e.payload.audio && e.payload.audio.file === m[1])));
      if (!owner || !canSee(user, stateOf(owner.opId))) return fail(res, 404, 'NAO_ENCONTRADA', 'Evidência não encontrada.');
      return serveFile(res, store.photoPath(m[1]));
    }

    if ((m = /^\/api\/dossies\/([a-f0-9]{64})$/.exec(p))) {
      const doc = store.loadDossie(m[1]);
      const owner = doc && store.events.find((e) => e.type === 'DOSSIE_GERADO' && e.payload.hash === m[1]);
      if (!owner || !canSee(user, stateOf(owner.opId))) return fail(res, 404, 'NAO_ENCONTRADO', 'Dossiê não encontrado.');
      return send(res, 200, doc);
    }

    if (p.startsWith('/api/admin/') && user.role !== 'admin') return fail(res, 403, 'SEM_PERMISSAO', 'Somente administradores.');
    if (p === '/api/admin/reset-demo' && req.method === 'POST') {
      if (!demo) return fail(res, 403, 'DESATIVADO', 'O reinício da demonstração está desativado neste ambiente.');
      resetDemo();
      return send(res, 200, { ok: true, mensagem: 'Demonstração reiniciada.' });
    }
    if (p === '/api/admin/integrity') return send(res, 200, store.verify());
    if (p === '/api/admin/users' && req.method === 'GET') return send(res, 200, { orgs: dir.data.orgs, users: dir.data.users.map((x) => publicUser(x, dir.org(x.orgId))), permissoes: D.PERMISSOES });
    if (p === '/api/admin/users' && req.method === 'POST') {
      const b = await readBody(req);
      if (!D.PERMISSOES[b.role]) return fail(res, 400, 'PERFIL', 'Perfil inválido.');
      if (!dir.org(b.orgId)) return fail(res, 400, 'ORG', 'Organização inválida.');
      if (!/^\S+@\S+\.\S+$/.test(String(b.email || ''))) return fail(res, 400, 'EMAIL', 'E-mail inválido.');
      if (String(b.senha || '').length < 6) return fail(res, 400, 'SENHA', 'A senha precisa de ao menos 6 caracteres.');
      const nu = dir.addUser({ email: b.email, senha: b.senha, nome: String(b.nome || b.email).slice(0, 80), role: b.role, orgId: b.orgId, placa: b.placa ? normPlaca(b.placa) : undefined });
      append({ type: 'USUARIO_CRIADO', payload: { userId: nu.id, email: nu.email, role: nu.role, orgId: nu.orgId } });
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
    console.log(`Estadia BR rodando em http://localhost:${port}`);
    console.log(`Dados em ${dataDir}`);
  });
}

module.exports = { createApp, sha256 };
