'use strict';
// RBAC: cada papel tem um conjunto fechado de permissões. Checado no servidor em toda rota.

const TODAS = {
  'ocorrencia.ver': 'ver ocorrências',
  'ocorrencia.atender': 'atender ocorrências',
  'ocorrencia.triar': 'classificar a fila de triagem',
  'ocorrencia.intervir': 'fazer intervenção excepcional',
  'conta.ver': 'ver contas',
  'conta.editar': 'editar contas e pontos focais',
  'rodada.ver': 'ver rodadas',
  'rodada.operar': 'operar pré e pós-rodada',
  'financeiro.detalhe': 'ver a situação financeira detalhada',
  'financeiro.bloqueio': 'pedir bloqueio por inadimplência',
  'supervisor.ver': 'ver o supervisor',
  'supervisor.reprocessar': 'reprocessar itens da fila de falhas',
  'auditoria.ver': 'ver a auditoria',
  'demo.simular': 'usar o simulador',
};

const OPERACIONAL = ['ocorrencia.ver', 'ocorrencia.atender', 'ocorrencia.triar', 'conta.ver', 'rodada.ver'];

const PAPEIS = {
  admin: Object.keys(TODAS),
  supervisor: Object.keys(TODAS).filter((p) => p !== 'financeiro.bloqueio'),
  suporte: [...OPERACIONAL, 'conta.editar', 'rodada.operar'],
  cs: [...OPERACIONAL, 'conta.editar', 'rodada.operar'],
  operacoes: [...OPERACIONAL, 'rodada.operar', 'conta.editar'],
  dev: ['ocorrencia.ver', 'ocorrencia.atender', 'conta.ver', 'rodada.ver'],
  financeiro: ['ocorrencia.ver', 'conta.ver', 'financeiro.detalhe', 'financeiro.bloqueio'],
};

const NOMES_PAPEIS = {
  admin: 'Administração', supervisor: 'Supervisão', suporte: 'Suporte', cs: 'Customer Success',
  operacoes: 'Operações', dev: 'Desenvolvimento', financeiro: 'Financeiro',
};

const permissoesDe = (papel) => PAPEIS[papel] || [];
const pode = (usuario, permissao) => !!usuario && permissoesDe(usuario.papel).includes(permissao);

module.exports = { TODAS, PAPEIS, NOMES_PAPEIS, permissoesDe, pode };
