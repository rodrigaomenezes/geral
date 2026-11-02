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
// Medido na rota de demonstração de Salvador (1,3 km, 11 pontos, passo de 1,3 m/s): com 90 s no "normal" o guia
// atravessava 2 pontos calado e nunca dava as dicas; com 45 s cobre todos sem falar em cima de si mesmo.
export const INTERVALO_FREQUENCIA_MS = { pouco: 4 * 60000, normal: 45000, muito: 15000 };
/** Um mesmo ponto não é narrado de novo antes disso. */
export const REPETICAO_MS = 6 * 3600000;
/** Acima dessa imprecisão do GPS (m) não narramos: evita falar do lugar errado. */
export const PRECISAO_MAX_M = 80;

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
    if (poi && poi.teaser != null && (typeof poi.teaser !== 'string' || poi.teaser.length < 10)) erros.push(`${onde}: teaser deve ser texto`);
    if (poi && poi.fonte != null && (typeof poi.fonte !== 'object' || typeof poi.fonte.nome !== 'string' || !/^https:\/\//.test(poi.fonte.url || ''))) erros.push(`${onde}: fonte deve ter nome e url https`);
  });
  if (p.avisos != null && !Array.isArray(p.avisos)) erros.push('avisos deve ser lista');
  (Array.isArray(p.avisos) ? p.avisos : []).forEach((a, i) => {
    const onde = `avisos[${i}]${a && a.id ? ` (${a.id})` : ''}`;
    if (!a || typeof a.id !== 'string' || !/^[a-z0-9-]+$/.test(a.id)) erros.push(`${onde}: id inválido`);
    else if (ids.has(a.id)) erros.push(`${onde}: id repetido`);
    else ids.add(a.id);
    if (!a || !TIPOS_AVISO.includes(a.tipo)) erros.push(`${onde}: tipo deve ser ${TIPOS_AVISO.join(', ')}`);
    if (!a || !posicaoValida(a)) erros.push(`${onde}: coordenada inválida`);
    if (!a || typeof a.texto !== 'string' || a.texto.length < 10) erros.push(`${onde}: texto obrigatório`);
  });
  return erros;
}

// ---------------------------------------------------------------------------------------------------------------
// Companheiro de caminhada: acompanha o trajeto e decide, sozinho, o que vale avisar agora.
// Tudo puro: quem chama guarda o trajeto e o estado, e grava o resultado de registrarAlerta.
// ---------------------------------------------------------------------------------------------------------------

export const TIPOS_AVISO = ['importante', 'dica', 'novidade'];

/** Ordem de prioridade quando há mais de um alerta possível no mesmo instante. */
export const PRIORIDADE = ['importante', 'chegada', 'a-caminho', 'dica', 'novidade'];

/** "Logo à frente": a partir de quantos metros anunciamos um ponto que ainda não chegou. */
export const ANTECEDENCIA_M = 200;
/** Cone de visão da caminhada: só anuncia o que está mais ou menos à frente (± graus). */
export const CONE_FRENTE = 65;
/** Avisos importantes furam a fila de frequência, mas não falam mais de uma vez a cada isso. */
export const INTERVALO_IMPORTANTE_MS = 15000;
/** Dicas e novidades são curtas e presas a um lugar: esperam só isso desde a última fala, não a frequência. */
export const INTERVALO_AVISO_MS = 20000;

/** Junta um ponto ao trajeto, ignorando ruído (GPS impreciso ou parado). Devolve um trajeto novo (máx. `max` pontos). */
export function anexarAoTrajeto(trajeto, pos, agora = Date.now(), max = 600) {
  if (!posicaoValida(pos)) return trajeto;
  if (Number.isFinite(pos.precisao) && pos.precisao > 50) return trajeto;
  const ultimo = trajeto.at(-1);
  if (ultimo && distanciaM(ultimo, pos) < 4) return trajeto;
  const novo = [...trajeto, { lat: pos.lat, lng: pos.lng, t: agora }];
  return novo.length > max ? novo.slice(-max) : novo;
}

/** Direção em que a pessoa está andando (graus), olhando os últimos ~`janelaM` metros; null se ainda não deu para saber. */
export function rumoDaCaminhada(trajeto, janelaM = 40) {
  if (trajeto.length < 2) return null;
  const fim = trajeto.at(-1);
  for (let i = trajeto.length - 2; i >= 0; i -= 1) {
    if (distanciaM(trajeto[i], fim) >= janelaM) return rumo(trajeto[i], fim);
  }
  // Andou menos que a janela: serve se já deu pelo menos 15 m (abaixo disso é ruído do GPS).
  return distanciaM(trajeto[0], fim) >= 15 ? rumo(trajeto[0], fim) : null;
}

/** "à frente", "à direita", "à esquerda" ou "atrás de você", a partir do rumo da caminhada. */
export function ladoRelativo(rumoCaminhada, rumoAlvo) {
  if (!Number.isFinite(rumoCaminhada)) return null;
  const d = ((rumoAlvo - rumoCaminhada + 540) % 360) - 180; // -180..180, positivo = direita
  if (Math.abs(d) <= 25) return 'à frente';
  if (Math.abs(d) >= 140) return 'atrás de você';
  return d > 0 ? 'à direita' : 'à esquerda';
}

const arredondarM = (m) => (m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50);

/**
 * Decide o próximo alerta do companheiro, ou null.
 * estado = { narrados:{poiId:ms}, anunciados:{poiId:ms}, avisos:{avisoId:ms}, ultimaNarracao:ms, ultimoImportante:ms }
 * Devolve { tipo, id, titulo, texto, poi?, aviso?, distancia }.
 */
export function proximoAlerta({ pacote, pos, rumoCaminhada = null, estado = {}, frequencia = 'normal', agora = Date.now(), raioPadraoM = 70,
  tipos = PRIORIDADE, maxPorHora = null }) {
  if (!posicaoValida(pos)) return null;
  if (Number.isFinite(pos.precisao) && pos.precisao > PRECISAO_MAX_M) return null;
  const narrados = estado.narrados || {};
  const anunciados = estado.anunciados || {};
  const dados = estado.avisos || {};
  const intervalo = INTERVALO_FREQUENCIA_MS[frequencia] ?? INTERVALO_FREQUENCIA_MS.normal;
  const livre = !estado.ultimaNarracao || agora - estado.ultimaNarracao >= intervalo;
  const candidatos = [];

  for (const a of pacote.avisos || []) {
    if (dados[a.id]) continue;
    const d = distanciaM(pos, a);
    if (d > (a.raioM || 60)) continue;
    if (a.tipo === 'importante') {
      if (estado.ultimoImportante && agora - estado.ultimoImportante < INTERVALO_IMPORTANTE_MS) continue;
    } else if (estado.ultimaNarracao && agora - estado.ultimaNarracao < INTERVALO_AVISO_MS) continue;
    candidatos.push({ tipo: a.tipo, id: a.id, titulo: a.titulo || ROTULO_ALERTA[a.tipo], texto: a.texto, aviso: a, distancia: Math.round(d) });
  }

  if (livre) {
    for (const x of proximos(pacote.pois, pos, ANTECEDENCIA_M)) {
      const raio = x.poi.raioM || raioPadraoM;
      const jaOuvido = narrados[x.poi.id] && agora - narrados[x.poi.id] < REPETICAO_MS;
      if (jaOuvido) continue;
      if (x.distancia <= raio) {
        candidatos.push({ tipo: 'chegada', id: x.poi.id, titulo: x.poi.nome, texto: null, poi: x.poi, distancia: Math.round(x.distancia) });
        continue;
      }
      if (anunciados[x.poi.id] && agora - anunciados[x.poi.id] < REPETICAO_MS) continue;
      const lado = ladoRelativo(rumoCaminhada, x.rumo);
      if (!lado || lado === 'atrás de você') continue; // sem direção conhecida, não anuncia o que pode estar às costas
      if (Math.abs(((x.rumo - rumoCaminhada + 540) % 360) - 180) > CONE_FRENTE) continue;
      const chamada = x.poi.teaser || (x.poi.curiosidades || [])[0] || x.poi.narrativa.curto;
      candidatos.push({ tipo: 'a-caminho', id: x.poi.id, titulo: x.poi.nome,
        texto: `Daqui a uns ${arredondarM(x.distancia)} metros, ${lado}: ${x.poi.nome}. ${chamada}`, poi: x.poi, distancia: Math.round(x.distancia) });
    }
  }

  // Preferências da pessoa: tipos desligados somem; o limite por hora não vale para avisos importantes.
  const ligados = new Set(tipos);
  const noLimite = Number.isFinite(maxPorHora) && maxPorHora > 0 && alertasNaUltimaHora(estado, agora) >= maxPorHora;
  const validos = candidatos.filter((c) => ligados.has(c.tipo) && (!noLimite || c.tipo === 'importante'));
  if (!validos.length) return null;
  validos.sort((a, b) => PRIORIDADE.indexOf(a.tipo) - PRIORIDADE.indexOf(b.tipo) || a.distancia - b.distancia);
  return validos[0];
}

/** Quantos alertas não importantes foram dados na última hora. */
export function alertasNaUltimaHora(estado = {}, agora = Date.now()) {
  return (estado.historico || []).filter((h) => agora - h.t < 3600000 && h.tipo !== 'importante').length;
}

export const ROTULO_ALERTA = { importante: 'Importante', chegada: 'Você chegou', 'a-caminho': 'Logo à frente', dica: 'Dica', novidade: 'Novidade' };

/** Estado novo depois de dar um alerta (não altera o original). */
export function registrarAlerta(estado = {}, alerta, agora = Date.now()) {
  const novo = { narrados: { ...(estado.narrados || {}) }, anunciados: { ...(estado.anunciados || {}) }, avisos: { ...(estado.avisos || {}) },
    ultimaNarracao: estado.ultimaNarracao || 0, ultimoImportante: estado.ultimoImportante || 0,
    historico: (estado.historico || []).filter((h) => agora - h.t < 3600000) };
  if (!alerta) return novo;
  novo.historico = [...novo.historico, { t: agora, tipo: alerta.tipo }].slice(-50);
  if (alerta.tipo === 'chegada') novo.narrados[alerta.id] = agora;
  else if (alerta.tipo === 'a-caminho') novo.anunciados[alerta.id] = agora;
  else novo.avisos[alerta.id] = agora;
  if (alerta.tipo === 'importante') novo.ultimoImportante = agora;
  else novo.ultimaNarracao = agora;
  return novo;
}

/** Resumo da caminhada: distância (m), duração (ms) e quantos lugares a pessoa conheceu desde `inicio`. */
export function resumoCaminhada(trajeto, estado = {}, inicio = 0) {
  const pontos = trajeto.filter((p) => p.t >= inicio);
  let metros = 0;
  for (let i = 1; i < pontos.length; i += 1) metros += distanciaM(pontos[i - 1], pontos[i]);
  const lugares = Object.values(estado.narrados || {}).filter((t) => t >= inicio).length;
  const duracao = pontos.length > 1 ? pontos.at(-1).t - pontos[0].t : 0;
  return { metros: Math.round(metros), duracao, lugares };
}
