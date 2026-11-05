'use strict';
// Fila durável de jobs no PostgreSQL (WFL-003, WFL-009, SUP-005). Tudo o que é agendado (contatos D-3/D-1/D+3,
// pré-rodada D-4, envio de mensagens, sincronização OMIE, varredura do supervisor) é uma linha em `jobs`.
// Reiniciar o servidor não perde nada: o ciclo só procura o que venceu. Execução "pelo menos uma vez":
// os handlers são idempotentes (chaves únicas e checagem de estado).

const { relogio } = require('../nucleo/relogio');
const { ctxSistema, auditar } = require('../nucleo/registro');
const { registrarFalha } = require('../modulos/integracoes/estado');

const BACKOFF_BASE_MS = 30e3;
const BACKOFF_MAX_MS = 3600e3;

/** Agenda um job. Com `chave`, repetir o pedido não duplica (devolve null). */
async function enfileirar(c, ctx, { tipo, payload = {}, executarEm, chave = null, maxTentativas = 5 }) {
  const r = await c.query(
    `INSERT INTO jobs (tenant_id, tipo, payload, executar_em, chave, max_tentativas)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, chave) DO NOTHING RETURNING id`,
    [ctx.tenantId, tipo, JSON.stringify(payload), executarEm || relogio.agora(), chave, maxTentativas],
  );
  return r.rows[0]?.id || null;
}

/** Cancela jobs pendentes por chave (ex.: contatos futuros após correção técnica — RN-005). */
async function cancelarPorChave(c, chaves) {
  if (!chaves.length) return 0;
  const r = await c.query(
    "UPDATE jobs SET estado = 'cancelado', concluido_em = now() WHERE chave = ANY($1) AND estado = 'pendente'",
    [chaves],
  );
  return r.rowCount;
}

const backoff = (tentativa) => Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, tentativa - 1), BACKOFF_MAX_MS);

function criarWorker(db, handlers, { log = () => {}, lote = 10 } = {}) {
  let parado = true;
  let timer = null;

  async function reivindicar() {
    return db.sistema(async (c) => (await c.query(
      `UPDATE jobs SET estado = 'executando', bloqueado_em = now(), tentativas = tentativas + 1
       WHERE id IN (SELECT id FROM jobs WHERE estado = 'pendente' AND executar_em <= $1
                    ORDER BY executar_em, id LIMIT $2 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [relogio.agora(), lote],
    )).rows);
  }

  async function executar(job) {
    const handler = handlers[job.tipo];
    const ctx = ctxSistema(job.tenant_id, `rotina ${job.tipo}`);
    try {
      if (!handler) throw new Error(`Nenhum handler para o job "${job.tipo}".`);
      const res = (await db.comoTenant(job.tenant_id, (c) => handler(c, ctx, job.payload, job))) || {};
      if (res.proximaEm) {
        // Job recorrente: a mesma linha volta para a fila.
        await db.query("UPDATE jobs SET estado = 'pendente', executar_em = $2, tentativas = 0, ultimo_erro = NULL WHERE id = $1",
          [job.id, res.proximaEm]);
      } else if (res.adiarPara) {
        await db.query("UPDATE jobs SET estado = 'pendente', executar_em = $2, tentativas = tentativas - 1 WHERE id = $1",
          [job.id, res.adiarPara]);
      } else {
        await db.query("UPDATE jobs SET estado = 'concluido', concluido_em = now(), ultimo_erro = NULL WHERE id = $1", [job.id]);
      }
      // Trabalho que precisa de outra transação roda só depois do commit (nunca aninhado).
      if (res.depois) await res.depois();
      return 'ok';
    } catch (e) {
      const msg = String(e && e.message ? e.message : e).slice(0, 500);
      const morto = job.tentativas >= job.max_tentativas;
      if (e && e.integracao) {
        // A transação do handler foi desfeita; a falha da integração é registrada numa transação própria.
        await db.comoTenant(job.tenant_id, (c) => registrarFalha(c, e.integracao, msg)).catch(() => {});
      }
      await db.query(
        `UPDATE jobs SET estado = $2, ultimo_erro = $3, executar_em = $4, concluido_em = CASE WHEN $2 = 'morto' THEN now() END
         WHERE id = $1`,
        [job.id, morto ? 'morto' : 'pendente', msg, new Date(relogio.agora().getTime() + backoff(job.tentativas))],
      );
      if (morto) {
        // RN-015: falha nunca some em silêncio — vai para a fila de falhas e fica na auditoria.
        await db.comoTenant(job.tenant_id, (c) => auditar(c, ctx, {
          acao: 'job.fila_de_falhas', entidade: 'job', entidadeId: job.id, depois: { tipo: job.tipo, erro: msg },
        })).catch(() => {});
        if (handlers.__aoMorrer) await handlers.__aoMorrer(job, msg).catch(() => {});
      }
      log(`job ${job.id} (${job.tipo}) falhou [${job.tentativas}/${job.max_tentativas}]: ${msg}`);
      return morto ? 'morto' : 'retentar';
    }
  }

  /** Executa tudo o que está vencido agora (usado pelo ciclo e pelos testes). */
  async function executarPendentes(maxRodadas = 20) {
    let total = 0;
    for (let i = 0; i < maxRodadas; i++) {
      const jobs = await reivindicar();
      if (!jobs.length) break;
      for (const j of jobs) { await executar(j); total++; }
    }
    return total;
  }

  async function ciclo(intervaloMs) {
    if (parado) return;
    try { await executarPendentes(); } catch (e) { log(`ciclo do worker falhou: ${e.message}`); }
    if (!parado) timer = setTimeout(() => ciclo(intervaloMs), intervaloMs);
  }

  return {
    executarPendentes,
    iniciar(intervaloMs) { if (!parado) return; parado = false; timer = setTimeout(() => ciclo(intervaloMs), 200); },
    parar() { parado = true; if (timer) clearTimeout(timer); },
  };
}

module.exports = { enfileirar, cancelarPorChave, criarWorker, backoff };
