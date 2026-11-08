'use strict';
// Chegada dos arquivos CSV (R-22, Prompt Mestre 7.2): a ausência de arquivo não é confirmação de sucesso.
// Cada arquivo da Platform e do OMIE é esperado uma vez por semana (decisão da Brobot, 08/11/2026). Sem arquivo novo
// dentro do prazo, o supervisor abre uma divergência e uma tarefa para a equipe que traz o arquivo (uma vez por episódio).
// Quando o arquivo chega, a divergência é dada como tratada sozinha. `tenants.config.csv_esperados` muda o prazo por
// tipo ({ tipo: dias }; 0 desliga). A migração do Pipedrive é pontual e não entra.

const { uma } = require('../../../db');
const { auditar } = require('../../../nucleo/registro');
const { relogio, HORA } = require('../../../nucleo/relogio');
const { TIPOS } = require('./importadores');

const ESPERADOS_PADRAO = { platform_rodada: 7, platform_credenciais: 7, platform_uso: 7, platform_consultas: 7, omie_clientes: 7 };
const EQUIPE = (tipo) => (tipo.startsWith('omie_') ? 'financeiro' : 'operacoes');

/** Regra pura: prazos em vigor (inteiros de 0 a 90 dias; inválido volta ao padrão; 0 desliga). */
function prazos(config) {
  const p = { ...ESPERADOS_PADRAO };
  if (config && typeof config === 'object') {
    for (const tipo of Object.keys(ESPERADOS_PADRAO)) {
      const v = Number(config[tipo]);
      if (config[tipo] !== undefined && config[tipo] !== null && Number.isInteger(v) && v >= 0 && v <= 90) p[tipo] = v;
    }
  }
  return p;
}

async function verificarChegada(c, ctx, { criarTarefa }) {
  const t = uma(await c.query('SELECT criado_em, config FROM tenants'));
  const p = prazos(t?.config?.csv_esperados);
  // Uma consulta: a última importação aplicada de cada tipo e a idade dela pelo relógio do banco (criado_em é do banco).
  const ultimas = Object.fromEntries((await c.query(`SELECT tipo, max(criado_em) AS ultima,
      EXTRACT(EPOCH FROM now() - max(criado_em)) / 86400 AS dias FROM importacoes GROUP BY tipo`)).rows.map((r) => [r.tipo, r]));
  const idadeOrg = uma(await c.query('SELECT EXTRACT(EPOCH FROM now() - $1::timestamptz) / 86400 AS dias', [t.criado_em])).dias;
  const equipes = new Set((await c.query('SELECT codigo FROM equipes')).rows.map((r) => r.codigo));
  const equipeDe = (tipo) => (equipes.has(EQUIPE(tipo)) ? EQUIPE(tipo) : 'supervisao'); // organização sem a equipe: a gestão recebe
  let abertas = 0;
  for (const [tipo, dias] of Object.entries(p)) {
    if (!dias) continue;
    const u = ultimas[tipo];
    const idade = u ? Number(u.dias) : Number(idadeOrg);
    if (idade <= dias) {
      await c.query("UPDATE divergencias SET estado = 'tratada' WHERE tipo = 'csv_atrasado' AND entidade_id = $1 AND estado = 'aberta'", [tipo]);
      continue;
    }
    const chave = `csv_atrasado:${tipo}:${u ? new Date(u.ultima).toISOString() : 'nunca'}`;
    const nome = TIPOS[tipo]?.nome || tipo;
    const descricao = u
      ? `Arquivo "${nome}" sem atualização há ${Math.floor(idade)} dia(s) (esperado a cada ${dias}). Sem ele, o Sinapse não sabe o que mudou: nada é dado como certo.`
      : `Arquivo "${nome}" nunca foi recebido (esperado a cada ${dias} dia(s)).`;
    const d = uma(await c.query(`INSERT INTO divergencias (tenant_id, tipo, descricao, entidade_id, chave) VALUES ($1, 'csv_atrasado', $2, $3, $4)
      ON CONFLICT (tenant_id, chave) DO NOTHING RETURNING id`, [ctx.tenantId, descricao.slice(0, 500), tipo, chave]));
    if (!d) continue;
    await auditar(c, ctx, { acao: 'supervisor.divergencia', entidade: 'divergencia', entidadeId: d.id, depois: { tipo: 'csv_atrasado', arquivo: tipo } });
    await criarTarefa({ tipo: 'geral', equipeCodigo: equipeDe(tipo), chave, prazoEm: new Date(relogio.agora().getTime() + 24 * HORA),
      titulo: `${u ? 'Arquivo atrasado' : 'Arquivo nunca recebido'}: importar "${nome}" em Integrações` });
    abertas++;
  }
  return abertas;
}

module.exports = { verificarChegada, prazos, ESPERADOS_PADRAO };
