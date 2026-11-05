'use strict';
// Adaptador de DEMONSTRAÇÃO da Platform Brobot. Implementa a porta que o ERP usa:
//   testarRodada(c, rodada)        → resultado por veículo (pré-rodada D-4)
//   revalidarVeiculo(c, contaId, placa) → nova consulta de um veículo (CRE-006)
//   executarOficial(c, rodada)     → resultado oficial da rodada (POS-001)
// O ERP nunca lê o banco da Platform (seção 9 da especificação). O adaptador real será escrito sobre a API
// oficial quando os endpoints forem homologados — sem presumir endpoint.

const { exigirDisponivel, registrarSucesso } = require('./estado');

async function veiculos(c, contaId) {
  return (await c.query('SELECT placa, erro_codigo FROM demo_platform_veiculos WHERE conta_id = $1 ORDER BY placa', [contaId])).rows;
}

async function testarRodada(c, rodada) {
  await exigirDisponivel(c, 'platform');
  const lista = await veiculos(c, rodada.conta_id);
  await registrarSucesso(c, 'platform', { ultimaRodadaTestada: rodada.id_platform });
  return lista.map((v) => ({ placa: v.placa, ok: !v.erro_codigo, codigoPlatform: v.erro_codigo }));
}

async function revalidarVeiculo(c, contaId, placa) {
  await exigirDisponivel(c, 'platform');
  const v = (await c.query('SELECT erro_codigo FROM demo_platform_veiculos WHERE conta_id = $1 AND placa = $2', [contaId, placa])).rows[0];
  await registrarSucesso(c, 'platform');
  return { placa, ok: !!v && !v.erro_codigo, codigoPlatform: v ? v.erro_codigo : 'VEICULO_NAO_ENCONTRADO',
    consultaId: `demo-${Date.now().toString(36)}` };
}

async function executarOficial(c, rodada) {
  return testarRodada(c, rodada);
}

module.exports = { testarRodada, revalidarVeiculo, executarOficial };
