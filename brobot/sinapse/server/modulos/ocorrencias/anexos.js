'use strict';
// INT-009 / R-12: anexos de ocorrência. O tipo é reconhecido pelo CONTEÚDO (assinatura do arquivo), não pela extensão
// nem pelo que o navegador diz; só entram PDF, imagens (PNG, JPEG, WEBP), texto/CSV e planilha/documento do Office
// (XLSX/DOCX). Executáveis, scripts, HTML/SVG e compactados soltos são recusados. Até 10 MB. O mesmo arquivo (SHA-256) na
// mesma ocorrência não entra duas vezes. Arquivar = some da lista, com motivo (o conteúdo continua até a retenção).
// Retenção: com `tenants.config.retencao_anexos_dias`, o supervisor expurga o conteúdo de anexos de ocorrências
// encerradas há mais tempo que isso; fica o registro. Sem a configuração, nada é expurgado.
// Antivírus: não há verificação de malware no servidor (registrado em RISCOS R-12); o download sai sempre como
// anexo (nunca aberto no navegador) e com o tipo conferido.

const crypto = require('node:crypto');
const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio, DIA } = require('../../nucleo/relogio');
const maquina = require('./maquina');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_POR_OCORRENCIA = 30;
const OFFICE = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

const comeca = (b, bytes, deslocamento = 0) => bytes.every((x, i) => b[deslocamento + i] === x);

/** Regra pura: reconhece o tipo pelo conteúdo. Devolve { mime } ou { erro }. */
function reconhecer(buf, nome) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { erro: 'Arquivo vazio.' };
  if (buf.length > MAX_BYTES) return { erro: 'Anexo acima de 10 MB.' };
  const ext = String(nome || '').toLowerCase().split('.').pop();
  if (comeca(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf' }; // %PDF-
  if (comeca(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png' };
  if (comeca(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg' };
  if (comeca(buf, [0x52, 0x49, 0x46, 0x46]) && comeca(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp' };
  if (comeca(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP: só vale como XLSX/DOCX (estrutura do Office no começo do pacote); .zip solto é recusado.
    const cabeca = buf.subarray(0, Math.min(buf.length, 4096)).toString('latin1');
    if (OFFICE[ext] && /\[Content_Types\]\.xml|xl\/|word\//.test(cabeca)) return { mime: OFFICE[ext] };
    return { erro: 'Arquivo compactado não é aceito. Envie o PDF, a planilha (XLSX) ou o documento (DOCX) diretamente.' };
  }
  if (['txt', 'csv', 'log'].includes(ext)) {
    const amostra = buf.subarray(0, Math.min(buf.length, 8192));
    if (amostra.includes(0)) return { erro: 'O arquivo de texto tem conteúdo binário.' };
    const texto = amostra.toString('utf8');
    if (/<\s*(script|html|svg|iframe)/i.test(texto)) return { erro: 'Texto com HTML ou script não é aceito.' };
    return { mime: ext === 'csv' ? 'text/csv' : 'text/plain' };
  }
  return { erro: 'Tipo de arquivo não aceito. Envie PDF, imagem (PNG, JPEG ou WEBP), texto/CSV, XLSX ou DOCX.' };
}

/** Nome seguro para guardar e para o download (sem caminho, sem caracteres de controle, até 160). */
function nomeSeguro(nome) {
  const base = String(nome || 'anexo').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  return (base || 'anexo').slice(0, 160);
}

async function anexar(c, ctx, ocorrenciaId, { nome, conteudo }) {
  const oc = uma(await c.query('SELECT id, estado, protocolo FROM ocorrencias WHERE id = $1', [ocorrenciaId]));
  if (!oc) throw erro.naoEncontrado('Ocorrência');
  if (maquina.FINAIS.includes(oc.estado)) throw erro.regra('ocorrencia_encerrada', 'Reabra a ocorrência para anexar arquivos.');
  const n = nomeSeguro(nome);
  const tipo = reconhecer(conteudo, n);
  if (tipo.erro) throw erro.entrada(tipo.erro);
  const qtd = uma(await c.query('SELECT count(*)::int AS n FROM anexos WHERE ocorrencia_id = $1 AND arquivado_em IS NULL', [oc.id])).n;
  if (qtd >= MAX_POR_OCORRENCIA) throw erro.regra('anexos_demais', `A ocorrência já tem ${MAX_POR_OCORRENCIA} anexos. Arquive os que não servem mais.`);
  const sha256 = crypto.createHash('sha256').update(conteudo).digest('hex');
  const a = uma(await c.query(`INSERT INTO anexos (tenant_id, ocorrencia_id, nome, tipo_mime, tamanho, sha256, conteudo, enviado_por)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id, nome, tipo_mime, tamanho, sha256, criado_em`,
  [ctx.tenantId, oc.id, n, tipo.mime, conteudo.length, sha256, conteudo, ctx.usuario?.id || null]));
  if (!a) throw erro.conflito('Este mesmo arquivo já está anexado a esta ocorrência.');
  await auditar(c, ctx, { acao: 'ocorrencia.anexo', entidade: 'ocorrencia', entidadeId: oc.id, depois: { anexo: a.id, nome: n, tipo: tipo.mime, tamanho: a.tamanho, sha256 } });
  await publicar(c, ctx, { tipo: 'ocorrencia.anexo_incluido', agregado: 'ocorrencia', agregadoId: oc.id, payload: { anexoId: a.id, tipo: tipo.mime, tamanho: a.tamanho } });
  return a;
}

async function listar(c, ocorrenciaId) {
  return (await c.query(`SELECT a.id, a.nome, a.tipo_mime, a.tamanho, a.criado_em, a.enviado_por, u.nome AS enviado_por_nome, a.expurgado_em IS NOT NULL AS expurgado
    FROM anexos a LEFT JOIN usuarios u ON u.id = a.enviado_por WHERE a.ocorrencia_id = $1 AND a.arquivado_em IS NULL ORDER BY a.criado_em LIMIT 100`, [ocorrenciaId])).rows;
}

async function baixar(c, ctx, id) {
  const a = uma(await c.query('SELECT id, ocorrencia_id, nome, tipo_mime, tamanho, conteudo, expurgado_em, arquivado_em FROM anexos WHERE id = $1', [id]));
  if (!a) throw erro.naoEncontrado('Anexo');
  if (a.expurgado_em) throw erro.regra('anexo_expurgado', 'O conteúdo deste anexo foi apagado pela política de retenção. O registro continua na ocorrência.');
  await auditar(c, ctx, { acao: 'ocorrencia.anexo_baixado', entidade: 'ocorrencia', entidadeId: a.ocorrencia_id, depois: { anexo: a.id } });
  return a;
}

async function arquivar(c, ctx, id, motivo, podeGerir) {
  const a = uma(await c.query('SELECT * FROM anexos WHERE id = $1 FOR UPDATE', [id]));
  if (!a || a.arquivado_em) throw erro.naoEncontrado('Anexo');
  if (a.enviado_por !== ctx.usuario.id && !podeGerir) throw erro.semPermissao('arquivar o anexo de outra pessoa');
  await c.query('UPDATE anexos SET arquivado_em = $2, arquivado_por = $3, motivo_arquivamento = $4 WHERE id = $1', [id, relogio.agora(), ctx.usuario.id, motivo]);
  await auditar(c, ctx, { acao: 'ocorrencia.anexo_arquivado', entidade: 'ocorrencia', entidadeId: a.ocorrencia_id, motivo, depois: { anexo: id, nome: a.nome } });
  return { ok: true };
}

/** Supervisor: expurga o conteúdo dos anexos de ocorrências encerradas há mais que a retenção configurada. */
async function aplicarRetencao(c, ctx) {
  const t = uma(await c.query('SELECT config FROM tenants'));
  const dias = Number(t?.config?.retencao_anexos_dias);
  if (!Number.isFinite(dias) || dias < 30) return 0; // sem política (ou menor que 30 dias): nada é expurgado
  const limite = new Date(relogio.agora().getTime() - dias * DIA);
  const r = await c.query(`UPDATE anexos a SET conteudo = NULL, expurgado_em = $2 FROM ocorrencias o
    WHERE o.id = a.ocorrencia_id AND a.expurgado_em IS NULL AND o.estado IN ('resolvida','encerrada_sem_resolucao') AND o.encerrada_em < $1
    RETURNING a.id, a.ocorrencia_id`, [limite, relogio.agora()]);
  for (const x of r.rows) {
    await auditar(c, ctx, { acao: 'ocorrencia.anexo_expurgado', entidade: 'ocorrencia', entidadeId: x.ocorrencia_id, motivo: `Retenção de ${dias} dias`, depois: { anexo: x.id } });
  }
  return r.rowCount;
}

module.exports = { reconhecer, nomeSeguro, anexar, listar, baixar, arquivar, aplicarRetencao, MAX_BYTES };
