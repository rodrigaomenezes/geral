'use strict';
// Mensageria WhatsApp do Estadia BR.
// Modos:
//  - api:      envia pela API oficial (WhatsApp Business Cloud API) e recebe respostas por webhook;
//  - simulado: mensagens ficam numa caixa de entrada simulada (demonstração com o "celular do destino");
//  - manual:   o app abre o WhatsApp do próprio motorista com a mensagem pronta (sem retorno automático).
// A resposta da pessoa ("SIM", "OK", "NÃO") é o que confirma o evento ou a entrega da informação.

const crypto = require('node:crypto');

const RE_SIM = /^(sim|s|ss|ok|okay|confirmo|confirmado|confirma|certo|correto|positivo|isso|recebido|recebi|ciente|1|👍|✅|✔️?)(\b|$)/iu;
const RE_NAO = /^(n[aã]o|n|negativo|errado|2|❌|👎)(\b|$)/iu;

function interpretar(texto) {
  const t = String(texto || '').trim().replace(/^[*_~\s]+|[*_~.!\s]+$/g, '');
  if (RE_NAO.test(t) || /^n[aã]o\b/i.test(t)) return 'NAO';
  if (RE_SIM.test(t)) return 'SIM';
  return 'OUTRO';
}

/** Normaliza para o formato internacional só com dígitos (ex.: 5511999990000). */
function normFone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) d = '55' + d.replace(/^0+/, '');
  return d;
}

const fmtFone = (d) => (d && d.length >= 12 ? `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, -4)}-${d.slice(-4)}` : d || '');

function config(env = process.env) {
  const token = env.WHATSAPP_TOKEN, phoneId = env.WHATSAPP_PHONE_ID;
  // Sem API oficial, o padrão é o WhatsApp do próprio motorista. O simulador só liga com WHATSAPP_MODE=simulado.
  const mode = env.WHATSAPP_MODE || (token && phoneId ? 'api' : 'manual');
  return { mode, token, phoneId, apiVersion: env.WHATSAPP_API_VERSION || 'v21.0', verifyToken: env.WHATSAPP_VERIFY_TOKEN || null, appSecret: env.WHATSAPP_APP_SECRET || null };
}

/** Envia texto pela API oficial. Retorna { externalId } ou lança erro. */
async function enviarApi(cfg, to, texto) {
  const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: true, body: texto } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.error && json.error.message) || `Falha HTTP ${res.status}`);
  return { externalId: json.messages && json.messages[0] && json.messages[0].id };
}

/** Lê o payload do webhook da Cloud API: mensagens recebidas e status de entrega. */
function lerWebhook(body) {
  const mensagens = [], status = [];
  for (const entry of (body && body.entry) || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      for (const m of v.messages || []) {
        const texto = m.type === 'text' ? m.text && m.text.body
          : m.type === 'button' ? m.button && (m.button.text || m.button.payload)
            : m.type === 'interactive' ? (m.interactive.button_reply || m.interactive.list_reply || {}).title
              : m.type === 'reaction' ? m.reaction && m.reaction.emoji : `[${m.type}]`;
        mensagens.push({ from: m.from, texto: texto || '', contextId: m.context && m.context.id, externalId: m.id, em: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString() });
      }
      for (const s of v.statuses || []) {
        status.push({ externalId: s.id, status: { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falha' }[s.status] || s.status, em: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString(), erro: s.errors && s.errors[0] && s.errors[0].title });
      }
    }
  }
  return { mensagens, status };
}

function assinaturaValida(appSecret, rawBody, header) {
  if (!appSecret) return true;
  const esperado = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return typeof header === 'string' && header.length === esperado.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(esperado));
}

module.exports = { interpretar, normFone, fmtFone, config, enviarApi, lerWebhook, assinaturaValida };
