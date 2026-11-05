# Diagnóstico — Sinapse (05/11/2026)

**Raiz:** `rodrigaomenezes/geral`, pasta `brobot/sinapse`. **Branch:** `claude/keen-albattani-fpgfyt` (base: merge da PR 13,
`d87e5ed`). Fontes lidas: CLAUDE.md, ARCHITECTURE.md, DECISIONS.md, README.md, RASTREABILIDADE.md, migrações 001–006,
módulos, rotas, telas e testes; a especificação v1.0 e a ata da reunião de 03/11 (arquivos do solicitante, **não
versionados**: repositório público). As seis fotos manuscritas foram vistas na conversa, mas não estão salvas como
arquivo (DP-12).

## Inventário
- **Servidor:** Node 22, `node:http`, CommonJS, 15 grupos de rotas (`server/app.js` `ROTAS`), ~9,2 mil linhas no total.
- **Módulos:** identidade, clientes, entrada, ocorrências (máquina de estados, SLA, tarefas), rodadas, comunicação
  (modelos versionados), processos (motor), agenda, comercial, integrações (CSV, demo, WhatsApp oficial e QR),
  telefonia, painel/dashboards, supervisor, demo.
- **Banco:** 43 tabelas em 6 migrações com volta e checksum; RLS em todas as de negócio; papel `sinapse_app`.
- **Jobs:** fila no banco (`FOR UPDATE SKIP LOCKED`, backoff, DLQ), 11 tipos (entrada, pré/oficial de rodada,
  comunicação, supervisor, OMIE, processos, lembretes, telefonia).
- **Eventos:** outbox `eventos` + auditoria só de anexação, na mesma transação.
- **Telas:** 16 (Meu dia, Painel, Dashboards, Ocorrências, Triagem, Tarefas, Comercial, Processos, Mensagens,
  Rodadas, Carteira, Integrações, Supervisor, Auditoria, Simulador, Login); PWA.
- **Testes:** 51 (`node:test`), servidor real + banco.
- **CI:** `.github/workflows/sinapse.yml`, PGlite e PostgreSQL 16; sem lint.
- **Deploy:** Dockerfile + `railway.json` (healthcheck `/api/health`).

## Verificações executadas (resultado real)
| Comando | Resultado |
| --- | --- |
| `npm test` (PGlite), antes da correção | **45 ok / 6 falhas**: AT-003, 005, 006, 008 e um de lembretes misturavam `now()` real com o relógio simulado; quebraram a partir de 05/11 13h UTC |
| `npm test` (PGlite), depois de `c8d606b` | **51 ok / 0 falha** |
| `TESTE_DATABASE_URL=postgres://…@127.0.0.1/sinapse_teste npm test` (PostgreSQL 16 local, banco descartável) | **51 ok / 0 falha** |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| Lint / análise estática | não existe no projeto (R-17) |
| Carga, E2E no navegador, restauração de backup | **não executados** (sem ferramenta nem ambiente para isso nesta rodada) |

## Cobertura (MATRIZ_REQUISITOS.csv, 209 IDs = 189 da especificação + CRM-001…020)
| Situação | Qtde |
| --- | --- |
| Implementado e testado | 86 |
| Implementado sem teste | 11 |
| Parcial | 63 |
| Mock/demo | 1 |
| Ausente | 34 |
| Bloqueado por API/decisão | 14 |

Divergência com `docs/RASTREABILIDADE.md`: aquele documento marca como "✔ demonstrado" itens que têm tela mas não têm
teste (CS-001, SUP-005, PRE-012…) e trata integrações CSV com layout proposto como prontas. A matriz nova usa o critério
mais rigoroso da diretriz. O RASTREABILIDADE será alinhado na primeira fatia aprovada.

## Principais lacunas
1. **Segurança de ambiente:** o modo demo vem ligado por padrão e permite entrar sem senha (R-01, crítico); TLS do
   banco sem verificação (R-03); login sem limite de tentativas (R-04); sem MFA (R-05).
2. **Resiliência:** PGlite no Volume sem backup testado (R-06); web, worker e supervisor no mesmo processo (R-07);
   monitor externo não configurado (R-08).
3. **CSV:** os layouts foram propostos pelo Sinapse, sem estado de confirmação na exportação (R-15, R-16).
4. **Domínios ausentes:** onboarding com checklist e offboarding (ONB-003…012), treinamentos do CS (CS-005…009),
   incidentes/RCA/releases (DEV-006…008), LGPD (SUP-008), anexos (INT-009), delegação/RACI (GOV-009/010).
5. **Comercial × Pipedrive:** funil único fixo, sem pessoas separadas de organizações, propostas, alçadas, catálogo
   nem importação do Pipedrive (CRM-003, 007, 008, 009, 014, 018).
6. **Kanban de tickets com responsáveis:** pedido em 05/11; hoje existe quadro só no Comercial (F1 do plano).

## Motor de processos (pergunta da diretriz)
Coberto por teste: versões ativadas imutáveis e execução antiga presa à sua versão; laço contido (5 inícios/24 h →
divergência); condições avaliadas na foto do evento (evento atrasado não usa o estado atual). Não coberto: falha no
meio de um passo com efeito externo (R-20) e corrida de duas réplicas despachando o mesmo evento (com PGlite há um
processo só; com PostgreSQL, a chave única de execução protege, mas sem teste dedicado).

## Arquitetura
O monólito modular está coeso; não há microsserviço a criar. Recomendação mínima: separar **papéis** (web × worker)
por variável na mesma imagem e pôr um monitor externo no supervisor. TypeScript: não recomendado agora (custo alto,
sem defeito que ele resolveria hoje); reavaliar se o time crescer.
