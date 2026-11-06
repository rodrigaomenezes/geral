'use strict';
// Regras puras do monitoramento de consultas (REC-001/002/003/007, CRE-003). Recebem a volumetria diária de uma conta
// num produto (janela de dias) e dizem quais alertas valem. Os limites ficam aqui, nomeados, para a decisão de mudar
// ser explícita (registrar em DECISIONS.md) até virarem configuração da organização.

const LIMITES = {
  janelaDias: 7,
  toleranciaNaoGeradas: 0.05, // até 5% de consultas esperadas faltando é ruído (atraso de processamento)
  diasSemExecucao: 3,         // 3 dias seguidos com consulta esperada e nenhuma gerada
  taxaErroTecnico: 0.05,      // 5% das geradas com erro técnico (e pelo menos 3) vai para o Desenvolvimento
  minimoErrosTecnicos: 3,
  reincidencia: 3,            // a mesma placa com o mesmo erro pela 3ª vez pede análise de causa raiz (POS-009)
};

/** `dias`: [{ dia: 'AAAA-MM-DD', esperadas, geradas, erros_tecnicos, erros_usuario, indisponiveis }] em qualquer ordem. */
function avaliar(dias, limites = LIMITES) {
  const ord = [...dias].sort((a, b) => (a.dia < b.dia ? -1 : 1));
  const soma = (k) => ord.reduce((s, d) => s + Number(d[k] || 0), 0);
  const esperadas = soma('esperadas'); const geradas = soma('geradas'); const tecnicos = soma('erros_tecnicos');
  const resumo = { esperadas, geradas, faltando: Math.max(0, esperadas - geradas), errosTecnicos: tecnicos, errosUsuario: soma('erros_usuario'),
    indisponiveis: soma('indisponiveis'), dias: ord.length, de: ord[0]?.dia || null, ate: ord.at(-1)?.dia || null };
  const alertas = [];
  // REC-007: os últimos N dias com consulta esperada e nada gerado (o robô parou ou a credencial sumiu).
  const ultimos = ord.slice(-limites.diasSemExecucao);
  if (ultimos.length === limites.diasSemExecucao && ultimos.every((d) => Number(d.esperadas) > 0 && Number(d.geradas) === 0)) {
    alertas.push({ motivo: 'sem_execucao', prioridade: 'alta' });
  } else if (esperadas > 0 && resumo.faltando > esperadas * limites.toleranciaNaoGeradas) {
    // CRE-003 / melhoria 3: consulta que devia existir e não foi gerada ("erro invisível").
    alertas.push({ motivo: 'nao_geradas', prioridade: resumo.faltando > esperadas * 0.3 ? 'alta' : 'media' });
  }
  // REC-002/004: erro técnico é do Desenvolvimento; erro de usuário segue pelas pendências; indisponibilidade só conta.
  if (tecnicos >= limites.minimoErrosTecnicos && geradas > 0 && tecnicos / geradas >= limites.taxaErroTecnico) {
    alertas.push({ motivo: 'erro_tecnico', prioridade: tecnicos / geradas >= 0.2 ? 'alta' : 'media' });
  }
  return { resumo, alertas };
}

/** Dias até vencer (data de Brasília, sem hora); negativo = já venceu. */
function diasAte(expiraEm, hojeIso) {
  return Math.round((Date.parse(`${expiraEm}T12:00:00Z`) - Date.parse(`${hojeIso}T12:00:00Z`)) / 864e5);
}

module.exports = { LIMITES, avaliar, diasAte };
