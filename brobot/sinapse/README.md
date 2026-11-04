# Sinapse · ERP Operacional Brobot

Gestão do trabalho interno de **Operações, Suporte e Customer Success** da Brobot: entrada omnicanal, triagem,
ocorrências com máquina de estados e SLA, transferências com aceite, pré-rodada (D-4 → D-3 → ligação → D-1),
pós-rodada (D0 → D+3), carteira com VIP e pontos focais, supervisor independente e auditoria completa.
A Platform Brobot continua dona das consultas e o OMIE, do financeiro: o Sinapse conversa com os dois por
adaptadores (hoje em modo demonstração).

**Fase 1 · demonstração.** Os dados são fictícios e o simulador reproduz os cenários de aceite da especificação.

## Rodar no computador

```bash
npm install
npm start          # http://localhost:3000 — cria o banco embutido em ./data/pg e a demonstração
npm test           # 27 testes: matriz de aceite AT-001 a AT-016 + regras
```

Com PostgreSQL próprio: `DATABASE_URL=postgres://... npm start`. Testes contra um PostgreSQL de teste (o schema é
apagado): `TESTE_DATABASE_URL=postgres://... npm test`.

## Publicar no Railway

1. **New Service → GitHub Repo → `rodrigaomenezes/geral`**, branch publicada.
2. **Settings → Root Directory:** `brobot/sinapse` (o `railway.json` e o `Dockerfile` desta pasta são usados;
   `watchPatterns` faz só mudanças desta pasta publicarem).
3. **Banco** (escolha um):
   - **Volume** com mount path `/data` (PostgreSQL embutido, como o Estadia) — mais simples para a demonstração; ou
   - serviço **PostgreSQL** do Railway e a variável `DATABASE_URL=${{Postgres.DATABASE_URL}}` — recomendado para
     uso real (backup e restauração do provedor).
4. **Settings → Networking → Generate Domain.** Healthcheck: `/api/health`.

### Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | uma das duas | PostgreSQL gerenciado |
| `SINAPSE_DATA` | uma das duas | Pasta do banco embutido (o Dockerfile já define `/data/pg`) |
| `SINAPSE_DEMO` | não | `0` desliga login por persona, simulador e reinício (use em produção real) |
| `SINAPSE_TOKEN_ENTRADA` | não | Token (24+ caracteres) do webhook `POST /api/entrada/{organização}/{canal}`; sem ele, a rota fica desligada |
| `SINAPSE_SENHA_ADMIN` | não | Senha (12+) do `admin@sinapse.demo`, usada só ao criar a demonstração |

Monitor externo (ex.: UptimeRobot) em `/api/health/supervisor`: responde 503 se o supervisor parar.

## Como apresentar

Roteiro de 15 minutos em [`docs/ROTEIRO_APRESENTACAO.md`](docs/ROTEIRO_APRESENTACAO.md). Mapa dos requisitos:
[`docs/RASTREABILIDADE.md`](docs/RASTREABILIDADE.md). Como está montado: [`ARCHITECTURE.md`](ARCHITECTURE.md).
