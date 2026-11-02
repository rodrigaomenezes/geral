// Núcleo do guia: regras puras, sem rede e sem DOM. Roda igual no navegador (offline) e no servidor (testes).
// Responsabilidades: distância e rumo, quem está perto, quando narrar, quem aparece numa foto sem internet,
// resposta local a perguntas a partir do pacote e validação do formato do pacote.

export const VERSAO_PACOTE = 1;

const RAIO_TERRA_M = 6371000;
const rad = (g) => (g * Math.PI) / 180;
const graus = (r) => (r * 180) / Math.PI;

/** Distância em metros entre dois pontos {lat, lng} (fórmula de haversine). */
export function distanciaM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumo de `a` para `b` em graus (0 = norte, 90 = leste). */
export function rumo(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (graus(Math.atan2(y, x)) + 360) % 360;
}

/** Menor diferença entre dois ângulos, de 0 a 180. */
export function diferencaAngular(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function posicaoValida(p) {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** POIs ordenados por distância, com `distancia` (m) e `rumo` (graus). `limite` em metros (opcional). */
export function proximos(pois, pos, limite = Infinity) {
  if (!posicaoValida(pos)) return [];
  return pois
    .map((p) => ({ poi: p, distancia: distanciaM(pos, p), rumo: rumo(pos, p) }))
    .filter((x) => x.distancia <= limite)
    .sort((a, b) => a.distancia - b.distancia);
}

/** Intervalo mínimo entre duas narrações automáticas, por frequência escolhida pelo usuário. */
export const INTERVALO_FREQUENCIA_MS = { pouco: 5 * 60000, normal: 90000, muito: 20000 };
/** Um mesmo ponto não é narrado de novo antes disso. */
export const REPETICAO_MS = 6 * 3600000;
/** Acima dessa imprecisão do GPS (m) não narramos: evita falar do lugar errado. */
export const PRECISAO_MAX_M = 80;

/**
 * Decide se algum ponto deve ser narrado agora.
 * estado = { narrados: {poiId: ms}, ultimaNarracao: ms }  (não é alterado; quem chama grava o resultado)
 * Devolve { poi, distancia } ou null.
 */
export function decidirNarracao({ pois, pos, estado = {}, frequencia = 'normal', agora = Date.now(), raioPadraoM = 70 }) {
  if (!posicaoValida(pos)) return null;
  if (Number.isFinite(pos.precisao) && pos.precisao > PRECISAO_MAX_M) return null;
  const intervalo = INTERVALO_FREQUENCIA_MS[frequencia] ?? INTERVALO_FREQUENCIA_MS.normal;
  if (estado.ultimaNarracao && agora - estado.ultimaNarracao < intervalo) return null;
  const narrados = estado.narrados || {};
  for (const x of proximos(pois, pos)) {
    const raio = x.poi.raioM || raioPadraoM;
    if (x.distancia > raio) continue;
    const quando = narrados[x.poi.id];
    if (quando && agora - quando < REPETICAO_MS) continue;
    return { poi: x.poi, distancia: Math.round(x.distancia) };
  }
  return null;
}

/**
 * Identificação de foto sem internet: o que está perto e na direção para onde a câmera aponta.
 * `direcao` = rumo da câmera em graus (bússola), ou null se o aparelho não informa.
 * Devolve até 3 candidatos { poi, distancia, confianca 0..1 }, melhor primeiro.
 */
const AREAS = new Set(['praca']);

export function candidatosFoto({ pois, pos, direcao = null, alcanceM = 350 }) {
  const perto = proximos(pois, pos, alcanceM);
  const com = perto.map((x) => {
    const pDist = 1 - x.distancia / alcanceM; // 1 colado, 0 no limite do alcance
    let pAng = 0.5; // sem bússola: neutro
    if (Number.isFinite(direcao)) {
      const d = diferencaAngular(direcao, x.rumo);
      pAng = x.distancia < 25 ? 0.8 : d <= 30 ? 1 : d <= 60 ? 0.6 : d <= 100 ? 0.2 : 0;
    }
    // Quem está dentro de uma área (praça, largo) quase sempre fotografa algo nela, não a área em si.
    if (AREAS.has(x.poi.categoria) && x.distancia <= (x.poi.raioM || 50)) pAng = Math.min(pAng, 0.2);
    return { poi: x.poi, distancia: Math.round(x.distancia), confianca: +(0.55 * pDist + 0.45 * pAng).toFixed(2) };
  });
  return com.filter((c) => c.confianca >= 0.25).sort((a, b) => b.confianca - a.confianca).slice(0, 3);
}

/** Minúsculas, sem acento e sem pontuação. */
export function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const VAZIAS = new Set('a o e as os um uma de da do das dos em no na nos nas por para pra com que qual quais quem quando onde como e eh sao foi era ser tem ter isso isto esse essa este esta aqui ali la me se seu sua mais muito pouco sobre ao aos me fala conta diga voce vc'.split(' '));

export function palavras(t) {
  return normalizar(t).split(' ').filter((w) => w.length > 2 && !VAZIAS.has(w));
}

/**
 * Resposta local (offline) a uma pergunta, a partir das perguntas frequentes e das narrativas do pacote.
 * `poiId` = ponto em foco na conversa (ganha prioridade). Devolve { texto, poiId, origem, confianca } ou null.
 */
export function responderLocal(pacote, pergunta, poiId = null) {
  const q = palavras(pergunta);
  if (!q.length) return null;
  const qs = new Set(q);
  const candidatos = [];
  for (const poi of pacote.pois) {
    const foco = poi.id === poiId ? 1.5 : 1;
    const nome = new Set(palavras(poi.nome));
    const citaNome = [...nome].some((w) => qs.has(w));
    for (const f of poi.perguntas || []) {
      const chave = new Set([...palavras(f.p), ...(f.chaves || []).flatMap(palavras)]);
      const acertos = q.filter((w) => chave.has(w)).length;
      if (!acertos) continue;
      const nota = (acertos / qs.size) * foco * (citaNome || poi.id === poiId ? 1.3 : 1);
      candidatos.push({ texto: f.r, poiId: poi.id, origem: 'pergunta', nota });
    }
    if (citaNome) {
      candidatos.push({ texto: poi.narrativa.medio, poiId: poi.id, origem: 'narrativa', nota: 0.45 * foco });
    }
  }
  for (const f of pacote.perguntasGerais || []) {
    const chave = new Set([...palavras(f.p), ...(f.chaves || []).flatMap(palavras)]);
    const acertos = q.filter((w) => chave.has(w)).length;
    if (acertos) candidatos.push({ texto: f.r, poiId: null, origem: 'pergunta', nota: acertos / qs.size });
  }
  candidatos.sort((a, b) => b.nota - a.nota);
  const m = candidatos[0];
  if (!m || m.nota < 0.34) return null;
  return { texto: m.texto, poiId: m.poiId, origem: m.origem, confianca: +Math.min(1, m.nota).toFixed(2) };
}

export const NIVEIS = ['curto', 'medio', 'longo'];

/** Confere o formato de um pacote. Devolve lista de problemas (vazia = válido). */
export function validarPacote(p) {
  const erros = [];
  if (!p || typeof p !== 'object') return ['pacote ausente'];
  if (p.versao !== VERSAO_PACOTE) erros.push(`versao deve ser ${VERSAO_PACOTE}`);
  for (const k of ['id', 'nome', 'cidade', 'idioma']) if (typeof p[k] !== 'string' || !p[k]) erros.push(`${k} obrigatório`);
  if (!posicaoValida(p.centro)) erros.push('centro inválido');
  if (!Array.isArray(p.pois) || !p.pois.length) return [...erros, 'pois vazio'];
  const ids = new Set();
  p.pois.forEach((poi, i) => {
    const onde = `pois[${i}]${poi && poi.id ? ` (${poi.id})` : ''}`;
    if (!poi || typeof poi.id !== 'string' || !/^[a-z0-9-]+$/.test(poi.id)) erros.push(`${onde}: id inválido`);
    else if (ids.has(poi.id)) erros.push(`${onde}: id repetido`);
    else ids.add(poi.id);
    if (!poi || !posicaoValida(poi)) erros.push(`${onde}: coordenada inválida`);
    if (!poi || typeof poi.nome !== 'string' || !poi.nome) erros.push(`${onde}: nome obrigatório`);
    for (const n of NIVEIS) if (!poi || !poi.narrativa || typeof poi.narrativa[n] !== 'string' || poi.narrativa[n].length < 20) erros.push(`${onde}: narrativa.${n} obrigatória`);
    if (poi && poi.perguntas && !Array.isArray(poi.perguntas)) erros.push(`${onde}: perguntas deve ser lista`);
    for (const f of (poi && Array.isArray(poi.perguntas) ? poi.perguntas : [])) if (!f.p || !f.r) erros.push(`${onde}: pergunta sem p ou r`);
  });
  return erros;
}
