# Plano de execução — fatias verticais (aguardando aprovação)

Cada fatia: domínio → banco → serviço → API → tela → job/evento → observabilidade → teste → documentação.
Commits pequenos e reversíveis; nada vai para a `main`/deploy sem aprovação. Ordem por risco e dependência.

## Estado do branch `claude/keen-albattani-fpgfyt` (não publicado)
- `c8d606b` correção dos testes que dependiam do relógio real (sem efeito no produto).
- `528bcf2` + tela Canais: WhatsApp por QR Code (migração 006 aditiva com volta) — aprovado em 05/11 (DP-03 = os dois).

## F0 · Segurança urgente (sem mudança de schema) — ✔ FEITA em 05/11 (aprovada)
| Item | Mudança | Teste | Volta |
| --- | --- | --- | --- |
| R-01 | Em `NODE_ENV=production`, `SINAPSE_DEMO` obrigatório e explícito; `SINAPSE_AMBIENTE=producao` recusa demo; faixa "DEMONSTRAÇÃO — dados fictícios" na tela | config recusa; rota `/api/sessao/demo` 403 com demo desligado | variável |
| R-02 | Seed recusado com `SINAPSE_AMBIENTE=producao` | config | variável |
| R-03 | `SINAPSE_DB_CA` com verificação TLS; `SINAPSE_DB_TLS_INSEGURO=1` só por escolha explícita e com aviso no log | unidade do adaptador | variável |
| R-04 | Limite de tentativas de login por e-mail+IP (memória do processo com janela; auditoria do bloqueio) | 6ª tentativa → 429 | código |
| R-10 / R-19 | HSTS em produção; expiração por inatividade | cabeçalho; sessão | código |
| R-17 | `npm run verificar` (`node --check` em tudo) no CI | CI | — |
Critério de aceite: testes atuais verdes nos dois motores + novos testes; README com as variáveis. Risco: baixo (padrões compatíveis com o deploy atual de demonstração).

## F1 · Kanban de ocorrências e tarefas com responsáveis (pedido de 05/11) — ✔ FEITA em 05/11 (DP-11 = opção a)
Opção (a), sem schema: colunas = estados da máquina (triagem, aberta, em atendimento, aguardando cliente,
aguardando terceiro/dev, em validação, resolvida). Cartão: protocolo, conta (VIP), responsável, prazo/SLA, próxima
ação, tarefas abertas (x/y). Arrastar chama a **mesma** transição da máquina (`/transicoes`), que pede evidência ou
motivo quando a regra exige; sem permissão ou transição inválida, o cartão volta com a mensagem. Filtros: equipe,
responsável, "minhas", VIP, vencidas. Paginação por coluna (limite por coluna + "ver mais"), sem chamada por cartão.
Acessível: além de arrastar, menu "Mover para…" (teclado e celular). Testes: rota agregada respeita RLS e escopo;
mover inválido → 409; contagem de tarefas sem N+1.

## F2 · Integração CSV com lotes, confirmação e mapeamento de colunas (adendo CSV) — ✔ FEITA em 05/11 (amostras reais indisponíveis, DP-05; falta reprocessamento e retorno automático)
Estados de lote (RECEBIDO … CONFIRMADO/FALHOU), manifesto com hash e correlação nas exportações, AGUARDANDO_CONFIRMACAO
com prazo e ocorrência quando o retorno não chega, rejeição por linha, reprocessamento autorizado, contratos
versionados por fluxo, **mapeamento de colunas salvo por fluxo** (o primeiro arquivo real é ligado aos campos na prévia, sem código), modelos de arquivo para download, central de integração com frescor. Migração aditiva `importacoes`/`lotes`.

## F3 · Comercial (CRM-001…020, substitui o Pipedrive) — F3a ✔ FEITA em 05/11 (catálogo, propostas, alçada, atividades, suspensão, migração de abertos); F3b ✔ FEITA em 05/11 (funis de expansão e renovação, pessoas, previsão, CS encaminha)
Pessoas × organizações com dedup; catálogo de produtos; múltiplos pipelines; propostas versionadas; alçadas;
suspenso/reaberto; handoff formal com aceite; renovação/expansão; importação do Pipedrive com prévia e conciliação.
DE-PARA em `DE_PARA_PIPEDRIVE_SINAPSE.csv` (a validar com a exportação real).

## F4 · Onboarding com checklist e offboarding (ONB-001…012, CS-012) — ✔ FEITA em 05/11 (falta: tela do modelo, pedido automático ao cliente)
Checklist configurável por produto (dados, contrato, ponto focal, certificados por status, placas, SNE, primeira
rodada), pedidos de faltantes com prazo, ativação administrativa × técnica × sinalização ao OMIE, exceção aprovada,
offboarding com revogação e retenção.

## F5 · Pré/pós-rodada, recorrentes e credenciais — fechar parciais (PRE-010/011, POS-008/009, REC, CRE-003/004)
## F6 · CS: treinamentos coletivos (CS-004…009), insights (CS-010) e encaminhamento ao Comercial (CS-011)
## F7 · Desenvolvimento: incidentes, RCA, melhorias e releases (DEV-003/006/007/008)
## F8 · Infra e conformidade: papéis web/worker, monitor externo, backup/restauração testados, LGPD (SUP-008), MFA (R-05), métricas
## F9 · Governança: delegação temporária, RACI, unidades, plantões (GOV-001/003/008/009/010)

## Corte de ferramentas legadas
Nenhuma ferramenta (planilhas, Redmine, Pipedrive, automações pessoais) é desligada por data. Para cada uma:
inventário, equivalência comprovada, migração do histórico, conciliação, aceite dos usuários, operação paralela e volta.
