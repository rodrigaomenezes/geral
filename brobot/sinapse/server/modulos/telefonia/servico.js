'use strict';
// Central de telefonia (portada do Lumen Operações). A tela fala só com esta central, que escolhe o provedor,
// controla o estado de cada ligação (máquina de estados), registra os eventos e, no fim, alimenta o fluxo:
// a ligação vira interação na ocorrência/oportunidade e, se veio de uma tarefa de ligação, conclui a tarefa com
// "atendeu/não atendeu" — o processo que esperava a ligação (ex.: pré-rodada) segue sozinho pelo caminho certo.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');
const { normalizarTelefone } = require('../../nucleo/telefone');
const { cifrar } = require('../../nucleo/cifra');
const tarefas = require('../ocorrencias/tarefas');
const { PROVEDORES } = require('./provedores');

const ATIVOS = ['criada', 'discando', 'tocando', 'em_ligacao', 'em_espera'];
const RESULTADOS = ['atendida', 'nao_atendida', 'ocupado', 'falhou', 'cancelada', 'perdida'];
const ROTULO = { atendida: 'atendida', nao_atendida: 'não atendeu', ocupado: 'ocupado', falhou: 'não completou', cancelada: 'cancelada', perdida: 'perdida', chamando: 'em andamento' };
// evento → de quais estados pode vir e para qual leva (null = só registra)
const TRANSICOES = {
  discando: { de: ['criada'], para: 'discando' },
  tocando: { de: ['criada', 'discando'], para: 'tocando' },
  atendida: { de: ['criada', 'discando', 'tocando'], para: 'em_ligacao' },
  espera: { de: ['em_ligacao'], para: 'em_espera' },
  retomada: { de: ['em_espera'], para: 'em_ligacao' },
  mudo: { de: ['em_ligacao', 'em_espera'], para: null },
  som: { de: ['em_ligacao', 'em_espera'], para: null },
};
const fmtDuracao = (s) => (s >= 60 ? `${Math.floor(s / 60)}min${String(s % 60).padStart(2, '0')}s` : `${s}s`);

async function config(c) {
  return uma(await c.query('SELECT * FROM telefonia_config')) || { provedor: 'desligado', celular: false };
}
const ramalDe = async (c, usuarioId) => uma(await c.query('SELECT * FROM telefonia_ramais WHERE usuario_id = $1', [usuarioId]));

function provedorDoCanal(canal, cfg) {
  if (cfg.provedor === 'desligado') return null;
  if (canal === 'celular') return cfg.celular ? PROVEDORES.celular : null;
  return PROVEDORES[cfg.provedor] || null;
}

/** Como esta pessoa pode ligar agora (computador e/ou celular). */
async function canais(c, usuario) {
  const cfg = await config(c);
  if (cfg.provedor === 'desligado' && !cfg.celular) return { ativo: false, motivo: 'A telefonia pelo sistema está desligada.', computador: { ok: false }, celular: { ok: false } };
  const p = provedorDoCanal('computador', cfg);
  const pc = p ? p.pronto(cfg, await ramalDe(c, usuario.id)) : { ok: false, motivo: 'Ligação pelo computador desligada.' };
  return { ativo: pc.ok || !!cfg.celular, provedor: p?.id || null, operadora: cfg.operadora || null, motivo: pc.ok ? null : pc.motivo,
    computador: { ok: pc.ok, motivo: pc.motivo || null, recursos: p?.recursos }, celular: { ok: !!cfg.celular } };
}

async function sessaoWebRTC(c, usuario) {
  const cfg = await config(c);
  const p = provedorDoCanal('computador', cfg);
  if (!p) throw erro.conflito('Ligação pelo computador desligada.');
  const ramal = await ramalDe(c, usuario.id);
  const s = p.pronto(cfg, ramal);
  if (!s.ok) throw erro.conflito(s.motivo);
  return p.sessao(cfg, ramal, usuario);
}

const resumo = (x) => ({ id: x.id, estado: x.estado, status: x.status, rotulo: ROTULO[x.status] || x.status, canal: x.canal, provedor: x.provedor, direcao: x.direcao,
  numero: x.numero, nome: x.nome, duracao_seg: x.duracao_seg, duracao: fmtDuracao(x.duracao_seg || 0), tarefa_id: x.tarefa_id, ocorrencia_id: x.ocorrencia_id,
  oportunidade_id: x.oportunidade_id, conta_id: x.conta_id });

async function registrarEvento(c, ctx, ch, nome, dados) {
  await c.query('INSERT INTO chamada_eventos (tenant_id, chamada_id, evento, dados, usuario_id) VALUES ($1,$2,$3,$4,$5)',
    [ctx.tenantId, ch.id, nome, dados ? JSON.stringify(dados) : null, ctx.usuario?.id || null]);
}

/** Descobre para quem ligar a partir da tarefa, ocorrência, oportunidade ou conta (ponto focal principal). */
async function alvoDaLigacao(c, d) {
  const alvo = { conta_id: d.contaId || null, ocorrencia_id: d.ocorrenciaId || null, oportunidade_id: d.oportunidadeId || null, tarefa_id: d.tarefaId || null,
    numero: d.numero ? normalizarTelefone(d.numero) : null, nome: d.nome || null, ponto_focal_id: null };
  if (alvo.tarefa_id) {
    const t = uma(await c.query('SELECT ocorrencia_id, oportunidade_id, estado, tipo FROM tarefas WHERE id = $1', [alvo.tarefa_id]));
    if (!t) throw erro.naoEncontrado('Tarefa');
    alvo.ocorrencia_id = alvo.ocorrencia_id || t.ocorrencia_id;
    alvo.oportunidade_id = alvo.oportunidade_id || t.oportunidade_id;
  }
  if (alvo.ocorrencia_id && !alvo.conta_id) alvo.conta_id = uma(await c.query('SELECT conta_id FROM ocorrencias WHERE id = $1', [alvo.ocorrencia_id]))?.conta_id || null;
  if (alvo.oportunidade_id && !alvo.numero) {
    const o = uma(await c.query('SELECT empresa, contato_nome, contato_telefone, conta_id FROM oportunidades WHERE id = $1', [alvo.oportunidade_id]));
    if (o) { alvo.numero = o.contato_telefone; alvo.nome = alvo.nome || `${o.contato_nome || ''} (${o.empresa})`.trim(); alvo.conta_id = alvo.conta_id || o.conta_id; }
  }
  if (!alvo.numero && alvo.conta_id) {
    const pf = uma(await c.query("SELECT p.id, p.nome, p.telefone, c.nome AS conta FROM pontos_focais p JOIN contas c ON c.id = p.conta_id WHERE p.conta_id = $1 AND p.vigente AND p.telefone IS NOT NULL ORDER BY p.papel = 'principal' DESC LIMIT 1", [alvo.conta_id]));
    if (pf) { alvo.numero = pf.telefone; alvo.nome = alvo.nome || `${pf.nome} (${pf.conta})`; alvo.ponto_focal_id = pf.id; }
  }
  if (!alvo.numero) throw erro.regra('sem_numero', 'Não há telefone para ligar: cadastre o ponto focal (ou o contato) com celular.');
  return alvo;
}

/** Fecha ligações deixadas abertas (aba fechada no meio) para não travar a próxima. */
async function fecharAbandonadas(c, ctx, usuarioId) {
  const abertas = (await c.query(`SELECT * FROM chamadas WHERE estado = ANY($1) AND ($2::uuid IS NOT NULL AND usuario_id = $2 OR atualizado_em < now() - interval '4 hours')`,
    [ATIVOS, usuarioId || null])).rows;
  for (const ch of abertas) await encerrar(c, ctx, ch, { resultado: ch.atendida_em ? 'atendida' : 'falhou', motivo: 'ligação deixada aberta' }, { silencioso: true });
}

async function criar(c, ctx, d) {
  const cfg = await config(c);
  const canal = d.canal === 'celular' ? 'celular' : 'computador';
  const p = provedorDoCanal(canal, cfg);
  if (!p) throw erro.conflito(canal === 'celular' ? 'A ligação pelo celular está desligada.' : 'A ligação pelo computador está desligada.');
  const s = p.pronto(cfg, await ramalDe(c, ctx.usuario.id));
  if (!s.ok) throw erro.conflito(s.motivo);
  await fecharAbandonadas(c, ctx, ctx.usuario.id);
  const alvo = await alvoDaLigacao(c, d);
  const ch = uma(await c.query(
    `INSERT INTO chamadas (tenant_id, usuario_id, conta_id, ponto_focal_id, ocorrencia_id, oportunidade_id, tarefa_id, numero, nome, provedor, canal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [ctx.tenantId, ctx.usuario.id, alvo.conta_id, alvo.ponto_focal_id, alvo.ocorrencia_id, alvo.oportunidade_id, alvo.tarefa_id, alvo.numero, alvo.nome, p.id, canal]));
  await registrarEvento(c, ctx, ch, 'criada', { canal });
  return { ...resumo(ch), discar: p.discar(ch.numero, cfg) };
}

async function carregar(c, ctx, id) {
  const ch = uma(await c.query('SELECT * FROM chamadas WHERE id = $1 FOR UPDATE', [id]));
  if (!ch || (ch.usuario_id !== ctx.usuario.id && !['supervisor', 'admin'].includes(ctx.usuario.papel))) throw erro.naoEncontrado('Ligação');
  return ch;
}

async function evento(c, ctx, id, nome, dados = {}) {
  const ch = await carregar(c, ctx, id);
  if (nome === 'encerrada') return resumo(await encerrar(c, ctx, ch, dados));
  const t = TRANSICOES[nome];
  if (!t) throw erro.entrada('Evento de ligação desconhecido.');
  if (ch.estado === 'encerrada') return resumo(ch); // evento atrasado de uma ligação que já acabou
  if (!t.de.includes(ch.estado)) throw erro.conflito(`A ligação está ${ch.estado.replace('_', ' ')}: não dá para "${nome}".`);
  const sets = ['atualizado_em = now()']; const vals = [ch.id];
  if (t.para) { vals.push(t.para); sets.push(`estado = $${vals.length}`); }
  if (nome === 'tocando') sets.push('tocando_em = coalesce(tocando_em, now())');
  if (nome === 'atendida') sets.push("atendida_em = coalesce(atendida_em, now()), status = 'atendida'");
  const atual = uma(await c.query(`UPDATE chamadas SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals));
  await registrarEvento(c, ctx, ch, nome, null);
  return resumo(atual);
}

async function encerrar(c, ctx, ch, { resultado, motivo, anotacao } = {}, { silencioso = false } = {}) {
  if (ch.estado === 'encerrada') return ch;
  let status;
  if (ch.atendida_em) status = 'atendida';
  else if (resultado === 'atendida') status = ch.canal === 'celular' ? 'atendida' : 'falhou'; // no computador, "atendida" só vem do evento da operadora
  else status = RESULTADOS.includes(resultado) ? resultado : 'falhou';
  const f = uma(await c.query(
    `UPDATE chamadas SET estado = 'encerrada', status = $2, motivo = $3, anotacao = $4, encerrada_em = now(), atualizado_em = now(),
       duracao_seg = CASE WHEN atendida_em IS NULL THEN 0 ELSE GREATEST(0, EXTRACT(EPOCH FROM now() - atendida_em)::int) END
     WHERE id = $1 RETURNING *`, [ch.id, status, motivo ? String(motivo).slice(0, 120) : null, anotacao ? String(anotacao).slice(0, 1000) : null]));
  await registrarEvento(c, ctx, ch, 'encerrada', { status });
  if (!silencioso) await noFluxo(c, ctx, f);
  return f;
}

/** Fim da ligação → linha do tempo e tarefa. Falha técnica e cancelada antes de discar não contam como tentativa. */
async function noFluxo(c, ctx, f) {
  if (['falhou', 'cancelada'].includes(f.status)) return;
  const texto = `📞 Ligação ${f.canal === 'celular' ? 'pelo celular' : 'pelo computador'} para ${f.nome || f.numero} · ${ROTULO[f.status]}${f.duracao_seg ? ` (${fmtDuracao(f.duracao_seg)})` : ''}${f.anotacao ? `\n${f.anotacao}` : ''}`;
  if (f.ocorrencia_id || f.conta_id) {
    await c.query(`INSERT INTO interacoes (tenant_id, ocorrencia_id, conta_id, canal, direcao, destinatario, texto, status_entrega, autor_id, chamada_id)
      VALUES ($1,$2,$3,'telefone','saida',$4,$5,'registrada',$6,$7)`, [ctx.tenantId, f.ocorrencia_id, f.conta_id, f.numero, texto, ctx.usuario?.id || null, f.id]);
  }
  if (f.oportunidade_id) {
    await auditar(c, ctx, { acao: 'oportunidade.ligacao', entidade: 'oportunidade', entidadeId: f.oportunidade_id, depois: { status: f.status, duracao: f.duracao_seg }, motivo: f.anotacao });
  }
  if (f.tarefa_id) {
    const t = uma(await c.query('SELECT tipo, estado FROM tarefas WHERE id = $1', [f.tarefa_id]));
    if (t && t.tipo === 'ligacao' && t.estado === 'aberta') {
      await tarefas.concluir(c, ctx, f.tarefa_id, f.anotacao || `Ligação ${ROTULO[f.status]}${f.duracao_seg ? ` (${fmtDuracao(f.duracao_seg)})` : ''}`,
        f.status === 'atendida' ? 'atendeu' : 'nao_atendeu');
    }
  }
  await publicar(c, ctx, { tipo: 'ligacao.encerrada', agregado: 'chamada', agregadoId: f.id, payload: { status: f.status, contaId: f.conta_id, ocorrenciaId: f.ocorrencia_id } });
}

async function listar(c, usuario, { todas, pagina = 1 } = {}) {
  const gestor = ['supervisor', 'admin'].includes(usuario.papel) && todas;
  const r = await c.query(
    `SELECT ch.*, u.nome AS usuario_nome, count(*) OVER()::int AS total FROM chamadas ch JOIN usuarios u ON u.id = ch.usuario_id
     ${gestor ? '' : 'WHERE ch.usuario_id = $3'} ORDER BY ch.iniciada_em DESC LIMIT $1 OFFSET $2`,
    gestor ? [30, (pagina - 1) * 30] : [30, (pagina - 1) * 30, usuario.id]);
  return { itens: r.rows.map(({ total, ...x }) => ({ ...resumo(x), iniciada_em: x.iniciada_em, usuario_nome: x.usuario_nome, anotacao: x.anotacao })), total: r.rows[0]?.total || 0, pagina };
}

/** Painel da gestão: ligações por pessoa no período. */
async function painel(c, { dias = 7 } = {}) {
  const r = await c.query(
    `SELECT u.id, u.nome, count(ch.id)::int AS total, count(ch.id) FILTER (WHERE ch.status = 'atendida')::int AS atendidas,
       count(ch.id) FILTER (WHERE ch.status IN ('nao_atendida','ocupado'))::int AS nao_atendidas, count(ch.id) FILTER (WHERE ch.canal = 'celular')::int AS celular,
       coalesce(sum(ch.duracao_seg), 0)::int AS segundos
     FROM usuarios u LEFT JOIN chamadas ch ON ch.usuario_id = u.id AND ch.iniciada_em > now() - make_interval(days => $1) AND ch.status NOT IN ('cancelada','falhou')
     WHERE u.ativo GROUP BY u.id, u.nome HAVING count(ch.id) > 0 ORDER BY total DESC`, [dias]);
  return { dias, equipe: r.rows.map((x) => ({ ...x, taxa: x.total ? Math.round((x.atendidas / x.total) * 100) : null, media: x.atendidas ? fmtDuracao(Math.round(x.segundos / x.atendidas)) : '—' })) };
}

async function salvarConfig(c, ctx, d) {
  const antes = await config(c);
  await c.query(`INSERT INTO telefonia_config (tenant_id, provedor, operadora, ws_url, dominio, ice_servers, formato_numero, prefixo, celular, atualizado_por, atualizado_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now()) ON CONFLICT (tenant_id) DO UPDATE SET provedor = EXCLUDED.provedor, operadora = EXCLUDED.operadora,
      ws_url = EXCLUDED.ws_url, dominio = EXCLUDED.dominio, ice_servers = EXCLUDED.ice_servers, formato_numero = EXCLUDED.formato_numero,
      prefixo = EXCLUDED.prefixo, celular = EXCLUDED.celular, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
  [ctx.tenantId, d.provedor, d.operadora || null, d.wsUrl || null, d.dominio || null, d.iceServers || null, d.formatoNumero || '55', d.prefixo || null, d.celular !== false, ctx.usuario.id]);
  await auditar(c, ctx, { acao: 'telefonia.config', entidade: 'telefonia', antes: { provedor: antes.provedor }, depois: { provedor: d.provedor, operadora: d.operadora || null } });
  return config(c);
}

async function salvarRamal(c, ctx, usuarioId, d) {
  const senha = d.senha ? cifrar(d.senha) : null;
  await c.query(`INSERT INTO telefonia_ramais (tenant_id, usuario_id, usuario_sip, senha_cifrada, nome_exibicao, ativo) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (tenant_id, usuario_id) DO UPDATE SET usuario_sip = EXCLUDED.usuario_sip, senha_cifrada = coalesce(EXCLUDED.senha_cifrada, telefonia_ramais.senha_cifrada),
      nome_exibicao = EXCLUDED.nome_exibicao, ativo = EXCLUDED.ativo, atualizado_em = now()`,
  [ctx.tenantId, usuarioId, d.usuarioSip, senha, d.nomeExibicao || null, d.ativo !== false]);
  await auditar(c, ctx, { acao: 'telefonia.ramal', entidade: 'usuario', entidadeId: usuarioId, depois: { usuarioSip: d.usuarioSip, senhaAlterada: !!d.senha } });
  return { ok: true };
}

async function admin(c) {
  const cfg = await config(c);
  const ramais = (await c.query(`SELECT u.id AS usuario_id, u.nome, r.usuario_sip, r.nome_exibicao, r.ativo, (r.senha_cifrada IS NOT NULL) AS tem_senha
    FROM usuarios u LEFT JOIN telefonia_ramais r ON r.usuario_id = u.id WHERE u.ativo ORDER BY u.nome`)).rows;
  return { config: cfg, ramais };
}

async function jobManutencao(c, ctx) {
  await fecharAbandonadas(c, ctx, null);
  return { proximaEm: new Date(relogio.agora().getTime() + 30 * 60e3) };
}

module.exports = { canais, sessaoWebRTC, criar, evento, listar, painel, salvarConfig, salvarRamal, admin, jobManutencao, ROTULO, TRANSICOES };
