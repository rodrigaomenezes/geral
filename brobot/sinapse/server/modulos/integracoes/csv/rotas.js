'use strict';
// Rotas da integração por CSV. O arquivo vem como texto (Content-Type: text/csv), até 5 MB.
const { ErroNegocio } = require('../../../nucleo/erros');
const s = require('./servico');

const nomeSeguro = (n) => String(n || 'arquivo.csv').replace(/[^\w.\- ]+/g, '_').slice(0, 120);

module.exports = [
  { metodo: 'GET', caminho: '/api/integracoes', permissao: 'integracao.usar', descricao: 'usar as integrações',
    handler: ({ db, ctx }) => db.comoTenant(ctx.tenantId, (c) => s.painel(c)) },
  { metodo: 'POST', caminho: '/api/integracoes/csv/:tipo/previa', permissao: 'integracao.usar', texto: true, descricao: 'importar arquivos',
    handler: ({ db, ctx, params, corpo }) => db.comoTenant(ctx.tenantId, (c) => s.previa(c, params.tipo, corpo)) },
  { metodo: 'POST', caminho: '/api/integracoes/csv/:tipo/aplicar', permissao: 'integracao.usar', texto: true, descricao: 'importar arquivos',
    handler: ({ db, ctx, params, corpo, req }) => db.comoTenant(ctx.tenantId, (c) => s.aplicar(c, ctx, params.tipo, nomeSeguro(req.headers['x-arquivo']), corpo)) },
  { metodo: 'GET', caminho: '/api/integracoes/exportar/:tipo', permissao: 'integracao.usar', descricao: 'exportar arquivos',
    handler: async ({ db, ctx, params, res }) => {
      const r = await db.comoTenant(ctx.tenantId, (c) => s.exportar(c, ctx, params.tipo));
      if (!r) throw new ErroNegocio(404, 'nao_encontrado', 'Exportação não encontrada.');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${r.arquivo}"`,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'X-Linhas': String(r.linhas) });
      res.end(r.conteudo);
      return { __bruto: true, status: 200 };
    } },
];
