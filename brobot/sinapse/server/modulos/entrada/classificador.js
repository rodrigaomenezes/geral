'use strict';
// Classificação determinística por regras (INT-004). Só uma categoria reconhecida = classificação certa;
// nenhuma ou mais de uma = incerta → triagem humana (INT-005). IA pode sugerir no futuro, nunca decidir (RN-013).

const REGRAS = [
  { tipo: 'credencial', prioridade: 'alta', termos: ['senha', 'certificado', 'gov.br', 'govbr', 'credencial', '2fa', 'dois fatores', 'sne', 'vinculo'] },
  { tipo: 'erro_consulta', prioridade: 'alta', termos: ['erro', 'falha', 'nao consultou', 'nao gerou', 'sem consulta', 'nao aparece', 'travou'] },
  { tipo: 'solicitacao', prioridade: 'media', termos: ['incluir placa', 'cadastrar', 'alterar', 'adicionar', 'remover placa', 'trocar'] },
  { tipo: 'duvida', prioridade: 'baixa', termos: ['duvida', 'como faco', 'como funciona', 'onde vejo', 'pergunta'] },
];

const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function classificar(texto) {
  const t = normalizar(texto);
  const achadas = REGRAS.filter((r) => r.termos.some((termo) => t.includes(termo)));
  if (achadas.length !== 1) {
    return { certa: false, tipo: 'nao_classificada', prioridade: 'media',
      motivo: achadas.length ? `Mais de um assunto (${achadas.map((a) => a.tipo).join(', ')})` : 'Assunto não reconhecido' };
  }
  return { certa: true, tipo: achadas[0].tipo, prioridade: achadas[0].prioridade };
}

module.exports = { classificar, normalizar };
