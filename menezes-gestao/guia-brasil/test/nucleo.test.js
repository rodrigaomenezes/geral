import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  distanciaM, rumo, diferencaAngular, proximos, decidirNarracao, candidatosFoto, responderLocal, validarPacote,
  INTERVALO_FREQUENCIA_MS, REPETICAO_MS,
} from '../public/js/nucleo.js';

const pacote = JSON.parse(readFileSync(new URL('../pacotes/salvador-centro-historico.json', import.meta.url), 'utf8'));
const poi = (id) => pacote.pois.find((p) => p.id === id);
const perto = (p, dLat = 0.0001) => ({ lat: p.lat + dLat, lng: p.lng, precisao: 10 }); // ~11 m ao norte

test('distância e rumo batem com valores conhecidos', () => {
  const a = { lat: 0, lng: 0 };
  assert.ok(Math.abs(distanciaM(a, { lat: 0, lng: 1 }) - 111195) < 10); // 1 grau no equador
  assert.equal(Math.round(rumo(a, { lat: 1, lng: 0 })), 0);
  assert.equal(Math.round(rumo(a, { lat: 0, lng: 1 })), 90);
  assert.equal(diferencaAngular(350, 10), 20);
  assert.equal(diferencaAngular(90, 270), 180);
});

test('pacote de Salvador é válido e o validador acusa problemas', () => {
  assert.deepEqual(validarPacote(pacote), []);
  const ruim = structuredClone(pacote);
  ruim.pois[1].id = ruim.pois[0].id;
  ruim.pois[2].lat = 200;
  delete ruim.pois[3].narrativa.curto;
  const erros = validarPacote(ruim);
  assert.ok(erros.some((e) => e.includes('id repetido')));
  assert.ok(erros.some((e) => e.includes('coordenada inválida')));
  assert.ok(erros.some((e) => e.includes('narrativa.curto')));
  assert.deepEqual(validarPacote(null), ['pacote ausente']);
});

test('proximos ordena por distância e respeita o limite', () => {
  const pos = perto(poi('elevador-lacerda'));
  const lista = proximos(pacote.pois, pos, 200);
  assert.equal(lista[0].poi.id, 'elevador-lacerda');
  assert.ok(lista.every((x, i) => i === 0 || x.distancia >= lista[i - 1].distancia));
  assert.ok(lista.every((x) => x.distancia <= 200));
  assert.deepEqual(proximos(pacote.pois, null), []);
});

test('narração: dispara perto, não repete, respeita frequência e precisão do GPS', () => {
  const agora = 1_000_000_000;
  const pos = perto(poi('mercado-modelo'));
  const r = decidirNarracao({ pois: pacote.pois, pos, agora });
  assert.equal(r.poi.id, 'mercado-modelo');

  // já narrado há pouco: pula para o próximo dentro do raio ou nada
  const estado = { narrados: { 'mercado-modelo': agora - 1000 }, ultimaNarracao: agora - INTERVALO_FREQUENCIA_MS.normal - 1 };
  const r2 = decidirNarracao({ pois: pacote.pois, pos, estado, agora });
  assert.ok(!r2 || r2.poi.id !== 'mercado-modelo');

  // depois de REPETICAO_MS pode narrar de novo
  const estado3 = { narrados: { 'mercado-modelo': agora - REPETICAO_MS - 1 }, ultimaNarracao: 0 };
  assert.equal(decidirNarracao({ pois: pacote.pois, pos, estado: estado3, agora }).poi.id, 'mercado-modelo');

  // intervalo da frequência ainda não passou
  assert.equal(decidirNarracao({ pois: pacote.pois, pos, estado: { ultimaNarracao: agora - 1000 }, agora }), null);
  assert.ok(decidirNarracao({ pois: pacote.pois, pos, estado: { ultimaNarracao: agora - 25000 }, frequencia: 'muito', agora }));

  // GPS impreciso ou longe de tudo: silêncio
  assert.equal(decidirNarracao({ pois: pacote.pois, pos: { ...pos, precisao: 150 }, agora }), null);
  assert.equal(decidirNarracao({ pois: pacote.pois, pos: { lat: -12.99, lng: -38.53 }, agora }), null);
});

test('foto offline: escolhe o ponto para onde a câmera aponta', () => {
  // De pé no Terreiro de Jesus, olhando para a Catedral (sudeste) e depois para o Museu (noroeste)
  const pos = { lat: poi('terreiro-de-jesus').lat, lng: poi('terreiro-de-jesus').lng };
  const paraCatedral = rumo(pos, poi('catedral-basilica'));
  const paraMuseu = rumo(pos, poi('museu-afro-brasileiro'));
  assert.equal(candidatosFoto({ pois: pacote.pois, pos, direcao: paraCatedral })[0].poi.id, 'catedral-basilica');
  assert.equal(candidatosFoto({ pois: pacote.pois, pos, direcao: paraMuseu })[0].poi.id, 'museu-afro-brasileiro');
  // sem bússola, ainda devolve candidatos por distância
  assert.ok(candidatosFoto({ pois: pacote.pois, pos, direcao: null }).length > 0);
  // longe de tudo, nada
  assert.deepEqual(candidatosFoto({ pois: pacote.pois, pos: { lat: -13.1, lng: -38.6 } }), []);
});

test('resposta local usa perguntas frequentes, foco e recusa o que não sabe', () => {
  const r = responderLocal(pacote, 'Quando o elevador foi construído?', 'elevador-lacerda');
  assert.equal(r.poiId, 'elevador-lacerda');
  assert.match(r.texto, /1873/);
  assert.match(responderLocal(pacote, 'o que significa pelourinho').texto, /castigos/);
  assert.match(responderLocal(pacote, 'O QUE É ACARAJÉ?').texto, /feijão-fradinho/);
  // a mesma pergunta genérica responde sobre o ponto em foco
  assert.equal(responderLocal(pacote, 'quando foi construída?', 'catedral-basilica').poiId, 'catedral-basilica');
  assert.equal(responderLocal(pacote, 'qual a cotação do dólar hoje'), null);
  assert.equal(responderLocal(pacote, '   '), null);
});
