'use strict';
// Variáveis que condições e textos dos processos enxergam, lidas do banco a cada passo (nunca de cópia velha).
// Só leitura: o motor não escreve nas tabelas de outros módulos por aqui.

const { uma } = require('../../db');
const { normalizarErro } = require('../rodadas/erros');
const { equipeDaConta } = require('../clientes/servico');

const dataBr = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');

/** Monta o contexto a partir de { ocorrencia_id, rodada_id, conta_id, iniciada_em, id }. */
async function carregar(c, alvo) {
  const vars = {};
  let contaId = alvo.conta_id;
  let oc = null;
  let rod = null;
  if (alvo.ocorrencia_id) {
    oc = uma(await c.query(`SELECT o.*, e.codigo AS equipe_codigo FROM ocorrencias o JOIN equipes e ON e.id = o.equipe_id WHERE o.id = $1`, [alvo.ocorrencia_id]));
    if (oc) {
      contaId = contaId || oc.conta_id;
      Object.assign(vars, {
        'ocorrencia.tipo': oc.tipo, 'ocorrencia.prioridade': oc.prioridade, 'ocorrencia.estado': oc.estado, 'ocorrencia.origem': oc.origem,
        'ocorrencia.equipe': oc.equipe_codigo, 'ocorrencia.encerrada': ['resolvida', 'encerrada_sem_resolucao'].includes(oc.estado),
        'ocorrencia.nivel_escalonamento': oc.nivel_escalonamento, protocolo: oc.protocolo, titulo: oc.titulo,
      });
    }
  }
  if (alvo.rodada_id) {
    rod = uma(await c.query('SELECT * FROM rodadas WHERE id = $1', [alvo.rodada_id]));
    if (rod) {
      contaId = contaId || rod.conta_id;
      Object.assign(vars, {
        'rodada.executada': ['executada', 'concluida'].includes(rod.estado), 'rodada.produto': rod.produto,
        'rodada.falhas': rod.veiculos_falha ?? 0, produto: rod.produto, data: dataBr(rod.agendada_para), d0: rod.agendada_para,
        sucesso: rod.veiculos_sucesso ?? 0, total: rod.veiculos_total ?? 0,
      });
    }
  }
  let conta = null;
  if (contaId) {
    conta = uma(await c.query('SELECT * FROM contas WHERE id = $1', [contaId]));
    const pfs = (await c.query("SELECT * FROM pontos_focais WHERE conta_id = $1 AND vigente ORDER BY papel = 'principal' DESC", [contaId])).rows;
    const pend = (await c.query("SELECT placa, erro_codigo FROM pendencias WHERE conta_id = $1 AND estado IN ('aberta','persistente') ORDER BY placa", [contaId])).rows
      .filter((p) => normalizarErro(p.erro_codigo).doCliente);
    if (conta) {
      Object.assign(vars, {
        'conta.vip': conta.vip, 'conta.status': conta.status, 'conta.tem_ponto_focal': pfs.some((p) => p.papel === 'principal'),
        'conta.tem_grupo': !!conta.grupo_whatsapp, conta: conta.nome, equipe_da_conta: equipeDaConta(conta),
        'pendencias.abertas': pend.length, qtd: pend.length, qtd_pendencias: pend.length, nome: pfs[0]?.nome || 'cliente',
        lista: pend.map((p) => `• ${p.placa}: ${normalizarErro(p.erro_codigo).descricao} — ${normalizarErro(p.erro_codigo).instrucao}`).join('\n') || '(nenhuma)',
      });
    }
    if (rod) {
      const falhas = new Set(pend.map((p) => p.placa));
      const placas = (await c.query('SELECT placa FROM demo_platform_veiculos WHERE conta_id = $1 ORDER BY placa', [contaId])).rows.map((x) => x.placa);
      vars.lista_sucesso = placas.filter((p) => !falhas.has(p)).join(', ') || '(nenhum)';
    }
  }
  if (!vars.protocolo && (alvo.rodada_id || contaId)) {
    const o = uma(await c.query(
      `SELECT protocolo FROM ocorrencias WHERE ${alvo.rodada_id ? 'rodada_id = $1' : 'conta_id = $1'} AND estado NOT IN ('resolvida','encerrada_sem_resolucao')
       ORDER BY criado_em DESC LIMIT 1`, [alvo.rodada_id || contaId]));
    vars.protocolo = o?.protocolo || '-';
  }
  if (alvo.id && alvo.iniciada_em) {
    const resp = uma(await c.query(
      `SELECT count(*)::int AS n FROM interacoes WHERE direcao = 'entrada' AND criado_em > $1
       AND (ocorrencia_id = $2 OR ($2::uuid IS NULL AND conta_id = $3))`, [alvo.iniciada_em, alvo.ocorrencia_id || null, contaId || null]));
    vars['cliente.respondeu'] = resp.n > 0;
    const lig = uma(await c.query(
      `SELECT resultado_codigo FROM tarefas WHERE execucao_id = $1 AND tipo = 'ligacao' AND estado = 'concluida' ORDER BY concluida_em DESC LIMIT 1`, [alvo.id]));
    vars['ligacao.atendeu'] = lig ? lig.resultado_codigo === 'atendeu' : false;
  } else {
    vars['cliente.respondeu'] = false;
    vars['ligacao.atendeu'] = false;
  }
  return { vars, conta, ocorrencia: oc, rodada: rod, contaId };
}

module.exports = { carregar };
