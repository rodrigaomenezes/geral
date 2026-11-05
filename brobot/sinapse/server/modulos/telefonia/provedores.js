'use strict';
// Provedores de telefonia (portados do Lumen Operações). O núcleo só conhece esta interface, nunca uma operadora:
//   pronto(cfg, ramal) → { ok, motivo }   ·   sessao(cfg, ramal, usuario) → o que o navegador precisa para ligar
//   discar(numero, cfg) → número no formato da operadora   ·   recursos → o que o provedor suporta
const { decifrar } = require('../../nucleo/cifra');

/** Número no formato que a operadora espera (guardado como +55 DDD número). */
function numeroParaDiscar(numero, cfg = {}) {
  const n = String(numero).replace(/\D/g, '');
  const br = n.startsWith('55') && (n.length === 12 || n.length === 13);
  let d = n;
  if (cfg.formato_numero === 'e164') d = `+${n}`;
  else if (cfg.formato_numero === '0ddd') d = br ? `0${n.slice(2)}` : `00${n}`;
  else if (cfg.formato_numero === 'ddd') d = br ? n.slice(2) : `00${n}`;
  return (cfg.prefixo || '') + d;
}

const PROVEDORES = {
  // Ligação simulada no navegador: treinar a equipe e apresentar sem custo.
  treino: {
    id: 'treino', nome: 'Modo de treino', canal: 'computador', recursos: { espera: true, dtmf: true },
    pronto: () => ({ ok: true }), sessao: () => ({ modo: 'treino' }), discar: numeroParaDiscar,
  },
  // Qualquer operadora com SIP sobre WebSocket seguro (WSS/WebRTC): Nvoip, Api4Com, Zenvia, 55PBX, Directcall…
  sip: {
    id: 'sip', nome: 'Operadora VoIP (SIP/WebRTC)', canal: 'computador', recursos: { espera: true, dtmf: true },
    pronto(cfg, ramal) {
      if (!cfg.ws_url || !cfg.dominio) return { ok: false, motivo: 'Falta configurar a operadora VoIP (Telefonia → Configuração).' };
      if (!ramal || !ramal.ativo || !ramal.senha_cifrada) return { ok: false, motivo: 'Você ainda não tem ramal. Peça à gestão para cadastrar o seu.' };
      return { ok: true };
    },
    // Credencial do ramal: só para o dono e só na hora de registrar o navegador.
    sessao(cfg, ramal, usuario) {
      return { modo: 'sip', ws_url: cfg.ws_url, dominio: cfg.dominio, usuario: ramal.usuario_sip, senha: decifrar(ramal.senha_cifrada),
        nome: ramal.nome_exibicao || usuario.nome, ice_servers: String(cfg.ice_servers || '').split(/\n+/).map((x) => x.trim()).filter(Boolean) };
    },
    discar: numeroParaDiscar,
  },
  // Chip do próprio atendente: o sistema abre o discador do aparelho e pede o resultado no fim.
  celular: {
    id: 'celular', nome: 'Celular do atendente', canal: 'celular', recursos: { espera: false, dtmf: false },
    pronto: () => ({ ok: true }), sessao: () => null, discar: (numero) => `+${String(numero).replace(/\D/g, '')}`,
  },
};

module.exports = { PROVEDORES, numeroParaDiscar };
