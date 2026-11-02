import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  anexarAoTrajeto, rumoDaCaminhada, ladoRelativo, proximoAlerta, registrarAlerta, resumoCaminhada, validarPacote,
  rumo, distanciaM, INTERVALO_FREQUENCIA_MS, INTERVALO_IMPORTANTE_MS,
} from '../public/js/nucleo.js';

const pacote = JSON.parse(readFileSync(new URL('../pacotes/salvador-centro-historico.json', import.meta.url), 'utf8'));
const poi = (id) => pacote.pois.find((p) => p.id === id);
const T0 = 1_700_000_000_000;

/** Pacote mínimo e controlado para testar regras sem depender do conteúdo real. */
const base = {
  versao: 1, id: 't', nome: 'T', cidade: 'T', idioma: 'pt-BR', centro: { lat: 0, lng: 0 },
  pois: [
    { id: 'norte', nome: 'Torre Norte', lat: 0.0015, lng: 0, raioM: 50, teaser: 'Uma torre com história curiosa.', narrativa: { curto: 'Texto curto da torre.', medio: 'Texto médio da torre norte.', longo: 'Texto longo da torre norte aqui.' } },
    { id: 'sul', nome: 'Igreja Sul', lat: -0.0015, lng: 0, raioM: 50, narrativa: { curto: 'Texto curto da igreja.', medio: 'Texto médio da igreja sul.', longo: 'Texto longo da igreja sul aqui.' }, curiosidades: ['Curiosidade da igreja.'] },
  ],
  avisos: [
    { id: 'ladeira', tipo: 'importante', lat: 0, lng: 0, raioM: 30, texto: 'Ladeira íngreme a partir daqui.' },
    { id: 'feira', tipo: 'dica', lat: 0.0004, lng: 0, raioM: 30, texto: 'Aqui perto tem uma feira aos sábados.' },
  ],
};
const andarParaNorte = (n, passoGrau = 0.0001, t = T0) => Array.from({ length: n }, (_, i) => ({ lat: -0.0003 + i * passoGrau, lng: 0, t: t + i * 5000 }));

test('trajeto ignora ruído, GPS impreciso e limita o tamanho', () => {
  let tr = [];
  tr = anexarAoTrajeto(tr, { lat: 0, lng: 0 }, T0);
  tr = anexarAoTrajeto(tr, { lat: 0.00001, lng: 0 }, T0 + 1); // ~1 m: ruído
  tr = anexarAoTrajeto(tr, { lat: 0.001, lng: 0, precisao: 120 }, T0 + 2); // impreciso
  assert.equal(tr.length, 1);
  tr = anexarAoTrajeto(tr, { lat: 0.0001, lng: 0 }, T0 + 3);
  assert.equal(tr.length, 2);
  let longo = [];
  for (let i = 0; i < 50; i += 1) longo = anexarAoTrajeto(longo, { lat: i * 0.0001, lng: 0 }, T0 + i, 10);
  assert.equal(longo.length, 10);
});

test('direção da caminhada e lado relativo', () => {
  assert.equal(rumoDaCaminhada([]), null);
  assert.equal(rumoDaCaminhada([{ lat: 0, lng: 0 }, { lat: 0.00005, lng: 0 }]), null); // ~5 m
  assert.equal(Math.round(rumoDaCaminhada(andarParaNorte(6))), 0);
  assert.equal(ladoRelativo(0, 10), 'à frente');
  assert.equal(ladoRelativo(0, 90), 'à direita');
  assert.equal(ladoRelativo(350, 280), 'à esquerda');
  assert.equal(ladoRelativo(0, 180), 'atrás de você');
  assert.equal(ladoRelativo(null, 10), null);
});

test('anuncia o ponto que está logo à frente, não o que ficou para trás', () => {
  const pos = { lat: 0, lng: 0.0006 }; // fora do aviso de ladeira (raio 30 m)
  const a = proximoAlerta({ pacote: base, pos, rumoCaminhada: 0, agora: T0 });
  assert.equal(a.tipo, 'a-caminho');
  assert.equal(a.id, 'norte');
  assert.match(a.texto, /à frente: Torre Norte\. Uma torre com história curiosa\./);
  // andando para o sul, quem aparece é a igreja (com a curiosidade como chamada)
  const b = proximoAlerta({ pacote: base, pos, rumoCaminhada: 180, agora: T0 });
  assert.equal(b.id, 'sul');
  assert.match(b.texto, /Curiosidade da igreja/);
  // sem direção conhecida, não chuta
  assert.equal(proximoAlerta({ pacote: base, pos, rumoCaminhada: null, agora: T0 }), null);
});

test('prioridade: importante > chegada > logo à frente > dica', () => {
  const noAviso = proximoAlerta({ pacote: base, pos: { lat: 0, lng: 0 }, rumoCaminhada: 0, agora: T0 });
  assert.equal(noAviso.tipo, 'importante');
  const chegando = proximoAlerta({ pacote: base, pos: { lat: 0.0013, lng: 0 }, rumoCaminhada: 0, agora: T0 });
  assert.equal(chegando.tipo, 'chegada');
  assert.equal(chegando.id, 'norte');
  // na feira, com a torre já anunciada: a dica aparece
  const estado = registrarAlerta({}, { tipo: 'a-caminho', id: 'norte' }, T0 - INTERVALO_FREQUENCIA_MS.normal - 1);
  const feira = proximoAlerta({ pacote: base, pos: { lat: 0.0004, lng: 0 }, rumoCaminhada: 0, estado, agora: T0 });
  assert.equal(feira.tipo, 'dica');
});

test('não repete, respeita a frequência e o importante fura a fila', () => {
  const pos = { lat: 0, lng: 0.0006 };
  let estado = registrarAlerta({}, proximoAlerta({ pacote: base, pos, rumoCaminhada: 0, agora: T0 }), T0);
  // logo depois: nada (frequência), mesmo andando
  assert.equal(proximoAlerta({ pacote: base, pos: { lat: 0.0003, lng: 0.0006 }, rumoCaminhada: 0, estado, agora: T0 + 1000 }), null);
  // o importante fala mesmo dentro do intervalo
  const imp = proximoAlerta({ pacote: base, pos: { lat: 0, lng: 0 }, rumoCaminhada: 0, estado, agora: T0 + 1000 });
  assert.equal(imp.tipo, 'importante');
  estado = registrarAlerta(estado, imp, T0 + 1000);
  // e não repete
  assert.equal(proximoAlerta({ pacote: base, pos: { lat: 0, lng: 0 }, rumoCaminhada: 0, estado, agora: T0 + 1000 + INTERVALO_IMPORTANTE_MS + 1 }), null);
  // a torre já anunciada não é anunciada de novo, mas a CHEGADA nela ainda acontece
  const depois = T0 + INTERVALO_FREQUENCIA_MS.normal + 1;
  assert.equal(proximoAlerta({ pacote: base, pos, rumoCaminhada: 0, estado, agora: depois }), null);
  const chegada = proximoAlerta({ pacote: base, pos: { lat: 0.0014, lng: 0 }, rumoCaminhada: 0, estado, agora: depois });
  assert.equal(chegada.tipo, 'chegada');
  // GPS impreciso: silêncio
  assert.equal(proximoAlerta({ pacote: base, pos: { lat: 0.0014, lng: 0, precisao: 200 }, rumoCaminhada: 0, agora: depois }), null);
});

test('registrarAlerta não altera o estado original', () => {
  const original = { narrados: { a: 1 } };
  const novo = registrarAlerta(original, { tipo: 'chegada', id: 'b' }, 5);
  assert.deepEqual(original, { narrados: { a: 1 } });
  assert.deepEqual(novo.narrados, { a: 1, b: 5 });
  assert.equal(novo.ultimaNarracao, 5);
});

test('resumo da caminhada soma distância, tempo e lugares desde o início', () => {
  const tr = andarParaNorte(11); // 10 passos de ~11 m
  const estado = { narrados: { x: T0 + 1, y: T0 - 999 } };
  const r = resumoCaminhada(tr, estado, T0);
  assert.ok(Math.abs(r.metros - 111) <= 2, `metros: ${r.metros}`);
  assert.equal(r.duracao, 50000);
  assert.equal(r.lugares, 1);
});

/** Caminha a rota de demonstração inteira a 1,3 m/s (8 m a cada 6 s) e devolve os alertas e o estado final. */
function caminharRota(frequencia) {
  const pts = pacote.rotaDemonstracao.map(poi);
  let trajeto = [], estado = {}, t = T0;
  const alertas = [];
  for (let k = 0; k < pts.length - 1; k += 1) {
    const de = pts[k], para = pts[k + 1];
    const n = Math.max(4, Math.round(distanciaM(de, para) / 8));
    for (let i = 0; i <= n; i += 1) {
      const pos = { lat: de.lat + (para.lat - de.lat) * (i / n), lng: de.lng + (para.lng - de.lng) * (i / n), precisao: 8 };
      t += 6000;
      trajeto = anexarAoTrajeto(trajeto, pos, t);
      const a = proximoAlerta({ pacote, pos, rumoCaminhada: rumoDaCaminhada(trajeto), estado, frequencia, agora: t });
      if (a) { alertas.push(`${a.tipo}:${a.id}`); estado = registrarAlerta(estado, a, t); }
    }
  }
  return { alertas, estado, trajeto };
}

test('rota de Salvador no modo normal: todos os pontos e avisos, sem repetir', () => {
  const { alertas, estado, trajeto } = caminharRota('normal');
  assert.equal(Object.keys(estado.narrados).length, pacote.pois.length, alertas.join(' | '));
  assert.equal(Object.keys(estado.avisos).length, pacote.avisos.length, alertas.join(' | '));
  assert.equal(new Set(alertas).size, alertas.length);
  assert.ok(alertas.some((a) => a.startsWith('a-caminho:')), 'anuncia pontos antes de chegar');
  const r = resumoCaminhada(trajeto, estado, T0);
  assert.equal(r.lugares, pacote.pois.length);
  assert.ok(r.metros > 1000 && r.metros < 1600, `metros: ${r.metros}`);
  // "pouco" fala bem menos, mas não pula os avisos importantes
  const pouco = caminharRota('pouco');
  assert.ok(pouco.alertas.length < alertas.length / 2);
  assert.ok(pouco.alertas.includes('importante:aviso-mirante-elevador'));
});

test('pacote real: avisos e chamadas válidos; trecho Mercado → Elevador narra os dois sem repetir', () => {
  assert.deepEqual(validarPacote(pacote), []);
  assert.ok(pacote.avisos.length >= 3);
  assert.ok(pacote.pois.every((p) => p.teaser), 'todo ponto tem chamada');
  const ruim = structuredClone(pacote);
  ruim.avisos[0].tipo = 'fofoca';
  ruim.avisos[1].id = ruim.pois[0].id;
  const erros = validarPacote(ruim);
  assert.ok(erros.some((e) => e.includes('tipo deve ser')));
  assert.ok(erros.some((e) => e.includes('id repetido')));

  // Caminha em linha reta do Mercado Modelo até o Elevador Lacerda
  const de = poi('mercado-modelo'), para = poi('elevador-lacerda');
  let trajeto = [], estado = {}, t = T0;
  const alertas = [];
  for (let i = 0; i <= 20; i += 1) {
    const f = i / 20;
    const pos = { lat: de.lat + (para.lat - de.lat) * f, lng: de.lng + (para.lng - de.lng) * f, precisao: 8 };
    t += 30000; // passos lentos: 30 s
    trajeto = anexarAoTrajeto(trajeto, pos, t);
    const a = proximoAlerta({ pacote, pos, rumoCaminhada: rumoDaCaminhada(trajeto), estado, agora: t });
    if (a) { alertas.push(`${a.tipo}:${a.id}`); estado = registrarAlerta(estado, a, t); }
  }
  assert.equal(alertas[0], 'chegada:mercado-modelo');
  assert.ok(alertas.includes('chegada:elevador-lacerda'));
  // nenhum alerta repetido
  assert.equal(new Set(alertas).size, alertas.length);
  assert.ok(distanciaM(de, para) > 100 && Number.isFinite(rumo(de, para)));
});
