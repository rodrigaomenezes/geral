'use strict';
// Webhook do WhatsApp oficial e cadastro do número da organização.
const { validar, ErroNegocio } = require('../../nucleo/erros');
const { auditar } = require('../../nucleo/registro');
const { cifrar } = require('../../nucleo/cifra');
const { uma } = require('../../db');
const cloud = require('./whatsapp-cloud');
const entrada = require('../entrada/servico');

const STATUS = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' };
const ORDEM = { enfileirada: 0, enviada: 1, entregue: 2, lida: 3 };

async function aplicarStatus(c, s) {
  const novo = STATUS[s.status];
  if (!novo) return;
  const it = uma(await c.query("SELECT id, status_entrega FROM interacoes WHERE id_externo = $1 AND direcao = 'saida' FOR UPDATE", [s.id]));
  if (!it) return;
  // Evento fora de ordem (entregue depois de lida) não volta o status.
  if (novo !== 'falhou' && (ORDEM[novo] ?? 0) <= (ORDEM[it.status_entrega] ?? -1)) return;
  await c.query('UPDATE interacoes SET status_entrega = $2, erro_entrega = $3 WHERE id = $1', [it.id, novo, s.erro]);
}

module.exports = [
  { metodo: 'GET', caminho: '/api/whatsapp/webhook', publica: true,
    handler: async ({ query, res }) => {
      const ok = query['hub.mode'] === 'subscribe' && process.env.WA_VERIFY_TOKEN && query['hub.verify_token'] === process.env.WA_VERIFY_TOKEN;
      res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      res.end(ok ? String(query['hub.challenge'] || '') : 'Token de verificação inválido.');
      return { __bruto: true, status: ok ? 200 : 403 };
    } },
  { metodo: 'POST', caminho: '/api/whatsapp/webhook', publica: true, cru: true,
    handler: async ({ req, db, corpo, bruto, deps }) => {
      if (!cloud.assinaturaValida(bruto, req.headers['x-hub-signature-256'])) {
        throw new ErroNegocio(401, 'assinatura_invalida', 'Assinatura do webhook inválida (confira META_APP_SECRET).');
      }
      for (const g of cloud.lerWebhook(corpo)) {
        const numero = uma(await db.query('SELECT tenant_id FROM whatsapp_numeros WHERE phone_number_id = $1 AND ativo', [g.phoneNumberId]));
        if (!numero) { deps.log?.(JSON.stringify({ nivel: 'aviso', webhook: 'whatsapp', motivo: 'número não cadastrado' })); continue; }
        // Entrada durável e deduplicada pelo id da mensagem (a Meta reenvia quando não recebe 200).
        for (const m of g.mensagens) await entrada.receber(db, numero.tenant_id, 'whatsapp', { idMensagem: m.id, de: m.de, nome: m.nome || undefined, texto: m.texto || '[mensagem]' }, 'whatsapp oficial');
        if (g.status.length) await db.comoTenant(numero.tenant_id, async (c) => { for (const s of g.status) await aplicarStatus(c, s); });
      }
      return { ok: true };
    } },
  { metodo: 'GET', caminho: '/api/whatsapp/numero', permissao: 'canais.gerir', descricao: 'ver o número de WhatsApp',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, async (c) => ({
      numero: uma(await c.query('SELECT id, provedor, phone_number_id, waba_id, numero_exibicao, (token_cifrado IS NOT NULL) AS tem_token, atualizado_em FROM whatsapp_numeros WHERE ativo')),
      webhook: '/api/whatsapp/webhook', verificacaoConfigurada: !!process.env.WA_VERIFY_TOKEN, assinaturaConfigurada: !!process.env.META_APP_SECRET })) },
  { metodo: 'POST', caminho: '/api/whatsapp/numero', permissao: 'canais.gerir', descricao: 'conectar o número de WhatsApp',
    handler: ({ db, ctx, corpo }) => {
      const d = validar(corpo, { phoneNumberId: { obrigatorio: true, tipo: 'texto', max: 40 }, wabaId: { tipo: 'texto', max: 40 },
        numeroExibicao: { tipo: 'texto', max: 30 }, token: { obrigatorio: true, tipo: 'texto', min: 20, max: 1000 } });
      if (!/^\d{5,30}$/.test(d.phoneNumberId)) throw new ErroNegocio(400, 'entrada_invalida', 'O Phone Number ID da Meta tem só dígitos.');
      return db.comoTenant(ctx.tenantId, async (c) => {
        const token = cifrar(d.token);
        await c.query('UPDATE whatsapp_numeros SET ativo = false, atualizado_em = now() WHERE ativo');
        // Só atualiza número desta organização; número de outra organização é recusado pela unicidade (409).
        const r = await c.query(`UPDATE whatsapp_numeros SET waba_id = $2, numero_exibicao = $3, token_cifrado = $4, ativo = true, atualizado_em = now()
          WHERE phone_number_id = $1`, [d.phoneNumberId, d.wabaId || null, d.numeroExibicao || null, token]);
        if (!r.rowCount) {
          await c.query(`INSERT INTO whatsapp_numeros (tenant_id, provedor, phone_number_id, waba_id, numero_exibicao, token_cifrado) VALUES ($1,'cloud',$2,$3,$4,$5)`,
            [ctx.tenantId, d.phoneNumberId, d.wabaId || null, d.numeroExibicao || null, token]);
        }
        await auditar(c, ctx, { acao: 'whatsapp.numero_conectado', entidade: 'whatsapp', depois: { phoneNumberId: d.phoneNumberId, numero: d.numeroExibicao || null } });
        return { ok: true };
      });
    } },
];
