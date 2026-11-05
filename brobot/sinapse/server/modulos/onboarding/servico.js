'use strict';
// Onboarding e offboarding por checklist (ONB-001…012, CS-012). Uma conta tem no máximo um checklist aberto de cada
// tipo; os itens são copiados do modelo ativo na abertura (versão guardada). Itens com verificação automática são
// conferidos pelo sistema a cada leitura e na varredura do supervisor; o resto a equipe marca com evidência.
// Item obrigatório só sai do caminho com evidência ou com dispensa aprovada por outra pessoa da gestão (ONB-010).
// Concluir onboarding ativa a conta; concluir offboarding encerra (nada é apagado).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar, publicar } = require('../../nucleo/registro');
const { relogio, DIA, HORA } = require('../../nucleo/relogio');
const { pode } = require('../identidade/permissoes');
const { PADRAO, GRUPOS, validarItens, progresso } = require('./modelos');

const ROTULO = { onboarding: 'Onboarding', offboarding: 'Offboarding' };

// Verificações automáticas: devolvem a evidência (texto) quando o dado do sistema comprova o item; senão null.
const VERIFICACOES = {
  async conta_com_produtos(c, ck) {
    const r = uma(await c.query('SELECT produtos FROM contas WHERE id = $1', [ck.conta_id]));
    return r?.produtos?.length ? `Produtos na conta: ${r.produtos.join(', ')}` : null;
  },
  async ponto_focal(c, ck) {
    const r = uma(await c.query("SELECT nome FROM pontos_focais WHERE conta_id = $1 AND vigente AND papel = 'principal'", [ck.conta_id]));
    return r ? `Ponto focal principal: ${r.nome}` : null;
  },
  async grupo_whatsapp(c, ck) {
    return uma(await c.query('SELECT 1 FROM contas WHERE id = $1 AND grupo_whatsapp IS NOT NULL', [ck.conta_id])) ? 'Grupo do WhatsApp cadastrado na conta' : null;
  },
  async provisionamento_confirmado(c, ck) {
    const r = uma(await c.query(`SELECT arquivo, resolvido_em FROM exportacoes WHERE tipo = 'platform_provisionamento' AND estado = 'confirmado'
      AND resolvido_em >= $1 ORDER BY resolvido_em DESC LIMIT 1`, [ck.aberto_em]));
    return r ? `Arquivo ${r.arquivo} confirmado como aplicado na Platform` : null;
  },
  async credenciais_ok(c, ck) {
    const r = uma(await c.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'ok')::int AS ok FROM credenciais_ref WHERE conta_id = $1", [ck.conta_id]));
    return r.total && r.total === r.ok ? `${r.ok} credencial(is) com status OK na Platform` : null;
  },
  async primeira_rodada(c, ck) {
    const r = uma(await c.query(`SELECT id_platform, veiculos_sucesso, veiculos_total FROM rodadas WHERE conta_id = $1 AND estado IN ('executada','concluida')
      AND veiculos_sucesso > 0 ORDER BY executada_em DESC NULLS LAST LIMIT 1`, [ck.conta_id]));
    return r ? `Rodada ${r.id_platform}: ${r.veiculos_sucesso} de ${r.veiculos_total ?? '?'} veículos com sucesso` : null;
  },
  async omie_vinculado(c, ck) {
    const r = uma(await c.query('SELECT id_omie FROM contas WHERE id = $1 AND id_omie IS NOT NULL', [ck.conta_id]));
    return r ? `Código OMIE ${r.id_omie}` : null;
  },
  async sem_pendencias(c, ck) {
    const r = uma(await c.query(`SELECT (SELECT count(*) FROM ocorrencias WHERE conta_id = $1 AND estado NOT IN ('resolvida','encerrada_sem_resolucao')
        AND id IS DISTINCT FROM $2)::int AS ocorrencias,
      (SELECT count(*) FROM pendencias WHERE conta_id = $1 AND estado IN ('aberta','persistente'))::int AS pendencias`, [ck.conta_id, ck.ocorrencia_id]));
    return !r.ocorrencias && !r.pendencias ? 'Nenhuma ocorrência ativa nem pendência aberta na conta' : null;
  },
};

async function equipes(c) { return (await c.query('SELECT codigo FROM equipes')).rows.map((r) => r.codigo); }

/** Modelo ativo do tipo; a organização sem modelo recebe o padrão como versão 1. */
async function modeloAtivo(c, ctx, tipo) {
  let m = uma(await c.query('SELECT * FROM checklist_modelos WHERE tipo = $1 AND ativo', [tipo]));
  if (!m) {
    const eq = await equipes(c);
    const itens = PADRAO[tipo].filter((i) => eq.includes(i.equipe)); // organização sem a equipe (ex.: parceiro sem Financeiro)
    m = uma(await c.query(`INSERT INTO checklist_modelos (tenant_id, tipo, versao, itens) VALUES ($1,$2,1,$3)
      ON CONFLICT (tenant_id, tipo, versao) DO UPDATE SET tipo = EXCLUDED.tipo RETURNING *`, [ctx.tenantId, tipo, JSON.stringify(itens)]));
  }
  return m;
}

/** Nova versão do modelo (não muda checklists já abertos). */
async function salvarModelo(c, ctx, tipo, itens) {
  const problemas = validarItens(itens, await equipes(c));
  if (problemas.length) throw erro.entrada(`O modelo tem itens a corrigir: ${problemas.join('; ')}.`);
  const atual = await modeloAtivo(c, ctx, tipo);
  await c.query('UPDATE checklist_modelos SET ativo = false WHERE id = $1', [atual.id]);
  const m = uma(await c.query('INSERT INTO checklist_modelos (tenant_id, tipo, versao, itens, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [ctx.tenantId, tipo, atual.versao + 1, JSON.stringify(itens), ctx.usuario?.id || null]));
  await auditar(c, ctx, { acao: 'checklist.modelo_salvo', entidade: 'checklist_modelo', entidadeId: m.id, antes: { versao: atual.versao }, depois: { tipo, versao: m.versao, itens: itens.length } });
  return m;
}

/** Abre o checklist da conta. Idempotente: se já há um aberto do mesmo tipo, devolve esse. */
async function abrir(c, ctx, { contaId, tipo, motivo, ocorrenciaId, oportunidadeId }) {
  if (!ROTULO[tipo]) throw erro.entrada('Tipo de checklist desconhecido.');
  const conta = uma(await c.query('SELECT id, nome, status FROM contas WHERE id = $1 AND arquivada_em IS NULL FOR UPDATE', [contaId]));
  if (!conta) throw erro.naoEncontrado('Conta');
  const aberto = uma(await c.query("SELECT * FROM checklists WHERE conta_id = $1 AND tipo = $2 AND estado = 'aberto'", [contaId, tipo]));
  if (aberto) return aberto;
  if (tipo === 'offboarding') {
    if (!(motivo && motivo.trim().length >= 5)) throw erro.entrada('Diga o motivo do encerramento (ex.: cancelamento pedido pelo cliente).', [{ campo: 'motivo', problema: 'obrigatório' }]);
    if (conta.status === 'encerrada') throw erro.conflito('Esta conta já está encerrada.');
  }
  const m = await modeloAtivo(c, ctx, tipo);
  const agora = relogio.agora();
  const ck = uma(await c.query(`INSERT INTO checklists (tenant_id, conta_id, tipo, modelo_versao, motivo, ocorrencia_id, oportunidade_id, aberto_por, aberto_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [ctx.tenantId, contaId, tipo, m.versao, motivo || null, ocorrenciaId || null, oportunidadeId || null, ctx.usuario?.id || null, agora]));
  let n = 0;
  for (const i of m.itens) {
    await c.query(`INSERT INTO checklist_itens (tenant_id, checklist_id, ordem, codigo, titulo, grupo, equipe_codigo, obrigatorio, verificacao, prazo_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [ctx.tenantId, ck.id, n++, i.codigo, i.titulo, i.grupo, i.equipe, i.obrigatorio !== false, i.verificacao || null, new Date(agora.getTime() + (i.dias || 0) * DIA)]);
  }
  await auditar(c, ctx, { acao: `checklist.${tipo}_aberto`, entidade: 'conta', entidadeId: contaId, depois: { checklist: ck.id, modeloVersao: m.versao, itens: n }, motivo: motivo || null });
  await publicar(c, ctx, { tipo: `conta.${tipo}_aberto`, agregado: 'conta', agregadoId: contaId, chave: `checklist:${ck.id}:aberto`, payload: { checklistId: ck.id } });
  await conferirAutomaticos(c, ctx, ck);
  return ck;
}

/** Roda as verificações automáticas dos itens pendentes; o que o dado comprova vira "feito" com a evidência. */
async function conferirAutomaticos(c, ctx, ck) {
  const itens = (await c.query("SELECT id, codigo, verificacao FROM checklist_itens WHERE checklist_id = $1 AND estado = 'pendente' AND verificacao IS NOT NULL", [ck.id])).rows;
  let marcados = 0;
  for (const i of itens) {
    const fn = VERIFICACOES[i.verificacao];
    const evidencia = fn ? await fn(c, ck) : null;
    if (!evidencia) continue;
    await c.query("UPDATE checklist_itens SET estado = 'feito', evidencia = $2, automatico = true, feito_em = $3 WHERE id = $1 AND estado = 'pendente'", [i.id, `Verificado pelo sistema: ${evidencia}`.slice(0, 1000), relogio.agora()]);
    await auditar(c, ctx, { acao: 'checklist.item_verificado', entidade: 'conta', entidadeId: ck.conta_id, depois: { item: i.codigo, evidencia } });
    marcados++;
  }
  return marcados;
}

async function itemComChecklist(c, itemId) {
  const i = uma(await c.query(`SELECT i.*, k.conta_id, k.estado AS checklist_estado, k.tipo FROM checklist_itens i JOIN checklists k ON k.id = i.checklist_id
    WHERE i.id = $1 FOR UPDATE OF i`, [itemId]));
  if (!i) throw erro.naoEncontrado('Item do checklist');
  if (i.checklist_estado !== 'aberto') throw erro.conflito('Este checklist já foi concluído.');
  return i;
}

/** Quem cuida da conta (conta.editar) ou a equipe dona do item (ex.: Financeiro no item do OMIE). */
const podeMexer = (usuario, item) => pode(usuario, 'conta.editar') || usuario.equipe_codigo === item.equipe_codigo;

async function agirItem(c, ctx, usuario, itemId, acao, { evidencia, motivo } = {}) {
  const i = await itemComChecklist(c, itemId);
  const agora = relogio.agora();
  let estado; let colunas;
  switch (acao) {
    case 'feito':
      if (!podeMexer(usuario, i)) throw erro.semPermissao('marcar itens deste checklist');
      if (i.estado === 'feito') throw erro.conflito('Este item já está feito.');
      if (!(evidencia && evidencia.trim().length >= 5)) throw erro.entrada('Registre a evidência (o que foi feito, onde está, quem confirmou).', [{ campo: 'evidencia', problema: 'obrigatório' }]);
      estado = 'feito'; colunas = { evidencia, feito_por: usuario.id, feito_em: agora, automatico: false };
      break;
    case 'pedir_dispensa':
      if (!podeMexer(usuario, i)) throw erro.semPermissao('pedir dispensa neste checklist');
      if (!i.obrigatorio) throw erro.regra('item_opcional', 'Item opcional não impede a conclusão: não precisa de dispensa.');
      if (i.estado !== 'pendente') throw erro.conflito('Só item pendente pode ter dispensa pedida.');
      if (!(motivo && motivo.trim().length >= 5)) throw erro.entrada('Explique por que o item não se aplica ou não será feito.', [{ campo: 'motivo', problema: 'obrigatório' }]);
      estado = 'dispensa_pedida'; colunas = { dispensa_motivo: motivo, dispensa_pedida_por: usuario.id };
      break;
    case 'aprovar_dispensa': case 'negar_dispensa':
      if (i.estado !== 'dispensa_pedida') throw erro.conflito('Este item não tem dispensa pedida.');
      if (!pode(usuario, 'ocorrencia.intervir')) throw erro.semPermissao('aprovar exceção no checklist');
      if (i.dispensa_pedida_por === usuario.id) throw erro.regra('aprovacao_propria', 'Quem pediu a dispensa não a aprova. Peça a outra pessoa da gestão.');
      estado = acao === 'aprovar_dispensa' ? 'dispensado' : 'pendente';
      colunas = acao === 'aprovar_dispensa' ? { dispensa_aprovada_por: usuario.id } : { dispensa_motivo: null, dispensa_pedida_por: null };
      break;
    default: throw erro.entrada('Ação desconhecida.');
  }
  const sets = ['estado = $2']; const vals = [i.id, estado];
  for (const [k, v] of Object.entries(colunas)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
  const r = uma(await c.query(`UPDATE checklist_itens SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals));
  await auditar(c, ctx, { acao: `checklist.item_${acao}`, entidade: 'conta', entidadeId: i.conta_id, antes: { item: i.codigo, estado: i.estado }, depois: { item: i.codigo, estado }, motivo: motivo || evidencia || null });
  return r;
}

/** Conclui: todo obrigatório feito ou dispensado. Onboarding → conta ativa; offboarding → conta encerrada. */
async function concluir(c, ctx, checklistId) {
  const ck = uma(await c.query('SELECT * FROM checklists WHERE id = $1 FOR UPDATE', [checklistId]));
  if (!ck) throw erro.naoEncontrado('Checklist');
  if (ck.estado !== 'aberto') throw erro.conflito('Este checklist já foi concluído.');
  await conferirAutomaticos(c, ctx, ck);
  const itens = (await c.query('SELECT codigo, titulo, estado, obrigatorio, grupo FROM checklist_itens WHERE checklist_id = $1', [ck.id])).rows;
  const p = progresso(itens);
  if (!p.podeConcluir) {
    throw erro.regra('checklist_incompleto', `Para concluir faltam: ${p.faltam.map((f) => f.titulo).join('; ')}. Faça com evidência ou peça a dispensa (exceção aprovada).`, p.faltam);
  }
  const agora = relogio.agora();
  await c.query("UPDATE checklists SET estado = 'concluido', concluido_por = $2, concluido_em = $3 WHERE id = $1", [ck.id, ctx.usuario?.id || null, agora]);
  const conta = uma(await c.query('SELECT status FROM contas WHERE id = $1', [ck.conta_id]));
  const novo = ck.tipo === 'onboarding' ? (conta.status === 'onboarding' ? 'ativa' : conta.status) : 'encerrada';
  if (novo !== conta.status) await c.query('UPDATE contas SET status = $2, version = version + 1, atualizado_em = now() WHERE id = $1', [ck.conta_id, novo]);
  await auditar(c, ctx, { acao: `checklist.${ck.tipo}_concluido`, entidade: 'conta', entidadeId: ck.conta_id, antes: { status: conta.status }, depois: { status: novo, checklist: ck.id } });
  await publicar(c, ctx, { tipo: ck.tipo === 'onboarding' ? 'conta.onboarding_concluido' : 'conta.encerrada', agregado: 'conta', agregadoId: ck.conta_id,
    chave: `checklist:${ck.id}:concluido`, payload: { checklistId: ck.id, status: novo } });
  return { id: ck.id, estado: 'concluido', contaStatus: novo };
}

/** Checklists da conta (abertos primeiro), com itens e progresso. Confere os automáticos antes de mostrar. */
async function daConta(c, ctx, contaId) {
  const lista = (await c.query(`SELECT k.*, u.nome AS aberto_por_nome FROM checklists k LEFT JOIN usuarios u ON u.id = k.aberto_por
    WHERE k.conta_id = $1 ORDER BY (k.estado = 'aberto') DESC, k.aberto_em DESC LIMIT 10`, [contaId])).rows;
  for (const ck of lista) if (ck.estado === 'aberto') await conferirAutomaticos(c, ctx, ck);
  const ids = lista.map((k) => k.id);
  const itens = ids.length ? (await c.query(`SELECT i.*, f.nome AS feito_por_nome, p.nome AS pedida_por_nome, a.nome AS aprovada_por_nome
    FROM checklist_itens i LEFT JOIN usuarios f ON f.id = i.feito_por LEFT JOIN usuarios p ON p.id = i.dispensa_pedida_por LEFT JOIN usuarios a ON a.id = i.dispensa_aprovada_por
    WHERE i.checklist_id = ANY($1) ORDER BY i.ordem`, [ids])).rows : [];
  const agora = relogio.agora();
  return { grupos: GRUPOS, checklists: lista.map((ck) => {
    const seus = itens.filter((i) => i.checklist_id === ck.id).map((i) => ({ ...i, atrasado: ['pendente', 'dispensa_pedida'].includes(i.estado) && new Date(i.prazo_em) < agora }));
    return { ...ck, rotulo: ROTULO[ck.tipo], itens: seus, progresso: progresso(seus) };
  }) };
}

/** Supervisor: item obrigatório vencido vira tarefa para a equipe dele (uma vez por item). Também confere automáticos. */
async function verificarAtrasados(c, ctx, { criarTarefa }) {
  for (const ck of (await c.query("SELECT * FROM checklists WHERE estado = 'aberto' LIMIT 200")).rows) await conferirAutomaticos(c, ctx, ck);
  const agora = relogio.agora();
  const eq = await equipes(c);
  const atrasados = (await c.query(`SELECT i.id, i.titulo, i.equipe_codigo, k.tipo, ct.nome AS conta FROM checklist_itens i JOIN checklists k ON k.id = i.checklist_id
    JOIN contas ct ON ct.id = k.conta_id WHERE k.estado = 'aberto' AND i.obrigatorio AND i.estado IN ('pendente', 'dispensa_pedida') AND i.prazo_em < $1
    AND NOT EXISTS (SELECT 1 FROM tarefas t WHERE t.chave = 'checklist:' || i.id) LIMIT 100`, [agora])).rows;
  for (const i of atrasados) {
    await criarTarefa({ tipo: 'geral', equipeCodigo: eq.includes(i.equipe_codigo) ? i.equipe_codigo : 'supervisao', chave: `checklist:${i.id}`,
      prazoEm: new Date(agora.getTime() + 4 * HORA), titulo: `${ROTULO[i.tipo]} de ${i.conta}: ${i.titulo} (prazo vencido)` });
  }
  return atrasados.length;
}

module.exports = { abrir, agirItem, concluir, daConta, modeloAtivo, salvarModelo, verificarAtrasados, conferirAutomaticos, VERIFICACOES };
