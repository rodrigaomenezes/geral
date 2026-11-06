'use strict';
// RN-002 / GOV-007: toda conta operacional (ativa ou em onboarding) precisa de ponto focal principal válido — vigente,
// sem opt-out e com um canal autorizado (e-mail ou WhatsApp com consentimento). Sem isso, os contatos de rodada ficam
// bloqueados. O supervisor abre uma tarefa para a equipe da conta, uma vez por situação (a chave muda quando o ponto
// focal muda). Com pendência de rodada aberta, é risco: prazo de 2 h e aviso também à Supervisão.

const { escolherCanal } = require('../comunicacao/servico');
const { relogio, HORA } = require('../../nucleo/relogio');

const equipeDaConta = (ct) => ct.roteamento_excecao || (ct.vip ? 'cs' : 'suporte');

async function verificarPontosFocais(c, ctx, { criarTarefa, concluirTarefa }) {
  const agora = relogio.agora();
  const contas = (await c.query(`SELECT ct.id, ct.nome, ct.vip, ct.roteamento_excecao,
      (SELECT row_to_json(p) FROM pontos_focais p WHERE p.conta_id = ct.id AND p.vigente AND p.papel = 'principal' ORDER BY p.criado_em DESC LIMIT 1) AS principal,
      (SELECT count(*)::int FROM pendencias pe WHERE pe.conta_id = ct.id AND pe.estado IN ('aberta','persistente')) AS pendencias
    FROM contas ct WHERE ct.status IN ('ativa','onboarding') AND ct.arquivada_em IS NULL LIMIT 500`)).rows;
  let abertas = 0;
  for (const ct of contas) {
    const pf = ct.principal;
    const motivo = pf ? escolherCanal(pf).motivo : 'Conta sem ponto focal principal vigente.';
    if (pf && !motivo) {
      // Corrigido: as tarefas abertas desta pendência de cadastro se fecham sozinhas, com o motivo.
      if (concluirTarefa) {
        const pendentes = (await c.query("SELECT id FROM tarefas WHERE estado = 'aberta' AND (chave LIKE $1 OR chave LIKE $2)", [`ponto-focal:${ct.id}:%`, `ponto-focal-risco:${ct.id}:%`])).rows;
        for (const x of pendentes) await concluirTarefa(x.id, `Ponto focal válido cadastrado: ${pf.nome}`);
      }
      continue;
    }
    const risco = ct.pendencias > 0;
    const situacao = pf ? `${pf.id}:${pf.opt_out ? 'optout' : 'semcanal'}` : 'sem';
    const base = { tipo: 'geral', prazoEm: new Date(agora.getTime() + (risco ? 2 : 24) * HORA) };
    const t = await criarTarefa({ ...base, equipeCodigo: equipeDaConta(ct), chave: `ponto-focal:${ct.id}:${situacao}`,
      titulo: `${risco ? 'RISCO de rodada · ' : ''}${ct.nome}: ponto focal inválido — ${motivo}`.slice(0, 200) });
    if (t) abertas++;
    // O risco é avaliado a cada varredura: a pendência pode aparecer depois da tarefa de cadastro (a chave evita repetir).
    if (risco) {
      const r = await criarTarefa({ ...base, equipeCodigo: 'supervisao', chave: `ponto-focal-risco:${ct.id}:${situacao}`,
        titulo: `${ct.nome}: ${ct.pendencias} pendência(s) de rodada e nenhum ponto focal para avisar`.slice(0, 200) });
      if (r) abertas++;
    }
  }
  return abertas;
}

module.exports = { verificarPontosFocais };
