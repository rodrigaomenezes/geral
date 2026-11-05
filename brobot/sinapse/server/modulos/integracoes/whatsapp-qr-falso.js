// SÓ PARA TESTES (portado do Lumen; carregado apenas com SINAPSE_WA_QR_FALSO=1): imita a biblioteca do WhatsApp Web
// pra testar o fluxo do QR code sem celular nem acesso à rede do WhatsApp.
const { EventEmitter } = require("events");
const crypto = require("crypto");
const socks = new Map(); // pasta da sessão -> sock

async function useMultiFileAuthState(pasta) {
  return { state: { creds: { registered: false }, keys: {}, _pasta: pasta }, saveCreds: async () => {} };
}
function makeWASocket({ auth }) {
  const ev = new EventEmitter();
  const sock = {
    ev, user: null,
    async sendMessage(jid, conteudo) {
      const id = "FAKE" + crypto.randomBytes(6).toString("hex");
      setTimeout(() => ev.emit("messages.update", [{ key: { id, fromMe: true, remoteJid: jid }, update: { status: 3 } }]), 300);
      setTimeout(() => ev.emit("messages.update", [{ key: { id, fromMe: true, remoteJid: jid }, update: { status: 4 } }]), 700);
      sock._enviadas.push({ jid, conteudo, id });
      return { key: { id, remoteJid: jid, fromMe: true } };
    },
    // como o WhatsApp de verdade: no Brasil, celulares de DDD 31 em diante costumam vir SEM o 9 extra
    async onWhatsApp(n) { let d = String(n).replace(/\D/g, ""); if (/^55([3-9]\d)9\d{8}$/.test(d)) d = d.slice(0, 4) + d.slice(5); return [{ exists: !d.endsWith("0000"), jid: d + "@s.whatsapp.net" }]; },
    async readMessages() {}, async logout() { ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } }); }, end() {},
    updateMediaMessage: async m => m, _enviadas: []
  };
  socks.set(auth._pasta, sock);
  setTimeout(() => ev.emit("connection.update", { qr: "SINAPSE-TESTE-QR-" + Date.now() }), 150);
  return sock;
}
// ações simuladas do "celular"
const sockDa = pasta => socks.get(pasta);
function escanear(pasta, numero = "5511988880000") {
  const s = sockDa(pasta); s.user = { id: numero + ":1@s.whatsapp.net", name: "Celular de teste" };
  s.ev.emit("connection.update", { connection: "open" });
}
function receber(pasta, { de, nome, texto, lid }) {
  const s = sockDa(pasta);
  const key = lid ? { remoteJid: lid + "@lid", remoteJidAlt: de + "@s.whatsapp.net", id: "IN" + Date.now() + Math.random(), fromMe: false }
    : { remoteJid: de + "@s.whatsapp.net", id: "IN" + Date.now() + Math.random(), fromMe: false };
  s.ev.emit("messages.upsert", { type: "notify", messages: [{ key, pushName: nome, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: texto } }] });
}
function ecoar(pasta, { para, texto, nome = "Perfil da empresa" }) {
  const s = sockDa(pasta);
  // como o WhatsApp de verdade: o pushName do eco é o nome do perfil de quem enviou (o próprio número)
  s.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: para + "@s.whatsapp.net", id: "ECO" + Date.now(), fromMe: true }, pushName: nome, messageTimestamp: Math.floor(Date.now() / 1000), message: { extendedTextMessage: { text: texto } } }] });
}
function cair(pasta, codigo = 428) { sockDa(pasta).ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: codigo } } } }); }

module.exports = { useMultiFileAuthState, makeWASocket, DisconnectReason: { loggedOut: 401 }, Browsers: { macOS: n => ["Mac OS", n, "1"] },
  downloadMediaMessage: async () => Buffer.from("midia"), _teste: { escanear, receber, ecoar, cair, sockDa } };
