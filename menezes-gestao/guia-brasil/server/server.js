// Servidor HTTP do GuIA Brasil: serve o app (PWA) e a API. Sem framework (decisão G-001).
import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarPacotes, resumo } from './pacotes.js';
import { conversar, explicarFoto, criarCliente, MODELO, SEM_DESTINO } from './guia.js';
import { clienteOpenRouter, chaveValida, modeloValido, MODELO_PADRAO_USUARIO } from './openrouter.js';
import { criarDescoberta, ErroDescoberta } from './descoberta.js';
import { posicaoValida, NIVEIS } from '../public/js/nucleo.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLICO = join(RAIZ, 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export const LIMITE_CORPO = 6 * 1024 * 1024; // foto redimensionada no app (~300 KB) com folga
const LIMITE_IMAGEM_B64 = 5 * 1024 * 1024;
const MIMES_IMAGEM = new Set(['image/jpeg', 'image/png', 'image/webp']);

class ErroHttp extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/** Limite simples por IP para as rotas que gastam IA (protege o custo, RNF09). Janela deslizante em memória. */
export function criarLimitador({ maximo = 40, janelaMs = 10 * 60000 } = {}) {
  const usos = new Map();
  return (chave, agora = Date.now()) => {
    const lista = (usos.get(chave) || []).filter((t) => agora - t < janelaMs);
    if (lista.length >= maximo) { usos.set(chave, lista); return false; }
    lista.push(agora); usos.set(chave, lista);
    if (usos.size > 5000) for (const [k, v] of usos) if (!v.some((t) => agora - t < janelaMs)) usos.delete(k);
    return true;
  };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', (c) => { tam += c.length; if (tam > LIMITE_CORPO) { reject(new ErroHttp(413, 'Envio grande demais.')); req.destroy(); } else partes.push(c); });
    req.on('end', () => {
      try { resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {}); }
      catch { reject(new ErroHttp(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pos = (p) => (p && posicaoValida({ lat: +p.lat, lng: +p.lng }) ? { lat: +p.lat, lng: +p.lng, precisao: Number.isFinite(+p.precisao) ? +p.precisao : undefined } : null);

/** Destino é opcional na conversa e na foto: sem ele, a IA responde pelo conhecimento geral e pela posição.
 *  Um destino informado que não existe continua sendo erro (404). */
/** Destino gerado (G-017): o id guarda o centro ("lugar-m12-255-m38-966" = -12,255; -38,966). */
export function centroDoIdGerado(id) {
  const m = /^lugar-(m?)(\d{1,2})-(\d{3})-(m?)(\d{1,3})-(\d{3})$/.exec(String(id || ''));
  if (!m) return null;
  const lat = (m[1] ? -1 : 1) * +`${m[2]}.${m[3]}`;
  const lng = (m[4] ? -1 : 1) * +`${m[5]}.${m[6]}`;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/**
 * Pacote do pedido: curado (em memória), gerado (o app só tem o id: o servidor monta de novo pelo centro, quase sempre
 * vindo do cache de 24 h, G-019) ou nenhum. Sem isso, toda pergunta feita num destino gerado voltava 404.
 */
async function pacoteDoPedido(b, pacotes, descoberta) {
  if (b.pacoteId == null || b.pacoteId === '') return { pacote: SEM_DESTINO };
  const reg = pacotes.get(b.pacoteId);
  if (reg) return reg;
  const centro = descoberta && centroDoIdGerado(b.pacoteId);
  if (centro) {
    try { return { pacote: await descoberta.gerarPacote(centro) }; } catch { return { pacote: SEM_DESTINO }; }
  }
  throw new ErroHttp(404, 'Pacote não encontrado.');
}

export async function validarConversa(b, pacotes, descoberta) {
  const reg = await pacoteDoPedido(b, pacotes, descoberta);
  const mensagem = texto(b.mensagem, 600);
  if (!mensagem) throw new ErroHttp(400, 'Escreva uma pergunta.');
  const historico = Array.isArray(b.historico) ? b.historico.slice(-8).map((h) => ({ papel: h && h.papel === 'guia' ? 'guia' : 'usuario', texto: texto(h && h.texto, 1500) })).filter((h) => h.texto) : [];
  const poiId = reg.pacote.pois.some((p) => p.id === b.poiId) ? b.poiId : null;
  return { pacote: reg.pacote, mensagem, pos: pos(b.pos), poiId, historico, nivel: NIVEIS.includes(b.nivel) ? b.nivel : 'medio' };
}

export async function validarFoto(b, pacotes, descoberta) {
  const reg = await pacoteDoPedido(b, pacotes, descoberta);
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(typeof b.imagem === 'string' ? b.imagem : '');
  if (!m || !MIMES_IMAGEM.has(m[1])) throw new ErroHttp(400, 'Envie uma foto JPEG, PNG ou WebP.');
  if (m[2].length > LIMITE_IMAGEM_B64) throw new ErroHttp(413, 'Foto grande demais.');
  const direcao = Number.isFinite(+b.direcao) && b.direcao !== null && b.direcao !== '' ? ((+b.direcao % 360) + 360) % 360 : null;
  return { pacote: reg.pacote, imagem: { mime: m[1], base64: m[2] }, pos: pos(b.pos), direcao, pergunta: texto(b.pergunta, 300) };
}

export function validarFeedback(b, pacotes) {
  if (!pacotes.has(b.pacoteId) && !centroDoIdGerado(b.pacoteId)) throw new ErroHttp(404, 'Pacote não encontrado.');
  if (!['util', 'errado'].includes(b.tipo)) throw new ErroHttp(400, 'tipo deve ser util ou errado.');
  const id = texto(b.id, 64);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new ErroHttp(400, 'id inválido.');
  return { id, pacoteId: b.pacoteId, poiId: texto(b.poiId, 64) || null, tipo: b.tipo, motor: texto(b.motor, 10), resposta: texto(b.resposta, 1500), comentario: texto(b.comentario, 500) };
}

export async function criarServidor({ pastaPacotes = join(RAIZ, 'pacotes'), pastaDados = process.env.GUIA_DADOS || join(RAIZ, 'dados'), cliente, limitador = criarLimitador(), log = console, fetchIA = fetch, descoberta = criarDescoberta() } = {}) {
  const pacotes = carregarPacotes(pastaPacotes);
  const ia = cliente === undefined ? await criarCliente() : cliente;
  const feedbackVistos = new Set(); // idempotência: o app reenvia da fila e não pode duplicar
  await mkdir(pastaDados, { recursive: true });

  const json = (res, status, corpo, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
    res.end(JSON.stringify(corpo));
  };

  /** "Sua IA": a pessoa conectou a conta dela (OpenRouter) no app; a chave vem por cabeçalho a cada pedido. */
  function iaDoPedido(req) {
    const chave = req.headers['x-guia-ia-chave'];
    if (!chave) return null;
    if (!chaveValida(chave)) throw new ErroHttp(400, 'A conexão com a sua IA está inválida. Conecte de novo em Viagem.');
    const modelo = req.headers['x-guia-ia-modelo'];
    return clienteOpenRouter(chave, modeloValido(modelo) ? modelo : MODELO_PADRAO_USUARIO, { fetchImpl: fetchIA });
  }

  async function estatico(req, res, caminho) {
    const rel = normalize(decodeURIComponent(caminho === '/' ? '/index.html' : caminho)).replace(/^([/\\])+/, '');
    if (rel.startsWith('..')) throw new ErroHttp(404, 'Não encontrado.');
    let dados;
    try { dados = await readFile(join(PUBLICO, rel)); } catch { throw new ErroHttp(404, 'Não encontrado.'); }
    res.writeHead(200, { 'content-type': TIPOS[extname(rel)] || 'application/octet-stream', 'cache-control': rel === 'sw.js' ? 'no-cache' : 'public, max-age=300' });
    res.end(dados);
  }

  async function rotear(req, res) {
    const url = new URL(req.url, 'http://local');
    const { pathname: p } = url;
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

    if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true, ia: !!ia, modelo: ia ? MODELO : null, pacotes: pacotes.size });
    if (req.method === 'GET' && p === '/api/pacotes') return json(res, 200, [...pacotes.values()].map(resumo));
    const mp = /^\/api\/pacotes\/([a-z0-9-]+)$/.exec(p);
    if (req.method === 'GET' && mp) {
      const reg = pacotes.get(mp[1]);
      if (!reg) throw new ErroHttp(404, 'Pacote não encontrado.');
      if (req.headers['if-none-match'] === reg.etag) { res.writeHead(304, { etag: reg.etag }); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', etag: reg.etag, 'cache-control': 'no-cache' });
      return res.end(reg.corpo);
    }
    // Qualquer lugar (G-017): busca por nome e destino gerado ao redor de uma coordenada.
    if (req.method === 'GET' && (p === '/api/lugares' || p === '/api/perto' || p === '/api/onde')) {
      if (!limitador(ip)) throw new ErroHttp(429, 'Muitas buscas em pouco tempo. Tente de novo em alguns minutos.');
      try {
        if (p === '/api/lugares') {
          const q = texto(url.searchParams.get('q'), 80);
          if (q.length < 2) throw new ErroHttp(400, 'Digite pelo menos 2 letras.');
          return json(res, 200, await descoberta.buscarLugares(q));
        }
        const lugar = pos({ lat: url.searchParams.get('lat'), lng: url.searchParams.get('lng') });
        if (!lugar) throw new ErroHttp(400, 'Coordenadas inválidas.');
        if (p === '/api/onde') return json(res, 200, await descoberta.ondeEstou(lugar.lat, lugar.lng));
        const inicio = Date.now();
        const pacote = await descoberta.gerarPacote({ ...lugar, nome: texto(url.searchParams.get('nome'), 80) || null });
        log.info(JSON.stringify({ rota: p, pontos: pacote.pois.length, ms: Date.now() - inicio }));
        return json(res, 200, pacote);
      } catch (e) {
        if (e instanceof ErroDescoberta) throw new ErroHttp(502, e.message);
        throw e;
      }
    }
    if (req.method === 'POST' && (p === '/api/conversa' || p === '/api/foto')) {
      if (!limitador(ip)) throw new ErroHttp(429, 'Muitas perguntas em pouco tempo. Tente de novo em alguns minutos.');
      const corpo = await lerCorpo(req);
      const inicio = Date.now();
      const motorIa = iaDoPedido(req) || ia;
      const r = p === '/api/conversa'
        ? await conversar(await validarConversa(corpo, pacotes, descoberta), motorIa, { pesquisar: descoberta.pesquisar })
        : await explicarFoto(await validarFoto(corpo, pacotes, descoberta), motorIa);
      // Nunca registrar a chave da pessoa: só o provedor e o resultado.
      log.info(JSON.stringify({ rota: p, motor: r.motor, provedor: r.provedor, ms: Date.now() - inicio, erroIa: r.erroIa || undefined }));
      return json(res, 200, r);
    }
    if (req.method === 'POST' && p === '/api/feedback') {
      const f = validarFeedback(await lerCorpo(req), pacotes);
      if (!feedbackVistos.has(f.id)) {
        feedbackVistos.add(f.id);
        await appendFile(join(pastaDados, 'feedback.jsonl'), JSON.stringify({ ...f, em: new Date().toISOString() }) + '\n');
      }
      res.writeHead(204); return res.end();
    }
    if (p.startsWith('/api/')) throw new ErroHttp(404, 'Rota não encontrada.');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErroHttp(405, 'Método não permitido.');
    return estatico(req, res, p);
  }

  const servidor = createServer((req, res) => {
    rotear(req, res).catch((e) => {
      const status = e instanceof ErroHttp ? e.status : 500;
      if (status === 500) log.error(JSON.stringify({ rota: req.url.split('?')[0], erro: String(e?.message || e).slice(0, 200) }));
      if (!res.headersSent) json(res, status, { erro: status === 500 ? 'Erro interno.' : e.message });
      else res.end();
    });
  });
  servidor.requestTimeout = 90000;
  return { servidor, pacotes, ia };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const porta = +process.env.PORT || 3000;
  const { servidor, ia, pacotes } = await criarServidor();
  servidor.listen(porta, () => console.log(`GuIA Brasil em http://localhost:${porta} · ${pacotes.size} pacote(s) · IA ${ia ? `ligada (${MODELO})` : 'desligada (modo local)'}`));
}
