'use strict';
// Log de eventos somente-anexação (append-only) com cadeia de hash.
// Cada evento guarda o hash do anterior; qualquer alteração no arquivo quebra a cadeia.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const GENESIS = 'GENESIS';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' };
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hashEvent = (ev) => {
  const { hash, ...rest } = ev;
  return sha256(JSON.stringify(rest));
};

class EventStore extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'dossies'), { recursive: true });
    this.file = path.join(dir, 'events.jsonl');
    this.events = [];
    this.byClientId = new Map();
    this.lastHash = GENESIS;
    if (fs.existsSync(this.file)) {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        this.events.push(ev);
        if (ev.clientEventId) this.byClientId.set(ev.clientEventId, ev);
        this.lastHash = ev.hash;
      }
    }
  }

  /** Anexa um evento. Se clientEventId já existir, devolve o original (idempotência). */
  append(data) {
    if (data.clientEventId && this.byClientId.has(data.clientEventId)) {
      return { event: this.byClientId.get(data.clientEventId), duplicate: true };
    }
    const ev = {
      seq: this.events.length + 1,
      id: crypto.randomUUID(),
      opId: data.opId || null,
      type: data.type,
      occurredAt: data.occurredAt || new Date().toISOString(),
      receivedAt: data.receivedAt || new Date().toISOString(),
      actor: data.actor,
      refEventId: data.refEventId || null,
      clientEventId: data.clientEventId || null,
      origem: data.origem || 'sistema',
      ip: data.ip || null,
      dispositivo: data.dispositivo || null,
      payload: data.payload || {},
      prevHash: this.lastHash,
    };
    ev.hash = hashEvent(ev);
    fs.appendFileSync(this.file, JSON.stringify(ev) + '\n');
    this.events.push(ev);
    if (ev.clientEventId) this.byClientId.set(ev.clientEventId, ev);
    this.lastHash = ev.hash;
    this.emit('append', ev);
    return { event: ev, duplicate: false };
  }

  /** Apaga todos os dados (somente para reiniciar a demonstração). */
  reset() {
    fs.writeFileSync(this.file, '');
    if (fs.existsSync(this.linksFile)) fs.rmSync(this.linksFile);
    for (const sub of ['photos', 'dossies']) {
      const d = path.join(this.dir, sub);
      for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { force: true });
    }
    this.events = [];
    this.byClientId.clear();
    this.lastHash = GENESIS;
    this.emit('reset');
  }

  forOp(opId) {
    return this.events.filter((e) => e.opId === opId);
  }

  opIds() {
    return this.events.filter((e) => e.type === 'OPERACAO_CRIADA').map((e) => e.opId);
  }

  /** Recalcula a cadeia inteira. Retorna o primeiro ponto de quebra, se houver. */
  verify() {
    let prev = GENESIS;
    for (const ev of this.events) {
      if (ev.prevHash !== prev) return { ok: false, seq: ev.seq, motivo: 'Elo quebrado com o evento anterior' };
      if (hashEvent(ev) !== ev.hash) return { ok: false, seq: ev.seq, motivo: 'Conteúdo do evento alterado' };
      prev = ev.hash;
    }
    return { ok: true, eventos: this.events.length, ultimoHash: prev };
  }

  savePhoto(buffer, mime) {
    const hash = sha256(buffer);
    const ext = EXT[mime] || 'jpg';
    const file = path.join(this.dir, 'photos', `${hash}.${ext}`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
    return { sha256: hash, mime, bytes: buffer.length, file: `${hash}.${ext}` };
  }

  photoPath(name) {
    if (!/^[a-f0-9]{64}\.(jpg|png|webp|webm|ogg|m4a|mp3)$/.test(name)) return null;
    const p = path.join(this.dir, 'photos', name);
    return fs.existsSync(p) ? p : null;
  }

  // Links de confirmação: o token fica fora do log (no log vai apenas o hash dele).
  get linksFile() { return path.join(this.dir, 'links.json'); }
  loadLinks() { return fs.existsSync(this.linksFile) ? JSON.parse(fs.readFileSync(this.linksFile, 'utf8')) : {}; }
  saveLinks(links) { fs.writeFileSync(this.linksFile, JSON.stringify(links, null, 2)); }

  saveDossie(content) {
    const body = JSON.stringify(content);
    const hash = sha256(body);
    fs.writeFileSync(path.join(this.dir, 'dossies', `${hash}.json`), JSON.stringify({ hash, content }));
    return hash;
  }

  loadDossie(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    const p = path.join(this.dir, 'dossies', `${hash}.json`);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  }
}

module.exports = { EventStore, sha256, hashEvent, GENESIS, EXT };
