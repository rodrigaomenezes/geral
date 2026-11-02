// "Conectar minha IA": login OAuth (PKCE) na OpenRouter, sem a pessoa copiar chave nenhuma (decisão G-015).
// 1. iniciarLogin: gera o verificador, guarda e manda a pessoa para openrouter.ai/auth;
// 2. a OpenRouter devolve para o app com ?code=…&state=…;
// 3. concluirLogin: troca o código por uma chave da conta da pessoa, que fica SÓ neste aparelho.
// O uso da IA é cobrado dos créditos dela. Em cada pergunta a chave vai por cabeçalho ao nosso servidor, que
// monta o contexto do guia e chama a OpenRouter sem gravar a chave.
import { ler, gravar } from './estado.js';

export const URL_AUTH = 'https://openrouter.ai/auth';
export const URL_TROCA = 'https://openrouter.ai/api/v1/auth/keys';
export const MODELO_PADRAO = 'openrouter/auto';
const VALIDADE_LOGIN_MS = 15 * 60000; // o código da OpenRouter vale 10 min; margem para quem volta devagar

export const modeloValido = (m) => typeof m === 'string' && /^[A-Za-z0-9._:/-]{3,100}$/.test(m);

function base64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function gerarVerificador() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** code_challenge = BASE64URL(SHA-256(verificador)) — RFC 7636, método S256. */
export async function desafioS256(verificador) {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador)));
}

/** { chave, modelo, conectadoEm } ou null. */
export function conexao() {
  const c = ler('minhaIa', null);
  return c && typeof c.chave === 'string' ? c : null;
}

export function cabecalhos() {
  const c = conexao();
  return c ? { 'x-guia-ia-chave': c.chave, 'x-guia-ia-modelo': c.modelo || MODELO_PADRAO } : {};
}

export function desconectar() { gravar('minhaIa', null); }

export function definirModelo(modelo) {
  const c = conexao();
  if (!c) return false;
  if (!modeloValido(modelo)) return false;
  gravar('minhaIa', { ...c, modelo });
  return true;
}

/** Monta o endereço de login e guarda o verificador. `destino` = endereço do app que receberá o retorno. */
export async function urlDeLogin(destino) {
  const verificador = gerarVerificador();
  const estado = gerarVerificador().slice(0, 24);
  gravar('minhaIa.login', { verificador, estado, em: Date.now() });
  const p = new URLSearchParams({
    callback_url: destino,
    code_challenge: await desafioS256(verificador),
    code_challenge_method: 'S256',
    state: estado,
    key_label: 'GuIA Brasil',
  });
  return `${URL_AUTH}?${p}`;
}

/** O endereço atual é o retorno de um login? */
export function ehRetornoDeLogin(params) {
  return params.has('code') && !!ler('minhaIa.login', null);
}

/** Troca o código pela chave. Lança Error com mensagem para a pessoa se algo não bater. */
export async function concluirLogin(params, fetchImpl = fetch, agora = Date.now()) {
  const login = ler('minhaIa.login', null);
  gravar('minhaIa.login', null); // uso único, dê certo ou não
  const codigo = params.get('code');
  if (!login || !codigo) throw new Error('Não encontrei o login em andamento. Tente conectar de novo.');
  if (agora - login.em > VALIDADE_LOGIN_MS) throw new Error('O login demorou demais e expirou. Tente conectar de novo.');
  if (params.has('state') && params.get('state') !== login.estado) throw new Error('O retorno do login não confere. Tente conectar de novo.');
  const r = await fetchImpl(URL_TROCA, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: codigo, code_verifier: login.verificador, code_challenge_method: 'S256' }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok || typeof dados.key !== 'string') throw new Error('A OpenRouter não confirmou a conexão. Tente de novo.');
  gravar('minhaIa', { chave: dados.key, modelo: MODELO_PADRAO, conectadoEm: agora });
  return conexao();
}
