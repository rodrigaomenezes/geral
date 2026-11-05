'use strict';
// Usuários de teste com e-mail e senha (pedido de 05/11): um por perfil, nomes simples, na organização Brobot.
// A senha NÃO fica no código (repositório público): vem de SINAPSE_SENHA_TESTE (12+ caracteres). Sem a variável,
// nada é criado. A cada subida a senha é reaplicada, então trocar a variável troca a senha de todos.
// Recusado em SINAPSE_AMBIENTE=producao: conta compartilhada com senha conhecida não entra em ambiente real.

const { hashSenha } = require('./servico');
const { auditar, ctxSistema } = require('../../nucleo/registro');

const USUARIOS_TESTE = [
  ['admin@brobot.com.br', 'Administrador', 'admin', 'supervisao'],
  ['gestor@brobot.com.br', 'Gestor', 'supervisor', 'supervisao'],
  ['suporte1@brobot.com.br', 'Suporte 1', 'suporte', 'suporte'],
  ['suporte2@brobot.com.br', 'Suporte 2', 'suporte', 'suporte'],
  ['cs@brobot.com.br', 'CS', 'cs', 'cs'],
  ['operacional@brobot.com.br', 'Operacional', 'operacoes', 'operacoes'],
  ['comercial@brobot.com.br', 'Comercial', 'comercial', 'comercial'],
  ['financeiro@brobot.com.br', 'Financeiro', 'financeiro', 'financeiro'],
  ['dev@brobot.com.br', 'Desenvolvimento', 'dev', 'dev'],
];

async function garantirUsuariosTeste(db, cfg, log = () => {}) {
  if (!cfg.senhaTeste) return { criados: 0, atualizados: 0 };
  if (cfg.ambiente === 'producao') { log('SINAPSE_SENHA_TESTE ignorada: usuários de teste não são criados em SINAPSE_AMBIENTE=producao.'); return { criados: 0, atualizados: 0 }; }
  const tenant = (await db.query("SELECT id FROM tenants WHERE slug = 'brobot'")).rows[0];
  if (!tenant) { log('Usuários de teste: organização "brobot" ainda não existe; nada criado.'); return { criados: 0, atualizados: 0 }; }
  const ctx = ctxSistema(tenant.id, 'usuários de teste');
  return db.comoTenant(tenant.id, async (c) => {
    const eq = Object.fromEntries((await c.query('SELECT codigo, id FROM equipes')).rows.map((r) => [r.codigo, r.id]));
    let criados = 0; let atualizados = 0;
    for (const [email, nome, papel, equipe] of USUARIOS_TESTE) {
      if (!eq[equipe]) continue;
      const hash = hashSenha(cfg.senhaTeste);
      const r = await c.query('UPDATE usuarios SET senha_hash = $2, ativo = true WHERE lower(email) = $1 RETURNING id', [email, hash]);
      if (r.rowCount) { atualizados++; continue; }
      const u = (await c.query('INSERT INTO usuarios (tenant_id, nome, email, senha_hash, papel, equipe_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [tenant.id, nome, email, hash, papel, eq[equipe]])).rows[0];
      await auditar(c, ctx, { acao: 'usuario.teste_criado', entidade: 'usuario', entidadeId: u.id, depois: { email, papel } });
      criados++;
    }
    log(`Usuários de teste: ${criados} criado(s), ${atualizados} com a senha reaplicada.`);
    return { criados, atualizados };
  });
}

module.exports = { garantirUsuariosTeste, USUARIOS_TESTE };
