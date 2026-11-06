'use strict';
// Dashboards interativos (SUP-006, SUP-012, melhoria 6 da reunião de 03/11). Cada dashboard devolve blocos prontos
// para a tela: { id, titulo, tipo, unidade, colunas, linhas, series?, link? }. `linhas` é sempre a tabela de dados
// (a mesma usada no "ver tabela" e no CSV), e o gráfico é só uma leitura dela.
// Filtros: dias (7/30/90), equipe (código), carteira (vip | demais).

const { relogio, DIA } = require('../../nucleo/relogio');
const { erro } = require('../../nucleo/erros');
const { normalizarErro } = require('../rodadas/erros');

const PERIODOS = [7, 30, 90];
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const diaBr = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
const NOMES_TIPO = { duvida: 'Dúvida', erro_consulta: 'Erro de consulta', credencial: 'Credencial', pre_rodada: 'Pré-rodada', pos_rodada: 'Pós-rodada',
  onboarding: 'Onboarding', tecnica: 'Técnica', incidente: 'Incidente', solicitacao: 'Solicitação', nao_classificada: 'Não classificada' };
const ETAPAS = ['novo', 'qualificacao', 'demonstracao', 'proposta', 'teste', 'negociacao', 'ganha'];
const NOMES_ETAPA = { novo: 'Novo lead', qualificacao: 'Qualificação', demonstracao: 'Demonstração', proposta: 'Proposta', teste: 'Teste', negociacao: 'Negociação', ganha: 'Ganha' };

function filtros(q) {
  const dias = PERIODOS.includes(Number(q.dias)) ? Number(q.dias) : 30;
  return { dias, desde: new Date(relogio.agora().getTime() - dias * DIA), equipe: /^[a-z_]{2,30}$/.test(q.equipe || '') ? q.equipe : null,
    carteira: ['vip', 'demais'].includes(q.carteira) ? q.carteira : null };
}

/** Pedaços de SQL dos filtros comuns para ocorrências (alias o / c). */
function ondeOcorrencias(f, params) {
  const w = [];
  if (f.equipe) { params.push(f.equipe); w.push(`o.equipe_id = (SELECT id FROM equipes WHERE codigo = $${params.length})`); }
  if (f.carteira) w.push(f.carteira === 'vip' ? 'c.vip' : 'NOT coalesce(c.vip, false)');
  return w.length ? ` AND ${w.join(' AND ')}` : '';
}

function serieDiaria(f, linhasBanco, campos) {
  const mapa = new Map(linhasBanco.map((r) => [new Date(r.dia).toISOString().slice(0, 10), r]));
  const out = [];
  const hoje = relogio.agora();
  for (let i = f.dias - 1; i >= 0; i--) {
    const d = new Date(hoje.getTime() - i * DIA - 3 * 3600e3).toISOString().slice(0, 10);
    const r = mapa.get(d) || {};
    out.push({ dia: diaBr(`${d}T15:00:00Z`), ...Object.fromEntries(campos.map((cpo) => [cpo, Number(r[cpo] || 0)])) });
  }
  return out;
}

async function operacao(c, f) {
  const p = [f.desde];
  const w = ondeOcorrencias(f, p);
  const base = `FROM ocorrencias o LEFT JOIN contas c ON c.id = o.conta_id WHERE true${w}`;
  const t = (await c.query(`SELECT
      count(*) FILTER (WHERE o.estado NOT IN ('resolvida','encerrada_sem_resolucao'))::int AS ativas,
      count(*) FILTER (WHERE o.criado_em >= $1)::int AS abertas,
      count(*) FILTER (WHERE o.encerrada_em >= $1 AND o.estado = 'resolvida')::int AS resolvidas,
      count(*) FILTER (WHERE o.primeira_resposta_em >= $1)::int AS respondidas,
      count(*) FILTER (WHERE o.primeira_resposta_em >= $1 AND o.primeira_resposta_em <= o.sla_resposta_em)::int AS no_prazo,
      coalesce(avg(EXTRACT(EPOCH FROM o.encerrada_em - o.criado_em) / 3600) FILTER (WHERE o.encerrada_em >= $1 AND o.estado = 'resolvida'), 0)::float AS horas_resolucao
    ${base}`, p)).rows[0];
  const abertasDia = (await c.query(`SELECT (o.criado_em - interval '3 hours')::date AS dia, count(*)::int AS abertas ${base} AND o.criado_em >= $1 GROUP BY 1`, p)).rows;
  const resolvidasDia = (await c.query(`SELECT (o.encerrada_em - interval '3 hours')::date AS dia, count(*)::int AS resolvidas ${base} AND o.estado = 'resolvida' AND o.encerrada_em >= $1 GROUP BY 1`, p)).rows;
  const porDia = new Map();
  for (const r of [...abertasDia, ...resolvidasDia]) {
    const k = new Date(r.dia).toISOString().slice(0, 10);
    porDia.set(k, { ...(porDia.get(k) || { dia: k }), ...r, dia: k });
  }
  const serie = [...porDia.values()];
  const agora = relogio.agora();
  const porEquipe = (await c.query(`SELECT e.codigo, e.nome,
      count(o.id) FILTER (WHERE o.estado NOT IN ('aguardando_cliente','aguardando_terceiro') AND o.prazo_em >= $1::timestamptz + interval '2 hours')::int AS no_prazo,
      count(o.id) FILTER (WHERE o.estado NOT IN ('aguardando_cliente','aguardando_terceiro') AND o.prazo_em >= $1 AND o.prazo_em < $1::timestamptz + interval '2 hours')::int AS em_risco,
      count(o.id) FILTER (WHERE o.estado NOT IN ('aguardando_cliente','aguardando_terceiro') AND o.prazo_em < $1)::int AS vencido,
      count(o.id) FILTER (WHERE NOT (o.estado NOT IN ('aguardando_cliente','aguardando_terceiro')))::int AS em_espera
    FROM equipes e JOIN ocorrencias o ON o.equipe_id = e.id AND o.estado NOT IN ('resolvida','encerrada_sem_resolucao')
    LEFT JOIN contas c ON c.id = o.conta_id WHERE true${ondeOcorrencias({ ...f, equipe: null }, [agora])}
    GROUP BY e.codigo, e.nome ORDER BY count(o.id) DESC`, [agora])).rows;
  const pIdade = [agora];
  const idade = (await c.query(`SELECT CASE WHEN o.criado_em > $1::timestamptz - interval '1 day' THEN '1. até 1 dia' WHEN o.criado_em > $1::timestamptz - interval '3 days' THEN '2. 1 a 3 dias'
      WHEN o.criado_em > $1::timestamptz - interval '7 days' THEN '3. 3 a 7 dias' ELSE '4. mais de 7 dias' END AS faixa, count(*)::int AS n
    FROM ocorrencias o LEFT JOIN contas c ON c.id = o.conta_id WHERE o.estado NOT IN ('resolvida','encerrada_sem_resolucao')${ondeOcorrencias(f, pIdade)} GROUP BY 1 ORDER BY 1`, pIdade)).rows;
  const porTipo = (await c.query(`SELECT o.tipo, count(*)::int AS n ${base} AND o.criado_em >= $1 GROUP BY o.tipo ORDER BY n DESC`, p)).rows;
  return [
    { id: 'resumo', titulo: 'Resumo do período', tipo: 'tiles', linhas: [
      { rotulo: 'Ativas agora', valor: t.ativas, link: '#/ocorrencias' }, { rotulo: 'Abertas no período', valor: t.abertas },
      { rotulo: 'Resolvidas no período', valor: t.resolvidas }, { rotulo: 'Primeira resposta no prazo', valor: pct(t.no_prazo, t.respondidas), unidade: '%' },
      { rotulo: 'Tempo médio até resolver', valor: Math.round(t.horas_resolucao * 10) / 10, unidade: 'h' }] },
    { id: 'abertas_resolvidas', titulo: 'Abertas × resolvidas por dia', tipo: 'linha', series: [{ campo: 'abertas', rotulo: 'Abertas' }, { campo: 'resolvidas', rotulo: 'Resolvidas' }],
      colunas: [{ campo: 'dia', rotulo: 'Dia' }, { campo: 'abertas', rotulo: 'Abertas' }, { campo: 'resolvidas', rotulo: 'Resolvidas' }],
      linhas: serieDiaria(f, serie, ['abertas', 'resolvidas']) },
    { id: 'fila_equipe', titulo: 'Fila ativa por equipe e prazo', tipo: 'empilhado', status: true,
      series: [{ campo: 'no_prazo', rotulo: 'No prazo', status: 'ok' }, { campo: 'em_risco', rotulo: 'Em risco (< 2 h)', status: 'alerta' }, { campo: 'vencido', rotulo: 'Vencido', status: 'perigo' },
        { campo: 'em_espera', rotulo: 'Em espera (prazo pausado)', status: 'neutro' }],
      colunas: [{ campo: 'nome', rotulo: 'Equipe' }, { campo: 'no_prazo', rotulo: 'No prazo' }, { campo: 'em_risco', rotulo: 'Em risco' }, { campo: 'vencido', rotulo: 'Vencido' }, { campo: 'em_espera', rotulo: 'Em espera' }],
      linhas: porEquipe.map((x) => ({ ...x, rotulo: x.nome, link: `#/ocorrencias?equipe=${x.codigo}` })) },
    { id: 'envelhecimento', titulo: 'Há quanto tempo as ativas estão abertas', tipo: 'barras', unidade: 'ocorrências',
      colunas: [{ campo: 'rotulo', rotulo: 'Idade' }, { campo: 'valor', rotulo: 'Ocorrências' }], linhas: idade.map((x) => ({ rotulo: x.faixa.slice(3), valor: x.n })) },
    { id: 'por_tipo', titulo: 'Abertas no período por tipo', tipo: 'barras', unidade: 'ocorrências',
      colunas: [{ campo: 'rotulo', rotulo: 'Tipo' }, { campo: 'valor', rotulo: 'Ocorrências' }], linhas: porTipo.map((x) => ({ rotulo: NOMES_TIPO[x.tipo] || x.tipo, valor: x.n })) },
  ];
}

async function rodadas(c, f) {
  const cart = f.carteira ? (f.carteira === 'vip' ? ' AND c.vip' : ' AND NOT c.vip') : '';
  const lista = (await c.query(`SELECT r.id_platform, c.nome AS conta, r.produto, r.agendada_para, r.pendencias_detectadas AS detectadas,
      coalesce(r.pendencias_corrigidas_ate_d0, (SELECT count(*) FROM pendencias p WHERE p.rodada_id = r.id AND p.origem = 'pre_rodada' AND p.estado = 'corrigida'))::int AS corrigidas,
      r.veiculos_total, r.veiculos_sucesso, r.estado, r.id
    FROM rodadas r JOIN contas c ON c.id = r.conta_id WHERE r.agendada_para >= $1::timestamptz - interval '7 days'${cart} ORDER BY r.agendada_para`, [f.desde])).rows;
  const executadas = lista.filter((r) => r.veiculos_total !== null && ['executada', 'concluida'].includes(r.estado));
  const det = lista.reduce((s, r) => s + (r.detectadas || 0), 0);
  const cor = lista.reduce((s, r) => s + (r.corrigidas || 0), 0);
  const tot = executadas.reduce((s, r) => s + r.veiculos_total, 0);
  const suc = executadas.reduce((s, r) => s + (r.veiculos_sucesso || 0), 0);
  const pend = (await c.query(`SELECT p.erro_codigo, p.estado, p.origem, count(*)::int AS n FROM pendencias p JOIN contas c ON c.id = p.conta_id
    WHERE p.detectada_em >= $1${cart} GROUP BY 1, 2, 3`, [f.desde])).rows;
  const posTotal = pend.filter((p) => p.origem === 'pos_rodada').reduce((s, p) => s + p.n, 0);
  const posCorr = pend.filter((p) => p.origem === 'pos_rodada' && p.estado === 'corrigida').reduce((s, p) => s + p.n, 0);
  const persistentes = pend.filter((p) => p.estado === 'persistente').reduce((s, p) => s + p.n, 0);
  const porCategoria = new Map();
  for (const p of pend) {
    const n = normalizarErro(p.erro_codigo);
    const k = n.descricao;
    const atual = porCategoria.get(k) || { rotulo: k, abertas: 0, corrigidas: 0 };
    if (p.estado === 'corrigida') atual.corrigidas += p.n; else atual.abertas += p.n;
    porCategoria.set(k, atual);
  }
  const contatos = (await c.query(`SELECT i.modelo, count(*)::int AS n FROM interacoes i WHERE i.modelo LIKE ANY(ARRAY['pre_rodada%','pos_rodada%','formalizacao%','comunicado%'])
    AND i.criado_em >= $1 GROUP BY i.modelo`, [f.desde])).rows;
  return [
    { id: 'resumo', titulo: 'Sucesso das correções (pré e pós-rodada)', tipo: 'tiles', linhas: [
      { rotulo: 'Correção pré-rodada (D-4 → D0)', valor: pct(cor, det), unidade: '%', nota: `${cor} de ${det} pendência(s)` },
      { rotulo: 'Correção pós-rodada', valor: pct(posCorr, posTotal), unidade: '%', nota: `${posCorr} de ${posTotal}` },
      { rotulo: 'Sucesso das consultas (rodada oficial)', valor: pct(suc, tot), unidade: '%', nota: `${suc} de ${tot} veículo(s)` },
      { rotulo: 'Pendências persistentes', valor: persistentes, link: '#/rodadas' },
      { rotulo: 'Contatos automáticos enviados', valor: contatos.reduce((s, x) => s + x.n, 0) }] },
    { id: 'por_rodada', titulo: 'Pendências detectadas × corrigidas até o D0, por rodada', tipo: 'agrupado',
      series: [{ campo: 'detectadas', rotulo: 'Detectadas no D-4' }, { campo: 'corrigidas', rotulo: 'Corrigidas até o D0' }],
      colunas: [{ campo: 'rotulo', rotulo: 'Rodada' }, { campo: 'detectadas', rotulo: 'Detectadas' }, { campo: 'corrigidas', rotulo: 'Corrigidas' }, { campo: 'taxa', rotulo: '% corrigidas' }],
      linhas: lista.filter((r) => r.detectadas).map((r) => ({ rotulo: `${r.conta} · ${diaBr(r.agendada_para)}`, detectadas: r.detectadas, corrigidas: r.corrigidas,
        taxa: pct(r.corrigidas, r.detectadas), link: `#/rodadas/${r.id}` })) },
    { id: 'por_erro', titulo: 'Pendências por tipo de erro', tipo: 'empilhado',
      series: [{ campo: 'corrigidas', rotulo: 'Corrigidas' }, { campo: 'abertas', rotulo: 'Em aberto' }],
      colunas: [{ campo: 'rotulo', rotulo: 'Erro' }, { campo: 'corrigidas', rotulo: 'Corrigidas' }, { campo: 'abertas', rotulo: 'Em aberto' }],
      linhas: [...porCategoria.values()].sort((a, b) => b.abertas + b.corrigidas - a.abertas - a.corrigidas) },
    { id: 'sucesso_rodada', titulo: 'Sucesso das consultas por rodada oficial', tipo: 'barras', unidade: '%',
      colunas: [{ campo: 'rotulo', rotulo: 'Rodada' }, { campo: 'valor', rotulo: '% com sucesso' }],
      linhas: executadas.map((r) => ({ rotulo: `${r.conta} · ${diaBr(r.agendada_para)}`, valor: pct(r.veiculos_sucesso, r.veiculos_total), link: `#/rodadas/${r.id}` })) },
  ];
}

async function carteira(c, f) {
  const cart = f.carteira ? (f.carteira === 'vip' ? ' AND c.vip' : ' AND NOT c.vip') : '';
  const contas = (await c.query(`SELECT c.id, c.nome, c.vip, u.ultimo_login, u.consultas_30d,
      EXISTS (SELECT 1 FROM pontos_focais p WHERE p.conta_id = c.id AND p.vigente AND p.papel = 'principal') AS tem_pf,
      (SELECT count(*)::int FROM pendencias p WHERE p.conta_id = c.id AND p.estado <> 'corrigida') AS pendencias,
      (SELECT count(*)::int FROM ocorrencias o WHERE o.conta_id = c.id AND o.estado NOT IN ('resolvida','encerrada_sem_resolucao')) AS ocorrencias,
      (SELECT situacao FROM status_financeiro s WHERE s.conta_id = c.id) AS financeiro
    FROM contas c LEFT JOIN uso_contas u ON u.conta_id = c.id WHERE c.arquivada_em IS NULL${cart} ORDER BY c.nome`)).rows;
  const agora = relogio.agora();
  const linhas = contas.map((x) => {
    const dias = x.ultimo_login ? Math.floor((agora - new Date(x.ultimo_login)) / DIA) : null;
    // Saúde transparente (CS-002): cada ponto perdido tem motivo escrito.
    const motivos = [];
    if (dias === null) motivos.push('sem dado de uso'); else if (dias > 14) motivos.push(`sem login há ${dias} dias`); else if (dias > 7) motivos.push(`último login há ${dias} dias`);
    if (!x.tem_pf) motivos.push('sem ponto focal');
    if (x.pendencias) motivos.push(`${x.pendencias} pendência(s)`);
    if (x.ocorrencias >= 3) motivos.push(`${x.ocorrencias} ocorrências ativas`);
    if (x.financeiro === 'em_atraso') motivos.push('atenção financeira');
    const pontos = Math.max(0, 100 - (dias === null ? 15 : dias > 14 ? 35 : dias > 7 ? 15 : 0) - (x.tem_pf ? 0 : 25) - Math.min(30, x.pendencias * 10)
      - (x.ocorrencias >= 3 ? 10 : 0) - (x.financeiro === 'em_atraso' ? 10 : 0));
    return { rotulo: x.nome, vip: x.vip ? 'VIP' : '', saude: pontos, dias_sem_login: dias ?? '—', pendencias: x.pendencias, ocorrencias: x.ocorrencias, motivos: motivos.join('; ') || 'tudo em dia', link: `#/contas/${x.id}` };
  }).sort((a, b) => a.saude - b.saude);
  const faixas = [['até 7 dias', (d) => d !== '—' && d <= 7], ['8 a 14 dias', (d) => d !== '—' && d > 7 && d <= 14], ['mais de 14 dias', (d) => d !== '—' && d > 14], ['sem dado', (d) => d === '—']];
  return [
    { id: 'resumo', titulo: 'Carteira', tipo: 'tiles', linhas: [
      { rotulo: 'Contas', valor: contas.length, link: '#/contas' }, { rotulo: 'VIP', valor: contas.filter((x) => x.vip).length },
      { rotulo: 'Sem ponto focal', valor: contas.filter((x) => !x.tem_pf).length, alerta: true }, { rotulo: 'Em risco (saúde < 60)', valor: linhas.filter((x) => x.saude < 60).length, alerta: true }] },
    { id: 'saude', titulo: 'Saúde das contas (menor primeiro)', tipo: 'barras', unidade: 'pontos', sequencial: true,
      colunas: [{ campo: 'rotulo', rotulo: 'Conta' }, { campo: 'vip', rotulo: 'VIP' }, { campo: 'saude', rotulo: 'Saúde' }, { campo: 'dias_sem_login', rotulo: 'Dias sem login' },
        { campo: 'pendencias', rotulo: 'Pendências' }, { campo: 'ocorrencias', rotulo: 'Ocorrências ativas' }, { campo: 'motivos', rotulo: 'Por quê' }],
      linhas: linhas.map((x) => ({ ...x, valor: x.saude })) },
    { id: 'ultimo_login', titulo: 'Último login na Platform', tipo: 'barras', unidade: 'contas',
      colunas: [{ campo: 'rotulo', rotulo: 'Faixa' }, { campo: 'valor', rotulo: 'Contas' }],
      linhas: faixas.map(([r, fn]) => ({ rotulo: r, valor: linhas.filter((x) => fn(x.dias_sem_login)).length })) },
  ];
}

async function comercial(c, f) {
  const porEtapa = (await c.query(`SELECT etapa, count(*)::int AS n, coalesce(sum(valor_mensal),0)::float AS valor FROM oportunidades
    WHERE etapa NOT IN ('ganha','perdida') OR fechada_em >= $1 GROUP BY etapa`, [f.desde])).rows;
  const alcancou = (await c.query(`SELECT a.depois->>'etapa' AS etapa, count(DISTINCT a.entidade_id)::int AS n FROM auditoria a
    WHERE a.entidade = 'oportunidade' AND a.acao IN ('oportunidade.etapa','oportunidade.ganha') AND a.criado_em >= $1 GROUP BY 1`, [f.desde])).rows;
  const criadas = (await c.query("SELECT count(*)::int AS n FROM oportunidades WHERE criado_em >= $1", [f.desde])).rows[0].n;
  const m = Object.fromEntries(porEtapa.map((x) => [x.etapa, x]));
  const a = Object.fromEntries(alcancou.map((x) => [x.etapa, x.n]));
  const motivos = (await c.query("SELECT motivo_perda, count(*)::int AS n FROM oportunidades WHERE etapa = 'perdida' AND fechada_em >= $1 GROUP BY 1 ORDER BY n DESC", [f.desde])).rows;
  const origens = (await c.query("SELECT origem, count(*)::int AS n, count(*) FILTER (WHERE etapa = 'ganha')::int AS ganhas FROM oportunidades WHERE criado_em >= $1 GROUP BY 1 ORDER BY n DESC", [f.desde])).rows;
  const testes = (await c.query(`SELECT count(*) FILTER (WHERE teste_resultado = 'aprovado')::int AS aprov, count(*) FILTER (WHERE teste_resultado IS NOT NULL)::int AS tot FROM oportunidades WHERE atualizado_em >= $1`, [f.desde])).rows[0];
  const MOT = { preco: 'Preço', sem_retorno: 'Sem retorno', concorrente: 'Concorrente', teste_reprovado: 'Teste reprovado', sem_fit: 'Sem aderência', timing: 'Momento' };
  const ORI = { indicacao: 'Indicação', site: 'Site', evento: 'Evento', outbound: 'Prospecção ativa', parceiro: 'Parceiro', base: 'Base (expansão)' };
  return [
    { id: 'resumo', titulo: 'Comercial no período', tipo: 'tiles', linhas: [
      { rotulo: 'Funil aberto (mensal)', valor: ETAPAS.slice(0, 6).reduce((s, e) => s + (m[e]?.valor || 0), 0), unidade: 'R$', link: '#/comercial' },
      { rotulo: 'Oportunidades novas', valor: criadas }, { rotulo: 'Vendas ganhas', valor: m.ganha?.n || 0, nota: `R$ ${Math.round(m.ganha?.valor || 0).toLocaleString('pt-BR')}/mês` },
      { rotulo: 'Testes aprovados', valor: pct(testes.aprov, testes.tot), unidade: '%', nota: `${testes.aprov} de ${testes.tot}` }] },
    { id: 'funil', titulo: 'Funil: quantas oportunidades chegaram a cada etapa no período', tipo: 'funil', unidade: 'oportunidades',
      colunas: [{ campo: 'rotulo', rotulo: 'Etapa' }, { campo: 'valor', rotulo: 'Oportunidades' }, { campo: 'conversao', rotulo: '% da etapa anterior' }],
      linhas: ETAPAS.map((e, i) => {
        const v = e === 'novo' ? Math.max(criadas, a.novo || 0) : a[e] || 0;
        return { etapa: e, rotulo: NOMES_ETAPA[e], valor: v };
      }).map((x, i, arr) => ({ ...x, conversao: i ? pct(x.valor, arr[i - 1].valor) : null })) },
    { id: 'motivos', titulo: 'Motivos de perda', tipo: 'barras', unidade: 'oportunidades',
      colunas: [{ campo: 'rotulo', rotulo: 'Motivo' }, { campo: 'valor', rotulo: 'Perdidas' }], linhas: motivos.map((x) => ({ rotulo: MOT[x.motivo_perda] || x.motivo_perda, valor: x.n })) },
    { id: 'origens', titulo: 'Origem das oportunidades', tipo: 'agrupado', series: [{ campo: 'n', rotulo: 'Criadas' }, { campo: 'ganhas', rotulo: 'Ganhas' }],
      colunas: [{ campo: 'rotulo', rotulo: 'Origem' }, { campo: 'n', rotulo: 'Criadas' }, { campo: 'ganhas', rotulo: 'Ganhas' }],
      linhas: origens.map((x) => ({ rotulo: ORI[x.origem] || x.origem, n: x.n, ganhas: x.ganhas })) },
  ];
}

async function pessoas(c, f) {
  const r = (await c.query(`SELECT u.id, u.nome, e.nome AS equipe,
      (SELECT count(*)::int FROM auditoria a WHERE a.ator_id = u.id AND a.acao = 'ocorrencia.resolvida' AND a.criado_em >= $1) AS resolvidas,
      (SELECT count(*)::int FROM tarefas t WHERE t.concluida_por = u.id AND t.concluida_em >= $1) AS tarefas,
      (SELECT count(*)::int FROM chamadas ch WHERE ch.usuario_id = u.id AND ch.iniciada_em >= $1 AND ch.status NOT IN ('cancelada','falhou')) AS ligacoes,
      (SELECT count(*)::int FROM chamadas ch WHERE ch.usuario_id = u.id AND ch.iniciada_em >= $1 AND ch.status = 'atendida') AS atendidas,
      (SELECT count(*)::int FROM interacoes i WHERE i.autor_id = u.id AND i.direcao = 'saida' AND i.criado_em >= $1) AS respostas,
      (SELECT count(*)::int FROM oportunidades o WHERE o.responsavel_id = u.id AND o.etapa = 'ganha' AND o.fechada_em >= $1) AS vendas
    FROM usuarios u JOIN equipes e ON e.id = u.equipe_id WHERE u.ativo ${f.equipe ? 'AND e.codigo = $2' : ''} ORDER BY u.nome`, f.equipe ? [f.desde, f.equipe] : [f.desde])).rows;
  const linhas = r.map((x) => ({ ...x, rotulo: x.nome, taxa_atendimento: pct(x.atendidas, x.ligacoes), valor: x.resolvidas + x.tarefas }))
    .sort((a, b) => b.valor - a.valor);
  return [
    { id: 'entregas', titulo: 'Entregas por pessoa (ocorrências resolvidas + tarefas concluídas)', tipo: 'agrupado',
      series: [{ campo: 'resolvidas', rotulo: 'Ocorrências resolvidas' }, { campo: 'tarefas', rotulo: 'Tarefas concluídas' }],
      colunas: [{ campo: 'rotulo', rotulo: 'Pessoa' }, { campo: 'equipe', rotulo: 'Equipe' }, { campo: 'resolvidas', rotulo: 'Resolvidas' }, { campo: 'tarefas', rotulo: 'Tarefas' },
        { campo: 'respostas', rotulo: 'Respostas a clientes' }, { campo: 'ligacoes', rotulo: 'Ligações' }, { campo: 'taxa_atendimento', rotulo: '% atendidas' }, { campo: 'vendas', rotulo: 'Vendas' }],
      linhas: linhas.filter((x) => x.valor || x.ligacoes || x.respostas || x.vendas) },
  ];
}

async function automacao(c, f) {
  const porProc = (await c.query(`SELECT p.nome, count(e.id)::int AS total, count(e.id) FILTER (WHERE e.estado = 'concluida')::int AS concluidas,
      count(e.id) FILTER (WHERE e.estado = 'encerrada')::int AS sozinho, count(e.id) FILTER (WHERE e.estado IN ('em_andamento','aguardando'))::int AS andamento,
      count(e.id) FILTER (WHERE e.estado = 'falhou')::int AS falhas
    FROM processos p LEFT JOIN processo_execucoes e ON e.processo_id = p.id AND e.iniciada_em >= $1 GROUP BY p.nome ORDER BY total DESC`, [f.desde])).rows;
  const tar = (await c.query(`SELECT count(*) FILTER (WHERE execucao_id IS NOT NULL)::int AS auto, count(*) FILTER (WHERE execucao_id IS NULL)::int AS manual FROM tarefas WHERE criado_em >= $1`, [f.desde])).rows[0];
  const msg = (await c.query(`SELECT count(*) FILTER (WHERE autor_id IS NULL)::int AS auto, count(*) FILTER (WHERE autor_id IS NOT NULL)::int AS manual FROM interacoes WHERE direcao = 'saida' AND criado_em >= $1`, [f.desde])).rows[0];
  const total = porProc.reduce((s, x) => s + x.total, 0);
  return [
    { id: 'resumo', titulo: 'O que os processos fizeram sozinhos', tipo: 'tiles', linhas: [
      { rotulo: 'Execuções no período', valor: total, link: '#/processos' }, { rotulo: 'Pararam sozinhas (motivo resolvido)', valor: porProc.reduce((s, x) => s + x.sozinho, 0) },
      { rotulo: 'Mensagens automáticas', valor: msg.auto, nota: `${pct(msg.auto, msg.auto + msg.manual) ?? 0}% das mensagens` },
      { rotulo: 'Tarefas criadas por processo', valor: tar.auto, nota: `${pct(tar.auto, tar.auto + tar.manual) ?? 0}% das tarefas` },
      { rotulo: 'Falhas', valor: porProc.reduce((s, x) => s + x.falhas, 0), alerta: true }] },
    { id: 'por_processo', titulo: 'Execuções por processo', tipo: 'empilhado',
      series: [{ campo: 'concluidas', rotulo: 'Concluídas' }, { campo: 'sozinho', rotulo: 'Pararam sozinhas' }, { campo: 'andamento', rotulo: 'Em andamento' }],
      colunas: [{ campo: 'rotulo', rotulo: 'Processo' }, { campo: 'concluidas', rotulo: 'Concluídas' }, { campo: 'sozinho', rotulo: 'Pararam sozinhas' }, { campo: 'andamento', rotulo: 'Em andamento' }, { campo: 'falhas', rotulo: 'Falhas' }],
      linhas: porProc.filter((x) => x.total).map((x) => ({ ...x, rotulo: x.nome })) },
    { id: 'manual_auto', titulo: 'Trabalho automático × manual', tipo: 'empilhado',
      series: [{ campo: 'auto', rotulo: 'Automático' }, { campo: 'manual', rotulo: 'Manual' }],
      colunas: [{ campo: 'rotulo', rotulo: 'Tipo' }, { campo: 'auto', rotulo: 'Automático' }, { campo: 'manual', rotulo: 'Manual' }],
      linhas: [{ rotulo: 'Mensagens', ...msg }, { rotulo: 'Tarefas', ...tar }] },
  ];
}

const DASHBOARDS = {
  operacao: { titulo: 'Operação', fn: operacao, permissao: 'ocorrencia.ver' },
  rodadas: { titulo: 'Rodadas', fn: rodadas, permissao: 'rodada.ver' },
  carteira: { titulo: 'Carteira e CS', fn: carteira, permissao: 'conta.ver' },
  comercial: { titulo: 'Comercial', fn: comercial, permissao: 'comercial.ver' },
  pessoas: { titulo: 'Pessoas', fn: pessoas, permissao: 'supervisor.ver' },
  automacao: { titulo: 'Automação', fn: automacao, permissao: 'processo.ver' },
};

async function montar(c, nome, query) {
  const d = DASHBOARDS[nome];
  if (!d) throw erro.naoEncontrado('Dashboard');
  const f = filtros(query);
  return { nome, titulo: d.titulo, filtros: { dias: f.dias, equipe: f.equipe, carteira: f.carteira }, geradoEm: relogio.agora(), blocos: await d.fn(c, f) };
}

module.exports = { DASHBOARDS, montar, filtros };
