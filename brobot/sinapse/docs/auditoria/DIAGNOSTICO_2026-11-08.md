# Diagnóstico e plano · 08/11/2026 (Prompt Mestre — auditoria, estabilização e evolução)

Auditoria feita sobre o código, o banco e os testes. Não sobre a documentação. Referência: *Sinapse — Documento de
Requisitos (Proposta e Análise)*, 07/11/2026, e `docs/auditoria/MATRIZ_REQUISITOS.csv`.

## 1. Resumo executivo

- **A base é sólida e ficou.** O que sustenta o sistema funciona e está testado nos dois bancos (PGlite e
  PostgreSQL):
  - isolamento por empresa no banco (RLS com papel sem privilégio em toda transação de negócio);
  - máquina de estados;
  - fila durável de jobs;
  - registro de eventos e auditoria só de inserção;
  - supervisor.
- **Um risco P0 real estava aberto: R-20.** A mensagem ao cliente podia sair duas vezes quando algo falhava entre o
  envio pelo provedor e a gravação da confirmação. Corrigido nesta etapa: envio em duas fases, migração 026, teste
  próprio.
- **Segundo defeito de confiabilidade, também corrigido nesta etapa.** Um job que derruba o processo em toda tentativa
  voltava à fila para sempre.
- **Divergência entre documento e código.** O documento de 07/11 fala em 152 testes automáticos. O código tem **174
  testes** (após esta etapa). A contagem de requisitos (158 prontos e testados, 39 parciais, 10 dependentes, 2
  ausentes) bate com a matriz.
- **Evidência dos 158 "prontos e testados".**
  - Todos têm teste localizável no código.
  - 22 citavam o teste por um nome informal (ex.: "regras máquina" é o `test/regras.test.js`).
  - 1 (RN-013) é garantido por ausência: não existe IA no sistema. Não há teste possível até existir.
- **O que impede a produção não é código.** São estas dependências:
  - banco gerenciado com backup testado (R-06);
  - monitor externo (R-08);
  - amostras reais de CSV da Platform, do OMIE e do Pipedrive (R-15);
  - decisões de negócio listadas em `DECISOES_PENDENTES.md`.

## 2. Arquitetura atual (confirmada no código)

| Camada | Como está | Avaliação |
| --- | --- | --- |
| Servidor | Node 22, `node:http` sem framework, CommonJS; rotas declarativas com permissão por rota (`server/http/servidor.js`) | Manter. Permissão no servidor em toda rota; erro sempre no formato `{error:{code,message,details}}` |
| Banco | PostgreSQL (`DATABASE_URL`) ou PGlite no Volume; migrações `NNN` com `.down.sql` e checksum (`server/db/migrar.js`) | Manter. Produção deve usar o PostgreSQL gerenciado (R-06, decisão DP-02) |
| Multiempresa | `tenant_id` + RLS; `comoTenant` faz `set_config` + `SET LOCAL ROLE sinapse_app`; `sistema()` só para login, fila e supervisor | Comprovado (AT-014 nos dois bancos). Consultas sem organização são só de sistema (busca do slug no webhook, número do WhatsApp pelo id interno) |
| Jobs | Tabela `jobs` com `FOR UPDATE SKIP LOCKED`, backoff, fila de falhas, chave única, devolução de job preso (`server/jobs/fila.js`) | Manter. Corrigido nesta etapa: job que esgota as tentativas preso em execução vai para a fila de falhas |
| Eventos e auditoria | Outbox `eventos` + `auditoria` só de inserção (o banco recusa UPDATE e DELETE) | Comprovado |
| Supervisor | Varredura por organização (invariantes, escalonamento, prazos, integrações, canais) + varredura global (heartbeat, jobs presos) | Ampliado nesta etapa: envio sem confirmação |
| Integrações | Adaptadores com versão de demonstração; CSV com prévia, hash, lotes de exportação com confirmação, mapa de colunas versionado | Layouts não homologados (R-15) |
| Front | JS puro com módulos ES, `h()` sem innerHTML, PWA, CSP sem inline | Conferência automática de 25 telas (360 px, rótulos, contraste AA, foco) |

Módulos (`server/modulos`): agenda, clientes, comercial, comunicacao, demo, desenvolvimento, entrada, governanca,
identidade, integracoes, lgpd, monitoramento, ocorrencias, onboarding, organizacao, painel, processos, rodadas,
supervisor, telefonia, treinamentos. Nenhum arquivo passa de 375 linhas. Não há framework a trocar nem camada a criar.

## 3. Riscos P0 (bloqueadores) e situação

| Risco | Problema | Situação após esta etapa | Evidência |
| --- | --- | --- | --- |
| R-20 · mensagem duplicada | O envio ao provedor acontecia dentro da transação do job. Falha depois do envio desfazia tudo e o job reenviava | **Corrigido.** Envio em duas fases (detalhes abaixo). Não há reenvio automático | `test/envio-duas-fases.test.js` |
| R-21 · job sem fim | Job que derruba o processo em toda tentativa nunca chegava à fila de falhas, porque só o `catch` contava | **Corrigido.** Esgotadas as tentativas, vai para a fila de falhas com auditoria | idem |
| R-06 · banco e backup | Produção ainda no banco embutido, sem backup testado | **Aberto. Depende de implantação** (DP-02) | — |
| R-08 · vigia do supervisor | Sem monitor externo de `/api/health/supervisor` | **Aberto. Depende de implantação** | AT-013 testa o 503 |
| R-15 · layouts CSV | Layouts propostos pelo Sinapse, sem arquivo real | **Aberto. Depende de amostras** | — |

Como funciona o envio em duas fases (R-20):

1. A interação passa a `enviando` numa transação já confirmada.
2. Só então o provedor é chamado; o envio e a confirmação `enviada` ficam numa transação própria.
3. Se o provedor recusou, a mensagem não saiu: volta à fila e é tentada de novo.
4. Se houve queda ou tempo esgotado, a mensagem pode ter saído: fica `enviando`. Depois de 10 minutos o supervisor a
   marca `incerta`, audita e cria uma tarefa "conferir se chegou; reenviar só se não chegou".

Itens verificados e sem defeito:

- **Sessão:** cookie HttpOnly e SameSite=Lax, conferência de origem nas rotas que mudam dado, expiração por
  inatividade, MFA da gestão.
- **Webhooks:** token comparado em tempo constante e assinatura HMAC da Meta.
- **Limites:** 1 MB de JSON, 5 MB de CSV e 10 MB de anexo.
- **Login:** limite de tentativas.
- **CSV:** importação idempotente por hash.
- **Exportação:** com prazo de confirmação.

## 4. Divergências entre documentação e código

| Onde | Documento dizia | Código mostra |
| --- | --- | --- |
| Documento de requisitos, 07/11 | 152 testes automáticos | 174 testes passando (PGlite e PostgreSQL) após esta etapa |
| `RISCOS.md` | R-20 aberto | Era real. Corrigido nesta etapa |
| Matriz, coluna "teste" | 22 requisitos citam o teste por apelido | Os testes existem. A coluna será normalizada para o nome do arquivo (P2, documentação) |
| Prompt Mestre, item 7.2 | Distinguir arquivo vazio de arquivo "válido sem registros" | Hoje o arquivo só com cabeçalho é recusado como erro e não fica registrado. Saber se "sem linhas" quer dizer "sem pendências" depende do layout real (P1, ligado a R-15) |
| Prompt Mestre, item 7.2 | Detectar arquivo esperado não recebido ou desatualizado | Não existe monitor de chegada por tipo de arquivo (P1). A frequência esperada de cada arquivo é decisão da Brobot |
| Prompt Mestre, itens 7.1 e 9.1 | Lote com competência, versão de layout e data de geração; funis com etapas configuráveis | Ausentes. A competência e a data de geração dependem do layout real; as etapas configuráveis dependem de decisão (CRM-003, muda o modelo de dados) |
| Prompt Mestre, item 12 | Processos administrativos (RH, DP, faturamento, tesouraria, cobrança, contabilidade, repasses) | Fora do escopo aprovado e sem documento AS-IS/TO-BE no repositório. O OMIE segue dono do financeiro. Para avaliar, é preciso receber os mapas de processo |

## 5. Backlog priorizado

### P0, bloqueadores

| # | Tarefa | Situação |
| --- | --- | --- |
| P0-1 | R-20 · envio em duas fases (migração 026), estado `incerta` no supervisor, adaptadores sinalizam falha ambígua (`envioIncerto`) | ✔ feito nesta etapa |
| P0-2 | R-21 · job preso que esgotou as tentativas → fila de falhas | ✔ feito nesta etapa |
| P0-3 | R-06 · PostgreSQL gerenciado, backup diário e teste de restauração | depende da implantação (DP-02) |
| P0-4 | R-08 · monitor externo e responsável pelo alerta | depende da implantação |

### P1, essenciais

| # | Problema | Solução proposta | Arquivos | Teste / critério | Depende de |
| --- | --- | --- | --- | --- | --- |
| P1-1 ✔ (08/11, T-053, semanal) | Arquivo esperado não chega e ninguém percebe | Expectativa por tipo (a cada N horas, em `tenants.config.csv.esperados`); o supervisor abre divergência e tarefa uma vez quando a última importação está vencida | `integracoes/csv`, `supervisor` | Sem arquivo no prazo → divergência; arquivo novo fecha a divergência | Frequência de cada arquivo (Brobot) |
| P1-2 | Arquivo vazio ou só com cabeçalho some sem registro | Registrar a tentativa como "vazio" (com hash e motivo) em vez de só recusar; "válido sem registros" só quando o layout disser o que isso significa | `integracoes/csv/servico.js` | Vazio fica no histórico; não conta como sucesso | Layout real (R-15) para o segundo caso |
| P1-3 | Lote de importação sem competência nem versão de layout | Campos opcionais no lote, preenchidos pelo mapa ou pelo arquivo | `integracoes/csv`, migração aditiva | Prévia mostra; histórico guarda | Layout real |
| P1-4 | Consulta lenta trava o worker | `statement_timeout` por transação de job, configurável | `server/db/index.js` | Consulta acima do limite falha e vai para retentativa | — |
| P1-5 | Arquivo desatualizado (competência antiga) aceito como novo | Recusar ou avisar quando a competência for anterior à última aplicada | `integracoes/csv` | Arquivo antigo → aviso na prévia | P1-3 |

### P2, evolução

| # | Tarefa | Depende de |
| --- | --- | --- |
| P2-1 | CRM: alertas configuráveis (lead sem primeiro contato, proposta sem acompanhamento, negociação parada, renovação próxima, perdida para reativar) a partir do motor de processos existente | Prazos de cada regra (Comercial) |
| P2-2 | Passagem venda → CS com aceite formal do CS (CRM-013) | Regra de aceite (CS) |
| P2-3 ✔ (08/11, T-054) | Funis com etapas configuráveis e versionadas (CRM-003) | Padrão agora, configurável depois, teste antes do fechamento |
| P2-4 | Migração completa do Pipedrive com conferência de contagens e amostras | Exportação real |
| P2-5 | Indicadores de linha de base do piloto: taxa de automação, intervenções humanas, tempo de detecção e de recuperação | — |
| P2-6 | Normalizar a coluna "teste" da matriz para o nome do arquivo | — |

### P3, futuro

| # | Tarefa | Depende de |
| --- | --- | --- |
| P3-1 | Copiloto de IA (classificar, resumir, sugerir): só sugere, nunca executa; contrato de entrada e saída sem dado sensível; o motor de regras continua autorizando | Aprovação de custo e de fornecedor |

## 6. Dependências de decisão (não inventadas)

Continuam as de `DECISOES_PENDENTES.md`:

- DP-01 e DP-02: ambiente e banco de produção.
- RN-010 e DP-07: bloqueio por CNPJ.
- PRE-010: escalonamento da rodada travada.
- PRE-011 e DP-08: quem autoriza o comunicado.
- ONB-008 e DP-09: critério de sucesso do onboarding.
- GOV-001: unidades.
- CRM-017: carteira por vendedor.
- Retenção LGPD (com o jurídico).
- Antivírus para anexos.
- Metas de SLA, RPO e RTO.

Novas nesta etapa:

- frequência esperada de cada arquivo CSV (P1-1);
- etapas por funil (P2-3);
- documentos AS-IS e TO-BE dos processos administrativos (item 12).

## 7. Verificações desta etapa

| Verificação | Resultado |
| --- | --- |
| `npm test` (PGlite) | 174 testes, 174 passando |
| `npm test` (PostgreSQL 16) | 174 testes, 174 passando |
| Teste novo `test/envio-duas-fases.test.js` | provedor recusou (sai uma vez depois); queda depois do envio (sem reenvio, `incerta` em 10 min, uma tarefa, auditoria); job sem fim → fila de falhas |
| Evidência da matriz (script) | 158 "prontos e testados": todos com teste localizável; 22 por apelido; RN-013 por ausência |

## 8. Respostas da Brobot (08/11) e o que entrou

| Pergunta | Resposta | O que entrou |
| --- | --- | --- |
| Frequência dos arquivos | Semanal | T-053 |
| Etapas do funil | O padrão agora, configurável depois, com o teste antes do fechamento | T-054 |
| Processos administrativos | Ficam no OMIE | O item 12 sai do escopo do Sinapse |

Testes: 180/180 no PGlite e no PostgreSQL; `npm run telas` sem problema nas 25 telas.

