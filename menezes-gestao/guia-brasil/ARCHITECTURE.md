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
| `public/js/nucleo.js` | Regras puras: distância, rumo, quem está perto, quando narrar, foto offline, resposta local, validação do pacote | Rede, DOM, armazenamento |
| `public/js/sensores.js` | GPS, simulação de caminhada, bússola | Decidir o que narrar |
| `public/js/estado.js` | Preferências, pacote baixado, conversa, fila de pendências (localStorage, com queda para memória) | Regras |
| `public/js/app.js` | Telas, voz, chamadas à API, fila | Regras (chama o núcleo) |
| `public/sw.js` | Guarda a casca do app para abrir offline | Guardar POST, pacotes |
| `server/pacotes.js` | Carrega e valida pacotes, ETag | — |
| `server/guia.js` | Conversa e foto: motor `ia` (Claude) com queda para `local` | HTTP |
| `server/server.js` | Rotas, validação de entrada, limite por IP, arquivos estáticos | Regras de guia |

O núcleo é o **mesmo arquivo** no app e no servidor: o que o app responde offline é o que o servidor responde sem IA,
e os testes cobrem os dois de uma vez.

## Contratos

### Pacote de viagem (`pacotes/*.json`, `versao: 1`)
`{ versao, id, nome, cidade, pais, idioma, atualizadoEm, centro:{lat,lng}, rotaDemonstracao:[poiId], pois:[…], perguntasGerais:[{p,r,chaves}] }`
POI: `{ id (a-z0-9-), nome, categoria, lat, lng, raioM, narrativa:{curto,medio,longo}, curiosidades:[], perguntas:[{p,r,chaves}] }`.
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

## Dados guardados
- **No aparelho:** preferências, pacote, conversa (últimas 60), pontos já narrados, fila (até 20 itens, 4 fotos).
  A rota do usuário não sai do aparelho; o servidor só recebe a posição junto da pergunta ou foto.
- **No servidor:** só `feedback.jsonl` (append). Fotos e perguntas não são gravadas.
