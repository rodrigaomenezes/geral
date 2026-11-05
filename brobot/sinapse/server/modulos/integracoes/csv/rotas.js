'use strict';
// Rotas da integração por CSV. O arquivo vem como texto (Content-Type: text/csv), até 5 MB.
const { ErroNegocio, validar } = require('../../../nucleo/erros');
const s = require('./servico');
const { TIPOS } = require('./importadores');
const { pode } = require('../../identidade/permissoes');
/** Alguns fluxos pedem uma permissão a mais (ex.: migração do Pipedrive só pela gestão comercial). */
const exigirDoTipo = (usuario, tipo) => { const p = TIPOS[tipo]?.permissao; if (p && !pode(usuario, p)) throw new ErroNegocio(403, 'sem_permissao', 'Você não tem permissão para importar este tipo de arquivo.'); };

const nomeSeguro = (n) => String(n || 'arquivo.csv').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
/** Mapa de colunas escolhido na prévia: cabeçalho X-Mapa com JSON (codificado com encodeURIComponent), até 2 KB. */
function mapaDoCabecalho(req) {
  const bruto = req.headers['x-mapa'];
  if (!bruto) return null;
  if (bruto.length > 2048) throw new ErroNegocio(400, 'entrada_invalida', 'Mapeamento de colunas grande demais.');
  try { return JSON.parse(decodeURIComponent(bruto)); } catch { throw new ErroNegocio(400, 'entrada_invalida', 'Mapeamento de colunas ilegível. Refaça a prévia.'); }
}

module.exports = [
  { metodo: 'GET', caminho: '/api/integracoes', permissao: 'integracao.usar', descricao: 'usar as integrações',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, (c) => s.painel(c)) },
  { metodo: 'POST', caminho: '/api/integracoes/csv/:tipo/previa', permissao: 'integracao.usar', texto: true, descricao: 'importar arquivos',
    handler: ({ db, ctx, params, corpo, req, usuario }) => { exigirDoTipo(usuario, params.tipo); const m = mapaDoCabecalho(req); return db.comoTenant(ctx.tenantId, (c) => s.previa(c, params.tipo, corpo, m)); } },
  { metodo: 'POST', caminho: '/api/integracoes/csv/:tipo/aplicar', permissao: 'integracao.usar', texto: true, descricao: 'importar arquivos',
    handler: ({ db, ctx, params, corpo, req, usuario }) => { exigirDoTipo(usuario, params.tipo); const m = mapaDoCabecalho(req); return db.comoTenant(ctx.tenantId, (c) => s.aplicar(c, ctx, params.tipo, nomeSeguro(req.headers['x-arquivo']), corpo, m)); } },
  { metodo: 'POST', caminho: '/api/integracoes/lotes/:id/resolver', permissao: 'integracao.usar', descricao: 'confirmar arquivos exportados',
    handler: ({ db, ctx, params, corpo }) => {
      const d = validar(corpo, { resultado: { obrigatorio: true, tipo: 'texto', em: ['confirmado', 'falhou'] },
        evidencia: { obrigatorio: true, tipo: 'texto', min: 10, max: 1000 } });
      if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new ErroNegocio(400, 'entrada_invalida', 'Lote inválido.');
      return db.comoTenant(ctx.tenantId, (c) => s.resolverLote(c, ctx, params.id, d));
    } },
  { metodo: 'GET', caminho: '/api/integracoes/exportar/:tipo', permissao: 'integracao.usar', descricao: 'exportar arquivos',
    handler: async ({ db, ctx, params, res }) => {
      const r = await db.comoTenant(ctx.tenantId, (c) => s.exportar(c, ctx, params.tipo));
      if (!r) throw new ErroNegocio(404, 'nao_encontrado', 'Exportação não encontrada.');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${r.arquivo}"`,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'X-Linhas': String(r.linhas), 'X-Lote': r.lote });
      res.end(r.conteudo);
      return { __bruto: true, status: 200 };
    } },
];
