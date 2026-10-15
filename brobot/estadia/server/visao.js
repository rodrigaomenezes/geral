'use strict';
// Validação das fotos de cada marco (decisões D-22 a D-27).
// Duas camadas:
//  1. Regras objetivas, sempre ativas: origem da captura (câmera ou galeria), diferença entre o horário
//     da foto e o do registro, foto repetida em outro registro e imagem pequena demais.
//  2. Análise da imagem por IA (Claude, visão), ativa quando há ANTHROPIC_API_KEY: confere se a cena
//     corresponde ao marco, lê a placa e compara com o cadastro, aponta foto de tela e falta de nitidez.
// A validação nunca bloqueia o registro: o resultado é um selo de apoio (aderente, duvidosa ou
// não aderente) gravado como evento próprio e levado ao Dossiê. A palavra final é sempre humana.

const MODELO = process.env.ESTADIA_IA_MODELO || 'claude-opus-5-5';
const TOLERANCIA_MIN = 15; // diferença aceita entre o horário da foto e o do registro
const MIN_BYTES = 15000; // abaixo disso a foto quase sempre é miniatura ou print recortado

/** O que deve aparecer na foto de cada marco. `cena` orienta a IA; `itens` viram o checklist. */
const GUIAS = {
  CHEGADA: {
    pedir: 'Enquadre a frente do caminhão com a placa legível e a portaria ou a fachada do local.',
    itens: [
      { id: 'placa', txt: 'Placa do veículo legível' },
      { id: 'local', txt: 'Portaria, fachada ou entrada do local' },
    ],
    cena: 'caminhão chegando ou parado na portaria, entrada, pátio ou fila de um local de carga e descarga (porto, terminal, armazém, indústria, centro de distribuição)',
  },
  INICIO: {
    pedir: 'Mostre o caminhão na doca ou no ponto de operação, com o número da doca visível.',
    itens: [
      { id: 'doca', txt: 'Veículo na doca ou no ponto de operação' },
      { id: 'identificacao', txt: 'Número ou identificação da doca' },
    ],
    cena: 'veículo posicionado em doca, plataforma, balança ou área de carga e descarga',
  },
  TERMINO: {
    pedir: 'Fotografe a carroceria aberta: vazia na descarga, carregada na carga.',
    itens: [
      { id: 'carroceria', txt: 'Carroceria ou baú aberto e visível' },
      { id: 'estado', txt: 'Estado da carga coerente com a operação' },
    ],
    cena: 'carroceria, baú ou implemento aberto mostrando o estado da carga ao fim da operação',
  },
  LIBERACAO: {
    pedir: 'Fotografe o documento de liberação, canhoto ou NF assinada, inteiro e nítido.',
    itens: [
      { id: 'documento', txt: 'Documento inteiro no quadro' },
      { id: 'assinatura', txt: 'Assinatura, carimbo ou data visíveis' },
      { id: 'legivel', txt: 'Texto legível' },
    ],
    cena: 'documento de liberação, canhoto, nota fiscal ou ordem de saída, com assinatura ou carimbo',
  },
  SAIDA: {
    pedir: 'Mostre o caminhão saindo pela portaria ou o comprovante de saída.',
    itens: [
      { id: 'saida', txt: 'Saída pela portaria ou comprovante de saída' },
      { id: 'placa_ou_doc', txt: 'Placa legível ou documento identificável' },
    ],
    cena: 'caminhão passando pela portaria de saída, ou comprovante/ticket de saída do local',
  },
};
const ROTULO = { aderente: 'Aderente', duvidosa: 'Duvidosa', nao_aderente: 'Não aderente' };
const PESO = { aderente: 0, duvidosa: 1, nao_aderente: 2 };
const pior = (a, b) => (PESO[b] > PESO[a] ? b : a);
const normPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function guiaDe(marco, op = {}) {
  const g = GUIAS[marco];
  if (!g || marco !== 'TERMINO') return g || null;
  const carga = op.tipo === 'CARGA';
  return { ...g, pedir: carga ? 'Fotografe a carroceria aberta e carregada.' : 'Fotografe a carroceria aberta e vazia.',
    cena: `${g.cena}; nesta operação de ${carga ? 'carga, a carroceria deve aparecer carregada' : 'descarga, a carroceria deve aparecer vazia ou quase vazia'}` };
}

/** Regras objetivas sobre um conjunto de fotos. `usosDe(sha256)` devolve os outros registros que usam a mesma foto. */
function regras({ marco, fotos, ocorridoEm, usosDe }) {
  const out = [];
  const critico = marco === 'CHEGADA' || marco === 'SAIDA';
  for (const f of fotos) {
    const n = fotos.indexOf(f) + 1;
    if (f.origem === 'galeria') out.push({ foto: n, regra: 'origem', resultado: critico ? 'duvidosa' : 'aderente', txt: `Foto ${n} escolhida da galeria, não tirada na hora pelo app.` });
    if (f.capturadaEm && ocorridoEm) {
      const min = Math.round(Math.abs(Date.parse(ocorridoEm) - Date.parse(f.capturadaEm)) / 60000);
      if (min > TOLERANCIA_MIN) out.push({ foto: n, regra: 'horario', resultado: 'duvidosa', txt: `Foto ${n} tirada ${min >= 120 ? `${Math.round(min / 60)} h` : `${min} min`} ${Date.parse(f.capturadaEm) < Date.parse(ocorridoEm) ? 'antes' : 'depois'} do registro.` });
    }
    const usos = usosDe ? usosDe(f.sha256) : [];
    if (usos.length) out.push({ foto: n, regra: 'repetida', resultado: 'nao_aderente', txt: `Foto ${n} já usada em ${usos.slice(0, 2).join(', ')}.` });
    if (f.bytes && f.bytes < MIN_BYTES) out.push({ foto: n, regra: 'tamanho', resultado: 'duvidosa', txt: `Foto ${n} muito pequena para servir de prova.` });
  }
  return out;
}

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cena_corresponde', 'itens', 'placa_lida', 'foto_de_tela', 'nitida', 'resumo'],
  properties: {
    cena_corresponde: { type: 'boolean', description: 'O conjunto de fotos mostra a cena esperada para o marco.' },
    itens: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'atendido', 'detalhe'],
        properties: { id: { type: 'string' }, atendido: { type: 'string', enum: ['sim', 'nao', 'nao_se_aplica'] }, detalhe: { type: 'string' } },
      },
    },
    placa_lida: { type: 'string', description: 'Placa brasileira lida em alguma foto (só letras e números), ou texto vazio se nenhuma estiver legível.' },
    foto_de_tela: { type: 'boolean', description: 'Alguma foto parece ser foto de tela, monitor ou impressão, e não da cena real.' },
    nitida: { type: 'boolean', description: 'As fotos têm nitidez e luz suficientes para servir de prova.' },
    resumo: { type: 'string', description: 'Uma frase curta em português para o motorista e a transportadora.' },
  },
};

const SISTEMA = `Você confere fotos tiradas por motoristas de caminhão para comprovar etapas de carga e descarga (estadia, Lei 11.442/2007).
Avalie apenas o que está visível nas imagens. Não presuma o que não aparece. As fotos são reais de campo: luz ruim, ângulo torto e sujeira são normais e não reprovam por si só.
Responda sempre em português do Brasil, em frases curtas e simples.`;

/**
 * Analisa as fotos de um registro.
 * @param {object} p { marco, op, fotos:[{file, sha256, bytes, origem, capturadaEm}], ocorridoEm, usosDe, lerArquivo }
 * @param {object} cliente Cliente da API Anthropic (opcional; sem ele só as regras rodam).
 */
async function analisar(p, cliente) {
  const guia = guiaDe(p.marco, p.op);
  const achados = regras(p);
  let resultado = achados.reduce((r, a) => pior(r, a.resultado), 'aderente');
  const checagens = [];
  let placaLida = null, placaConfere = null, resumo = null, motor = 'regras', modelo = null, erro = null;

  if (cliente && guia && p.fotos.length) {
    try {
      const imgs = p.fotos.slice(0, 6).map((f) => ({ type: 'image', source: { type: 'base64', media_type: f.mime || 'image/jpeg', data: p.lerArquivo(f.file).toString('base64') } }));
      const pedido = `Marco: ${p.marco}. Cena esperada: ${guia.cena}.
Placa cadastrada do veículo: ${p.op.placa || 'não informada'}${(p.op.placasImplementos || []).length ? `; implementos: ${p.op.placasImplementos.join(', ')}` : ''}.
Itens a conferir (use exatamente estes ids): ${guia.itens.map((i) => `${i.id} = ${i.txt}`).join('; ')}.
As ${imgs.length} foto(s) acima são do mesmo registro: um item está atendido se aparecer em qualquer uma delas.`;
      const resp = await cliente.beta.messages.create({
        model: MODELO,
        max_tokens: 2000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
        system: SISTEMA,
        messages: [{ role: 'user', content: [...imgs, { type: 'text', text: pedido }] }],
      });
      if (resp.stop_reason === 'refusal') throw new Error('A IA não analisou estas fotos.');
      const bloco = resp.content.find((b) => b.type === 'text');
      const r = JSON.parse(bloco ? bloco.text : '{}');
      motor = 'ia'; modelo = resp.model;
      resumo = String(r.resumo || '').slice(0, 300) || null;
      for (const it of guia.itens) {
        const x = (r.itens || []).find((y) => y.id === it.id) || { atendido: 'nao', detalhe: 'Não avaliado.' };
        checagens.push({ id: it.id, item: it.txt, atendido: x.atendido, detalhe: String(x.detalhe || '').slice(0, 200) });
      }
      placaLida = normPlaca(r.placa_lida) || null;
      const cadastradas = [p.op.placa, ...(p.op.placasImplementos || [])].map(normPlaca).filter(Boolean);
      if (placaLida && cadastradas.length) placaConfere = cadastradas.includes(placaLida);
      if (!r.cena_corresponde) { resultado = pior(resultado, 'nao_aderente'); achados.push({ regra: 'cena', resultado: 'nao_aderente', txt: 'A cena não corresponde ao que este marco pede.' }); }
      if (r.foto_de_tela) { resultado = pior(resultado, 'nao_aderente'); achados.push({ regra: 'tela', resultado: 'nao_aderente', txt: 'Parece foto de uma tela ou de uma impressão.' }); }
      if (!r.nitida) { resultado = pior(resultado, 'duvidosa'); achados.push({ regra: 'nitidez', resultado: 'duvidosa', txt: 'Foto escura ou sem nitidez.' }); }
      if (checagens.some((c) => c.atendido === 'nao')) resultado = pior(resultado, 'duvidosa');
      if (placaConfere === false) { resultado = pior(resultado, 'duvidosa'); achados.push({ regra: 'placa', resultado: 'duvidosa', txt: `Placa lida (${placaLida}) diferente da cadastrada.` }); }
    } catch (e) {
      erro = String(e && e.message || e).slice(0, 200);
    }
  }
  if (!resumo) resumo = achados.length ? achados[0].txt : motor === 'ia' ? 'Fotos conferem com o marco.' : 'Origem, horário e repetição conferidos.';
  return { marco: p.marco, fotos: p.fotos.map((f) => f.sha256), resultado, rotulo: ROTULO[resultado], resumo, achados, checagens, placaLida, placaConfere, motor, modelo, erro };
}

/** Cliente da API, se houver chave e o pacote estiver instalado. */
function criarCliente(env = process.env) {
  if (env.ESTADIA_IA === '0' || !(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)) return null;
  try { const Anthropic = require('@anthropic-ai/sdk'); return new (Anthropic.default || Anthropic)({ maxRetries: 2, timeout: 60000 }); }
  catch { return null; }
}

module.exports = { GUIAS, ROTULO, guiaDe, regras, analisar, criarCliente, MODELO };
