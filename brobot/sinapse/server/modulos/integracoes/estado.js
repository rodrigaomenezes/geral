'use strict';
// Saúde das integrações (Platform, OMIE, WhatsApp, e-mail): disponibilidade, checkpoint e falhas consecutivas.
// Em demonstração a disponibilidade pode ser desligada no simulador para provar AT-005/AT-006/AT-007.

class ErroIntegracao extends Error {
  constructor(nome, message) { super(message); this.integracao = nome; }
}

const NOMES = { platform: 'Platform Brobot', omie: 'OMIE', whatsapp: 'WhatsApp', email: 'E-mail' };

async function exigirDisponivel(c, nome) {
  const r = (await c.query('SELECT disponivel FROM integracoes WHERE nome = $1', [nome])).rows[0];
  if (r && !r.disponivel) throw new ErroIntegracao(nome, `${NOMES[nome]} indisponível no momento.`);
}

async function registrarSucesso(c, nome, checkpoint) {
  await c.query(
    `UPDATE integracoes SET ultima_sincronizacao = now(), ultimo_erro = NULL, falhas_consecutivas = 0,
       checkpoint = CASE WHEN $2::jsonb IS NULL THEN checkpoint ELSE checkpoint || $2::jsonb END
     WHERE nome = $1`,
    [nome, checkpoint ? JSON.stringify(checkpoint) : null],
  );
}

async function registrarFalha(c, nome, mensagem) {
  await c.query('UPDATE integracoes SET ultimo_erro = $2, falhas_consecutivas = falhas_consecutivas + 1 WHERE nome = $1',
    [nome, String(mensagem).slice(0, 300)]);
}

module.exports = { ErroIntegracao, NOMES, exigirDisponivel, registrarSucesso, registrarFalha };
