'use strict';
// Entrada omnicanal (INT-001 a INT-005, INT-008, AT-001, AT-002, AT-012).
// 1) `receber`: grava a entrada de forma durável ANTES de processar; a mesma mensagem repetida (mesmo id do
//    provedor) não duplica nada — só conta a repetição e audita.
// 2) Job `entrada.processar`: identifica o ponto focal pelo telefone normalizado/e-mail, junta na conversa aberta,
//    reabre a encerrada recente ou cria ocorrência (classificada ou em triagem).

const { uma } = require('../../db');
const { erro, validar } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio, DIA } = require('../../nucleo/relogio');
const { normalizarTelefone } = require('../../nucleo/telefone');
const { enfileirar } = require('../../jobs/fila');
const { classificar } = require('./classificador');
const clientes = require('../clientes/servico');
const ocorrencias = require('../ocorrencias/servico');
const { somarHorasUteis } = require('../ocorrencias/sla');

const ORIGENS = ['whatsapp', 'email', 'portal', 'api'];

function validarMensagem(corpo) {
  return validar(corpo, {
    idMensagem: { obrigatorio: true, tipo: 'texto', max: 200 },
    de: { obrigatorio: true, tipo: 'texto', max: 200 },
    nome: { tipo: 'texto', max: 120 },
    texto: { obrigatorio: true, tipo: 'texto', max: 4000 },
    assunto: { tipo: 'texto', max: 200 },
  });
}

/** Registro durável + deduplicação. Devolve { entradaId, duplicada }. */
async function receber(db, tenantId, origem, corpo, ator = 'webhook') {
  if (!ORIGENS.includes(origem)) throw erro.entrada(`Origem não suportada: ${origem}.`);
  const msg = validarMensagem(corpo);
  const ctx = { tenantId, ator: `${ator} ${origem}` };
  return db.comoTenant(tenantId, async (c) => {
    const r = uma(await c.query(
      `INSERT INTO entradas (tenant_id, origem, chave_idempotencia, payload, recebida_em) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, origem, chave_idempotencia) DO UPDATE SET duplicatas = entradas.duplicatas + 1
       RETURNING id, duplicatas, (xmax = 0) AS nova`,
      [tenantId, origem, msg.idMensagem, JSON.stringify(msg), relogio.agora()],
    ));
    if (!r.nova) {
      await auditar(c, ctx, { acao: 'entrada.duplicada_ignorada', entidade: 'entrada', entidadeId: r.id,
        depois: { origem, repeticoes: r.duplicatas } });
      return { entradaId: r.id, duplicada: true };
    }
    await enfileirar(c, ctx, { tipo: 'entrada.processar', chave: `entrada:${r.id}`, payload: { entradaId: r.id }, maxTentativas: 8 });
    return { entradaId: r.id, duplicada: false };
  });
}

/** Handler do job `entrada.processar`. Idempotente: entrada já processada é ignorada. */
async function processar(c, ctx, { entradaId }) {
  const ent = uma(await c.query('SELECT * FROM entradas WHERE id = $1 FOR UPDATE', [entradaId]));
  if (!ent || ent.estado === 'processada') return {};
  const msg = ent.payload;
  const telefone = ent.origem === 'whatsapp' ? normalizarTelefone(msg.de) : null;
  const email = ent.origem === 'email' || /@/.test(msg.de) ? String(msg.de).toLowerCase() : null;
  const pf = await clientes.pontoFocalPorContato(c, { telefone, email });
  const conversa = `${ent.origem}:${telefone || email || msg.de}`;
  const cal = await ocorrencias.carregarCalendario(c);
  const agora = relogio.agora();

  let oc = uma(await c.query(
    `SELECT * FROM ocorrencias WHERE conversa_chave = $1 AND estado NOT IN ('resolvida','encerrada_sem_resolucao')
     ORDER BY criado_em DESC LIMIT 1`, [conversa]));
  let destino = 'conversa_aberta';
  if (oc && oc.estado === 'aguardando_cliente') {
    oc = await ocorrencias.alterarComMotivo(c, ctx, oc.id, 'em_atendimento',
      { proxima_acao: 'Cliente respondeu: dar andamento', proxima_acao_em: somarHorasUteis(agora, 2, cal) },
      'ocorrencia.cliente_respondeu', 'Nova mensagem do cliente durante a espera');
  }
  if (!oc) {
    // WFL-012 / AT-012: mensagem nova numa conversa encerrada há pouco reabre a ocorrência em vez de criar outra.
    const recente = uma(await c.query(
      `SELECT * FROM ocorrencias WHERE conversa_chave = $1 AND estado IN ('resolvida','encerrada_sem_resolucao')
         AND encerrada_em > $2 ORDER BY encerrada_em DESC LIMIT 1`, [conversa, new Date(agora - cal.reaberturaDias * DIA)]));
    if (recente) {
      oc = await ocorrencias.alterarComMotivo(c, ctx, recente.id, 'aberta', {
        responsavel_id: null, encerrada_em: null, evidencia: null, motivo_encerramento: null, codigo_desfecho: null,
        reaberturas: recente.reaberturas + 1, proxima_acao: 'Assumir (reaberta por nova mensagem)',
        proxima_acao_em: somarHorasUteis(agora, 2, cal), prazo_em: somarHorasUteis(agora, 24, cal),
      }, 'ocorrencia.reaberta', `Nova mensagem do cliente em até ${cal.reaberturaDias} dias do encerramento`);
      destino = 'reaberta';
    }
  }
  if (!oc) {
    const cls = classificar(`${msg.assunto || ''} ${msg.texto}`);
    oc = await ocorrencias.criar(c, ctx, {
      origem: ent.origem, contaId: pf && cls.certa ? pf.conta_id : null, tipo: cls.tipo, prioridade: cls.prioridade,
      pontoFocalId: pf?.id, conversaChave: conversa,
      titulo: msg.assunto || msg.texto.split('\n')[0].slice(0, 120),
      descricao: pf ? (cls.certa ? null : `Classificação incerta: ${cls.motivo}.`) : 'Remetente não identificado entre os pontos focais.',
    });
    destino = oc.estado === 'triagem' ? 'triagem' : 'nova';
  }
  await c.query(
    `INSERT INTO interacoes (tenant_id, ocorrencia_id, entrada_id, conta_id, canal, direcao, remetente, texto, status_entrega, id_externo)
     VALUES ($1,$2,$3,$4,$5,'entrada',$6,$7,'registrada',$8)`,
    [ctx.tenantId, oc.id, ent.id, oc.conta_id, ent.origem, msg.nome || msg.de, msg.texto, msg.idMensagem],
  );
  await c.query("UPDATE entradas SET estado = 'processada', processada_em = now() WHERE id = $1", [ent.id]);
  await publicar(c, ctx, { tipo: 'entrada.processada', agregado: 'entrada', agregadoId: ent.id, chave: `entrada.processada:${ent.id}`,
    payload: { ocorrenciaId: oc.id, destino } });
  return {};
}

async function tenantPorSlug(db, slug) {
  return uma(await db.query("SELECT id FROM tenants WHERE slug = $1 AND status = 'ativo'", [slug]));
}

module.exports = { receber, processar, tenantPorSlug, ORIGENS };
