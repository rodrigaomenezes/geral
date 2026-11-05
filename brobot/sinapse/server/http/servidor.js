'use strict';
// Servidor HTTP (node:http, sem framework — mesma pilha dos outros projetos do repositório).
// Responsabilidades: estáticos, sessão por cookie, checagem de permissão por rota, corpo JSON (até 1 MB),
// proteção de origem (CSRF), cabeçalhos de segurança, correlação, log sem dado sensível e erro padronizado.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ErroNegocio, erro } = require('../nucleo/erros');
const { pode } = require('../modulos/identidade/permissoes');
const identidade = require('../modulos/identidade/servico');

const PUBLICO = path.join(__dirname, '..', '..', 'public');
const COOKIE = 'sinapse_sessao';
const LIMITE_CORPO = 1024 * 1024;
const LIMITE_ARQUIVO = 5 * 1024 * 1024; // CSV de integração: upload próprio, não JSON
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

const CABECALHOS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self' wss:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function compilar(rotas) {
  return rotas.map((r) => {
    const nomes = [];
    const re = new RegExp(`^${r.caminho.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; })}$`);
    return { ...r, re, nomes };
  });
}

function lerCookie(req, nome) {
  const c = req.headers.cookie || '';
  for (const parte of c.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

function lerCorpo(req, { texto = false } = {}) {
  const limite = texto ? LIMITE_ARQUIVO : LIMITE_CORPO;
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (ch) => {
      tamanho += ch.length;
      if (tamanho > limite) {
        reject(new ErroNegocio(413, 'corpo_grande', texto ? 'Arquivo acima de 5 MB. Divida em partes menores.' : 'Conteúdo acima de 1 MB. Envie arquivos pelo upload próprio.'));
        req.destroy(); return;
      }
      partes.push(ch);
    });
    req.on('end', () => {
      if (texto) return resolve(Buffer.concat(partes).toString('utf8'));
      if (!partes.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { reject(erro.entrada('O corpo da requisição não é um JSON válido.')); }
    });
    req.on('error', reject);
  });
}

function responder(res, status, corpo, extras = {}) {
  const dados = corpo === undefined ? '' : JSON.stringify(corpo);
  res.writeHead(status, { ...CABECALHOS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extras });
  res.end(dados);
}

/** Traduz erros do banco para mensagens que dizem o que fazer. */
function traduzir(e) {
  if (e instanceof ErroNegocio) return e;
  if (e && e.code === '23505') return erro.conflito('Já existe um registro com esses dados.');
  if (e && e.code === '23514') return erro.regra('regra_violada', `O banco recusou a alteração por uma regra de integridade (${e.constraint || 'checagem'}). Confira os dados.`);
  if (e && e.code === '23503') return erro.regra('referencia_invalida', 'Um dos itens referenciados não existe ou é de outra organização.');
  if (e && e.code === '22P02') return erro.entrada('Identificador ou valor em formato inválido.');
  return null;
}

function servirEstatico(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const arquivo = path.normalize(path.join(PUBLICO, rel));
  if (!arquivo.startsWith(PUBLICO)) { res.writeHead(403, CABECALHOS); res.end(); return; }
  fs.readFile(arquivo, (err, dados) => {
    if (err) { res.writeHead(404, { ...CABECALHOS, 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Não encontrado'); return; }
    const ext = path.extname(arquivo);
    res.writeHead(200, { ...CABECALHOS, 'Content-Type': TIPOS[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || rel === '/sw.js' ? 'no-cache' : 'public, max-age=300' });
    res.end(dados);
  });
}

function criarServidor({ db, cfg, rotas, deps = {}, log = console.log }) {
  const tabela = compilar(rotas);

  async function tratar(req, res) {
    const inicio = Date.now();
    const correlacao = /^[0-9a-f-]{36}$/i.test(req.headers['x-correlation-id'] || '') ? req.headers['x-correlation-id'] : crypto.randomUUID();
    const url = new URL(req.url, 'http://local');
    const registrar = (status) => log(JSON.stringify({ t: new Date().toISOString(), metodo: req.method, rota: url.pathname, status, ms: Date.now() - inicio, correlacao }));

    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, CABECALHOS); res.end(); return; }
      servirEstatico(req, res, url.pathname);
      return;
    }
    const rota = tabela.find((r) => r.metodo === req.method && r.re.test(url.pathname));
    try {
      if (!rota) throw new ErroNegocio(404, 'rota_inexistente', 'Endereço da API não encontrado.');
      if (req.method !== 'GET') {
        const origem = req.headers.origin;
        if (origem && new URL(origem).host !== req.headers.host) throw new ErroNegocio(403, 'origem_invalida', 'Requisição de outra origem recusada.');
        const tipo = req.headers['content-type'] || '';
        if (rota.texto ? !/text\/(csv|plain)/.test(tipo) : !rota.publica && !/application\/json/.test(tipo)) {
          throw new ErroNegocio(415, 'tipo_invalido', rota.texto ? 'Envie o arquivo como CSV (Content-Type: text/csv).' : 'Envie os dados como JSON (Content-Type: application/json).');
        }
      }
      const params = Object.fromEntries(rota.nomes.map((n, i) => [n, decodeURIComponent(url.pathname.match(rota.re)[i + 1])]));
      const token = lerCookie(req, COOKIE);
      const usuario = token ? await identidade.sessaoPorToken(db, token) : null;
      if (!rota.publica) {
        if (!usuario) throw erro.naoAutenticado();
        if (rota.permissao && !pode(usuario, rota.permissao)) throw erro.semPermissao(rota.descricao || 'esta ação');
        if (rota.demo && !cfg.demo) throw new ErroNegocio(404, 'rota_inexistente', 'O simulador está desligado neste ambiente.');
      }
      let corpo = req.method === 'GET' ? {} : await lerCorpo(req, { texto: !!(rota.texto || rota.cru) });
      let bruto = null;
      if (rota.cru && req.method !== 'GET') { bruto = corpo; try { corpo = JSON.parse(bruto || '{}'); } catch { throw erro.entrada('JSON inválido.'); } }
      const ctx = usuario ? { tenantId: usuario.tenant_id, usuario, correlacao } : { correlacao };
      const r = await rota.handler({ req, res, params, query: Object.fromEntries(url.searchParams), corpo, bruto, usuario, ctx, token, db, cfg, deps });
      if (r && r.__bruto) { registrar(r.status); return; }
      const status = r && r.__status ? r.__status : 200;
      responder(res, status, r && r.__status ? r.corpo : r ?? { ok: true }, r && r.__cabecalhos);
      registrar(status);
    } catch (e) {
      const t = traduzir(e);
      if (t) {
        responder(res, t.status, { error: { code: t.code, message: t.message, details: t.details } });
        registrar(t.status);
      } else {
        log(JSON.stringify({ t: new Date().toISOString(), nivel: 'erro', rota: url.pathname, correlacao, erro: String(e && e.message).slice(0, 300) }));
        responder(res, 500, { error: { code: 'erro_interno', message: `Algo deu errado do nosso lado. Tente de novo; se continuar, informe o código ${correlacao.slice(0, 8)}.`, details: null } });
        registrar(500);
      }
    }
  }

  return http.createServer((req, res) => { tratar(req, res); });
}

/** Utilitários para os handlers. */
const com = (status, corpo, cabecalhos) => ({ __status: status, corpo, __cabecalhos: cabecalhos });
const cookieSessao = (token, maxAge, seguro) =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${seguro ? '; Secure' : ''}`;
const cookieApagado = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

module.exports = { criarServidor, com, cookieSessao, cookieApagado, COOKIE };
