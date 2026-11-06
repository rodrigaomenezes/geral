'use strict';
// INT-006: relacionar, mesclar e dividir ocorrências sem apagar nada.
// - Relacionar: vínculo nos dois sentidos (ex.: mesmo problema em contas diferentes).
// - Mesclar: a duplicada é encerrada como "duplicada" apontando para a principal; os itens (placas) são copiados para a
//   principal e as próximas mensagens da mesma conversa caem nela. A duplicada continua consultável com o histórico.
// - Dividir: itens escolhidos saem para uma ocorrência nova da mesma conta, ligada à original.
// Cada passo grava auditoria e evento na mesma transação (via alterarComMotivo e `registrar`).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');
const maquina = require('./maquina');
const s = require('./servico');

async function carregar(c, id, rotulo = 'Ocorrência') {
  const o = uma(await c.query('SELECT * FROM ocorrencias WHERE id = $1 FOR UPDATE', [id]));
  if (!o) throw erro.naoEncontrado(rotulo);
  return o;
}

/** Aceita o protocolo (SIN-000123) ou o identificador. */
async function porReferencia(c, ref) {
  const r = String(ref || '').trim().toUpperCase();
  const o = /^SIN-\d{6}$/.test(r) ? uma(await c.query('SELECT id FROM ocorrencias WHERE protocolo = $1', [r]))
    : /^[0-9A-F-]{36}$/.test(r) ? uma(await c.query('SELECT id FROM ocorrencias WHERE id = $1', [r.toLowerCase()])) : null;
  if (!o) throw erro.naoEncontrado('Ocorrência com esse protocolo');
  return o.id;
}

async function vincular(c, ctx, de, para, tipo) {
  await c.query(`INSERT INTO ocorrencia_vinculos (tenant_id, ocorrencia_id, relacionada_id, tipo) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [ctx.tenantId, de, para, tipo]);
}

async function registrar(c, ctx, oc, acao, motivo, depois) {
  await auditar(c, ctx, { acao, entidade: 'ocorrencia', entidadeId: oc.id, motivo, depois });
  await publicar(c, ctx, { tipo: acao, agregado: 'ocorrencia', agregadoId: oc.id, payload: { protocolo: oc.protocolo, ...depois } });
}

async function relacionar(c, ctx, id, outroId, motivo) {
  if (id === outroId) throw erro.entrada('Escolha outra ocorrência.');
  const [a, b] = [await carregar(c, id), await carregar(c, outroId, 'Ocorrência relacionada')];
  const ja = uma(await c.query("SELECT 1 FROM ocorrencia_vinculos WHERE ocorrencia_id = $1 AND relacionada_id = $2 AND tipo = 'relacionada'", [a.id, b.id]));
  if (ja) throw erro.conflito(`${a.protocolo} e ${b.protocolo} já estão relacionadas.`);
  await vincular(c, ctx, a.id, b.id, 'relacionada');
  await vincular(c, ctx, b.id, a.id, 'relacionada');
  await registrar(c, ctx, a, 'ocorrencia.relacionada', motivo, { com: b.protocolo });
  await registrar(c, ctx, b, 'ocorrencia.relacionada', motivo, { com: a.protocolo });
  return { ok: true };
}

/** Mescla `duplicadaId` em `principalId`. */
async function mesclar(c, ctx, duplicadaId, principalId, motivo) {
  if (duplicadaId === principalId) throw erro.entrada('Escolha a ocorrência principal (outra).');
  const dup = await carregar(c, duplicadaId);
  const pri = await carregar(c, principalId, 'Ocorrência principal');
  if (maquina.FINAIS.includes(dup.estado)) throw erro.regra('ocorrencia_encerrada', `${dup.protocolo} já está encerrada.`);
  if (maquina.FINAIS.includes(pri.estado)) throw erro.regra('principal_encerrada', `${pri.protocolo} está encerrada. Reabra-a ou escolha outra principal.`);
  if (dup.conta_id && pri.conta_id && dup.conta_id !== pri.conta_id) {
    throw erro.regra('contas_diferentes', 'Só dá para mesclar ocorrências da mesma conta. Para contas diferentes, use "Relacionar".');
  }
  // Itens (placas) passam a constar também na principal; os da duplicada ficam como estavam (histórico).
  const copiados = await c.query(`INSERT INTO ocorrencia_itens (tenant_id, ocorrencia_id, pendencia_id, placa, descricao)
    SELECT tenant_id, $2, pendencia_id, placa, descricao FROM ocorrencia_itens i WHERE i.ocorrencia_id = $1
      AND NOT EXISTS (SELECT 1 FROM ocorrencia_itens x WHERE x.ocorrencia_id = $2 AND (x.pendencia_id = i.pendencia_id OR (i.pendencia_id IS NULL AND x.placa IS NOT DISTINCT FROM i.placa AND x.descricao = i.descricao)))
    ON CONFLICT DO NOTHING`, [dup.id, pri.id]);
  // Mensagens novas da conversa da duplicada passam a cair na principal.
  if (dup.conversa_chave && !pri.conversa_chave) await c.query('UPDATE ocorrencias SET conversa_chave = $2 WHERE id = $1', [pri.id, dup.conversa_chave]);
  await s.alterarComMotivo(c, ctx, dup.id, 'encerrada_sem_resolucao', {
    motivo_encerramento: `Mesclada em ${pri.protocolo}: ${motivo}`, codigo_desfecho: 'duplicada', encerrada_em: relogio.agora(),
  }, 'ocorrencia.mesclada', `Mesclada em ${pri.protocolo}: ${motivo}`);
  await vincular(c, ctx, dup.id, pri.id, 'mesclada_em');
  await vincular(c, ctx, pri.id, dup.id, 'relacionada');
  await registrar(c, ctx, pri, 'ocorrencia.recebeu_mescla', motivo, { de: dup.protocolo, itens: copiados.rowCount });
  return { principal: pri.protocolo, duplicada: dup.protocolo, itensCopiados: copiados.rowCount };
}

/** Divide: itens escolhidos (ou nenhum) vão para uma ocorrência nova da mesma conta. */
async function dividir(c, ctx, id, d) {
  const orig = await carregar(c, id);
  if (!orig.conta_id) throw erro.regra('sem_conta', 'Classifique a ocorrência (conta) antes de dividir.');
  if (maquina.FINAIS.includes(orig.estado)) throw erro.regra('ocorrencia_encerrada', 'Reabra a ocorrência antes de dividir.');
  const itens = d.itemIds?.length ? (await c.query('SELECT id FROM ocorrencia_itens WHERE ocorrencia_id = $1 AND id = ANY($2::uuid[])', [orig.id, d.itemIds])).rows : [];
  if (d.itemIds?.length && itens.length !== d.itemIds.length) throw erro.entrada('Algum item escolhido não é desta ocorrência.');
  const total = uma(await c.query('SELECT count(*)::int AS n FROM ocorrencia_itens WHERE ocorrencia_id = $1', [orig.id])).n;
  if (itens.length && itens.length === total) throw erro.regra('todos_os_itens', 'Deixe ao menos um item na original (ou transfira a ocorrência inteira).');
  const nova = await s.criar(c, ctx, { contaId: orig.conta_id, tipo: d.tipo || orig.tipo, prioridade: d.prioridade || orig.prioridade,
    titulo: d.titulo, descricao: d.descricao || `Dividida de ${orig.protocolo}`, origem: 'interna', pontoFocalId: orig.ponto_focal_id, rodadaId: orig.rodada_id });
  if (itens.length) await c.query('UPDATE ocorrencia_itens SET ocorrencia_id = $2 WHERE id = ANY($1::uuid[])', [itens.map((x) => x.id), nova.id]);
  await vincular(c, ctx, nova.id, orig.id, 'dividida_de');
  await vincular(c, ctx, orig.id, nova.id, 'relacionada');
  await registrar(c, ctx, orig, 'ocorrencia.dividida', d.motivo, { nova: nova.protocolo, itens: itens.length });
  return { id: nova.id, protocolo: nova.protocolo, itensMovidos: itens.length };
}

module.exports = { relacionar, mesclar, dividir, porReferencia };
