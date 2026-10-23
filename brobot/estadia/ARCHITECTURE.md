# Arquitetura — Estadia BR

Como o sistema está montado hoje. Mudou a forma? Atualize este arquivo na mesma mudança. Decisões e o porquê:
`DECISIONS.md`. Visão de produto e uso: `README.md`.

## Visão geral

```
App do motorista (PWA ou Android fino) · Portal das empresas · Link de confirmação (WhatsApp/SMS)
        │  HTTPS, token assinado (HMAC), SSE para tempo real
        ▼
server/server.js (node:http) ── rotas, estáticos, página pública do link, SSE
        ├─ domain.js     regras puras: marcos, status, permissões, apuração (regra versionada), conciliação, deslocamento
        ├─ cadastros.js  composições, veículos, carrocerias, tipos de carga; validação do conjunto
        ├─ auth.js       Directory: organizações, usuários (scrypt), frota; sessão assinada
        ├─ store.js      EventStore: log só de anexação com cadeia de hash; fotos por hash; links; dossiês
        ├─ whatsapp.js   envio (manual / API oficial / simulado), webhook com assinatura, leitura de SIM/NÃO/OK
        ├─ visao.js      conferência de fotos (regras + IA opcional com ANTHROPIC_API_KEY)
        ├─ amelia.js     texto/voz → dados estruturados (determinístico)
        ├─ arquivo.js    gravação atômica dos arquivos de estado
        └─ seed.js       dados de demonstração
```

O estado de cada operação é **projetado dos eventos** (`D.project(store.forOp(opId))`); nada é guardado já
calculado. Um processo, uma réplica.

## Dados (pasta `ESTADIA_DATA`, no Railway o Volume `/data`)

| Arquivo | Conteúdo | Como muda |
| --- | --- | --- |
| `events.jsonl` | Eventos imutáveis, cada um com o hash do anterior | Só anexação (`appendFileSync`) |
| `photos/` | Fotos e áudios nomeados pelo próprio hash | Escrita única |
| `links.json` | Tokens dos links de confirmação (no log vai só o hash) | Gravação atômica |
| `dossies/` | Dossiês gerados (por hash, com versões) | Gravação atômica |
| `directory.json` | Organizações, usuários, veículos, implementos, conjuntos; marca `demonstracao` quando semeado | Gravação atômica; cada cadastro também gera evento |
| `secret.key` | Chave de sessão quando `ESTADIA_SECRET` não existe | Criada uma vez |

Integridade da cadeia: `GET /api/admin/integrity`.

## Segurança

Perfis: motorista (TAC), transportadora, embarcador/destinatário, jurídico, administração. Cada organização vê só as
operações em que participa. Webhook do WhatsApp validado pela assinatura (`WHATSAPP_APP_SECRET`). Reinício da
demonstração só para administrador e só com `ESTADIA_DEMO_RESET` diferente de `0`.

## Testes e publicação

`npm test` (`node:test`, servidor real com pasta temporária). CI: `.github/workflows/estadia.yml` (na raiz do
repositório). Publicação: Railway com `Dockerfile` e `railway.json` (Volume em `/data`). `render.yaml` na raiz é
antigo (dados em `/tmp`): não usar.

## Limites conhecidos

Ver "Deficiências encontradas" em `../../docs/POLITICA_ENGENHARIA.md` (varredura do log por consulta, `server.js`
grande, sem versão de formato nos dados).
