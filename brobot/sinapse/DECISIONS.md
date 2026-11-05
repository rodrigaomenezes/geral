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

# T-009 — Processos escritos pela operação, executados por um motor próprio sobre o outbox
**Decisão:** a cadência de contatos deixou de ser código fixo e virou processo editável (lista de passos em
formulário, com leitura em português, simulação e versões). O motor consome o outbox de eventos e roda na fila de jobs.
**Por quê:** pedido do cliente ("escrever processos que o sistema seguirá sozinho") e WFL-003/WFL-013/SUP-010/RN-012.
Sem dependência nova nem motor externo (BPMN): o vocabulário é pequeno, validado e testado.
**Contrato:** a definição (`gatilho`, `condicoes`, `passos`, `encerrarSe`, `agenda`) é versionada; mudar o sentido de um
campo exige versão nova do vocabulário.

# T-010 — Marca por organização na configuração
**Decisão:** nome, cores (hex) e logo em `tenants.config.marca`, aplicados no carregamento. **Por quê:** white-label
(seção 2 da especificação); o material oficial da Brobot entra sem mudar código.

# T-011 — Comercial dentro do Sinapse, com teste obrigatório antes do fechamento
**Decisão:** visão do cliente (05/11/2026): o Sinapse é o único sistema de gestão, inclusive do Comercial. Funil padrão
de aquisição com etapa Teste; o banco recusa negociação ou ganho sem teste aprovado. Venda ganha cria a conta em
onboarding (ou expande a do mesmo CNPJ) e o onboarding vai para o CS.

# T-012 — Platform e OMIE por CSV nesta fase
**Decisão:** integração por arquivos (exportar/importar) até as APIs estarem disponíveis. O resultado de rodada por CSV
reaproveita exatamente o mesmo processamento da API (`processarPreRodada`/`processarOficial`). **Rever** quando houver
API: o adaptador real substitui o arquivo sem mudar o resto.

# T-013 — Reaproveitar canais do Lumen Operações
**Decisão:** WhatsApp (API oficial + QR), telefonia (SIP/WebRTC, celular, treino) e fila de ligações vêm do Lumen
Operações, adaptados ao PostgreSQL multiempresa. **Atenção:** este repositório é público; o código portado fica visível.

# T-014 — Identidade visual Brobot no padrão do sistema
**Decisão:** paleta azul do site da Brobot, Montserrat (OFL, servida de `public/fonts`, sem chamada externa), botões em
pílula e fundo em grade no login. Wordmark em CSS até receber o logo oficial em SVG. `tenants.config.marca` continua
permitindo outra marca por organização (white-label).

# T-015 — Canais portados do Lumen: telefonia e WhatsApp oficial
**Decisão:** provedores de telefonia trocáveis (treino, SIP/WebRTC com JsSIP 3.13.8 MIT em `public/vendor`, celular) e
Meta Cloud API para WhatsApp. Segredos (senha de ramal, token da Meta) cifrados com AES-256-GCM (`SINAPSE_CHAVE`);
webhook validado por HMAC do corpo cru (`META_APP_SECRET`). CSP passa a permitir `wss:` (operadora SIP).
**Não portado ainda:** WhatsApp por QR (Baileys: sessão em memória e risco de bloqueio do número), gravação de ligações.

# T-016 — Dashboards sem biblioteca de gráficos
**Decisão:** gráficos em SVG/HTML próprios (`public/js/graficos.js`): barras, agrupado, empilhado, funil, linha com cruz e dica.
Paleta categórica validada para daltonismo (ordem fixa; status só para estado); toda visão tem "ver tabela" e CSV.
**Por quê:** sem dependência nova, CSP sem exceção, carregamento leve no celular.

# T-017 — Mensagens padrão com revisão e aprovação
**Decisão:** texto padrão no código; versões da organização em `modelos_mensagem` (rascunho → revisão → aprovada, imutável
depois). Quem escreve não aprova o próprio texto (salvo Administração). O envio usa sempre a versão aprovada e, se houver,
o template da Meta com as variáveis na ordem indicada (resolve a janela de 24 h do WhatsApp).

# T-018 — `rowCount` igual nos dois motores
**Problema encontrado:** o PGlite devolve `affectedRows`, o `pg` devolve `rowCount`; com o banco embutido, checagens por
`rowCount` (cancelar jobs, cadastro do número de WhatsApp, revisão de mensagem) falhavam em silêncio.
**Correção:** o adaptador do PGlite preenche `rowCount`; teste de regressão em `test/regras.test.js`.

# T-019 — Demonstração explícita em produção, TLS verificado e limite de login (F0 da auditoria)
**Problema encontrado (auditoria de 05/11, R-01/R-03/R-04):** o modo demonstração vinha ligado por padrão — no Railway
qualquer pessoa entrava como qualquer perfil sem senha; a conexão TLS com o PostgreSQL aceitava qualquer certificado;
o login não limitava tentativas.
**Decisão:** em `NODE_ENV=production` a demonstração só liga com `SINAPSE_DEMO=1` (faixa fixa na tela);
`SINAPSE_AMBIENTE=producao` recusa demonstração, banco embutido e TLS sem verificação. Com `sslmode` o certificado é
verificado (`SINAPSE_DB_CA` para CA própria; desligar só com `SINAPSE_DB_TLS_INSEGURO=1`, registrado no log). Login:
5 erros por e-mail ou 30 por endereço em 15 min → 429. O limitador fica na memória do processo (uma réplica hoje); com
várias réplicas, passa para tabela. HSTS em produção. `npm run verificar` no CI (sintaxe, sem `innerHTML`, sem
`setInterval` no servidor).
**Consequência:** a apresentação no Railway precisa de `SINAPSE_DEMO=1`.

# T-020 — WhatsApp por QR Code (Baileys) além da API oficial
**Contexto:** pedido de 05/11 ("inclua o WhatsApp QR Code"), aprovado com ciência do risco (DP-03).
**Decisão:** o número por QR é mais um provedor de `whatsapp_numeros` (`provedor = 'qr'`, migração 006 aditiva); um
número ativo por organização. Sessão em arquivo no Volume (`/data/wa-sessoes`), conexão na memória do processo;
recebido vira entrada deduplicada pelo id da mensagem; o que o celular manda direto vai ao histórico (eco, sem
duplicar); status entregue/lida pela mesma regra do oficial (não regride). Testado com simulador
(`SINAPSE_WA_QR_FALSO=1`).
**Riscos:** não é a API oficial — a Meta pode bloquear o número; sem Volume a sessão se perde a cada deploy.
