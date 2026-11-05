'use strict';
// Mensagens padrão editáveis (COM-001, COM-002). Texto padrão no código; a organização cria versões, envia para
// revisão e a Supervisão aprova. Só a versão aprovada é usada no envio. Quem escreveu não aprova o próprio texto
// (salvo a Administração). Opcional: o modelo aprovado na Meta, para enviar fora da janela de 24 h do WhatsApp.

const { uma } = require('../../db');
const { erro } = require('../../nucleo/erros');
const { auditar } = require('../../nucleo/registro');
const { relogio } = require('../../nucleo/relogio');
const { MODELOS } = require('./modelos');

const EXEMPLO = { nome: 'Fernanda', conta: 'Transportadora Rota Sul', protocolo: 'SIN-000123', produto: 'Multas e Notificações', data: '08/11/2026',
  qtd: 2, lista: '• RSU2B34: Veículo sem vínculo ativo no SNE — faça o vínculo no SNE\n• RSU5E67: Certificado digital expirado — renove o certificado',
  sucesso: 5, total: 7, lista_sucesso: 'RSU1A23, RSU4D56, RSU6F78, RSU7G89, RSU3C45', texto: 'Texto da resposta' };
const EDITAVEIS = Object.keys(MODELOS).filter((k) => k !== 'resposta_atendimento');
const usadas = (texto) => [...new Set([...String(texto).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

function validarTexto(codigo, texto) {
  const m = MODELOS[codigo];
  if (!m || !EDITAVEIS.includes(codigo)) throw erro.naoEncontrado('Modelo de mensagem');
  const t = String(texto || '').trim();
  if (t.length < 5) throw erro.entrada('Escreva a mensagem (pelo menos 5 caracteres).');
  const desconhecidas = usadas(t).filter((v) => !m.variaveis.includes(v));
  if (desconhecidas.length) {
    throw erro.entrada(`Variável que este modelo não conhece: ${desconhecidas.map((v) => `{${v}}`).join(', ')}. Disponíveis: ${m.variaveis.map((v) => `{${v}}`).join(', ')}.`);
  }
  return t;
}

const preencher = (texto, vars) => String(texto).replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));

/** Texto em uso agora (versão aprovada ou o padrão do sistema) já preenchido, e o template da Meta, se houver. */
async function renderizarAtual(c, codigo, variaveis) {
  const m = MODELOS[codigo];
  if (!m) throw new Error(`Modelo de mensagem desconhecido: ${codigo}.`);
  const ativo = EDITAVEIS.includes(codigo) ? uma(await c.query("SELECT * FROM modelos_mensagem WHERE codigo = $1 AND estado = 'ativa'", [codigo])) : null;
  const texto = ativo ? ativo.texto : m.texto;
  const faltam = usadas(texto).filter((v) => variaveis[v] === undefined || variaveis[v] === null || variaveis[v] === '');
  if (faltam.length) throw new Error(`Modelo ${codigo} sem as variáveis: ${faltam.join(', ')}.`);
  const template = ativo?.template_nome ? { nome: ativo.template_nome, idioma: ativo.template_idioma || 'pt_BR',
    variaveis: ativo.template_variaveis.map((v) => String(variaveis[v] ?? '').replace(/\n+/g, ' · ').slice(0, 1000)) } : null;
  return { texto: preencher(texto, variaveis).slice(0, 4000), modelo: `${codigo}@${ativo ? `o${ativo.versao}` : m.versao}`, template };
}

async function listar(c) {
  const linhas = (await c.query(`SELECT codigo, versao, estado, texto, template_nome, criado_em FROM modelos_mensagem
    WHERE estado IN ('ativa','rascunho','em_revisao') ORDER BY codigo, versao`)).rows;
  return EDITAVEIS.map((k) => {
    const ativa = linhas.find((l) => l.codigo === k && l.estado === 'ativa');
    const pendente = linhas.find((l) => l.codigo === k && ['rascunho', 'em_revisao'].includes(l.estado));
    return { codigo: k, nome: MODELOS[k].nome, variaveis: MODELOS[k].variaveis, emUso: ativa ? `versão ${ativa.versao} da equipe` : 'texto padrão do sistema',
      texto: ativa ? ativa.texto : MODELOS[k].texto, pendente: pendente ? { versao: pendente.versao, estado: pendente.estado } : null, template: ativa?.template_nome || null };
  });
}

async function detalhe(c, codigo) {
  if (!EDITAVEIS.includes(codigo)) throw erro.naoEncontrado('Modelo de mensagem');
  const versoes = (await c.query(`SELECT m.*, a.nome AS autor, r.nome AS revisor FROM modelos_mensagem m LEFT JOIN usuarios a ON a.id = m.criado_por
    LEFT JOIN usuarios r ON r.id = m.revisado_por WHERE m.codigo = $1 ORDER BY m.versao DESC`, [codigo])).rows;
  return { codigo, nome: MODELOS[codigo].nome, padrao: MODELOS[codigo].texto, variaveis: MODELOS[codigo].variaveis, versoes, exemplo: EXEMPLO };
}

async function salvarRascunho(c, ctx, codigo, { texto, nota }) {
  const t = validarTexto(codigo, texto);
  const pend = uma(await c.query("SELECT id FROM modelos_mensagem WHERE codigo = $1 AND estado IN ('rascunho','em_revisao') FOR UPDATE", [codigo]));
  if (pend) {
    await c.query("UPDATE modelos_mensagem SET texto = $2, nota = $3, estado = 'rascunho', criado_por = $4, criado_em = now(), enviado_revisao_em = NULL WHERE id = $1",
      [pend.id, t, nota || null, ctx.usuario.id]);
  } else {
    const v = uma(await c.query('SELECT coalesce(max(versao), 0) + 1 AS v FROM modelos_mensagem WHERE codigo = $1', [codigo])).v;
    await c.query('INSERT INTO modelos_mensagem (tenant_id, codigo, versao, texto, nota, criado_por) VALUES ($1,$2,$3,$4,$5,$6)', [ctx.tenantId, codigo, v, t, nota || null, ctx.usuario.id]);
  }
  await auditar(c, ctx, { acao: 'modelo.rascunho', entidade: 'modelo', entidadeId: codigo });
  return detalhe(c, codigo);
}

async function enviarRevisao(c, ctx, codigo) {
  const r = await c.query("UPDATE modelos_mensagem SET estado = 'em_revisao', enviado_revisao_em = now() WHERE codigo = $1 AND estado = 'rascunho' RETURNING versao", [codigo]);
  if (!r.rowCount) throw erro.regra('sem_rascunho', 'Não há rascunho para enviar. Edite o texto primeiro.');
  await auditar(c, ctx, { acao: 'modelo.enviado_revisao', entidade: 'modelo', entidadeId: codigo, depois: { versao: r.rows[0].versao } });
  return detalhe(c, codigo);
}

async function aprovar(c, ctx, codigo, { parecer, templateNome, templateIdioma, templateVariaveis }) {
  const m = uma(await c.query("SELECT * FROM modelos_mensagem WHERE codigo = $1 AND estado = 'em_revisao' FOR UPDATE", [codigo]));
  if (!m) throw erro.regra('nada_para_aprovar', 'Não há versão em revisão para aprovar.');
  if (m.criado_por === ctx.usuario.id && ctx.usuario.papel !== 'admin') throw erro.regra('autoaprovacao', 'Outra pessoa precisa aprovar o texto que você escreveu.');
  const vars = (templateVariaveis || []).map(String);
  const invalidas = vars.filter((v) => !MODELOS[codigo].variaveis.includes(v));
  if (invalidas.length) throw erro.entrada(`Variáveis do template desconhecidas: ${invalidas.join(', ')}.`);
  await c.query("UPDATE modelos_mensagem SET estado = 'substituida' WHERE codigo = $1 AND estado = 'ativa'", [codigo]);
  await c.query(`UPDATE modelos_mensagem SET estado = 'ativa', revisado_por = $2, revisado_em = $3, parecer = $4, template_nome = $5, template_idioma = $6, template_variaveis = $7
    WHERE id = $1`, [m.id, ctx.usuario.id, relogio.agora(), parecer || null, templateNome || null, templateIdioma || (templateNome ? 'pt_BR' : null), vars]);
  await auditar(c, ctx, { acao: 'modelo.aprovado', entidade: 'modelo', entidadeId: codigo, depois: { versao: m.versao, template: templateNome || null }, motivo: parecer || null });
  return detalhe(c, codigo);
}

async function reprovar(c, ctx, codigo, parecer) {
  if (!parecer) throw erro.entrada('Explique o que precisa mudar.');
  const r = await c.query("UPDATE modelos_mensagem SET estado = 'reprovada', revisado_por = $2, revisado_em = now(), parecer = $3 WHERE codigo = $1 AND estado = 'em_revisao' RETURNING versao",
    [codigo, ctx.usuario.id, parecer]);
  if (!r.rowCount) throw erro.regra('nada_para_revisar', 'Não há versão em revisão.');
  await auditar(c, ctx, { acao: 'modelo.reprovado', entidade: 'modelo', entidadeId: codigo, motivo: parecer });
  return detalhe(c, codigo);
}

function previa(codigo, texto) {
  const t = validarTexto(codigo, texto);
  return { texto: preencher(t, EXEMPLO), variaveisUsadas: usadas(t) };
}

module.exports = { renderizarAtual, listar, detalhe, salvarRascunho, enviarRevisao, aprovar, reprovar, previa, EDITAVEIS };
