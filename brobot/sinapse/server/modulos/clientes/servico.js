'use strict';
// Carteira: contas, VIP, pontos focais (principal/suplente com histórico), credenciais (só status) e
// situação financeira mínima vinda do OMIE. Roteamento RN-001: VIP → CS, demais → Suporte, salvo exceção.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { publicar, auditar } = require('../../nucleo/registro');
const { normalizarTelefone, mascararTelefone } = require('../../nucleo/telefone');
const { pode } = require('../identidade/permissoes');

const POR_PAGINA = 25;

/** RN-001 / GOV-005: código da equipe que atende a conta. */
function equipeDaConta(conta) {
  if (conta.roteamento_excecao) return conta.roteamento_excecao;
  return conta.vip ? 'cs' : 'suporte';
}

/** FIN-010: quem não é do Financeiro vê só se há atenção financeira, sem detalhe. */
function situacaoVisivel(situacao, sincronizadoEm, usuario) {
  if (!situacao) return { rotulo: 'Sem dado do OMIE', nivel: 'neutro' };
  if (situacao === 'desconhecido') return { rotulo: 'Sem dado do OMIE', nivel: 'neutro', sincronizadoEm };
  if (pode(usuario, 'financeiro.detalhe')) {
    return { rotulo: situacao === 'em_dia' ? 'Em dia' : 'Em atraso', nivel: situacao === 'em_dia' ? 'ok' : 'alerta', sincronizadoEm };
  }
  return { rotulo: situacao === 'em_dia' ? 'Sem restrição' : 'Atenção: consulte o Financeiro', nivel: situacao === 'em_dia' ? 'ok' : 'alerta', sincronizadoEm };
}

async function listar(c, usuario, { q, pagina = 1, filtro } = {}) {
  const params = [];
  const onde = ['c.arquivada_em IS NULL'];
  if (q) { params.push(`%${q}%`); onde.push(`(c.nome ILIKE $${params.length} OR c.cnpj LIKE $${params.length})`); }
  if (filtro === 'vip') onde.push('c.vip');
  if (filtro === 'sem_ponto_focal') onde.push('NOT EXISTS (SELECT 1 FROM pontos_focais p WHERE p.conta_id = c.id AND p.vigente AND p.papel = \'principal\')');
  params.push(POR_PAGINA, (Math.max(1, pagina) - 1) * POR_PAGINA);
  const r = await c.query(
    `SELECT c.id, c.nome, c.cnpj, c.segmento, c.status, c.vip, c.roteamento_excecao,
       EXISTS (SELECT 1 FROM pontos_focais p WHERE p.conta_id = c.id AND p.vigente AND p.papel = 'principal') AS tem_principal,
       EXISTS (SELECT 1 FROM pontos_focais p WHERE p.conta_id = c.id AND p.vigente AND p.papel = 'suplente') AS tem_suplente,
       (SELECT count(*)::int FROM credenciais_ref cr WHERE cr.conta_id = c.id AND cr.status <> 'ok') AS credenciais_pendentes,
       (SELECT count(*)::int FROM ocorrencias o WHERE o.conta_id = c.id AND o.estado NOT IN ('resolvida','encerrada_sem_resolucao')) AS ocorrencias_ativas,
       sf.situacao, sf.sincronizado_em, count(*) OVER()::int AS total
     FROM contas c LEFT JOIN status_financeiro sf ON sf.conta_id = c.id
     WHERE ${onde.join(' AND ')} ORDER BY c.vip DESC, c.nome LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    itens: r.rows.map(({ total, situacao, sincronizado_em: s, ...x }) => ({
      ...x, equipe: equipeDaConta(x), financeiro: situacaoVisivel(situacao, s, usuario),
    })),
    total: r.rows[0]?.total || 0, pagina, porPagina: POR_PAGINA,
  };
}

async function buscar(c, id) {
  return uma(await c.query('SELECT * FROM contas WHERE id = $1 AND arquivada_em IS NULL', [id]));
}

async function detalhe(c, usuario, id) {
  const conta = await buscar(c, id);
  if (!conta) throw erro.naoEncontrado('Conta');
  // Consultas em sequência: a mesma transação não executa comandos em paralelo.
  const pfs = await c.query('SELECT * FROM pontos_focais WHERE conta_id = $1 ORDER BY vigente DESC, papel, criado_em DESC', [id]);
  const creds = await c.query('SELECT id, tipo, status, expira_em, referencia_platform, atualizado_em FROM credenciais_ref WHERE conta_id = $1 ORDER BY tipo', [id]);
  const fin = await c.query('SELECT situacao, sincronizado_em FROM status_financeiro WHERE conta_id = $1', [id]);
  const rodadas = await c.query('SELECT id, id_platform, produto, agendada_para, estado, pendencias_detectadas FROM rodadas WHERE conta_id = $1 ORDER BY agendada_para DESC LIMIT 10', [id]);
  const ocs = await c.query(`SELECT id, protocolo, titulo, estado, prioridade, criado_em FROM ocorrencias WHERE conta_id = $1
             ORDER BY criado_em DESC LIMIT 10`, [id]);
  const vigentes = pfs.rows.filter((p) => p.vigente);
  const mostrarContato = pode(usuario, 'conta.editar');
  return {
    ...conta,
    equipe: equipeDaConta(conta),
    alertas: alertasDaConta(vigentes),
    pontosFocais: pfs.rows.map((p) => ({ ...p, telefone: mostrarContato ? p.telefone : mascararTelefone(p.telefone) })),
    credenciais: creds.rows,
    financeiro: situacaoVisivel(fin.rows[0]?.situacao, fin.rows[0]?.sincronizado_em, usuario),
    rodadas: rodadas.rows,
    ocorrencias: ocs.rows,
  };
}

/** GOV-007 / RN-002: sem ponto focal principal válido, marcos críticos ficam bloqueados. */
function alertasDaConta(vigentes) {
  const a = [];
  if (!vigentes.some((p) => p.papel === 'principal')) a.push({ codigo: 'sem_ponto_focal', texto: 'Conta sem ponto focal principal: contatos de rodada ficam bloqueados.' });
  if (!vigentes.some((p) => p.papel === 'suplente')) a.push({ codigo: 'sem_suplente', texto: 'Conta sem ponto focal suplente.' });
  if (vigentes.some((p) => p.canal_preferido === 'whatsapp' && !p.consentimento_whatsapp)) a.push({ codigo: 'sem_consentimento', texto: 'Ponto focal sem consentimento para WhatsApp: os avisos vão por e-mail.' });
  return a;
}

/** GOV-006: troca o ponto focal guardando o histórico (o anterior deixa de ser vigente, não é apagado). */
async function definirPontoFocal(c, ctx, contaId, d) {
  const conta = await buscar(c, contaId);
  if (!conta) throw erro.naoEncontrado('Conta');
  const telefone = d.telefone ? normalizarTelefone(d.telefone) : null;
  if (d.telefone && !telefone) throw erro.entrada('Telefone inválido. Use DDD + número, ex.: (11) 91234-5678.', [{ campo: 'telefone', problema: 'inválido' }]);
  if (!telefone && !d.email) throw erro.entrada('Informe telefone ou e-mail do ponto focal.');
  const anterior = uma(await c.query(
    `UPDATE pontos_focais SET vigente = false, encerrado_em = now() WHERE conta_id = $1 AND papel = $2 AND vigente
     RETURNING id, nome`, [contaId, d.papel],
  ));
  const novo = uma(await c.query(
    `INSERT INTO pontos_focais (tenant_id, conta_id, papel, nome, telefone, email, canal_preferido, consentimento_whatsapp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [ctx.tenantId, contaId, d.papel, d.nome, telefone, d.email || null, d.canalPreferido || (telefone ? 'whatsapp' : 'email'),
      d.consentimentoWhatsapp === true],
  ));
  await auditar(c, ctx, { acao: 'conta.ponto_focal_definido', entidade: 'conta', entidadeId: contaId,
    antes: anterior ? { nome: anterior.nome } : null, depois: { papel: d.papel, nome: d.nome } });
  await publicar(c, ctx, { tipo: 'conta.ponto_focal_definido', agregado: 'conta', agregadoId: contaId,
    payload: { papel: d.papel, pontoFocalId: novo.id } });
  return novo;
}

/** Grupo de WhatsApp do cliente: destino "no grupo" dos processos (decisão de 03/11/2026). */
async function definirGrupo(c, ctx, contaId, grupo) {
  const conta = await buscar(c, contaId);
  if (!conta) throw erro.naoEncontrado('Conta');
  await c.query('UPDATE contas SET grupo_whatsapp = $2, version = version + 1, atualizado_em = now() WHERE id = $1', [contaId, grupo || null]);
  await auditar(c, ctx, { acao: 'conta.grupo_definido', entidade: 'conta', entidadeId: contaId, antes: { grupo: conta.grupo_whatsapp }, depois: { grupo: grupo || null } });
  await publicar(c, ctx, { tipo: 'conta.grupo_definido', agregado: 'conta', agregadoId: contaId, payload: { contaId } });
  return { ok: true };
}

/**
 * FIN-006 / AT-015: sem regra de bloqueio aprovada, nenhum bloqueio é feito — e o pedido fica auditado.
 * Devolve a recusa (em vez de lançar erro) para a auditoria não ser desfeita junto com a transação.
 */
async function pedirBloqueio(c, ctx, contaId, motivo) {
  const conta = await buscar(c, contaId);
  if (!conta) throw erro.naoEncontrado('Conta');
  const regras = ((await c.query("SELECT config -> 'regrasBloqueioAprovadas' AS r FROM tenants")).rows[0]?.r) || [];
  await auditar(c, ctx, { acao: 'financeiro.bloqueio_recusado', entidade: 'conta', entidadeId: contaId, motivo,
    depois: { resultado: 'nenhuma ação na Platform', regrasAprovadas: regras.length } });
  return {
    recusado: true,
    erro: erro.regra('sem_regra_aprovada',
      'Não existe regra de bloqueio por inadimplência aprovada. Nenhuma ação foi feita na Platform; o pedido ficou registrado na auditoria.'),
  };
}

async function pontoFocalPorContato(c, { telefone, email }) {
  if (telefone) {
    const r = uma(await c.query('SELECT * FROM pontos_focais WHERE telefone = $1 AND vigente ORDER BY papel LIMIT 1', [telefone]));
    if (r) return r;
  }
  if (email) return uma(await c.query('SELECT * FROM pontos_focais WHERE lower(email) = lower($1) AND vigente LIMIT 1', [email]));
  return null;
}

async function pontosFocaisVigentes(c, contaId) {
  return (await c.query("SELECT * FROM pontos_focais WHERE conta_id = $1 AND vigente ORDER BY papel = 'principal' DESC", [contaId])).rows;
}

module.exports = {
  definirGrupo, equipeDaConta, situacaoVisivel, listar, buscar, detalhe, definirPontoFocal, pedirBloqueio, pontoFocalPorContato,
  pontosFocaisVigentes, alertasDaConta,
};
