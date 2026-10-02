'use strict';
// Usuários, organizações e tokens de sessão assinados (HMAC).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 32);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

class Directory {
  constructor(dir) {
    this.file = path.join(dir, 'directory.json');
    const secretFile = path.join(dir, 'secret.key');
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    this.secret = process.env.ESTADIA_SECRET || fs.readFileSync(secretFile, 'utf8').trim();
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { orgs: [], users: [] };
  }

  reset() {
    this.data = { orgs: [], users: [] };
    this.save();
  }

  get empty() {
    return this.data.users.length === 0;
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  addOrg(org) {
    this.data.orgs.push(org);
    this.save();
    return org;
  }

  addUser({ email, senha, ...rest }) {
    email = String(email).trim().toLowerCase();
    if (this.data.users.some((u) => u.email === email)) throw Object.assign(new Error('E-mail já cadastrado.'), { status: 409 });
    const user = { id: crypto.randomUUID(), email, senhaHash: hashPassword(senha), ...rest };
    this.data.users.push(user);
    this.save();
    return user;
  }

  org(id) {
    return this.data.orgs.find((o) => o.id === id) || null;
  }

  user(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  login(email, senha) {
    const u = this.data.users.find((x) => x.email === String(email || '').trim().toLowerCase());
    if (!u || !checkPassword(senha, u.senhaHash)) return null;
    return { token: this.sign(u.id), user: publicUser(u, this.org(u.orgId)) };
  }

  sign(userId) {
    const body = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verify(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const { uid, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (Date.now() > exp) return null;
      return this.user(uid);
    } catch {
      return null;
    }
  }
}

function publicUser(u, org) {
  return { id: u.id, email: u.email, nome: u.nome, role: u.role, orgId: u.orgId, orgNome: org ? org.nome : null, placa: u.placa || null };
}

module.exports = { Directory, publicUser, hashPassword, checkPassword };
