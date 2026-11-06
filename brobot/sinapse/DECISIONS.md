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

# T-021 — CSV com mapeamento de colunas e lote de exportação com confirmação (F2)
**Contexto:** adendo CSV da diretriz; em 05/11 a Brobot informou que não consegue enviar amostras reais de Platform/OMIE.
**Decisão:** os layouts continuam os propostos pelo Sinapse, marcados "pendente de validação"; quando o arquivo real vier
com outros nomes, a prévia pede a ligação das colunas, que é salva por fluxo como versão (`mapas_csv`, uma ativa,
auditada). Exportar cria um lote (`exportacoes`, hash, código no nome do arquivo) que fica "aguardando confirmação":
baixar não é aplicar no destino. Confirmar ou dar como falho exige evidência; sem confirmação em 2 dias, o supervisor
abre divergência e tarefa para a Supervisão, uma vez por lote. A checagem fica em `csv/lotes.js` para o supervisor
não depender do módulo CSV inteiro.
**Fora desta fatia:** reprocessar o mesmo arquivo (hoje recusado pelo hash), arquivo de retorno automático do destino.

# T-022 — Usuários de teste com senha de variável de ambiente
**Contexto:** pedido de 05/11 ("um usuário e senha para teste, vários níveis de acesso, nomes simples").
**Decisão:** `SINAPSE_SENHA_TESTE` cria/atualiza na subida um usuário por perfil (`gestor@brobot.com.br`, `suporte1@…`),
idempotente por e-mail; a senha não está no código (repositório público) nem no banco (só o hash scrypt). Recusado em
`SINAPSE_AMBIENTE=producao`.

# T-023 — Comercial como CRM (F3a): catálogo, propostas com alçada, atividades, suspensão e migração do Pipedrive
**Contexto:** adendo Comercial da diretriz (substituir o Pipedrive) e DP-04 (teste obrigatório para todo produto?).
**Decisão:** `produtos_comerciais` por organização com `exige_teste` (padrão = exige, a regra de antes); a oportunidade
só vai da Proposta direto à Negociação quando nenhum produto exige teste, e o banco aceita o fechamento com
`teste_dispensado`. Propostas versionadas (`propostas`): uma vigente por oportunidade, enviada imutável (gatilho),
desconto acima da alçada (`tenants.config.comercial.descontoMaximo`, padrão 10%) aprovado por outra pessoa com
`comercial.gerir`; enviar a proposta passa o valor e os produtos dela para a oportunidade. Atividades
(`atividades_comerciais`) com resultado obrigatório ao concluir; agendada vira a próxima ação. Suspensa guarda a etapa
de origem e a data para retomar; perdida reabre na qualificação com motivo. Migração do Pipedrive por CSV (com o
mapeamento da F2): só negócios abertos, uma vez por id (`fonte`, `id_externo`), apenas pela gestão comercial.
**Fora (F3b):** múltiplos funis (CRM-003), pessoas × organizações (CRM-001), renovação/expansão (CRM-014), previsão
(CRM-015), histórico de ganhos e perdidos do Pipedrive (aguarda a exportação real).

# T-024 — Datas sem hora como texto; classe própria do quadro de ocorrências
**Problema encontrado:** colunas DATE (validade, período do teste, VIP, feriado) chegavam como meia-noite UTC e a tela
mostrava o dia anterior (fuso de Brasília); e o `teste_fim` lido do banco gerava data inválida ao montar a próxima
ação. **Correção:** os dois motores devolvem DATE como `AAAA-MM-DD`; `data()` da tela formata esse texto direto.
**Problema encontrado:** o CSS do quadro de ocorrências (PR 14) reusou a classe `.quadro` do funil comercial e mudou
o layout dele. **Correção:** o quadro de ocorrências usa `.kquadro`.

# T-025 — Funis de expansão e renovação, pessoas da negociação e previsão (F3b)
**Contexto:** adendo Comercial (CRM-001, 003, 014, 015) e CS-011 (oportunidade de expansão encaminhada ao Comercial).
**Decisão:** em vez de funis com etapas livres (que exigiriam reescrever as regras de banco de cada etapa), três funis
fixos com as mesmas etapas e regras próprias: aquisição (como antes); expansão (cliente da carteira, teste só para
produto novo que o catálogo exige, ganhar soma produtos e valor à conta e abre "Expansão" para o CS); renovação
(dispensa teste, ganhar troca o valor do contrato, sem onboarding). O CS encaminha pela Carteira (`conta.editar`): a
oportunidade fica na fila do Comercial, sem dono, e "Minhas" passa a incluir a fila. Pessoas (`contatos_comerciais`)
são únicas por telefone e por e-mail na organização; reaproveitar completa dado vazio e nunca sobrescreve. Previsão =
valor × probabilidade da etapa por mês de fechamento previsto, com a fórmula na tela (probabilidades em `funil.js`).
**Fora:** etapas configuráveis por funil; probabilidade configurável por organização; vínculo pessoa ↔ conta.

# T-026 — Onboarding e offboarding por checklist (F4)
**Contexto:** ONB-001…012 e CS-012; reunião de 03/11 (CS define o ponto focal e repassa ao Suporte).
**Decisão:** módulo `onboarding` com modelo de checklist por organização e versionado (`checklist_modelos`, padrão em
`onboarding/modelos.js`); o checklist aberto copia os itens (mudar o modelo não mexe no que está em andamento). Cada
item tem grupo (ativação administrativa, técnica, sinalização financeira, relacionamento, encerramento — ONB-009),
equipe dona, prazo e evidência. Itens com dado no sistema são conferidos sozinhos (ponto focal, produtos, grupo do
WhatsApp, provisionamento confirmado por lote exportado, credenciais OK, primeira rodada com sucesso, código OMIE,
ausência de pendências). Item obrigatório só sai do caminho feito com evidência ou com dispensa pedida por quem cuida e
aprovada por OUTRA pessoa com `ocorrencia.intervir` (ONB-010; o banco confere). Concluir onboarding ativa a conta;
concluir offboarding encerra (status `encerrada`, nada apagado). Venda de cliente novo abre o onboarding sozinha;
item obrigatório vencido vira tarefa da equipe dele na varredura do supervisor (uma vez por item).
**Fora:** tela para editar o modelo (há a API, para a gestão); pedido de dados ao cliente com mensagem automática
(ONB-003 parcial); provisionamento real na Platform (ONB-004, bloqueado: CSV).

# T-027 — Monitoramento de consultas, credenciais e reincidência (F5)
**Contexto:** REC-001…008, CRE-003/004, POS-009 e as melhorias 3 (erros invisíveis) e 6 (visão de sucesso) da reunião.
A Platform fica no CSV nesta fase (adendo CSV).
**Decisão:** importador `platform_consultas` (volumetria por conta, produto e dia: esperadas, geradas, erros técnicos,
de usuário e indisponibilidade), guardada em `consultas_volume` (o mesmo dia reimportado é atualizado: vale o arquivo
mais recente). As regras ficam em `monitoramento/regras.js` com os limites nomeados (5% de tolerância, 3 dias sem
execução, 5% de erro técnico com mínimo de 3, reincidência na 3ª vez). Cada alerta tem `alerta_chave`; o índice único
do banco garante no máximo uma ocorrência ativa por alerta. Erro técnico vai para o Desenvolvimento (tipo técnica); o
resto segue a equipe da conta (VIP → CS). Credencial com status OK vencendo em até 15 dias (configurável em
`tenants.config.credenciais.avisoDias`) e reincidência são conferidas na varredura do supervisor.
**Fora:** fechar o alerta sozinho quando a consulta normaliza (exige evidência: fica para a equipe), limites por
organização, aviso automático ao ponto focal (a ocorrência traz a próxima ação; o envio segue pelos processos).
