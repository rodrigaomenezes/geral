# Decisões técnicas — Sinapse

A especificação (seção 11) pede que pilha, hospedagem, ORM, mensageria e autenticação sejam decididos em ADR após
avaliar o repositório e a infraestrutura da Brobot. Estas são as decisões **da Fase 1 (demonstração)**, tomadas
para combinar com os outros projetos deste repositório; cada uma diz quando deve ser revista.

# T-001 — Node.js sem framework, CommonJS, front em JS puro sem build
**Decisão:** `node:http` e módulos próprios (como o Estadia); interface em módulos ES servidos direto.
**Por quê:** mesma pilha do repositório, sobe em qualquer lugar, superfície pequena. **Rever** se a equipe da Brobot
já tiver padrão (ex.: TypeScript/Fastify) — a separação rotas → serviço → regra pura facilita a migração.

# T-002 — PostgreSQL como única fonte de verdade, com dois motores
**Decisão:** `DATABASE_URL` → PostgreSQL gerenciado (`pg`); sem ela → PostgreSQL embutido (PGlite, WebAssembly)
gravando no Volume. Mesmo SQL, mesmas migrações, mesmos testes (o CI roda nos dois).
**Por quê:** a especificação exige transação, unicidade para idempotência, trava otimista, constraints de estado e
isolamento por organização — garantias de banco, não de arquivo. O PGlite permite publicar a demonstração só com
um Volume. **Dependências:** `pg` e `@electric-sql/pglite` (as duas únicas). **Rever:** produção real usa
`DATABASE_URL` (backup/PITR do provedor).

# T-003 — Isolamento por organização no banco (RLS + papel sem privilégio)
**Decisão:** toda transação de usuário faz `set_config('app.tenant_id')` e `SET LOCAL ROLE sinapse_app`; as
políticas `isolamento` filtram tudo. O caminho `sistema` (dono das tabelas) é usado só por login, fila, supervisor e
migração. **Por quê:** um `WHERE tenant_id` esquecido não vaza dados (AT-014).

# T-004 — Fila de jobs no próprio PostgreSQL; um processo
**Decisão:** tabela `jobs` com `FOR UPDATE SKIP LOCKED`, backoff exponencial (30 s → 1 h), fila de falhas e
reprocessamento auditado; worker e supervisor no mesmo processo da API. Relógio ajustável só na demonstração.
**Por quê:** "monólito modular, sem microsserviço prematuro" (seção 11); nada de agendamento em memória.
**Rever:** com volume, separar `SINAPSE_WORKER=0` na API e um serviço só de worker (o código já permite).

# T-005 — Máquina de estados e regras como funções puras; invariantes também no banco
**Decisão:** `maquina.js`, `sla.js`, `classificador.js`, `erros.js` não tocam o banco e têm teste próprio; as
invariantes críticas (RN-008, RN-009, GOV-004) também são CHECK no PostgreSQL.
**Por quê:** a regra é testável sem infraestrutura e, mesmo com bug no código, o banco recusa o estado inválido.

# T-006 — Outbox + auditoria na mesma transação
**Decisão:** toda mudança grava `eventos` (contrato canônico da seção 9) e `auditoria` (só anexação, gatilho) junto
com o dado. **Por quê:** histórico, indicadores e futura integração derivam dos eventos; nada muda sem rastro.

# T-007 — Adaptadores de demonstração para Platform, OMIE e mensageria
**Decisão:** portas simples (`testarRodada`, `revalidarVeiculo`, `executarOficial`, `consultarSituacoes`,
`enviar`) com implementação de demonstração e chave de indisponibilidade para testes de falha.
**Por quê:** a especificação proíbe presumir endpoint; os adaptadores reais entram com a documentação oficial.

# T-008 — Classificação determinística; IA fora da Fase 1
**Decisão:** regras por termos; um assunto reconhecido = classificação certa; nenhum ou vários = triagem humana.
**Por quê:** RN-013 e princípio 9 (IA nunca decide sozinha). IA pode sugerir numa fase futura, com revisão humana.
