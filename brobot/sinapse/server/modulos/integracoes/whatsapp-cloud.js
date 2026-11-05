'use strict';
// WhatsApp oficial (Meta Cloud API), portado do Lumen Operações. Caminho suportado pela Meta para integrar
// WhatsApp Business: sem risco de banimento, com webhooks e status de entrega.
// Variáveis: META_APP_SECRET (assinatura do webhook), WA_VERIFY_TOKEN (verificação do webhook), WA_GRAPH_VERSION.
// O token de cada número fica cifrado no banco (whatsapp_numeros.token_cifrado, SINAPSE_CHAVE).

const crypto = require('node:crypto');
const { decifrar } = require('../../nucleo/cifra');

const VERSAO = process.env.WA_GRAPH_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${VERSAO}`;

class ErroWhatsApp extends Error {
  constructor(msg, codigo) { super(msg); this.codigo = codigo; this.integracao = 'whatsapp'; }
}
// Mensagens da Meta traduzidas para o que a equipe precisa saber.
const ERROS = {
  131047: 'Passaram mais de 24 h desde a última mensagem do cliente: para retomar é preciso um modelo aprovado (template).',
  131026: 'Não foi possível entregar: o número pode não ter WhatsApp.',
  130429: 'Limite de envio atingido. Aguarde um pouco.',
  131056: 'Muitas mensagens para o mesmo contato em pouco tempo.',
  132001: 'O modelo (template) não existe ou não está aprovado nesse idioma.',
  190: 'A conexão com o WhatsApp expirou. Reconecte o número.',
  100: 'Parâmetro inválido enviado ao WhatsApp.',
};

async function graph(token, caminho, { method = 'GET', body } = {}) {
  const res = await fetch(`${GRAPH}/${caminho}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok || dados.error) {
    const e = dados.error || {};
    const codigo = e.code || res.status;
    throw new ErroWhatsApp(ERROS[codigo] || e.error_user_msg || e.message || `Erro ${res.status} no WhatsApp`, codigo);
  }
  return dados;
}

/** Envia texto (ou template, quando informado) pelo número da organização. */
async function enviar(numero, para, { texto, template }) {
  const token = decifrar(numero.token_cifrado);
  const corpo = { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(para).replace(/\D/g, '') };
  if (template) {
    Object.assign(corpo, { type: 'template', template: { name: template.nome, language: { code: template.idioma || 'pt_BR' },
      ...(template.variaveis?.length ? { components: [{ type: 'body', parameters: template.variaveis.map((t) => ({ type: 'text', text: String(t) })) }] } : {}) } });
  } else {
    Object.assign(corpo, { type: 'text', text: { body: texto, preview_url: false } });
  }
  const r = await graph(token, `${numero.phone_number_id}/messages`, { method: 'POST', body: corpo });
  return { idExterno: r.messages?.[0]?.id || null, status: 'enviada' };
}

/** A Meta assina o corpo cru com o App Secret (cabeçalho X-Hub-Signature-256). */
function assinaturaValida(corpoCru, cabecalho, segredo = process.env.META_APP_SECRET) {
  if (!segredo || !corpoCru || !cabecalho) return false;
  const esperado = `sha256=${crypto.createHmac('sha256', segredo).update(corpoCru).digest('hex')}`;
  const a = Buffer.from(esperado); const b = Buffer.from(String(cabecalho));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Lê o payload do webhook: mensagens recebidas e status de entrega, agrupados pelo número (phone_number_id). */
function lerWebhook(payload) {
  const saida = [];
  for (const entry of payload?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const nomes = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      const mensagens = (v.messages || []).map((m) => ({
        id: m.id, de: m.from, nome: nomes[m.from] || null,
        texto: m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive'
          ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : `[${m.type === 'image' ? 'imagem' : m.type === 'audio' ? 'áudio' : m.type === 'document' ? 'documento' : m.type}${m[m.type]?.caption ? `: ${m[m.type].caption}` : ''}]`,
      }));
      const status = (v.statuses || []).map((s) => ({ id: s.id, status: s.status, erro: s.errors?.[0] ? (ERROS[s.errors[0].code] || s.errors[0].title) : null }));
      saida.push({ phoneNumberId, mensagens, status });
    }
  }
  return saida;
}

module.exports = { enviar, assinaturaValida, lerWebhook, ErroWhatsApp, ERROS, VERSAO };
