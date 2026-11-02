// Servidor HTTP do GuIA Brasil: serve o app (PWA) e a API. Sem framework (decisão G-001).
import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarPacotes, resumo } from './pacotes.js';
import { conversar, explicarFoto, criarCliente, MODELO } from './guia.js';
import { clienteOpenRouter, chaveValida, modeloValido, MODELO_PADRAO_USUARIO } from './openrouter.js';
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

export function validarConversa(b, pacotes) {
  const reg = pacotes.get(b.pacoteId);
  if (!reg) throw new ErroHttp(404, 'Pacote não encontrado.');
  const mensagem = texto(b.mensagem, 600);
  if (!mensagem) throw new ErroHttp(400, 'Escreva uma pergunta.');
  const historico = Array.isArray(b.historico) ? b.historico.slice(-8).map((h) => ({ papel: h && h.papel === 'guia' ? 'guia' : 'usuario', texto: texto(h && h.texto, 1500) })).filter((h) => h.texto) : [];
  const poiId = reg.pacote.pois.some((p) => p.id === b.poiId) ? b.poiId : null;
  return { pacote: reg.pacote, mensagem, pos: pos(b.pos), poiId, historico, nivel: NIVEIS.includes(b.nivel) ? b.nivel : 'medio' };
}

export function validarFoto(b, pacotes) {
  const reg = pacotes.get(b.pacoteId);
  if (!reg) throw new ErroHttp(404, 'Pacote não encontrado.');
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(typeof b.imagem === 'string' ? b.imagem : '');
  if (!m || !MIMES_IMAGEM.has(m[1])) throw new ErroHttp(400, 'Envie uma foto JPEG, PNG ou WebP.');
  if (m[2].length > LIMITE_IMAGEM_B64) throw new ErroHttp(413, 'Foto grande demais.');
  const direcao = Number.isFinite(+b.direcao) && b.direcao !== null && b.direcao !== '' ? ((+b.direcao % 360) + 360) % 360 : null;
  return { pacote: reg.pacote, imagem: { mime: m[1], base64: m[2] }, pos: pos(b.pos), direcao, pergunta: texto(b.pergunta, 300) };
}

export function validarFeedback(b, pacotes) {
  if (!pacotes.has(b.pacoteId)) throw new ErroHttp(404, 'Pacote não encontrado.');
  if (!['util', 'errado'].includes(b.tipo)) throw new ErroHttp(400, 'tipo deve ser util ou errado.');
  const id = texto(b.id, 64);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new ErroHttp(400, 'id inválido.');
  return { id, pacoteId: b.pacoteId, poiId: texto(b.poiId, 64) || null, tipo: b.tipo, motor: texto(b.motor, 10), resposta: texto(b.resposta, 1500), comentario: texto(b.comentario, 500) };
}

export async function criarServidor({ pastaPacotes = join(RAIZ, 'pacotes'), pastaDados = process.env.GUIA_DADOS || join(RAIZ, 'dados'), cliente, limitador = criarLimitador(), log = console, fetchIA = fetch } = {}) {
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
    if (req.method === 'POST' && (p === '/api/conversa' || p === '/api/foto')) {
      if (!limitador(ip)) throw new ErroHttp(429, 'Muitas perguntas em pouco tempo. Tente de novo em alguns minutos.');
      const corpo = await lerCorpo(req);
      const inicio = Date.now();
      const motorIa = iaDoPedido(req) || ia;
      const r = p === '/api/conversa' ? await conversar(validarConversa(corpo, pacotes), motorIa) : await explicarFoto(validarFoto(corpo, pacotes), motorIa);
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
