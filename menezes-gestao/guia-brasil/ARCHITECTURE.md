# Arquitetura — GuIA Brasil (MVP)

```
Celular (PWA)                                      Servidor (Node, sem framework)
┌───────────────────────────────┐                  ┌───────────────────────────────┐
│ app.js      telas, voz, rede  │── GET pacote ──▶ │ pacotes.js  lê e valida JSON  │
│ sensores.js GPS, bússola, sim │── POST conversa ▶│ guia.js     IA ou motor local │──▶ Claude (opcional)
│ estado.js   localStorage      │── POST foto ───▶ │ server.js   rotas, limites    │
│ nucleo.js   REGRAS (comum)  ◀─┼── mesmo arquivo ─┼▶ nucleo.js                   │
│ sw.js       casca offline     │── POST feedback ▶│ dados/feedback.jsonl          │
└───────────────────────────────┘                  └───────────────────────────────┘
```

## Módulos e limites

| Módulo | Responsabilidade | Não faz |
|---|---|---|
| `public/js/nucleo.js` | Regras puras: distância, rumo, quem está perto, foto offline, resposta local, validação do pacote e o **companheiro de caminhada** (trajeto, direção, próximo alerta, resumo) | Rede, DOM, armazenamento |
| `public/js/sensores.js` | GPS, simulação de caminhada, bússola | Decidir o que narrar |
| `public/js/estado.js` | Preferências, pacote baixado, conversa, fila de pendências (localStorage, com queda para memória) | Regras |
| `public/js/app.js` | Telas, voz, tela acesa (Wake Lock), chamadas à API, fila | Regras (chama o núcleo) |
| `public/sw.js` | Guarda a casca do app para abrir offline | Guardar POST, pacotes |
| `server/pacotes.js` | Carrega e valida pacotes, ETag | — |
| `server/guia.js` | Conversa e foto: motor `ia` (Claude) com queda para `local` | HTTP |
| `server/server.js` | Rotas, validação de entrada, limite por IP, arquivos estáticos | Regras de guia |

O núcleo é o **mesmo arquivo** no app e no servidor: o que o app responde offline é o que o servidor responde sem IA,
e os testes cobrem os dois de uma vez.

## Contratos

### Pacote de viagem (`pacotes/*.json`, `versao: 1`)
`{ versao, id, nome, cidade, pais, idioma, atualizadoEm, centro:{lat,lng}, rotaDemonstracao:[poiId], pois:[…], perguntasGerais:[{p,r,chaves}] }`
POI: `{ id (a-z0-9-), nome, categoria, lat, lng, raioM, teaser?, narrativa:{curto,medio,longo}, curiosidades:[], perguntas:[{p,r,chaves}] }`.
`teaser` = chamada de uma frase usada no "Logo à frente" (sem ele, usa a primeira curiosidade).
Aviso (opcional, `avisos:[…]`): `{ id, tipo:'importante'|'dica'|'novidade', titulo?, lat, lng, raioM, texto }`. Ids de avisos e
pontos não podem se repetir. Campos opcionais: pacotes antigos continuam válidos sem mudar a `versao`.
Validado ao subir o servidor (`validarPacote`); pacote inválido impede o boot. Mudança incompatível = nova `versao`
(o app ignora pacote guardado com versão diferente e pede novo download).

### API
| Rota | Entrada | Saída |
|---|---|---|
| `GET /api/health` | — | `{ ok, ia, modelo, pacotes }` |
| `GET /api/pacotes` | — | `[{ id, nome, cidade, pais, idioma, atualizadoEm, pontos, bytes, versao }]` |
| `GET /api/pacotes/:id` | `If-None-Match` | pacote (ETag) ou 304 |
| `POST /api/conversa` | `{ pacoteId, mensagem ≤600, pos?, poiId?, historico? ≤8, nivel? }` | `{ texto, poiId, motor:'ia'|'local', modelo?, confianca?, semResposta?, erroIa? }` |
| `POST /api/foto` | `{ pacoteId, imagem: dataURL jpeg/png/webp ≤5 MB, pos?, direcao?, pergunta? }` | `{ identificado, poiId, titulo, explicacao, curiosidades[≤3], alternativas, motor, erroIa? }` |
| `POST /api/feedback` | `{ id (idempotência), pacoteId, tipo:'util'|'errado', poiId?, motor?, resposta?, comentario? }` | 204 |

Erros: `{ erro }` com 400 (entrada), 404, 413 (tamanho), 429 (limite por IP: 40 chamadas de IA a cada 10 min).

## Companheiro de caminhada

```
GPS / simulação ──▶ anexarAoTrajeto ──▶ rumoDaCaminhada ──▶ proximoAlerta ──▶ fala + cartão ──▶ registrarAlerta
                    (ignora ruído <4 m      (últimos 40 m)     (prioridade e          (vibração por tipo)
                     e GPS >50 m)                               intervalos)
```

| Alerta | Quando | Intervalo |
|---|---|---|
| Importante | Dentro do raio de um aviso `importante` | fura a fila; 15 s entre importantes |
| Você chegou | Dentro do raio de um ponto não visitado nas últimas 6 h | frequência (pouca 4 min, normal 45 s, muita 15 s) |
| Logo à frente | Ponto a até 200 m, dentro de ±65° da direção em que a pessoa anda | frequência |
| Dica / Novidade | Dentro do raio de um aviso `dica` ou `novidade` | 20 s desde a última fala |

O app não decide nada enquanto ainda está falando. Estado por pacote em `companheiro.<pacoteId>` no aparelho.

## Dados guardados
- **No aparelho:** preferências, pacote, conversa (últimas 60), estado do companheiro, trajeto (até 600 pontos), fila (até 20 itens, 4 fotos).
  A rota do usuário não sai do aparelho; o servidor só recebe a posição junto da pergunta ou foto.
- **No servidor:** só `feedback.jsonl` (append). Fotos e perguntas não são gravadas.
