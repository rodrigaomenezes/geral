'use strict';
// Quem responde agora (consultas sem efeito, sem importar outros módulos): delegação vigente de uma pessoa (GOV-009)
// e plantonista vigente de uma equipe (GOV-008). Usado pela identidade (resolver responsável) e pelas ocorrências.

const { uma } = require('../../db');

async function delegadoDe(c, usuarioId, agora) {
  return uma(await c.query(`SELECT d.id, d.para_id, p.nome AS para_nome, p.disponivel AS para_disponivel, d.fim
    FROM delegacoes d JOIN usuarios p ON p.id = d.para_id AND p.ativo
    WHERE d.de_id = $1 AND d.revogada_em IS NULL AND d.inicio <= $2 AND d.fim > $2 ORDER BY d.criado_em DESC LIMIT 1`, [usuarioId, agora]));
}

async function plantonista(c, equipeId, agora) {
  return uma(await c.query(`SELECT pl.id, pl.usuario_id, u.nome, pl.fim FROM plantoes pl JOIN usuarios u ON u.id = pl.usuario_id AND u.ativo
    WHERE pl.equipe_id = $1 AND pl.cancelado_em IS NULL AND pl.inicio <= $2 AND pl.fim > $2 ORDER BY pl.inicio DESC LIMIT 1`, [equipeId, agora]));
}

module.exports = { delegadoDe, plantonista };
