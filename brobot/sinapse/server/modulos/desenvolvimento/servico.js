'use strict';
// Desenvolvimento (DEV-005…008): incidentes com linha do tempo, aviso aos clientes afetados e post-mortem; backlog de
// melhorias com aprovação por outra pessoa da gestão; release que libera as melhorias; validação operacional (quem
// opera confirma que resolveu: liberado não é resolvido). Problema recorrente liga ocorrências à ação preventiva.
// Todo texto passa por `sanitizar` (sem senha, token ou chave em incidente e evidência — DEV-001).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio, HORA } = require('../../nucleo/relogio');
const { sanitizar } = require('../../nucleo/sanitizar');
const comunicacao = require('../comunicacao/servico');
const ocorrencias = require('../ocorrencias/servico');
const tarefas = require('../ocorrencias/tarefas');

const SEVERIDADE = { sev1: 'SEV1 · parada geral', sev2: 'SEV2 · parte dos clientes', sev3: 'SEV3 · degradação' };
const ESTADO_INCIDENTE = { aberto: 'Aberto', mitigado: 'Mitigado', resolvido: 'Resolvido', encerrado: 'Encerrado (post-mortem feito)' };
const PROXIMO = { aberto: ['mitigado', 'resolvido'], mitigado: ['resolvido'], resolvido: [], encerrado: [] };
const ESTADO_MELHORIA = { proposta: 'Proposta', aprovada: 'Aprovada', recusada: 'Recusada', em_desenvolvimento: 'Em desenvolvimento', liberada: 'Liberada (aguarda validação)', validada: 'Validada na operação' };

async function codigo(c, ctx, nome, prefixo) {
  const r = uma(await c.query(`INSERT INTO contadores (tenant_id, nome, valor) VALUES ($1, $2, 1)
    ON CONFLICT (tenant_id, nome) DO UPDATE SET valor = contadores.valor + 1 RETURNING valor`, [ctx.tenantId, nome]));
  return `${prefixo}-${String(r.valor).padStart(4, '0')}`;
}

async function incidente(c, id, trava = false) {
  const i = uma(await c.query(`SELECT * FROM incidentes WHERE id = $1 ${trava ? 'FOR UPDATE' : ''}`, [id]));
  if (!i) throw erro.naoEncontrado('Incidente');
  return i;
}

async function registrarAtualizacao(c, ctx, inc, { texto, estado = null, comunicar = false }) {
  let avisos = 0;
  if (comunicar) {
    // DEV-006: aviso a cada cliente afetado, pelo ponto focal e pelo canal permitido (consentimento e opt-out valem).
    const contas = (await c.query(`SELECT ct.id, ct.nome FROM incidente_contas ic JOIN contas ct ON ct.id = ic.conta_id WHERE ic.incidente_id = $1`, [inc.id])).rows;
    for (const ct of contas) {
      const pf = uma(await c.query("SELECT * FROM pontos_focais WHERE conta_id = $1 AND vigente ORDER BY (papel = 'principal') DESC LIMIT 1", [ct.id]));
      if (!pf) continue;
      const it = await comunicacao.programarEnvio(c, ctx, { contaId: ct.id, pontoFocal: pf, modelo: 'aviso_incidente',
        variaveis: { nome: pf.nome.split(' ')[0], conta: ct.nome, titulo: inc.titulo, texto, codigo: inc.codigo } });
      if (!it.motivoBloqueio) avisos++;
    }
  }
  return uma(await c.query(`INSERT INTO incidente_atualizacoes (tenant_id, incidente_id, texto, estado, comunicado_clientes, avisos, autor_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [ctx.tenantId, inc.id, texto, estado, comunicar, avisos, ctx.usuario?.id || null]));
}

async function abrirIncidente(c, ctx, d) {
  if (!SEVERIDADE[d.severidade]) throw erro.entrada('Severidade: sev1, sev2 ou sev3.');
  const cod = await codigo(c, ctx, 'incidente', 'INC');
  const agora = relogio.agora();
  const inc = uma(await c.query(`INSERT INTO incidentes (tenant_id, codigo, titulo, severidade, produto, impacto, responsavel_id, inicio_em, criado_por)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [ctx.tenantId, cod, sanitizar(d.titulo), d.severidade, d.produto || null, sanitizar(d.impacto), d.responsavelId || ctx.usuario?.id || null,
    d.inicioEm ? new Date(d.inicioEm) : agora, ctx.usuario?.id || null]));
  for (const contaId of [...new Set(d.contaIds || [])].slice(0, 500)) {
    await c.query(`INSERT INTO incidente_contas (tenant_id, incidente_id, conta_id) SELECT $1, $2, id FROM contas WHERE id = $3 ON CONFLICT DO NOTHING`, [ctx.tenantId, inc.id, contaId]);
  }
  await registrarAtualizacao(c, ctx, inc, { texto: sanitizar(d.primeiraAtualizacao || 'Incidente aberto. Investigando.'), estado: 'aberto', comunicar: !!d.comunicar });
  // SEV1: a gestão acompanha desde o primeiro minuto (tarefa da Supervisão, com prazo de 1 hora).
  if (d.severidade === 'sev1') {
    await tarefas.criar(c, ctx, { tipo: 'escalonamento', equipeCodigo: 'supervisao', chave: `inc-sev1:${inc.id}`, prazoEm: new Date(agora.getTime() + HORA),
      titulo: `${cod} (SEV1) · acompanhar o incidente e a comunicação aos clientes`.slice(0, 200) });
  }
  await auditar(c, ctx, { acao: 'incidente.aberto', entidade: 'incidente', entidadeId: inc.id, depois: { codigo: cod, severidade: inc.severidade } });
  await publicar(c, ctx, { tipo: 'incidente.aberto', agregado: 'incidente', agregadoId: inc.id, chave: `inc:${inc.id}:aberto`, payload: { codigo: cod, severidade: inc.severidade } });
  return inc;
}

async function atualizarIncidente(c, ctx, id, { texto, estado, comunicar, versao }) {
  const inc = await incidente(c, id, true);
  if (versao !== undefined && versao !== null && Number(versao) !== inc.version) throw erro.conflito('O incidente foi atualizado por outra pessoa. Atualize a tela.');
  if (inc.estado === 'encerrado') throw erro.conflito('Incidente encerrado: o post-mortem já foi feito.');
  if (estado && !PROXIMO[inc.estado].includes(estado)) throw erro.conflito(`De "${ESTADO_INCIDENTE[inc.estado]}" não se vai para "${ESTADO_INCIDENTE[estado] || estado}".`);
  const agora = relogio.agora();
  if (estado) {
    const col = { mitigado: { mitigado_em: agora }, resolvido: { mitigado_em: inc.mitigado_em || agora, resolvido_em: agora } }[estado];
    const sets = ['estado = $2', 'version = version + 1']; const vals = [id, estado];
    for (const [k, v] of Object.entries(col)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
    await c.query(`UPDATE incidentes SET ${sets.join(', ')} WHERE id = $1`, vals);
  } else await c.query('UPDATE incidentes SET version = version + 1 WHERE id = $1', [id]);
  const a = await registrarAtualizacao(c, ctx, inc, { texto: sanitizar(texto), estado: estado || null, comunicar });
  await auditar(c, ctx, { acao: `incidente.${estado || 'atualizado'}`, entidade: 'incidente', entidadeId: id, antes: { estado: inc.estado }, depois: { estado: estado || inc.estado, avisos: a.avisos } });
  if (estado) await publicar(c, ctx, { tipo: `incidente.${estado}`, agregado: 'incidente', agregadoId: id, chave: `inc:${id}:${estado}`, payload: { codigo: inc.codigo } });
  return a;
}

/** Post-mortem (DEV-006): causa raiz e lições; as ações preventivas viram melhorias propostas ligadas ao incidente. */
async function encerrarIncidente(c, ctx, id, { causaRaiz, licoes, acoes = [] }) {
  const inc = await incidente(c, id, true);
  if (inc.estado !== 'resolvido') throw erro.regra('incidente_nao_resolvido', 'Só incidente resolvido vai para o post-mortem.');
  if (!(causaRaiz && causaRaiz.trim().length >= 10) || !(licoes && licoes.trim().length >= 10)) throw erro.entrada('Post-mortem: escreva a causa raiz e as lições aprendidas (10+ caracteres cada).');
  await c.query("UPDATE incidentes SET estado = 'encerrado', causa_raiz = $2, licoes = $3, encerrado_em = $4, version = version + 1 WHERE id = $1",
    [id, sanitizar(causaRaiz), sanitizar(licoes), relogio.agora()]);
  const criadas = [];
  for (const titulo of acoes.slice(0, 10)) {
    criadas.push(await proporMelhoria(c, ctx, { titulo, descricao: `Ação preventiva do post-mortem de ${inc.codigo}: ${inc.titulo}. Causa raiz: ${causaRaiz}`.slice(0, 4000),
      tipo: 'preventiva', origem: 'incidente', incidenteId: id, prioridade: inc.severidade === 'sev1' ? 'alta' : 'media' }));
  }
  await auditar(c, ctx, { acao: 'incidente.encerrado', entidade: 'incidente', entidadeId: id, depois: { acoesPreventivas: criadas.map((m) => m.codigo) } });
  await publicar(c, ctx, { tipo: 'incidente.encerrado', agregado: 'incidente', agregadoId: id, chave: `inc:${id}:encerrado`, payload: { codigo: inc.codigo } });
  return { id, estado: 'encerrado', acoes: criadas.map((m) => ({ id: m.id, codigo: m.codigo })) };
}

async function listarIncidentes(c, { pagina = 1 } = {}) {
  const por = 20; const p = Math.max(1, Number(pagina) || 1);
  const r = await c.query(`SELECT i.id, i.codigo, i.titulo, i.severidade, i.estado, i.produto, i.inicio_em, i.resolvido_em, u.nome AS responsavel,
      (SELECT count(*)::int FROM incidente_contas ic WHERE ic.incidente_id = i.id) AS contas, count(*) OVER()::int AS total
    FROM incidentes i LEFT JOIN usuarios u ON u.id = i.responsavel_id ORDER BY (i.estado IN ('aberto','mitigado')) DESC, i.inicio_em DESC LIMIT $1 OFFSET $2`, [por, (p - 1) * por]);
  return { itens: r.rows.map(({ total, ...x }) => x), total: r.rows[0]?.total || 0, pagina: p, porPagina: por };
}

/** DEV-002/REC-005: fila técnica. Toda ocorrência que passou pelo Desenvolvimento, até ser resolvida: aguardando aceite,
 *  com o Desenvolvimento ou devolvida aguardando a validação da operação (DEV-005). Uma consulta só, paginada. */
const SITUACAO_FILA = { aguardando_aceite: 'Aguardando aceite do Desenvolvimento', com_dev: 'Com o Desenvolvimento',
  aguardando_validacao: 'Devolvida: aguardando validação da operação' };

async function filaTecnica(c, { pagina = 1 } = {}) {
  const por = 30; const p = Math.max(1, Number(pagina) || 1);
  const r = await c.query(`SELECT o.id, o.protocolo, o.titulo, o.prioridade, o.estado, o.prazo_em, o.criado_em, ct.nome AS conta, ct.vip,
      u.nome AS responsavel, (SELECT count(*)::int FROM ocorrencia_itens i WHERE i.ocorrencia_id = o.id) AS itens,
      h.estado AS handoff_estado, h.criado_em AS pedido_em, h.prazo_aceite_em, ua.nome AS aceito_por, de.nome AS de_equipe,
      CASE WHEN h.estado = 'pendente' THEN 'aguardando_aceite' WHEN e.codigo = 'dev' THEN 'com_dev' ELSE 'aguardando_validacao' END AS situacao,
      count(*) OVER()::int AS total
    FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id LEFT JOIN contas ct ON ct.id = o.conta_id LEFT JOIN usuarios u ON u.id = o.responsavel_id
    LEFT JOIN LATERAL (SELECT hh.* FROM handoffs hh JOIN equipes pe ON pe.id = hh.para_equipe_id WHERE hh.ocorrencia_id = o.id AND pe.codigo = 'dev'
      ORDER BY hh.criado_em DESC LIMIT 1) h ON true
    LEFT JOIN usuarios ua ON ua.id = h.aceito_por LEFT JOIN equipes de ON de.id = h.de_equipe_id
    WHERE o.estado NOT IN ('resolvida', 'encerrada_sem_resolucao') AND (e.codigo = 'dev' OR h.id IS NOT NULL)
    ORDER BY array_position(ARRAY['critica','alta','media','baixa'], o.prioridade), o.prazo_em NULLS LAST, o.criado_em
    LIMIT $1 OFFSET $2`, [por, (p - 1) * por]);
  return { itens: r.rows.map(({ total, ...x }) => ({ ...x, situacaoNome: SITUACAO_FILA[x.situacao] })), total: r.rows[0]?.total || 0, pagina: p, porPagina: por };
}

async function detalheIncidente(c, id) {
  const i = uma(await c.query('SELECT i.*, u.nome AS responsavel FROM incidentes i LEFT JOIN usuarios u ON u.id = i.responsavel_id WHERE i.id = $1', [id]));
  if (!i) throw erro.naoEncontrado('Incidente');
  const contas = (await c.query('SELECT ct.id, ct.nome, ct.vip FROM incidente_contas ic JOIN contas ct ON ct.id = ic.conta_id WHERE ic.incidente_id = $1 ORDER BY ct.nome', [id])).rows;
  const linha = (await c.query(`SELECT a.texto, a.estado, a.comunicado_clientes, a.avisos, a.criado_em, u.nome AS autor FROM incidente_atualizacoes a
    LEFT JOIN usuarios u ON u.id = a.autor_id WHERE a.incidente_id = $1 ORDER BY a.criado_em, a.id`, [id])).rows;
  const melhorias = (await c.query('SELECT id, codigo, titulo, estado FROM melhorias WHERE incidente_id = $1 ORDER BY criado_em', [id])).rows;
  const duracaoMin = i.resolvido_em ? Math.round((new Date(i.resolvido_em) - new Date(i.inicio_em)) / 60000) : null;
  return { ...i, contas, linha, melhorias, duracaoMin, proximos: PROXIMO[i.estado] };
}

async function melhoria(c, id) {
  const m = uma(await c.query('SELECT * FROM melhorias WHERE id = $1 FOR UPDATE', [id]));
  if (!m) throw erro.naoEncontrado('Melhoria');
  return m;
}

async function proporMelhoria(c, ctx, d) {
  const cod = await codigo(c, ctx, 'melhoria', 'MEL');
  const m = uma(await c.query(`INSERT INTO melhorias (tenant_id, codigo, titulo, descricao, tipo, origem, incidente_id, prioridade, proposta_por, link_externo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [ctx.tenantId, cod, sanitizar(d.titulo), sanitizar(d.descricao), d.tipo || 'melhoria', d.origem || 'interna', d.incidenteId || null, d.prioridade || 'media', ctx.usuario?.id || null, d.linkExterno || null]));
  for (const ocId of [...new Set(d.ocorrenciaIds || [])].slice(0, 50)) {
    if (!uma(await c.query('SELECT 1 FROM ocorrencias WHERE id = $1', [ocId]))) throw erro.entrada('Ocorrência vinculada não encontrada.');
    await c.query('INSERT INTO melhoria_ocorrencias (tenant_id, melhoria_id, ocorrencia_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ctx.tenantId, m.id, ocId]);
    await ocorrencias.anotar(c, ctx, ocId, `Vinculada à ${cod} (${m.titulo}): ação para resolver a causa.`);
  }
  await auditar(c, ctx, { acao: 'melhoria.proposta', entidade: 'melhoria', entidadeId: m.id, depois: { codigo: cod, tipo: m.tipo, origem: m.origem } });
  return m;
}

/** Ciclo da melhoria. `pode(perm)` = permissão do usuário. */
async function agirMelhoria(c, ctx, id, acao, d, pode) {
  const m = await melhoria(c, id);
  const muda = async (estado, extra = {}) => {
    const sets = ['estado = $2', 'atualizado_em = now()', 'version = version + 1']; const vals = [id, estado];
    for (const [k, v] of Object.entries(extra)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
    return uma(await c.query(`UPDATE melhorias SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals));
  };
  let r;
  switch (acao) {
    case 'aprovar': case 'recusar':
      if (m.estado !== 'proposta') throw erro.conflito('Só proposta é aprovada ou recusada.');
      if (!pode('ocorrencia.intervir')) throw erro.semPermissao('aprovar melhorias');
      if (m.proposta_por === ctx.usuario.id) throw erro.regra('aprovacao_propria', 'Quem propôs não aprova a própria melhoria. Peça a outra pessoa da gestão.');
      if (acao === 'recusar' && !(d.motivo && d.motivo.trim().length >= 5)) throw erro.entrada('Diga por que a melhoria foi recusada.');
      r = await muda(acao === 'aprovar' ? 'aprovada' : 'recusada', { decidida_por: ctx.usuario.id, decisao_motivo: d.motivo || null, prioridade: d.prioridade || m.prioridade });
      break;
    case 'iniciar':
      if (m.estado !== 'aprovada') throw erro.conflito('Só melhoria aprovada entra em desenvolvimento.');
      if (!pode('dev.gerir')) throw erro.semPermissao('mover melhorias no desenvolvimento');
      r = await muda('em_desenvolvimento', d.linkExterno ? { link_externo: d.linkExterno } : {});
      break;
    case 'validar':
      // DEV-005: quem valida é a operação (não o Desenvolvimento), com evidência de que resolveu de fato.
      if (m.estado !== 'liberada') throw erro.conflito('Só melhoria liberada em release é validada.');
      if (!pode('conta.editar') || ctx.usuario.papel === 'dev') throw erro.semPermissao('validar na operação (Suporte, CS, Operações ou gestão)');
      if (!(d.evidencia && d.evidencia.trim().length >= 10)) throw erro.entrada('Registre a evidência da validação (o que foi conferido e onde).');
      r = await muda('validada', { validada_por: ctx.usuario.id, validacao_evidencia: sanitizar(d.evidencia) });
      for (const v of (await c.query('SELECT ocorrencia_id FROM melhoria_ocorrencias WHERE melhoria_id = $1', [id])).rows) {
        await ocorrencias.anotar(c, ctx, v.ocorrencia_id, `${m.codigo} validada na operação: ${sanitizar(d.evidencia)}`.slice(0, 3000));
      }
      break;
    default: throw erro.entrada('Ação desconhecida.');
  }
  await auditar(c, ctx, { acao: `melhoria.${r.estado}`, entidade: 'melhoria', entidadeId: id, antes: { estado: m.estado }, depois: { estado: r.estado }, motivo: d.motivo || d.evidencia || null });
  await publicar(c, ctx, { tipo: 'melhoria.estado', agregado: 'melhoria', agregadoId: id, chave: `mel:${id}:${r.estado}`, payload: { codigo: m.codigo, estado: r.estado } });
  return r;
}

async function listarMelhorias(c, { estado, pagina = 1 } = {}) {
  const por = 30; const p = Math.max(1, Number(pagina) || 1); const params = [];
  let onde = '';
  if (estado && ESTADO_MELHORIA[estado]) { params.push(estado); onde = 'WHERE m.estado = $1'; }
  params.push(por, (p - 1) * por);
  const r = await c.query(`SELECT m.id, m.codigo, m.titulo, m.tipo, m.origem, m.prioridade, m.estado, m.link_externo, m.criado_em, r.versao AS release,
      up.nome AS proposta_por_nome, (SELECT count(*)::int FROM melhoria_ocorrencias mo WHERE mo.melhoria_id = m.id) AS ocorrencias, count(*) OVER()::int AS total
    FROM melhorias m LEFT JOIN releases r ON r.id = m.release_id LEFT JOIN usuarios up ON up.id = m.proposta_por ${onde}
    ORDER BY CASE m.estado WHEN 'liberada' THEN 0 WHEN 'proposta' THEN 1 WHEN 'aprovada' THEN 2 WHEN 'em_desenvolvimento' THEN 3 ELSE 4 END,
      CASE m.prioridade WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, m.criado_em
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { itens: r.rows.map(({ total, ...x }) => x), total: r.rows[0]?.total || 0, pagina: p, porPagina: por };
}

async function criarRelease(c, ctx, { versao, previstoPara, notas }) {
  const r = uma(await c.query('INSERT INTO releases (tenant_id, versao, previsto_para, notas) VALUES ($1,$2,$3,$4) RETURNING *',
    [ctx.tenantId, versao, previstoPara || null, notas ? sanitizar(notas) : null]));
  await auditar(c, ctx, { acao: 'release.criada', entidade: 'release', entidadeId: r.id, depois: { versao } });
  return r;
}

async function incluirNaRelease(c, ctx, releaseId, melhoriaId) {
  const rel = uma(await c.query('SELECT * FROM releases WHERE id = $1 FOR UPDATE', [releaseId]));
  if (!rel) throw erro.naoEncontrado('Release');
  if (rel.estado !== 'planejada') throw erro.conflito('Release já publicada.');
  const m = await melhoria(c, melhoriaId);
  if (!['aprovada', 'em_desenvolvimento'].includes(m.estado)) throw erro.regra('melhoria_nao_aprovada', 'Só melhoria aprovada entra numa release.');
  await c.query('UPDATE melhorias SET release_id = $2, atualizado_em = now() WHERE id = $1', [melhoriaId, releaseId]);
  await auditar(c, ctx, { acao: 'release.melhoria_incluida', entidade: 'release', entidadeId: releaseId, depois: { melhoria: m.codigo } });
  return { ok: true };
}

/** Publicar: as melhorias dela ficam "liberadas" e vira tarefa da operação validar cada uma (DEV-005). */
async function publicarRelease(c, ctx, releaseId, criarTarefa) {
  const rel = uma(await c.query('SELECT * FROM releases WHERE id = $1 FOR UPDATE', [releaseId]));
  if (!rel) throw erro.naoEncontrado('Release');
  if (rel.estado !== 'planejada') throw erro.conflito('Release já publicada.');
  const ms = (await c.query("SELECT id, codigo, titulo FROM melhorias WHERE release_id = $1 AND estado IN ('aprovada','em_desenvolvimento')", [releaseId])).rows;
  if (!ms.length) throw erro.regra('release_vazia', 'Inclua pelo menos uma melhoria aprovada antes de publicar.');
  const agora = relogio.agora();
  await c.query("UPDATE releases SET estado = 'publicada', publicada_em = $2, publicada_por = $3 WHERE id = $1", [releaseId, agora, ctx.usuario?.id || null]);
  for (const m of ms) {
    await c.query("UPDATE melhorias SET estado = 'liberada', atualizado_em = now(), version = version + 1 WHERE id = $1", [m.id]);
    await criarTarefa({ tipo: 'validar_correcao', equipeCodigo: 'suporte', chave: `validar-mel:${m.id}`, prazoEm: new Date(agora.getTime() + 24 * HORA),
      titulo: `Validar na operação: ${m.codigo} · ${m.titulo} (release ${rel.versao})`.slice(0, 200) });
  }
  await auditar(c, ctx, { acao: 'release.publicada', entidade: 'release', entidadeId: releaseId, depois: { versao: rel.versao, melhorias: ms.map((m) => m.codigo) } });
  await publicar(c, ctx, { tipo: 'release.publicada', agregado: 'release', agregadoId: releaseId, chave: `rel:${releaseId}:publicada`, payload: { versao: rel.versao, melhorias: ms.length } });
  return { id: releaseId, estado: 'publicada', melhorias: ms.length };
}

async function listarReleases(c) {
  return (await c.query(`SELECT r.*, (SELECT count(*)::int FROM melhorias m WHERE m.release_id = r.id) AS melhorias,
      (SELECT count(*)::int FROM melhorias m WHERE m.release_id = r.id AND m.estado = 'validada') AS validadas
    FROM releases r ORDER BY (r.estado = 'planejada') DESC, coalesce(r.publicada_em, r.criado_em) DESC LIMIT 30`)).rows;
}

module.exports = { SEVERIDADE, ESTADO_INCIDENTE, ESTADO_MELHORIA, SITUACAO_FILA, filaTecnica, abrirIncidente, atualizarIncidente, encerrarIncidente, listarIncidentes, detalheIncidente,
  proporMelhoria, agirMelhoria, listarMelhorias, criarRelease, incluirNaRelease, publicarRelease, listarReleases };
