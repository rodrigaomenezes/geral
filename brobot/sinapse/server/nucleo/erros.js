'use strict';
// Erro de negócio com código estável e mensagem que diz o que a pessoa pode fazer.
// Resposta HTTP sempre no formato { error: { code, message, details } }.

class ErroNegocio extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details || null;
  }
}

const erro = {
  entrada: (message, details) => new ErroNegocio(400, 'entrada_invalida', message, details),
  naoAutenticado: () => new ErroNegocio(401, 'nao_autenticado', 'Sua sessão terminou. Entre novamente.'),
  semPermissao: (o) => new ErroNegocio(403, 'sem_permissao', `Seu perfil não permite ${o}. Peça a um supervisor.`),
  naoEncontrado: (o) => new ErroNegocio(404, 'nao_encontrado', `${o} não encontrado(a) ou fora da sua organização.`),
  conflito: (message, details) => new ErroNegocio(409, 'conflito', message, details),
  regra: (code, message, details) => new ErroNegocio(422, code, message, details),
  indisponivel: (message) => new ErroNegocio(503, 'indisponivel', message),
};

/** Validação mínima de entrada: campos obrigatórios, tipos e listas permitidas. */
function validar(corpo, regras) {
  const dados = corpo && typeof corpo === 'object' ? corpo : {};
  const saida = {};
  const problemas = [];
  for (const [campo, r] of Object.entries(regras)) {
    let v = dados[campo];
    if (v === undefined || v === null || v === '') {
      if (r.obrigatorio) problemas.push({ campo, problema: 'obrigatório' });
      continue;
    }
    if (r.tipo === 'texto') {
      if (typeof v !== 'string') { problemas.push({ campo, problema: 'deve ser texto' }); continue; }
      v = v.trim();
      if (r.max && v.length > r.max) { problemas.push({ campo, problema: `máximo de ${r.max} caracteres` }); continue; }
      if (r.min && v.length < r.min) { problemas.push({ campo, problema: `mínimo de ${r.min} caracteres` }); continue; }
    } else if (r.tipo === 'inteiro') {
      v = Number(v);
      if (!Number.isInteger(v)) { problemas.push({ campo, problema: 'deve ser número inteiro' }); continue; }
    } else if (r.tipo === 'uuid') {
      if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) { problemas.push({ campo, problema: 'identificador inválido' }); continue; }
    } else if (r.tipo === 'data') {
      const d = new Date(v);
      if (typeof v !== 'string' || Number.isNaN(d.getTime())) { problemas.push({ campo, problema: 'data inválida' }); continue; }
      v = d.toISOString();
    } else if (r.tipo === 'booleano') {
      if (typeof v !== 'boolean') { problemas.push({ campo, problema: 'deve ser verdadeiro ou falso' }); continue; }
    }
    if (r.em && !r.em.includes(v)) { problemas.push({ campo, problema: `valor não permitido (use: ${r.em.join(', ')})` }); continue; }
    saida[campo] = v;
  }
  if (problemas.length) throw erro.entrada('Confira os campos destacados e tente de novo.', problemas);
  return saida;
}

module.exports = { ErroNegocio, erro, validar };
