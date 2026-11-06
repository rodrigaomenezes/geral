'use strict';
// WFL-007: ciência do escalonamento. Quando a próxima ação vence, o supervisor sobe o nível (1 a 3) e abre tarefa para a
// Supervisão. A gestão registra a ciência com a ação decidida e o novo prazo: a próxima ação passa a ser essa, as
// tarefas de escalonamento abertas da ocorrência são concluídas com a ação, e tudo fica na linha do tempo. Se o novo
// prazo também vencer, o nível sobe de novo e a falta de ciência no nível atual aparece.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { relogio, HORA } = require('../../nucleo/relogio');
const maquina = require('./maquina');
const s = require('./servico');
const tarefas = require('./tarefas');

async function registrarCiencia(c, ctx, id, { acao, proximaAcaoEm, versao }) {
  const oc = uma(await c.query('SELECT * FROM ocorrencias WHERE id = $1 FOR UPDATE', [id]));
  if (!oc) throw erro.naoEncontrado('Ocorrência');
  if (maquina.FINAIS.includes(oc.estado)) throw erro.regra('ocorrencia_encerrada', 'A ocorrência já está encerrada.');
  if (!oc.nivel_escalonamento) throw erro.regra('sem_escalonamento', 'Esta ocorrência não está escalonada.');
  if (oc.escalonamento_ciente_nivel >= oc.nivel_escalonamento) throw erro.conflito(`A ciência do nível ${oc.nivel_escalonamento} já foi registrada.`);
  if (versao !== undefined && versao !== null && Number(versao) !== oc.version) throw erro.conflito('Ocorrência alterada por outra pessoa. Atualize a tela.');
  const agora = relogio.agora();
  const quando = proximaAcaoEm ? new Date(proximaAcaoEm) : new Date(agora.getTime() + 4 * HORA);
  if (!(quando > agora)) throw erro.entrada('O prazo da ação precisa ser no futuro.');
  if (quando - agora > 7 * 24 * HORA) throw erro.entrada('O prazo da ação vai até 7 dias. Para mais, registre uma espera com revisão.');
  const atual = await s.alterarComMotivo(c, ctx, oc.id, null, {
    proxima_acao: acao.slice(0, 200), proxima_acao_em: quando,
    escalonamento_ciente_em: agora, escalonamento_ciente_por: ctx.usuario.id, escalonamento_ciente_nivel: oc.nivel_escalonamento,
  }, 'ocorrencia.escalonamento_ciente', `Ciência do nível ${oc.nivel_escalonamento}: ${acao}`);
  const abertas = (await c.query("SELECT id FROM tarefas WHERE ocorrencia_id = $1 AND tipo = 'escalonamento' AND estado = 'aberta'", [oc.id])).rows;
  for (const t of abertas) await tarefas.concluir(c, ctx, t.id, `Ciência registrada: ${acao}`.slice(0, 1000));
  return { nivel: atual.nivel_escalonamento, proximaAcaoEm: atual.proxima_acao_em, tarefasConcluidas: abertas.length };
}

module.exports = { registrarCiencia };
