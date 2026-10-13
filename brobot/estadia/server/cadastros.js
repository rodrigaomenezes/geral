'use strict';
// Tabelas de referência e regras da frota: tipos de composição, veículos, implementos e cargas.
// Puro (sem I/O). Os registros de cada frota ficam no diretório (auth.js) com trilha no log de eventos.

const { DomainError } = require('./domain');

// Tipos de composição veicular. `veiculo`: rígido (caminhão que leva carga) ou trator (cavalo mecânico).
// `implementos`: quantos semirreboques/reboques a composição exige; `tipoImplemento` define a categoria.
const COMPOSICOES = [
  { id: 'VUC', nome: 'VUC / 3/4', descricao: 'Caminhão leve urbano', veiculo: 'rigido', implementos: 0 },
  { id: 'TOCO', nome: 'Toco', descricao: 'Caminhão de 2 eixos', veiculo: 'rigido', implementos: 0 },
  { id: 'TRUCK', nome: 'Truck', descricao: 'Caminhão de 3 eixos', veiculo: 'rigido', implementos: 0 },
  { id: 'BITRUCK', nome: 'Bitruck', descricao: 'Caminhão de 4 eixos', veiculo: 'rigido', implementos: 0 },
  { id: 'CARRETA', nome: 'Carreta', descricao: 'Cavalo + 1 semirreboque', veiculo: 'trator', implementos: 1, tipoImplemento: 'semirreboque' },
  { id: 'VANDERLEIA', nome: 'Vanderleia', descricao: 'Cavalo + semirreboque com eixos distanciados', veiculo: 'trator', implementos: 1, tipoImplemento: 'semirreboque' },
  { id: 'BITREM', nome: 'Bitrem', descricao: 'Cavalo + 2 semirreboques', veiculo: 'trator', implementos: 2, tipoImplemento: 'semirreboque' },
  { id: 'RODOTREM', nome: 'Rodotrem', descricao: 'Cavalo + 2 semirreboques ligados por dolly', veiculo: 'trator', implementos: 2, tipoImplemento: 'semirreboque' },
  { id: 'TRITREM', nome: 'Tritrem', descricao: 'Cavalo + 3 semirreboques', veiculo: 'trator', implementos: 3, tipoImplemento: 'semirreboque' },
  { id: 'ROMEU_JULIETA', nome: 'Romeu e Julieta', descricao: 'Caminhão + 1 reboque', veiculo: 'rigido', implementos: 1, tipoImplemento: 'reboque' },
  { id: 'TREMINHAO', nome: 'Treminhão', descricao: 'Caminhão + 2 reboques', veiculo: 'rigido', implementos: 2, tipoImplemento: 'reboque' },
];

const TIPOS_VEICULO = {
  rigido: [
    { id: 'VUC', nome: 'VUC / 3/4' }, { id: 'TOCO', nome: 'Toco (2 eixos)' }, { id: 'TRUCK', nome: 'Truck (3 eixos)' }, { id: 'BITRUCK', nome: 'Bitruck (4 eixos)' },
  ],
  trator: [{ id: '4X2', nome: 'Cavalo 4x2 (toco)' }, { id: '6X2', nome: 'Cavalo 6x2 (trucado)' }, { id: '6X4', nome: 'Cavalo 6x4 (traçado)' }],
};

// Carrocerias (do caminhão rígido ou de cada implemento).
const CARROCERIAS = [
  { id: 'BAU', nome: 'Baú' }, { id: 'BAU_FRIGORIFICO', nome: 'Baú frigorífico' }, { id: 'SIDER', nome: 'Sider' },
  { id: 'GRANELEIRO', nome: 'Graneleiro' }, { id: 'GRADE_BAIXA', nome: 'Grade baixa / carga seca' }, { id: 'CACAMBA', nome: 'Caçamba basculante' },
  { id: 'TANQUE', nome: 'Tanque' }, { id: 'SILO', nome: 'Silo' }, { id: 'PORTA_CONTEINER', nome: 'Porta-contêiner' },
  { id: 'PRANCHA', nome: 'Prancha' }, { id: 'CEGONHA', nome: 'Cegonha' }, { id: 'BOIADEIRO', nome: 'Boiadeiro' },
  { id: 'FLORESTAL', nome: 'Florestal' }, { id: 'OUTRA', nome: 'Outra' },
];

// Tipos de carga (categorias usadas no transporte rodoviário de cargas).
const TIPOS_CARGA = [
  { id: 'GRANEL_SOLIDO', nome: 'Granel sólido', exemplo: 'grãos, açúcar, minério, fertilizante' },
  { id: 'GRANEL_LIQUIDO', nome: 'Granel líquido', exemplo: 'combustível, óleo, leite, etanol' },
  { id: 'FRIGORIFICADA', nome: 'Frigorificada ou aquecida', exemplo: 'carnes, laticínios, congelados' },
  { id: 'CONTEINERIZADA', nome: 'Conteinerizada', exemplo: 'carga em contêiner' },
  { id: 'CARGA_GERAL', nome: 'Carga geral', exemplo: 'caixas, sacarias, paletes, bebidas' },
  { id: 'NEOGRANEL', nome: 'Neogranel', exemplo: 'bobinas, veículos, madeira, perfis' },
  { id: 'PERIGOSA_GRANEL_SOLIDO', nome: 'Perigosa · granel sólido', exemplo: 'produtos perigosos a granel' },
  { id: 'PERIGOSA_GRANEL_LIQUIDO', nome: 'Perigosa · granel líquido', exemplo: 'combustíveis, químicos líquidos' },
  { id: 'PERIGOSA_FRIGORIFICADA', nome: 'Perigosa · frigorificada', exemplo: 'produtos perigosos refrigerados' },
  { id: 'PERIGOSA_CONTEINERIZADA', nome: 'Perigosa · conteinerizada', exemplo: 'produtos perigosos em contêiner' },
  { id: 'PERIGOSA_CARGA_GERAL', nome: 'Perigosa · carga geral', exemplo: 'embalados perigosos' },
  { id: 'GRANEL_PRESSURIZADA', nome: 'Granel pressurizada', exemplo: 'gases' },
];

const composicao = (id) => COMPOSICOES.find((c) => c.id === id) || null;
const nomeDe = (lista, id) => (lista.find((x) => x.id === id) || {}).nome || null;
const normPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const placaValida = (p) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p);

/** Valida o pedido de cadastro de um conjunto (composição + veículo + implementos) e devolve os dados limpos. */
function validarConjunto(b) {
  const comp = composicao(b.composicao);
  if (!comp) throw new DomainError(400, 'COMPOSICAO', 'Escolha o tipo do caminhão.');
  const placa = normPlaca(b.placaVeiculo);
  if (!placaValida(placa)) throw new DomainError(400, 'PLACA', `Placa ${comp.veiculo === 'trator' ? 'do cavalo' : 'do caminhão'} inválida. Use o formato ABC1D23 ou ABC1234.`);
  const placasImp = (Array.isArray(b.placasImplementos) ? b.placasImplementos : []).map(normPlaca).filter(Boolean);
  if (placasImp.length !== comp.implementos) {
    throw new DomainError(400, 'IMPLEMENTOS', comp.implementos === 1 ? `Informe a placa do ${comp.tipoImplemento}.` : `Informe as ${comp.implementos} placas dos ${comp.tipoImplemento}s.`);
  }
  for (const p of placasImp) if (!placaValida(p)) throw new DomainError(400, 'PLACA', `Placa ${p} inválida. Use o formato ABC1D23 ou ABC1234.`);
  if (new Set([placa, ...placasImp]).size !== placasImp.length + 1) throw new DomainError(400, 'PLACA', 'Há placas repetidas no conjunto.');
  const cap = Number(String(b.capacidadeToneladas ?? '').replace(',', '.'));
  if (!(cap > 0 && cap < 100)) throw new DomainError(400, 'CAPACIDADE', 'Informe quantas toneladas o conjunto leva (veja a capacidade de carga no documento).');
  const carroceria = CARROCERIAS.some((c) => c.id === b.carroceria) ? b.carroceria : null;
  if (!carroceria) throw new DomainError(400, 'CARROCERIA', 'Escolha o tipo de carroceria.');
  const tiposV = TIPOS_VEICULO[comp.veiculo];
  const categoria = comp.veiculo === 'rigido' && tiposV.some((t) => t.id === comp.id) ? comp.id : tiposV.some((t) => t.id === b.categoriaVeiculo) ? b.categoriaVeiculo : null;
  const ano = b.ano ? Number(b.ano) : null;
  if (ano != null && !(ano >= 1960 && ano <= new Date().getFullYear() + 1)) throw new DomainError(400, 'ANO', 'Ano do veículo inválido.');
  const txt = (v, n = 40) => String(v || '').trim().slice(0, n) || null;
  return {
    comp, placa, placasImp, cap: Math.round(cap * 10) / 10, carroceria, categoria, ano,
    marca: txt(b.marca), modelo: txt(b.modelo), apelido: txt(b.apelido, 40), rntrc: txt(b.rntrc, 20),
  };
}

/** Texto curto que descreve o implemento da operação (ex.: "Bitrem · Graneleiro"). */
function descreverConjunto(c) {
  const comp = composicao(c.composicao);
  return [comp ? comp.nome : c.composicao, nomeDe(CARROCERIAS, c.carroceria)].filter(Boolean).join(' · ');
}

const catalogos = () => ({ composicoes: COMPOSICOES, tiposVeiculo: TIPOS_VEICULO, carrocerias: CARROCERIAS, tiposCarga: TIPOS_CARGA });

module.exports = { COMPOSICOES, TIPOS_VEICULO, CARROCERIAS, TIPOS_CARGA, composicao, nomeDe, normPlaca, placaValida, validarConjunto, descreverConjunto, catalogos };
