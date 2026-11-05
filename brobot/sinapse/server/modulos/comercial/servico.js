'use strict';
// Comercial: oportunidades em três funis — aquisição (teste antes do fechamento), expansão (upsell/cross-sell de cliente
// da carteira) e renovação. Venda de aquisição vira conta em onboarding e abre o onboarding para o CS (o CS define o
// ponto focal e repassa ao Suporte — reunião de 03/11/2026); expansão soma produtos e valor à conta; renovação troca o
// valor do contrato. Toda mudança: auditoria + evento (processos podem reagir).

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { publicar, auditar } = require('../../nucleo/registro');
const { relogio, DIA } = require('../../nucleo/relogio');
const { normalizarTelefone } = require('../../nucleo/telefone');
const ocorrencias = require('../ocorrencias/servico');
const { ETAPAS, ABERTAS, FUNIS, validarMudanca, previsao } = require('./funil');
const catalogo = require('./catalogo');
const propostas = require('./propostas');
const atividades = require('./atividades');
const contatos = require('./contatos');

const ACAO_PADRAO = { qualificacao: 'Agendar a demonstração', demonstracao: 'Enviar a proposta', proposta: 'Combinar o teste (período e critério de sucesso)',
  negociacao: 'Fechar a venda' };

const CAMPOS = ['empresa', 'cnpj', 'contato_nome', 'contato_telefone', 'contato_email', 'origem', 'produtos', 'frota', 'valor_mensal',
  'responsavel_id', 'proxima_acao', 'proxima_acao_em', 'teste_inicio', 'teste_fim', 'teste_criterio', 'fechamento_previsto'];

/** Normaliza o que veio da tela (camelCase) para as colunas, com validação de formato. */
function normalizar(d) {
  const o = {};
  const mapa = { empresa: 'empresa', cnpj: 'cnpj', contatoNome: 'contato_nome', contatoTelefone: 'contato_telefone', contatoEmail: 'contato_email',
    origem: 'origem', produtos: 'produtos', frota: 'frota', valorMensal: 'valor_mensal', responsavelId: 'responsavel_id', proximaAcao: 'proxima_acao',
    proximaAcaoEm: 'proxima_acao_em', testeInicio: 'teste_inicio', testeFim: 'teste_fim', testeCriterio: 'teste_criterio',
    fechamentoPrevisto: 'fechamento_previsto' };
  for (const [k, col] of Object.entries(mapa)) if (d[k] !== undefined) o[col] = d[k] === '' ? null : d[k];
  if (o.cnpj) { o.cnpj = String(o.cnpj).replace(/\D/g, ''); if (o.cnpj.length !== 14) throw erro.entrada('CNPJ precisa ter 14 dígitos.', [{ campo: 'cnpj', problema: 'inválido' }]); }
  if (o.contato_telefone) {
    const t = normalizarTelefone(o.contato_telefone);
    if (!t) throw erro.entrada('Telefone inválido. Use DDD + número.', [{ campo: 'contatoTelefone', problema: 'inválido' }]);
    o.contato_telefone = t;
  }
  if (o.contato_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.contato_email)) throw erro.entrada('E-mail inválido.', [{ campo: 'contatoEmail', problema: 'inválido' }]);
  if (o.produtos !== undefined && o.produtos !== null) {
    // O catálogo (por organização) confere os códigos depois, em `conferirProdutos`.
    o.produtos = Array.isArray(o.produtos) ? o.produtos : String(o.produtos).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (o.fechamento_previsto && !/^\d{4}-\d{2}-\d{2}$/.test(String(o.fechamento_previsto))) throw erro.entrada('Fechamento previsto: use uma data (AAAA-MM-DD).', [{ campo: 'fechamentoPrevisto', problema: 'inválida' }]);
  for (const n of ['frota', 'valor_mensal']) if (o[n] !== undefined && o[n] !== null) { o[n] = Number(o[n]); if (!(o[n] >= 0)) throw erro.entrada(`Valor inválido em ${n}.`); }
  return o;
}

const conferirProdutos = async (c, ctx, o) => { if (o.produtos && o.produtos.length) await catalogo.validarProdutos(c, ctx, o.produtos); return o; };

async function codigo(c, ctx) {
  const r = uma(await c.query(`INSERT INTO contadores (tenant_id, nome, valor) VALUES ($1, 'oportunidade', 1)
    ON CONFLICT (tenant_id, nome) DO UPDATE SET valor = contadores.valor + 1 RETURNING valor`, [ctx.tenantId]));
  return `OPP-${String(r.valor).padStart(5, '0')}`;
}

async function criar(c, ctx, d) {
  const o = await conferirProdutos(c, ctx, normalizar(d));
  const funil = d.funil || 'aquisicao';
  if (!FUNIS[funil]) throw erro.entrada('Funil desconhecido.', [{ campo: 'funil', problema: `use: ${Object.keys(FUNIS).join(', ')}` }]);
  let conta = null;
  if (funil !== 'aquisicao') {
    // Expansão e renovação partem de um cliente da carteira: empresa e CNPJ vêm da conta.
    conta = d.contaOrigemId ? uma(await c.query('SELECT id, nome, cnpj, valor_mensal FROM contas WHERE id = $1 AND arquivada_em IS NULL', [d.contaOrigemId])) : null;
    if (!conta) throw erro.entrada('Expansão e renovação precisam de um cliente da carteira.', [{ campo: 'contaOrigemId', problema: 'obrigatório' }]);
    Object.assign(o, { empresa: conta.nome, cnpj: conta.cnpj });
    if (funil === 'renovacao' && o.valor_mensal === undefined && conta.valor_mensal !== null) o.valor_mensal = Number(conta.valor_mensal);
  }
  if (!o.empresa) throw erro.entrada('Informe o nome da empresa.', [{ campo: 'empresa', problema: 'obrigatório' }]);
  const agora = relogio.agora();
  const cod = await codigo(c, ctx);
  const acaoInicial = { aquisicao: 'Qualificar o lead (dor, frota, decisor)', expansao: 'Entender a necessidade nova com o cliente', renovacao: 'Confirmar a renovação e as condições com o cliente' }[funil];
  const op = uma(await c.query(
    `INSERT INTO oportunidades (tenant_id, codigo, empresa, cnpj, contato_nome, contato_telefone, contato_email, origem, produtos, frota, valor_mensal,
       responsavel_id, proxima_acao, proxima_acao_em, funil, conta_origem_id, fechamento_previsto, encaminhada_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [ctx.tenantId, cod, o.empresa, o.cnpj || null, o.contato_nome || null, o.contato_telefone || null, o.contato_email || null, conta ? 'base' : o.origem || 'outbound',
      o.produtos || [], o.frota ?? null, o.valor_mensal ?? null, o.responsavel_id || (ctx.usuario?.papel === 'comercial' ? ctx.usuario.id : null),
      o.proxima_acao || acaoInicial, o.proxima_acao_em || new Date(agora.getTime() + DIA), funil, conta?.id || null, o.fechamento_previsto || null,
      d.encaminhada ? ctx.usuario?.id || null : null]));
  await auditar(c, ctx, { acao: d.encaminhada ? 'oportunidade.encaminhada' : 'oportunidade.criada', entidade: 'oportunidade', entidadeId: op.id,
    depois: { codigo: cod, empresa: op.empresa, funil }, motivo: d.observacao || null });
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
  if (!ABERTAS.includes(atual.etapa)) throw erro.conflito('Oportunidade encerrada ou suspensa não pode ser editada.');
  const o = await conferirProdutos(c, ctx, normalizar(d));
  const colunas = Object.fromEntries(Object.entries(o).filter(([k]) => CAMPOS.includes(k)));
  const r = await gravar(c, atual, colunas, versao);
  await auditar(c, ctx, { acao: 'oportunidade.editada', entidade: 'oportunidade', entidadeId: id, depois: Object.keys(colunas) });
  return r;
}

/** Muda de etapa aplicando os dados enviados junto (ex.: período e critério do teste). */
async function mover(c, ctx, id, para, d = {}, versao) {
  const atual = await buscar(c, id, true);
  const o = await conferirProdutos(c, ctx, normalizar(d));
  const proposta = { ...atual, ...o };
  if (para === 'perdida') { proposta.motivo_perda = d.motivoPerda || null; }
  // DP-04: da Proposta direto para a Negociação quando nenhum produto exige teste no catálogo. Renovação dispensa
  // sempre (o cliente já usa); expansão só olha os produtos que a conta ainda não tem.
  let dispensa = false;
  if (para === 'negociacao' && atual.etapa === 'proposta') {
    if (atual.funil === 'renovacao') dispensa = true;
    else {
      const jaTem = atual.funil === 'expansao' ? (uma(await c.query('SELECT produtos FROM contas WHERE id = $1', [atual.conta_origem_id]))?.produtos || []) : [];
      const novos = (proposta.produtos || []).filter((p) => !jaTem.includes(p));
      dispensa = atual.funil === 'expansao' && !novos.length ? (proposta.produtos || []).length > 0 : !(await catalogo.exigeTeste(c, ctx, novos));
    }
  }
  if (dispensa) proposta.teste_dispensado = true;
  validarMudanca(atual, proposta, para);
  const agora = relogio.agora();
  const colunas = Object.fromEntries(Object.entries(o).filter(([k]) => CAMPOS.includes(k)));
  Object.assign(colunas, { etapa: para, etapa_desde: agora });
  if (dispensa) colunas.teste_dispensado = true;
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
      payload: { contaId: venda.contaId, ocorrenciaId: venda.ocorrenciaId, expansao: venda.expansao, renovacao: !!venda.renovacao, funil: r.funil, valorMensal: r.valor_mensal } });
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

/** Venda ganha → conta em onboarding (ou expansão da conta do mesmo CNPJ) + onboarding para o CS.
 *  Renovação: troca o valor do contrato da conta de origem, sem novo onboarding. */
async function criarContaDaVenda(c, ctx, o) {
  if (o.funil === 'renovacao') {
    const antes = uma(await c.query('SELECT * FROM contas WHERE id = $1 FOR UPDATE', [o.conta_origem_id]));
    const produtos = [...new Set([...(antes.produtos || []), ...(o.produtos || [])])];
    const conta = uma(await c.query('UPDATE contas SET valor_mensal = $2, produtos = $3, version = version + 1, atualizado_em = now() WHERE id = $1 RETURNING *',
      [antes.id, o.valor_mensal, produtos]));
    await auditar(c, ctx, { acao: 'conta.renovada', entidade: 'conta', entidadeId: conta.id, antes: { valorMensal: antes.valor_mensal, produtos: antes.produtos },
      depois: { oportunidade: o.codigo, valorMensal: conta.valor_mensal, produtos } });
    return { contaId: conta.id, ocorrenciaId: null, expansao: true, renovacao: true };
  }
  let conta = uma(await c.query(o.conta_origem_id ? 'SELECT * FROM contas WHERE id = $1' : 'SELECT * FROM contas WHERE cnpj = $1 AND arquivada_em IS NULL',
    [o.conta_origem_id || o.cnpj]));
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
  const cat = await catalogo.mapa(c, ctx);
  const nomesProdutos = o.produtos.map((p) => cat[p]?.nome || p).join(', ');
  const oc = await ocorrencias.criar(c, ctx, {
    origem: 'interna', contaId: conta.id, tipo: 'onboarding', prioridade: 'alta', equipeCodigo: 'cs',
    titulo: `${expansao ? 'Expansão' : 'Onboarding'}: ${conta.nome} (${nomesProdutos})`,
    descricao: `Venda ${o.codigo} fechada pelo Comercial. Contato comercial: ${o.contato_nome || '-'} ${o.contato_telefone || ''} ${o.contato_email || ''}. `
      + `Teste: ${o.teste_dispensado ? 'dispensado (produtos sem teste no catálogo)' : `${o.teste_criterio || '-'} (${o.teste_parecer || 'aprovado'})`}. O CS define o ponto focal (1 nome + 1 contato) e repassa ao Suporte.`,
    proximaAcao: 'Definir o ponto focal e o plano de onboarding',
  });
  await auditar(c, ctx, { acao: expansao ? 'conta.expansao_vendida' : 'conta.criada_pela_venda', entidade: 'conta', entidadeId: conta.id,
    depois: { oportunidade: o.codigo, produtos: o.produtos, valorMensal: o.valor_mensal } });
  return { contaId: conta.id, ocorrenciaId: oc.id, expansao };
}

/** Suspende (CRM-011): sai do funil ativo, com motivo e data para retomar — que vira a próxima ação. */
async function suspender(c, ctx, id, { motivo, retomarEm }, versao) {
  const atual = await buscar(c, id, true);
  if (!ABERTAS.includes(atual.etapa)) throw erro.conflito('Só oportunidade em andamento pode ser suspensa.');
  const quando = new Date(retomarEm); const agora = relogio.agora();
  if (!(quando > agora) || quando - agora > 365 * DIA) throw erro.entrada('Data para retomar: no futuro e em até 1 ano.', [{ campo: 'retomarEm', problema: 'inválida' }]);
  const r = await gravar(c, atual, { etapa: 'suspensa', suspensa_de: atual.etapa, motivo_suspensao: motivo, etapa_desde: agora,
    proxima_acao: `Retomar contato (suspensa: ${motivo})`.slice(0, 200), proxima_acao_em: quando }, versao);
  await auditar(c, ctx, { acao: 'oportunidade.suspensa', entidade: 'oportunidade', entidadeId: id, antes: { etapa: atual.etapa }, depois: { etapa: 'suspensa', retomarEm: quando }, motivo });
  await publicar(c, ctx, { tipo: 'oportunidade.etapa', agregado: 'oportunidade', agregadoId: id, chave: `op:${id}:v${r.version}`, payload: { de: atual.etapa, para: 'suspensa' } });
  return r;
}

/** Retoma a suspensa (volta à etapa de onde saiu) ou reabre a perdida (volta à qualificação, com motivo). */
async function retomar(c, ctx, id, { motivo } = {}, versao) {
  const atual = await buscar(c, id, true);
  const agora = relogio.agora();
  let colunas; let acao;
  if (atual.etapa === 'suspensa') {
    acao = 'oportunidade.retomada';
    colunas = { etapa: atual.suspensa_de, suspensa_de: null, motivo_suspensao: null, etapa_desde: agora,
      proxima_acao: ACAO_PADRAO[atual.suspensa_de] || 'Retomar a negociação', proxima_acao_em: new Date(agora.getTime() + DIA) };
  } else if (atual.etapa === 'perdida') {
    if (!(motivo && motivo.trim().length >= 5)) throw erro.entrada('Diga por que a oportunidade está sendo reaberta.', [{ campo: 'motivo', problema: 'obrigatório' }]);
    acao = 'oportunidade.reaberta';
    colunas = { etapa: 'qualificacao', motivo_perda: null, detalhe_perda: null, fechada_em: null, etapa_desde: agora,
      proxima_acao: 'Retomar a negociação (reaberta)', proxima_acao_em: new Date(agora.getTime() + DIA) };
  } else throw erro.conflito('Só oportunidade suspensa ou perdida pode ser retomada.');
  const r = await gravar(c, atual, colunas, versao);
  await auditar(c, ctx, { acao, entidade: 'oportunidade', entidadeId: id, antes: { etapa: atual.etapa, motivoPerda: atual.motivo_perda }, depois: { etapa: r.etapa }, motivo: motivo || null });
  await publicar(c, ctx, { tipo: 'oportunidade.etapa', agregado: 'oportunidade', agregadoId: id, chave: `op:${id}:v${r.version}`, payload: { de: atual.etapa, para: r.etapa } });
  return r;
}

/** Migração do Pipedrive (CRM-018) por CSV: negócios em aberto entram uma vez só (id do Pipedrive). Ganhos e perdidos
 *  ficam para a migração completa do histórico, com a exportação real e a conciliação aprovada. */
async function importarDoPipedrive(c, ctx, linhas) {
  const resumo = { criadas: 0, jaExistiam: 0 }; const erros = [];
  const emails = [...new Set(linhas.map((l) => (l.responsavel_email || '').toLowerCase()).filter(Boolean))];
  const donos = new Map((await c.query("SELECT id, lower(email) AS email FROM usuarios WHERE lower(email) = ANY($1) AND ativo AND papel IN ('comercial','supervisor','admin')", [emails])).rows.map((u) => [u.email, u.id]));
  const agora = relogio.agora();
  for (const l of linhas) {
    if (uma(await c.query("SELECT 1 FROM oportunidades WHERE fonte = 'pipedrive' AND id_externo = $1", [l.id]))) { resumo.jaExistiam++; continue; }
    let o;
    try { o = normalizar({ empresa: l.organizacao, cnpj: l.cnpj || undefined, contatoNome: l.contato || undefined, contatoTelefone: l.telefone || undefined,
      contatoEmail: l.email || undefined, valorMensal: l.valor || undefined }); } catch (e) { erros.push({ linha: l.numero, erro: e.message }); continue; }
    const cod = await codigo(c, ctx);
    const op = uma(await c.query(`INSERT INTO oportunidades (tenant_id, codigo, empresa, cnpj, contato_nome, contato_telefone, contato_email, origem, valor_mensal,
        responsavel_id, proxima_acao, proxima_acao_em, fonte, id_externo, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,'base',$8,$9,$10,$11,'pipedrive',$12,$13) RETURNING id`,
    [ctx.tenantId, cod, o.empresa, o.cnpj || null, o.contato_nome || null, o.contato_telefone || null, o.contato_email || null, o.valor_mensal ?? null,
      donos.get((l.responsavel_email || '').toLowerCase()) || null, `Revisar negócio migrado do Pipedrive${l.etapa ? ` (lá: ${l.etapa})` : ''}`.slice(0, 200),
      new Date(agora.getTime() + DIA), l.id, l.criado_em || agora]));
    if (l.titulo || l.observacoes) await atividades.registrar(c, ctx, { id: op.id, etapa: 'novo' }, { tipo: 'nota', assunto: (l.titulo || 'Negócio do Pipedrive').slice(0, 200), resultado: l.observacoes || null });
    await auditar(c, ctx, { acao: 'oportunidade.importada_pipedrive', entidade: 'oportunidade', entidadeId: op.id, depois: { codigo: cod, idPipedrive: l.id } });
    resumo.criadas++;
  }
  return { resumo: [`${resumo.criadas} oportunidade(s) criada(s) do Pipedrive`, `${resumo.jaExistiam} já estavam no Sinapse (mesmo id do Pipedrive)`], erros };
}

async function definirProximaAcao(c, ctx, id, { proximaAcao, proximaAcaoEm }, versao) {
  const atual = await buscar(c, id, true);
  if (!ABERTAS.includes(atual.etapa)) throw erro.conflito('Oportunidade encerrada.');
  return gravar(c, atual, { proxima_acao: proximaAcao, proxima_acao_em: proximaAcaoEm }, versao);
}

async function listar(c, { q, minhas, usuario, funil } = {}) {
  const params = [relogio.agora()];
  if (funil && FUNIS[funil]) params.push(funil);
  const onde = ["(o.etapa NOT IN ('ganha','perdida') OR o.fechada_em > $1::timestamptz - interval '60 days')"];
  if (q) { params.push(`%${q}%`); onde.push(`(o.empresa ILIKE $${params.length} OR o.codigo ILIKE $${params.length} OR o.cnpj LIKE $${params.length})`); }
  if (funil && FUNIS[funil]) onde.push('o.funil = $2');
  // "Minhas" inclui a fila (sem dono): oportunidade encaminhada pelo CS não pode sumir da tela de quem vai pegá-la.
  if (minhas) { params.push(usuario.id); onde.push(`(o.responsavel_id = $${params.length} OR o.responsavel_id IS NULL)`); }
  const r = await c.query(
    `SELECT o.id, o.codigo, o.empresa, o.etapa, o.valor_mensal, o.frota, o.produtos, o.proxima_acao, o.proxima_acao_em, o.etapa_desde, o.teste_fim,
       o.teste_resultado, o.teste_dispensado, o.version, o.conta_id, o.fonte, o.suspensa_de, o.funil, o.fechamento_previsto, u.nome AS responsavel_nome,
       count(*) OVER()::int AS total
     FROM oportunidades o LEFT JOIN usuarios u ON u.id = o.responsavel_id
     WHERE ${onde.join(' AND ')} ORDER BY o.proxima_acao_em NULLS LAST LIMIT 300`, params);
  // O quadro mostra até 300; acima disso a tela avisa e pede filtro (busca, funil, "só as minhas").
  return { itens: r.rows.map(({ total, ...x }) => x), total: r.rows[0]?.total || 0, limite: 300 };
}

async function detalhe(c, ctx, id) {
  const o = uma(await c.query(`SELECT o.*, u.nome AS responsavel_nome, ct.nome AS conta_nome, co.nome AS conta_origem_nome, co.produtos AS conta_origem_produtos,
    co.valor_mensal AS conta_origem_valor, ep.nome AS encaminhada_por_nome FROM oportunidades o LEFT JOIN usuarios u ON u.id = o.responsavel_id
    LEFT JOIN contas ct ON ct.id = o.conta_id LEFT JOIN contas co ON co.id = o.conta_origem_id LEFT JOIN usuarios ep ON ep.id = o.encaminhada_por WHERE o.id = $1`, [id]));
  if (!o) throw erro.naoEncontrado('Oportunidade');
  const historico = (await c.query("SELECT acao, ator_nome, antes, depois, motivo, criado_em FROM auditoria WHERE entidade = 'oportunidade' AND entidade_id = $1 ORDER BY id", [id])).rows;
  // Mesma regra do `mover`: renovação nunca exige teste; expansão só pelos produtos novos.
  const novos = o.funil === 'expansao' ? (o.produtos || []).filter((p) => !(o.conta_origem_produtos || []).includes(p)) : o.produtos || [];
  const exigeTeste = o.funil === 'renovacao' ? false : o.funil === 'expansao' && !novos.length && (o.produtos || []).length ? false : await catalogo.exigeTeste(c, ctx, novos);
  return { ...o, historico, propostas: await propostas.listar(c, id), atividades: await atividades.listar(c, id), contatos: await contatos.listar(c, id), exigeTeste };
}

/** Indicadores do funil (para o Comercial e para a diretoria). */
async function indicadores(c) {
  const porEtapa = (await c.query(`SELECT etapa, count(*)::int AS n, coalesce(sum(valor_mensal),0)::float AS valor FROM oportunidades
    WHERE etapa NOT IN ('ganha','perdida') OR fechada_em > $1::timestamptz - interval '90 days' GROUP BY etapa`, [relogio.agora()])).rows;
  const testes = uma(await c.query(`SELECT count(*) FILTER (WHERE teste_resultado = 'aprovado')::int AS aprovados,
    count(*) FILTER (WHERE teste_resultado = 'reprovado')::int AS reprovados,
    count(*) FILTER (WHERE etapa = 'teste' AND teste_resultado IS NULL)::int AS em_andamento,
    count(*) FILTER (WHERE etapa = 'ganha')::int AS ganhas, count(*) FILTER (WHERE etapa = 'perdida')::int AS perdidas,
    coalesce(avg(EXTRACT(EPOCH FROM fechada_em - criado_em) / 86400) FILTER (WHERE etapa = 'ganha'), 0)::float AS ciclo_dias,
    count(*) FILTER (WHERE etapa NOT IN ('ganha','perdida') AND proxima_acao_em < $1)::int AS acao_vencida
    FROM oportunidades`, [relogio.agora()]));
  const motivos = (await c.query("SELECT motivo_perda, count(*)::int AS n FROM oportunidades WHERE etapa = 'perdida' GROUP BY motivo_perda ORDER BY n DESC")).rows;
  const abertas = (await c.query("SELECT etapa, valor_mensal, fechamento_previsto FROM oportunidades WHERE etapa NOT IN ('ganha','perdida','suspensa')")).rows;
  const porFunil = (await c.query(`SELECT funil, count(*) FILTER (WHERE etapa NOT IN ('ganha','perdida','suspensa'))::int AS abertas,
    coalesce(sum(valor_mensal) FILTER (WHERE etapa NOT IN ('ganha','perdida','suspensa')), 0)::float AS valor,
    count(*) FILTER (WHERE etapa = 'ganha' AND fechada_em > $1::timestamptz - interval '90 days')::int AS ganhas_90d FROM oportunidades GROUP BY funil`, [relogio.agora()])).rows;
  return { porEtapa, testes, motivos, porFunil, previsao: previsao(abertas, 3, relogio.agora()) };
}

/** CS encaminha ao Comercial (CS-011): oportunidade de expansão ou renovação de um cliente da carteira, na fila do
 *  Comercial (sem responsável), com a observação de quem encaminhou. */
async function encaminhar(c, ctx, { contaId, funil, observacao }) {
  if (!['expansao', 'renovacao'].includes(funil)) throw erro.entrada('Encaminhe como expansão ou renovação.');
  const op = await criar(c, ctx, { funil, contaOrigemId: contaId, encaminhada: true, observacao,
    proximaAcao: `Contato do Comercial (encaminhado: ${observacao})`.slice(0, 200) });
  await atividades.registrar(c, ctx, op, { tipo: 'nota', assunto: `Encaminhado por ${ctx.usuario?.nome || 'CS'}`, resultado: observacao });
  return op;
}

module.exports = { encaminhar, criar, atualizar, mover, registrarTeste, definirProximaAcao, suspender, retomar, importarDoPipedrive, listar, detalhe, indicadores, normalizar, buscar };
