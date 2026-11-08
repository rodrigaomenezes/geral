'use strict';
// WhatsApp por QR Code (portado do Lumen Operações): a mesma técnica do WhatsApp Web/Desktop (biblioteca Baileys).
// A gestão escaneia o QR no celular do número da empresa (Aparelhos conectados) e o Sinapse vira mais um aparelho:
// o que entra aparece aqui, e o que o sistema manda sai pelo número. NÃO é a API oficial da Meta: a tela avisa dos
// cuidados para o número não ser bloqueado. A sessão fica em arquivo (Volume); a conexão vive na memória do processo
// (uma réplica). Ligações com o resto do sistema por ganchos (configurar), sem importar outros módulos.

const fs = require('node:fs');
const path = require('node:path');

const sessoes = new Map(); // numeroId → { sock, estado, qr, parar, tentativas, conectouAlgumaVez }
let cfg = { db: null, pasta: null, log: () => {}, aoReceber: async () => {}, aoEco: async () => {}, aoStatus: async () => {} };
let baileys = null;
const silencioso = { level: 'silent', child() { return silencioso; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

function configurar(opcoes) { cfg = { ...cfg, ...opcoes }; if (cfg.pasta) fs.mkdirSync(cfg.pasta, { recursive: true }); }
const usarFalso = () => process.env.SINAPSE_WA_QR_FALSO === '1';
const pastaDa = (id) => path.join(cfg.pasta, String(id));
async function carregarBaileys() {
  if (usarFalso()) return require('./whatsapp-qr-falso');
  if (!baileys) baileys = await import('baileys');
  return baileys;
}
async function marcar(id, campos) {
  const k = Object.keys(campos);
  await cfg.db.query(`UPDATE whatsapp_numeros SET ${k.map((c, i) => `${c} = $${i + 2}`).join(', ')}, atualizado_em = now() WHERE id = $1`, [id, ...k.map((c) => campos[c])]);
}
const numeroRow = async (id) => (await cfg.db.query('SELECT * FROM whatsapp_numeros WHERE id = $1', [id])).rows[0];

// ---------- Ciclo da sessão ----------
async function iniciar(numeroId) {
  const atual = sessoes.get(numeroId);
  if (atual && atual.sock && !atual.parar) return atual;
  const B = await carregarBaileys();
  const { state, saveCreds } = await B.useMultiFileAuthState(pastaDa(numeroId));
  // `doSistema`: ids enviados pelo próprio Sinapse; o eco deles chega antes de o envio gravar o id, e não pode virar
  // uma segunda mensagem "do celular" no histórico. Limitado às últimas 500.
  const s = { estado: 'conectando', qr: null, parar: false, tentativas: atual?.tentativas || 0, conectouAlgumaVez: !!state.creds?.registered, doSistema: new Set() };
  sessoes.set(numeroId, s);
  const opcoes = { auth: state, logger: silencioso, markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false,
    browser: B.Browsers ? B.Browsers.macOS('Sinapse Brobot') : undefined, getMessage: async () => undefined };
  if (B.fetchLatestBaileysVersion && !usarFalso()) { try { opcoes.version = (await B.fetchLatestBaileysVersion()).version; } catch { /* usa a padrão */ } }
  const sock = (B.makeWASocket || B.default)(opcoes);
  s.sock = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => aoMudarConexao(numeroId, s, u, B).catch((e) => cfg.log(`WhatsApp QR (conexão): ${e.message}`)));
  sock.ev.on('messages.upsert', (ev) => aoChegar(numeroId, s, ev).catch((e) => cfg.log(`WhatsApp QR (mensagem): ${e.message}`)));
  sock.ev.on('messages.update', (lista) => lista.forEach((x) => {
    const mapa = { 2: 'enviada', 3: 'entregue', 4: 'lida', 5: 'lida' };
    const st = mapa[x.update?.status];
    if (x.key?.fromMe && st) numeroRow(numeroId).then((n) => cfg.aoStatus(n, x.key.id, st)).catch(() => {});
  }));
  await marcar(numeroId, { status: 'conectando', ultimo_erro: null });
  return s;
}

async function aoMudarConexao(numeroId, s, u, B) {
  if (u.qr) {
    s.qr = await require('qrcode').toDataURL(u.qr, { margin: 1, width: 300 });
    s.estado = 'aguardando_qr';
  }
  if (u.connection === 'open') {
    s.estado = 'conectado'; s.qr = null; s.tentativas = 0; s.conectouAlgumaVez = true;
    const tel = String(s.sock?.user?.id || '').split(':')[0].split('@')[0];
    await marcar(numeroId, { status: 'conectado', ultimo_erro: null, numero_exibicao: tel ? `+${tel}` : null });
  }
  if (u.connection === 'close') {
    const codigo = u.lastDisconnect?.error?.output?.statusCode;
    s.sock = null;
    if (s.parar) return;
    if (codigo === (B.DisconnectReason || {}).loggedOut || codigo === 401) {
      apagarSessao(numeroId); s.estado = 'desconectado'; sessoes.delete(numeroId);
      await marcar(numeroId, { status: 'erro', ultimo_erro: 'A conexão foi encerrada no celular. Escaneie o QR Code de novo.' });
      return;
    }
    if (!s.conectouAlgumaVez && s.estado === 'aguardando_qr' && ++s.tentativas >= 4) {
      s.estado = 'expirado'; sessoes.delete(numeroId);
      await marcar(numeroId, { status: 'erro', ultimo_erro: 'O QR Code expirou sem ser escaneado. Clique em Conectar para gerar outro.' });
      return;
    }
    // Queda de rede ou reinício do WhatsApp: reconecta sozinho, com espera crescente.
    const espera = Math.min(30000, 2000 * 2 ** Math.min(4, s.tentativas || 0));
    s.estado = 'reconectando';
    setTimeout(() => { sessoes.delete(numeroId); iniciar(numeroId).catch((e) => cfg.log(`WhatsApp QR (reconectar): ${e.message}`)); }, espera);
  }
}

function apagarSessao(numeroId) { try { fs.rmSync(pastaDa(numeroId), { recursive: true, force: true }); } catch { /* já não existia */ } }

async function encerrar(numeroId, { sair = true } = {}) {
  const s = sessoes.get(numeroId);
  if (s) { s.parar = true; try { if (sair && s.sock) await s.sock.logout(); } catch { /* já caiu */ } try { s.sock?.end?.(undefined); } catch { /* idem */ } }
  sessoes.delete(numeroId);
  if (sair) apagarSessao(numeroId);
}

/** Desligamento do servidor: fecha as conexões sem sair da conta (a sessão continua salva). */
async function pararTodos() { for (const id of [...sessoes.keys()]) await encerrar(id, { sair: false }); }

const situacao = (numeroId) => { const s = sessoes.get(numeroId); return s ? { estado: s.estado, qr: s.qr } : { estado: 'parado', qr: null }; };

/** No boot, religa os números que estavam conectados (a sessão está salva no Volume). */
async function religarTodos() {
  const r = await cfg.db.query("SELECT id FROM whatsapp_numeros WHERE provedor = 'qr' AND ativo AND status IN ('conectado','conectando')");
  for (const n of r.rows) {
    if (fs.existsSync(pastaDa(n.id))) iniciar(n.id).catch((e) => cfg.log(`WhatsApp QR (religar): ${e.message}`));
    else await marcar(n.id, { status: 'erro', ultimo_erro: 'Sessão não encontrada (o Volume foi trocado?). Escaneie o QR Code de novo.' });
  }
}

// ---------- Mensagens que chegam ----------
const soNumero = (jid) => String(jid || '').split('@')[0].split(':')[0];
async function telefoneDe(s, key) {
  for (const j of [key.remoteJidAlt, key.senderPn, key.remoteJid]) if (j && /@s\.whatsapp\.net$/.test(j)) return soNumero(j);
  try { const m = await s.sock?.signalRepository?.lidMapping?.getPNForLID?.(key.remoteJid); if (m) return soNumero(m); } catch { /* sem mapa */ }
  return null;
}
function conteudoDe(m) {
  let c = m.message || {};
  for (let i = 0; i < 4; i++) {
    const dentro = (c.ephemeralMessage || c.viewOnceMessage || c.viewOnceMessageV2 || c.documentWithCaptionMessage || {}).message;
    if (!dentro) break; c = dentro;
  }
  return c;
}
function textoDe(c) {
  if (c.conversation || c.extendedTextMessage) return c.conversation || c.extendedTextMessage.text;
  if (c.imageMessage) return `[imagem]${c.imageMessage.caption ? ` ${c.imageMessage.caption}` : ''}`;
  if (c.audioMessage) return '[áudio]';
  if (c.videoMessage) return `[vídeo]${c.videoMessage.caption ? ` ${c.videoMessage.caption}` : ''}`;
  if (c.documentMessage) return `[documento: ${c.documentMessage.fileName || 'arquivo'}]`;
  if (c.locationMessage) return `📍 https://maps.google.com/?q=${c.locationMessage.degreesLatitude},${c.locationMessage.degreesLongitude}`;
  if (c.contactMessage) return `👤 ${c.contactMessage.displayName || 'Contato'}`;
  if (c.buttonsResponseMessage || c.listResponseMessage) return c.buttonsResponseMessage?.selectedDisplayText || c.listResponseMessage?.title || 'Resposta';
  return null; // protocolo, reações, enquetes: não vira mensagem
}
async function aoChegar(numeroId, s, ev) {
  if (ev.type !== 'notify' && ev.type !== 'append') return;
  const n = await numeroRow(numeroId);
  for (const m of ev.messages || []) {
    const jid = m.key?.remoteJid;
    if (!jid || /@g\.us$|@broadcast$|@newsletter$/.test(jid)) continue; // grupos, status e canais ficam de fora
    const texto = textoDe(conteudoDe(m));
    if (!texto) continue;
    const numero = await telefoneDe(s, m.key);
    if (!numero) continue;
    const msg = { id: m.key.id, numero, nome: m.key.fromMe ? null : m.pushName || null, texto };
    if (m.key.fromMe) { if (!s.doSistema.has(m.key.id)) await cfg.aoEco(n, msg); } else await cfg.aoReceber(n, msg);
  }
}

// ---------- Envio (mesma porta do oficial) ----------
async function enviar(numero, para, { texto }) {
  const s = sessoes.get(numero.id);
  if (!s || !s.sock || s.estado !== 'conectado') {
    throw Object.assign(new Error('O WhatsApp por QR Code não está conectado agora. Abra Canais e reconecte.'), { integracao: 'whatsapp' });
  }
  let jid = String(para || '').replace(/\D/g, '');
  try {
    // No Brasil, contas antigas ficam sem o 9 extra: o WhatsApp diz qual é o jid certo.
    const [r] = await s.sock.onWhatsApp(jid);
    if (r && r.exists) jid = r.jid; else throw Object.assign(new Error('Esse número não tem WhatsApp.'), { integracao: 'whatsapp', semWhatsapp: true });
  } catch (e) { if (e.semWhatsapp) throw e; jid = `${jid}@s.whatsapp.net`; }
  let r;
  try {
    r = await s.sock.sendMessage(jid, { text: texto || '' });
  } catch (e) {
    // R-20: a conexão pode ter levado a mensagem antes de falhar; não reenviar sozinho.
    throw Object.assign(new Error(`O WhatsApp por QR falhou no meio do envio: a mensagem pode ter saído (${String(e?.message || e).slice(0, 120)}).`), { integracao: 'whatsapp', envioIncerto: true });
  }
  if (r?.key?.id) { s.doSistema.add(r.key.id); if (s.doSistema.size > 500) s.doSistema.delete(s.doSistema.values().next().value); }
  return { idExterno: r?.key?.id || null, status: 'enviada' };
}

module.exports = { configurar, iniciar, encerrar, pararTodos, situacao, religarTodos, enviar, pastaDa };
