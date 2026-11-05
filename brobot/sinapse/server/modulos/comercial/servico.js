'use strict';
// Comercial: oportunidades no funil de aquisição com teste antes do fechamento. Venda ganha vira conta em
// onboarding (ou expansão de conta existente pelo CNPJ) e abre o onboarding para o CS — o CS define o ponto focal
// e repassa ao Suporte (reunião de 03/11/2026). Toda mudança: auditoria + evento (processos podem reagir).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { publicar, auditar } = require('../../nucleo/registro');
const { relogio, DIA } = require('../../nucleo/relogio');
const { normalizarTelefone } = require('../../nucleo/telefone');
const ocorrencias = require('../ocorrencias/servico');
const { ETAPAS, ABERTAS, PRODUTOS, validarMudanca } = require('./funil');

const ACAO_PADRAO = { qualificacao: 'Agendar a demonstração', demonstracao: 'Enviar a proposta', proposta: 'Combinar o teste (período e critério de sucesso)',
  negociacao: 'Fechar a venda' };

const CAMPOS = ['empresa', 'cnpj', 'contato_nome', 'contato_telefone', 'contato_email', 'origem', 'produtos', 'frota', 'valor_mensal',
  'responsavel_id', 'proxima_acao', 'proxima_acao_em', 'teste_inicio', 'teste_fim', 'teste_criterio'];

/** Normaliza o que veio da tela (camelCase) para as colunas, com validação de formato. */
function normalizar(d) {
  const o = {};
  const mapa = { empresa: 'empresa', cnpj: 'cnpj', contatoNome: 'contato_nome', contatoTelefone: 'contato_telefone', contatoEmail: 'contato_email',
    origem: 'origem', produtos: 'produtos', frota: 'frota', valorMensal: 'valor_mensal', responsavelId: 'responsavel_id', proximaAcao: 'proxima_acao',
    proximaAcaoEm: 'proxima_acao_em', testeInicio: 'teste_inicio', testeFim: 'teste_fim', testeCriterio: 'teste_criterio' };
  for (const [k, col] of Object.entries(mapa)) if (d[k] !== undefined) o[col] = d[k] === '' ? null : d[k];
  if (o.cnpj) { o.cnpj = String(o.cnpj).replace(/\D/g, ''); if (o.cnpj.length !== 14) throw erro.entrada('CNPJ precisa ter 14 dígitos.', [{ campo: 'cnpj', problema: 'inválido' }]); }
  if (o.contato_telefone) {
    const t = normalizarTelefone(o.contato_telefone);
    if (!t) throw erro.entrada('Telefone inválido. Use DDD + número.', [{ campo: 'contatoTelefone', problema: 'inválido' }]);
    o.contato_telefone = t;
  }
  if (o.contato_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.contato_email)) throw erro.entrada('E-mail inválido.', [{ campo: 'contatoEmail', problema: 'inválido' }]);
  if (o.produtos !== undefined && o.produtos !== null) {
    const lista = Array.isArray(o.produtos) ? o.produtos : String(o.produtos).split(',').map((s) => s.trim()).filter(Boolean);
    if (lista.some((p) => !PRODUTOS[p])) throw erro.entrada('Produto desconhecido.', [{ campo: 'produtos', problema: `use: ${Object.keys(PRODUTOS).join(', ')}` }]);
    o.produtos = lista;
  }
  for (const n of ['frota', 'valor_mensal']) if (o[n] !== undefined && o[n] !== null) { o[n] = Number(o[n]); if (!(o[n] >= 0)) throw erro.entrada(`Valor inválido em ${n}.`); }
  return o;
}

async function codigo(c, ctx) {
  const r = uma(await c.query(`INSERT INTO contadores (tenant_id, nome, valor) VALUES ($1, 'oportunidade', 1)
    ON CONFLICT (tenant_id, nome) DO UPDATE SET valor = contadores.valor + 1 RETURNING valor`, [ctx.tenantId]));
  return `OPP-${String(r.valor).padStart(5, '0')}`;
}

async function criar(c, ctx, d) {
  const o = normalizar(d);
  if (!o.empresa) throw erro.entrada('Informe o nome da empresa.', [{ campo: 'empresa', problema: 'obrigatório' }]);
  const agora = relogio.agora();
  const cod = await codigo(c, ctx);
  const op = uma(await c.query(
    `INSERT INTO oportunidades (tenant_id, codigo, empresa, cnpj, contato_nome, contato_telefone, contato_email, origem, produtos, frota, valor_mensal,
       responsavel_id, proxima_acao, proxima_acao_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [ctx.tenantId, cod, o.empresa, o.cnpj || null, o.contato_nome || null, o.contato_telefone || null, o.contato_email || null, o.origem || 'outbound',
      o.produtos || [], o.frota ?? null, o.valor_mensal ?? null, o.responsavel_id || (ctx.usuario?.papel === 'comercial' ? ctx.usuario.id : null),
      o.proxima_acao || 'Qualificar o lead (dor, frota, decisor)', o.proxima_acao_em || new Date(agora.getTime() + DIA)]));
  await auditar(c, ctx, { acao: 'oportunidade.criada', entidade: 'oportunidade', entidadeId: op.id, depois: { codigo: cod, empresa: op.empresa } });
  await publicar(c, ctx, { tipo: 'oportunidade.etapa', agregado: 'oportunidade', agregadoId: op.id, chave: `op:${op.id}:v1`, payload: { de: null, para: 'novo' } });
  return op;
}

async function buscar(c, id, trava = false) {
  const o = uma(await c.query(`SELECT * FROM oportunidades WHERE id = $1 ${trava ? 'FOR UPDATE' : ''}`, [id]));
  if (!o) throw erro.naoEncontrado('Oportunidade');
  return o;
}

async function gravar(c, atual, colunas, versao) {
  if (versao !== undefined && versao !== null && Number(versao) !== atual.version) {
    throw erro.conflito('Esta oportunidade foi alterada por outra pessoa. Atualize a tela.');
  }
  const sets = ['version = version + 1', 'atualizado_em = now()'];
  const vals = [atual.id, atual.version];
  for (const [k, v] of Object.entries(colunas)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
  const r = uma(await c.query(`UPDATE oportunidades SET ${sets.join(', ')} WHERE id = $1 AND version = $2 RETURNING *`, vals));
  if (!r) throw erro.conflito('Esta oportunidade foi alterada ao mesmo tempo por outra ação. Atualize a tela.');
  return r;
}

/** Edita dados (sem mudar de etapa). */
async function atualizar(c, ctx, id, d, versao) {
  const atual = await buscar(c, id, true);
  if (!ABERTAS.includes(atual.etapa)) throw erro.conflito('Oportunidade encerrada não pode ser editada.');
  const o = normalizar(d);
  const colunas = Object.fromEntries(Object.entries(o).filter(([k]) => CAMPOS.includes(k)));
  const r = await gravar(c, atual, colunas, versao);
  await auditar(c, ctx, { acao: 'oportunidade.editada', entidade: 'oportunidade', entidadeId: id, depois: Object.keys(colunas) });
  return r;
}

/** Muda de etapa aplicando os dados enviados junto (ex.: período e critério do teste). */
async function mover(c, ctx, id, para, d = {}, versao) {
  const atual = await buscar(c, id, true);
  const o = normalizar(d);
  const proposta = { ...atual, ...o };
  if (para === 'perdida') { proposta.motivo_perda = d.motivoPerda || null; }
  validarMudanca(atual, proposta, para);
  const agora = relogio.agora();
  const colunas = Object.fromEntries(Object.entries(o).filter(([k]) => CAMPOS.includes(k)));
  Object.assign(colunas, { etapa: para, etapa_desde: agora });
  if (para === 'perdida') Object.assign(colunas, { motivo_perda: d.motivoPerda, detalhe_perda: d.detalhePerda || null, fechada_em: agora, proxima_acao: null, proxima_acao_em: null });
  if (para === 'teste' && !o.proxima_acao) Object.assign(colunas, { proxima_acao: 'Acompanhar o teste e registrar o resultado', proxima_acao_em: new Date(`${proposta.teste_fim}T21:00:00Z`) });
  let venda = null;
  if (para === 'ganha') {
    venda = await criarContaDaVenda(c, ctx, proposta);
    Object.assign(colunas, { conta_id: venda.contaId, fechada_em: agora, proxima_acao: null, proxima_acao_em: null });
  } else if (!colunas.proxima_acao && ABERTAS.includes(para)) {
    colunas.proxima_acao = d.proximaAcao || ACAO_PADRAO[para] || `Avançar ${ETAPAS[para].rotulo.toLowerCase()}`;
    colunas.proxima_acao_em = d.proximaAcaoEm || new Date(agora.getTime() + 2 * DIA);
  }
  const r = await gravar(c, atual, colunas, versao);
  await auditar(c, ctx, { acao: `oportunidade.${para === 'ganha' ? 'ganha' : para === 'perdida' ? 'perdida' : 'etapa'}`, entidade: 'oportunidade', entidadeId: id,
    antes: { etapa: atual.etapa }, depois: { etapa: para, ...(para === 'perdida' ? { motivo: d.motivoPerda } : {}) }, motivo: d.detalhePerda || null });
  await publicar(c, ctx, { tipo: 'oportunidade.etapa', agregado: 'oportunidade', agregadoId: id, chave: `op:${id}:v${r.version}`,
    payload: { de: atual.etapa, para, contaId: r.conta_id } });
  if (venda) {
    await publicar(c, ctx, { tipo: 'oportunidade.ganha', agregado: 'oportunidade', agregadoId: id, chave: `op.ganha:${id}`,
      payload: { contaId: venda.contaId, ocorrenciaId: venda.ocorrenciaId, expansao: venda.expansao, valorMensal: r.valor_mensal } });
  }
  return { ...r, venda };
}

/** Registra o resultado do teste (critério combinado com o cliente). */
async function registrarTeste(c, ctx, id, { resultado, parecer }, versao) {
  const atual = await buscar(c, id, true);
  if (atual.etapa !== 'teste') throw erro.regra('fora_do_teste', 'O resultado do teste só é registrado com a oportunidade na etapa Teste.');
  if (!['aprovado', 'reprovado'].includes(resultado)) throw erro.entrada('Resultado do teste: aprovado ou reprovado.');
  const r = await gravar(c, atual, { teste_resultado: resultado, teste_parecer: parecer,
    proxima_acao: resultado === 'aprovado' ? 'Levar para a negociação' : 'Decidir: estender o teste ou encerrar', proxima_acao_em: new Date(relogio.agora().getTime() + DIA) }, versao);
  await auditar(c, ctx, { acao: 'oportunidade.teste_registrado', entidade: 'oportunidade', entidadeId: id, depois: { resultado }, motivo: parecer });
  await publicar(c, ctx, { tipo: 'oportunidade.teste_registrado', agregado: 'oportunidade', agregadoId: id, chave: `op:${id}:v${r.version}`, payload: { resultado } });
  return r;
}

/** Venda ganha → conta em onboarding (ou expansão da conta do mesmo CNPJ) + onboarding para o CS. */
async function criarContaDaVenda(c, ctx, o) {
  let conta = uma(await c.query('SELECT * FROM contas WHERE cnpj = $1 AND arquivada_em IS NULL', [o.cnpj]));
  const expansao = !!conta;
  if (conta) {
    const produtos = [...new Set([...(conta.produtos || []), ...o.produtos])];
    conta = uma(await c.query('UPDATE contas SET produtos = $2, valor_mensal = coalesce(valor_mensal, 0) + $3, version = version + 1, atualizado_em = now() WHERE id = $1 RETURNING *',
      [conta.id, produtos, o.valor_mensal || 0]));
  } else {
    conta = uma(await c.query(
      `INSERT INTO contas (tenant_id, nome, cnpj, segmento, status, produtos, valor_mensal, oportunidade_id)
       VALUES ($1,$2,$3,$4,'onboarding',$5,$6,$7) RETURNING *`,
      [ctx.tenantId, o.empresa, o.cnpj, o.frota ? `${o.frota} veículos` : null, o.produtos, o.valor_mensal, o.id]));
    await c.query("INSERT INTO status_financeiro (tenant_id, conta_id, situacao) VALUES ($1, $2, 'desconhecido') ON CONFLICT DO NOTHING", [ctx.tenantId, conta.id]);
  }
  const nomesProdutos = o.produtos.map((p) => PRODUTOS[p]).join(', ');
  const oc = await ocorrencias.criar(c, ctx, {
    origem: 'interna', contaId: conta.id, tipo: 'onboarding', prioridade: 'alta', equipeCodigo: 'cs',
    titulo: `${expansao ? 'Expansão' : 'Onboarding'}: ${conta.nome} (${nomesProdutos})`,
    descricao: `Venda ${o.codigo} fechada pelo Comercial. Contato comercial: ${o.contato_nome || '-'} ${o.contato_telefone || ''} ${o.contato_email || ''}. `
      + `Teste: ${o.teste_criterio || '-'} (${o.teste_parecer || 'aprovado'}). O CS define o ponto focal (1 nome + 1 contato) e repassa ao Suporte.`,
    proximaAcao: 'Definir o ponto focal e o plano de onboarding',
  });
  await auditar(c, ctx, { acao: expansao ? 'conta.expansao_vendida' : 'conta.criada_pela_venda', entidade: 'conta', entidadeId: conta.id,
    depois: { oportunidade: o.codigo, produtos: o.produtos, valorMensal: o.valor_mensal } });
  return { contaId: conta.id, ocorrenciaId: oc.id, expansao };
}

async function definirProximaAcao(c, ctx, id, { proximaAcao, proximaAcaoEm }, versao) {
  const atual = await buscar(c, id, true);
  if (!ABERTAS.includes(atual.etapa)) throw erro.conflito('Oportunidade encerrada.');
  return gravar(c, atual, { proxima_acao: proximaAcao, proxima_acao_em: proximaAcaoEm }, versao);
}

async function listar(c, { q, minhas, usuario } = {}) {
  const params = [];
  const onde = ["(o.etapa NOT IN ('ganha','perdida') OR o.fechada_em > now() - interval '60 days')"];
  if (q) { params.push(`%${q}%`); onde.push(`(o.empresa ILIKE $${params.length} OR o.codigo ILIKE $${params.length} OR o.cnpj LIKE $${params.length})`); }
  if (minhas) { params.push(usuario.id); onde.push(`o.responsavel_id = $${params.length}`); }
  const r = await c.query(
    `SELECT o.id, o.codigo, o.empresa, o.etapa, o.valor_mensal, o.frota, o.produtos, o.proxima_acao, o.proxima_acao_em, o.etapa_desde, o.teste_fim,
       o.teste_resultado, o.version, o.conta_id, u.nome AS responsavel_nome
     FROM oportunidades o LEFT JOIN usuarios u ON u.id = o.responsavel_id
     WHERE ${onde.join(' AND ')} ORDER BY o.proxima_acao_em NULLS LAST LIMIT 300`, params);
  return { itens: r.rows, limite: 300 };
}

async function detalhe(c, id) {
  const o = uma(await c.query('SELECT o.*, u.nome AS responsavel_nome, ct.nome AS conta_nome FROM oportunidades o LEFT JOIN usuarios u ON u.id = o.responsavel_id LEFT JOIN contas ct ON ct.id = o.conta_id WHERE o.id = $1', [id]));
  if (!o) throw erro.naoEncontrado('Oportunidade');
  const historico = (await c.query("SELECT acao, ator_nome, antes, depois, motivo, criado_em FROM auditoria WHERE entidade = 'oportunidade' AND entidade_id = $1 ORDER BY id", [id])).rows;
  return { ...o, historico };
}

/** Indicadores do funil (para o Comercial e para a diretoria). */
async function indicadores(c) {
  const porEtapa = (await c.query(`SELECT etapa, count(*)::int AS n, coalesce(sum(valor_mensal),0)::float AS valor FROM oportunidades
    WHERE etapa NOT IN ('ganha','perdida') OR fechada_em > now() - interval '90 days' GROUP BY etapa`)).rows;
  const testes = uma(await c.query(`SELECT count(*) FILTER (WHERE teste_resultado = 'aprovado')::int AS aprovados,
    count(*) FILTER (WHERE teste_resultado = 'reprovado')::int AS reprovados,
    count(*) FILTER (WHERE etapa = 'teste' AND teste_resultado IS NULL)::int AS em_andamento,
    count(*) FILTER (WHERE etapa = 'ganha')::int AS ganhas, count(*) FILTER (WHERE etapa = 'perdida')::int AS perdidas,
    coalesce(avg(EXTRACT(EPOCH FROM fechada_em - criado_em) / 86400) FILTER (WHERE etapa = 'ganha'), 0)::float AS ciclo_dias,
    count(*) FILTER (WHERE etapa NOT IN ('ganha','perdida') AND proxima_acao_em < $1)::int AS acao_vencida
    FROM oportunidades`, [relogio.agora()]));
  const motivos = (await c.query("SELECT motivo_perda, count(*)::int AS n FROM oportunidades WHERE etapa = 'perdida' GROUP BY motivo_perda ORDER BY n DESC")).rows;
  return { porEtapa, testes, motivos };
}

module.exports = { criar, atualizar, mover, registrarTeste, definirProximaAcao, listar, detalhe, indicadores, normalizar };
