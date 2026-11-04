# Arquitetura — Sinapse (ERP Operacional Brobot)

Como o sistema está montado hoje. Mudou a forma? Atualize este arquivo na mesma mudança. Decisões e o porquê:
`DECISIONS.md`. Requisitos atendidos: `docs/RASTREABILIDADE.md`.

## Visão geral

Monólito modular (seção 11 da especificação): um processo Node.js com API HTTP, worker da fila de jobs e
supervisor; PostgreSQL como única fonte de verdade.

```
Navegador (PWA, JS puro)          Webhooks (WhatsApp/e-mail/portal/API)      Monitor externo
        │ cookie de sessão               │ x-sinapse-token                      │ /api/health/supervisor
        ▼                                ▼                                      ▼
server/http/servidor.js — rotas, sessão, permissão por rota, CSRF (origem), CSP, JSON ≤ 1 MB, erro padronizado
        │
        ├─ modulos/identidade    sessão (token aleatório, hash no banco), RBAC, substituto, personas da demo
        ├─ modulos/clientes      carteira, VIP, roteamento RN-001, pontos focais com histórico, bloqueio (recusado sem regra)
        ├─ modulos/entrada       inbox durável + deduplicação, identificação por telefone E.164, classificação, triagem
        ├─ modulos/ocorrencias   máquina de estados (pura), SLA por calendário (puro), handoff, tarefas, resposta no canal
        ├─ modulos/rodadas       pré-rodada D-4/D-3/ligação/D-1, pós-rodada D0/D+3, pendências, revalidação na Platform
        ├─ modulos/comunicacao   modelos versionados, consentimento/opt-out, janela de horário, retentativa, fallback
        ├─ modulos/supervisor    varredura de invariantes, escalonamento, handoff vencido, heartbeat, fila de falhas
        ├─ modulos/painel        indicadores da seção 13
        ├─ modulos/integracoes   portas + adaptadores de demonstração: Platform, OMIE (+ sincronização), WhatsApp/e-mail
        └─ modulos/demo          dados fictícios e simulador (só com SINAPSE_DEMO ligado)
        │
server/jobs/fila.js — fila durável no PostgreSQL (FOR UPDATE SKIP LOCKED), backoff, fila de falhas, recorrentes
server/db — adaptador pg | PGlite, `comoTenant` (RLS) / `sistema`, migrações versionadas com volta
```

Dependências entre módulos são só para **baixo** (rotas → serviço → banco; `rodadas`/`entrada`/`supervisor` usam
o serviço público de `ocorrencias`, `clientes` e `comunicacao`; nenhum usa SQL de tabela de outro módulo para
escrever, exceto o adaptador de demonstração da Platform, que lê a tabela do próprio simulador).

## Dados

Uma migração (`server/db/migracoes/001_fundacao.sql`, com `.down.sql`). Principais tabelas:

| Tabela | Papel |
| --- | --- |
| `tenants`, `equipes`, `usuarios`, `sessoes` | Organizações, filas (inclui Triagem e Contingência), pessoas, sessões |
| `contas`, `pontos_focais`, `credenciais_ref`, `status_financeiro` | Carteira; credencial só com status e referência; financeiro mínimo do OMIE |
| `entradas` | Inbox durável, único por (organização, origem, id do provedor) |
| `ocorrencias`, `ocorrencia_itens`, `ocorrencia_vinculos`, `interacoes`, `handoffs`, `tarefas` | Atendimento |
| `rodadas`, `pendencias`, `contatos_programados` | Pré e pós-rodada; pendência única por placa+erro enquanto aberta |
| `eventos` | Outbox com o contrato canônico (event_id, schema_version, aggregate, correlation, idempotency_key…) |
| `auditoria` | Só anexação (gatilho recusa UPDATE/DELETE) |
| `jobs`, `integracoes`, `divergencias`, `sistema` | Fila durável, saúde/checkpoint das integrações, reconciliação, heartbeat/relógio |

Invariantes garantidas **pelo banco** (CHECK): ocorrência ativa tem fila, prazo e próxima ação (RN-008); resolvida
tem evidência e encerrada sem resolução tem motivo (RN-009); tarefa tem fila (GOV-004); VIP tem critério e
aprovador; exceção de roteamento tem justificativa; pendência corrigida tem evidência.

## Segurança

- **Isolamento:** RLS em todas as tabelas de negócio; as transações de usuário rodam com `SET LOCAL ROLE
  sinapse_app` (sem privilégio de dono) e `app.tenant_id`. Pedido de id de outra organização = 404 + auditoria.
- **Sessão:** token aleatório de 32 bytes em cookie HttpOnly/SameSite=Lax (Secure em produção); no banco só o hash.
- **Permissão** por rota (`permissoes.js`); Financeiro vê detalhe financeiro, os demais só "atenção financeira".
- **CSRF:** POST exige JSON e origem igual ao host. **CSP** sem inline; front sem `innerHTML`.
- Webhook com token comparado em tempo constante. Nenhum segredo, senha ou certificado é guardado.

## Tempo, jobs e supervisor

Tudo que acontece "depois" é um job: `entrada.processar`, `rodada.pre_rodada` (D-4), `rodada.contato` (D-3,
intermediária, D-1, resultado, D+3), `rodada.executar` (D0), `comunicacao.enviar`, `omie.sincronizar` (10 min) e
`supervisor.varrer` (1 min). O ciclo do worker (2 s) só procura o que venceu. O relógio (`nucleo/relogio.js`) pode
ser adiantado na demonstração para mostrar a cadência inteira em minutos.

## Testes e publicação

`npm test` (`node:test`, servidor real; PGlite em memória ou `TESTE_DATABASE_URL`). CI:
`.github/workflows/sinapse.yml` roda nos dois motores. Publicação: Railway com `Dockerfile` e `railway.json`
(Root Directory `brobot/sinapse`; Volume em `/data` ou `DATABASE_URL`).

## Limites conhecidos (deficiências registradas)

- **Adaptadores reais** (Platform, OMIE, WhatsApp Cloud API, e-mail) não existem: dependem da documentação oficial
  e das pendências decisórias da seção 16. Consequência: a demonstração não conversa com sistemas reais.
- **Uma réplica:** o relógio da demonstração fica em memória por processo, e o PGlite tem uma conexão só. Para
  mais de uma réplica, usar `DATABASE_URL` e desligar o ajuste de relógio (`SINAPSE_DEMO=0`).
- **Outbox sem consumidor externo:** eventos são gravados com o contrato canônico, mas ainda não são publicados
  para fora (`publicado_em` fica nulo). Entra com a integração Comercial/Financeiro.
- **Fora desta fase:** onboarding/offboarding, CS (saúde da conta, treinamentos, campanhas), incidentes, base de
  conhecimento, anexos, LGPD (exportação/anonimização), MFA, OpenAPI/AsyncAPI publicados, edição de regras com
  simulação e rollback (SUP-010). Ver `docs/RASTREABILIDADE.md`.
- Listas da carteira e da triagem usam subconsultas por linha limitadas à página (25–30 linhas); medir antes de
  otimizar quando houver volume real.
