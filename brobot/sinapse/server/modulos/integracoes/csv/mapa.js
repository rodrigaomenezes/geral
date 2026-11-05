'use strict';
// Mapeamento de colunas (regra pura). Sem amostra real de Platform/OMIE, o arquivo de verdade pode vir com outros
// nomes de coluna: a pessoa liga cada campo do Sinapse a uma coluna do arquivo na prévia, e o mapa fica salvo por
// fluxo. Mapa = { campoDoSinapse: cabecalhoDoArquivo } (cabeçalhos já normalizados por csv.normalizarCabecalho).

// Nomes comuns em planilhas brasileiras para sugerir a ligação (a pessoa sempre confere antes de aplicar).
const SINONIMOS = {
  cnpj: ['cnpj_cliente', 'documento', 'cpf_cnpj', 'cnpj_cpf'], placa: ['veiculo', 'placa_veiculo'],
  rodada: ['id_rodada', 'codigo_rodada', 'execucao'], data_rodada: ['data', 'data_execucao', 'dt_rodada'],
  resultado: ['status', 'situacao'], codigo_erro: ['erro', 'cod_erro', 'motivo'], produto: ['modulo', 'servico'],
  situacao: ['status_financeiro', 'status'], codigo_omie: ['codigo_cliente_omie', 'id_omie', 'codigo_cliente'],
  ultimo_login: ['ultimo_acesso', 'last_login'], tipo: ['tipo_credencial'], expira_em: ['validade', 'vencimento'],
};

/** Sugestão: nome igual, depois sinônimo. Nunca liga a mesma coluna a dois campos. */
function sugerir(campos, cabecalhos) {
  const livres = new Set(cabecalhos);
  const mapa = {};
  for (const campo of campos) if (livres.has(campo)) { mapa[campo] = campo; livres.delete(campo); }
  for (const campo of campos) {
    if (mapa[campo]) continue;
    const s = (SINONIMOS[campo] || []).find((x) => livres.has(x));
    if (s) { mapa[campo] = s; livres.delete(s); }
  }
  return mapa;
}

/** Valida um mapa enviado: campos conhecidos, colunas que existem no arquivo, sem coluna repetida. */
function validarMapa(mapa, campos, cabecalhos) {
  const problemas = [];
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) return ['mapa de colunas inválido'];
  const usadas = new Map();
  for (const [campo, col] of Object.entries(mapa)) {
    if (!campos.includes(campo)) { problemas.push(`campo desconhecido: ${campo}`); continue; }
    if (col === '' || col === null) continue;
    if (typeof col !== 'string' || !cabecalhos.includes(col)) { problemas.push(`a coluna "${col}" não está no arquivo`); continue; }
    if (usadas.has(col)) problemas.push(`a coluna "${col}" foi ligada a ${usadas.get(col)} e a ${campo}`);
    usadas.set(col, campo);
  }
  return problemas;
}

/** Renomeia as colunas do arquivo para os campos do Sinapse. Colunas não ligadas ficam como vieram. */
function aplicarMapa(tabela, mapa) {
  const pares = Object.entries(mapa || {}).filter(([campo, col]) => col && campo !== col);
  if (!pares.length) return tabela;
  const linhas = tabela.linhas.map((l) => {
    const v = { ...l.valores };
    for (const [campo, col] of pares) v[campo] = l.valores[col] ?? '';
    return { ...l, valores: v };
  });
  const cabecalhos = [...new Set([...tabela.cabecalhos, ...pares.map(([campo]) => campo)])];
  return { ...tabela, linhas, cabecalhos };
}

const mesmoMapa = (a, b) => JSON.stringify(Object.entries(a || {}).filter(([, v]) => v).sort()) === JSON.stringify(Object.entries(b || {}).filter(([, v]) => v).sort());

module.exports = { sugerir, validarMapa, aplicarMapa, mesmoMapa };
