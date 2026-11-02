// Catálogo de pacotes de viagem: lê os JSON da pasta `pacotes/`, valida o formato e serve com ETag.
// O pacote é o contrato entre servidor e app (formato em ARCHITECTURE.md, versão em VERSAO_PACOTE).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validarPacote } from '../public/js/nucleo.js';

export function carregarPacotes(pasta) {
  const mapa = new Map();
  for (const nome of readdirSync(pasta).filter((f) => f.endsWith('.json')).sort()) {
    const bruto = readFileSync(join(pasta, nome), 'utf8');
    const pacote = JSON.parse(bruto);
    const erros = validarPacote(pacote);
    if (erros.length) throw new Error(`Pacote ${nome} inválido: ${erros.join('; ')}`);
    const corpo = JSON.stringify(pacote);
    const etag = `"${createHash('sha256').update(corpo).digest('hex').slice(0, 16)}"`;
    mapa.set(pacote.id, { pacote, corpo, etag, bytes: Buffer.byteLength(corpo) });
  }
  return mapa;
}

/** Resumo para a lista de destinos (sem o conteúdo). */
export function resumo({ pacote, etag, bytes }) {
  return { id: pacote.id, nome: pacote.nome, cidade: pacote.cidade, pais: pacote.pais, idioma: pacote.idioma,
    atualizadoEm: pacote.atualizadoEm, pontos: pacote.pois.length, bytes, versao: etag };
}
