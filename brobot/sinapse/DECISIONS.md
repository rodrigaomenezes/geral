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

# T-028 — Treinamentos coletivos do CS (F6)
**Contexto:** CS-004…009 e a reunião de 03/11 (treinamento coletivo por link, conta de demonstração, documento por
tela). A foto "Treinamentos CS" não chegou; a fatia segue a especificação.
**Decisão:** módulo `treinamentos`. Roteiro versionado por código (`treinamento_roteiros`, um ativo; a sessão aponta
para a versão usada) com passos por tela, imprimível como documento. Sessão com link `https://` e conta de
demonstração (o CNPJ de um cliente é recusado: todos veem a tela). Convite pelo modelo editável
`convite_treinamento`, ao ponto focal, pelo canal permitido (consentimento e opt-out da comunicação). No convite o
uso da Platform (`uso_contas`) é fotografado; a efetividade compara com o uso de hoje, presentes × ausentes (CS-009).
Presença e avaliação só depois do início; concluir exige toda presença marcada; quem faltou vira tarefa do CS para
reagendar. Conta ativa sem acesso há 30 dias ou sem consulta no mês vira alerta para o CS (uma vez, `alerta_chave`),
salvo se já estiver numa sessão agendada (CS-004). Permissão nova `treinamento.gerir` (CS e gestão).
**Fora:** inscrição pelo próprio cliente (link de inscrição), lista de presença automática pela ferramenta de chamada.

# T-029 — Desenvolvimento: incidentes, melhorias e releases (F7)
**Contexto:** DEV-001, DEV-005…008; a diretriz manda substituir o Redmine no que é decisão e acompanhamento.
**Decisão:** módulo `desenvolvimento`. Incidente com severidade, clientes afetados, linha do tempo só de inserção e
aviso opcional a cada atualização (modelo editável `aviso_incidente`, ao ponto focal, pelo canal permitido); SEV1 vira
tarefa da Supervisão com prazo de 1 hora; encerrar exige post-mortem (causa raiz e lições, CHECK no banco) e as ações
preventivas viram melhorias propostas ligadas ao incidente. Melhoria: proposta por quem atende; aprovada ou recusada
(com motivo) por outra pessoa com `ocorrencia.intervir` (CHECK no banco); entra numa release; publicar a release
libera e cria a tarefa de validação para a operação; validar é de quem cuida de contas e não é do Desenvolvimento,
com evidência (DEV-005), e avisa as ocorrências ligadas (DEV-007). Todo texto passa por `nucleo/sanitizar.js`
(DEV-001: tira senha, token e chave; preserva placa, protocolo e UUID). Permissão nova `dev.gerir`.
**Fora:** sincronizar com a ferramenta técnica (DEV-003, sem API autorizada), status público para os clientes.

# T-030 — Verificação em duas etapas, sessão por inatividade e pedidos de titulares (F8a)
**Contexto:** R-05 (sem MFA), R-19 (sessão de 12 h sem inatividade), R-11/SUP-008 (LGPD) da auditoria.
**Decisão:** TOTP próprio (`nucleo/totp.js`, RFC 6238, testado com os vetores oficiais), sem dependência. O segredo
fica cifrado (AES-256-GCM, `SINAPSE_CHAVE`); com MFA ativo o login cria a sessão "pendente" e ela só vale depois do
código (5 erros por sessão bloqueiam); o mesmo código não vale duas vezes (`mfa_ultimo_passo`). MFA obrigatório para
Administração e Supervisão com `SINAPSE_MFA_OBRIGATORIO=1` e sempre em `SINAPSE_AMBIENTE=producao`: sem ele, só a
ativação responde. Aparelho perdido: a Administração redefine (não a própria), com motivo; as sessões da pessoa caem.
Sessão parada mais de 120 min (`SINAPSE_SESSAO_INATIVIDADE_MIN`) deixa de valer; o uso grava no máximo a cada 5 min.
LGPD: `lgpd.gerir` localiza o titular por telefone/e-mail, exporta (acesso) e anonimiza (eliminação: nome, telefone e
e-mail viram marcadores, o papel de contato é encerrado, o destinatário das mensagens é trocado); confirmação digitada;
auditoria só com o hash do identificador.
**Fora:** retenção automática por prazo (política a definir com o jurídico), MFA por e-mail/SMS, chaves de acesso (passkeys).

# T-031 — Governança: delegação temporária, matriz RACI, plantão e SLA por contrato (F9)
**Contexto:** GOV-003/008/009/010 da especificação; ausência coberta só por `substituto_id` (um, fixo).
**Decisão:** `delegacoes` (de → para, início/fim, até 90 dias, motivo; revogar encerra, nada se apaga). A própria pessoa
delega o que é dela; a gestão (`governanca.gerir`) delega por quem faltou. Uma delegação por vez e sem corrente (quem
recebe não pode estar delegando no período). `identidade.resolverResponsavel` passa a seguir: delegado disponível →
pessoa → substituto → fila; o supervisor repassa as ocorrências abertas de quem tem delegação vigente e registra a
expiração uma vez. A consulta de vigência fica em `governanca/vigencia.js` (sem importar outros módulos, para não criar
ciclo com a identidade). RACI: `raci` por processo do catálogo (`governanca/servico.js` PROCESSOS), pessoa ou equipe,
um aprovador por processo (índice único); a tela mostra quem responde **agora** (delegado, substituto ou plantonista),
numa consulta só. Organização nova recebe uma sugestão por código de equipe, que só preenche processo vazio.
`plantoes` por equipe (até 7 dias, sem choque): ocorrência nova da equipe sem responsável nasce com o plantonista.
SLA de contrato: `contas.sla_contrato` (horas por prioridade, validado) substitui o padrão e não sofre o fator VIP.
**Fora:** unidades (GOV-001) e cadastro de equipes/usuários por tela; reatribuir de volta quando a delegação termina
(as ocorrências ficam com quem assumiu); escala recorrente de plantão.

# T-032 — Implantação real e cadastro de pessoas e equipes (F9b)
**Contexto:** sem demonstração, o banco vazio não tinha como ganhar a primeira organização nem a primeira pessoa
(só o seed de demonstração criava); pessoas e equipes só por seed (GOV-001).
**Decisão:** `organizacao/implantacao.js` é o único lugar que monta uma organização (equipes, rotinas, processos
padrão, matriz sugerida); a demonstração usa o mesmo código. Com `SINAPSE_DEMO` desligado e banco vazio, cria a
organização (`SINAPSE_ORGANIZACAO`, padrão "Brobot"), os feriados nacionais e a primeira Administração com
`SINAPSE_ADMIN_EMAIL` + `SINAPSE_SENHA_ADMIN`; sem elas, o log diz o que criar. Nunca mexe em organização existente.
Cadastro (`usuario.gerir`, só Administração): senha temporária de 16 caracteres gerada no servidor e mostrada uma vez;
com ela, só a troca de senha responde (403 `senha_temporaria`). Perfil trocado, desativação e senha redefinida
derrubam as sessões. Desativar não apaga, marca indisponível (o supervisor devolve as ocorrências) e tira a pessoa de
substituta; a organização nunca fica sem Administração ativa. A pessoa troca a própria senha (12+, sem o e-mail) e
marca ausência em "Minha conta".
**Fora:** convite por e-mail (não há envio de e-mail real ainda), unidades (GOV-001), SSO.

# T-033 — Relacionar, mesclar e dividir ocorrências (F10, INT-006)
**Contexto:** a tabela `ocorrencia_vinculos` existia desde a 001 sem uso; duplicadas eram encerradas à mão.
**Decisão:** `ocorrencias/vinculos.js`, sem migração. Relacionar grava o vínculo nos dois sentidos. Mesclar só na
mesma conta: a duplicada é encerrada com desfecho `duplicada` e motivo "Mesclada em …", as placas que faltam são
copiadas para a principal (a duplicada mantém as suas) e a conversa da duplicada passa para a principal, para as
próximas mensagens caírem nela. Dividir cria uma ocorrência da mesma conta (com SLA e roteamento normais) e move as
placas escolhidas; a original nunca fica vazia por divisão. Referência pelo protocolo ou pelo id; o protocolo é por
organização, a RLS isola. Tudo com motivo na linha do tempo das duas.
**Fora:** mesclar entre contas diferentes (use relacionar); desfazer uma mescla (reabrir a duplicada continua possível).

# T-034 — Relógio da espera: dependência externa fora do prazo de resolução (F11, WFL-006)
**Contexto:** em "aguardando cliente/terceiro" o prazo de resolução continuava correndo; ocorrências esperando o
cliente apareciam como vencidas.
**Decisão:** o único ponto que muda o estado (`aplicar` em `ocorrencias/servico.js`) marca `espera_inicio_em` ao
entrar em espera e, ao sair, soma o tempo em `espera_cliente_seg` ou `espera_terceiro_seg`; se a ocorrência segue
ativa, o prazo de resolução anda as mesmas horas úteis esperadas (crítica: horas corridas). Vale para toda saída:
retomar, resposta do cliente pela entrada, transferência, rotina do supervisor; encerrar durante a espera só registra
o tempo. Em espera, a situação do prazo é "pausado" e não conta como vencida (quadro, painel, dashboard, saúde do
supervisor); a revisão da espera (até 3 dias) continua sendo o prazo da dependência externa. O SLA de primeira
resposta não pausa. Migração 017 (aditiva; ocorrências já em espera ganham início = última atualização).
**Fora:** pausa parcial (por exemplo, só para a primeira resposta) e relatório de tempo por fase.

# T-035 — VIP por pedido, aprovação, validade e histórico (F12, GOV-002)
**Contexto:** VIP muda o roteamento (VIP → CS) mas era só um campo do cadastro, sem aprovação nem efeito da validade.
**Decisão:** `vip_pedidos` (018): quem cuida da conta (`conta.editar`) pede conceder, renovar ou retirar, com critério,
validade (até 2 anos) e motivo; outra pessoa da gestão (`governanca.gerir`) aprova ou recusa (recusa com motivo; o banco
recusa quem pediu decidir). Um pedido pendente por conta. Aprovado, a conta muda na mesma transação, com auditoria
antes/depois e evento. O supervisor avisa o CS 15 dias antes da validade (tarefa, uma vez) e, vencida sem renovação,
retira o VIP sozinho (pedido "automático"). Só as ocorrências novas seguem o novo roteamento; as abertas ficam.
**Fora:** critérios automáticos (por frota, faturamento), aprovação em dois níveis.

# T-036 — Ciência do escalonamento (F13, WFL-007) e teste da intervenção (WFL-014)
**Contexto:** o supervisor subia o nível e abria tarefa para a Supervisão, mas não havia registro de que a gestão viu
nem do que decidiu.
**Decisão:** `POST /api/ocorrencias/:id/ciencia` (`ocorrencia.intervir`) grava ciência do nível atual com a ação e o
novo prazo (até 7 dias): a ação vira a próxima ação, as tarefas de escalonamento abertas são concluídas com ela e a
linha do tempo registra. Uma ciência por nível (019: `escalonamento_ciente_*`, o banco recusa ciência acima do nível).
Se o novo prazo vencer, o nível sobe; sem ciência no nível anterior, a tarefa diz "sem ciência da gestão".
A intervenção excepcional (reatribuir) ganhou teste próprio: só gestão, justificativa, trava otimista, não em encerrada.
**Fora:** notificação fora do sistema (e-mail/SMS) para nível 3.

# T-037 — Supervisor detecta canal em silêncio, entrada parada e rotina parada (F14, SUP-002)
**Contexto:** webhook interrompido ou número desconectado não davam sinal: as mensagens simplesmente não chegavam.
**Decisão:** `supervisor/saude-canais.js`, sem migração, na varredura do supervisor. Canal que já recebeu mensagens e
está sem nada há mais que o limite em horas úteis (padrão WhatsApp 4 h, e-mail 24 h; `tenants.config.canais_silencio_horas`
muda) vira divergência `canal_silencio` e tarefa da Supervisão, uma vez por episódio (chave = canal + última mensagem);
a próxima mensagem fecha a divergência. Entrada gravada e não processada há mais de 15 min (`entrada_parada`) e rotina
recorrente na fila de falhas (`rotina_parada`) seguem o mesmo padrão. Noite, fim de semana e feriado não contam.
**Fora:** teste ativo do webhook (mensagem sintética do provedor) e alerta fora do sistema; o worker parado continua
coberto pelo monitor externo de `/api/health/supervisor` (AT-013).

# T-038 — Anexos de ocorrência (F16, INT-009, R-12)
**Contexto:** não havia como guardar o comprovante, a tela de erro ou a planilha do cliente junto da ocorrência.
**Decisão:** tabela `anexos` (020) no próprio PostgreSQL (`bytea`), sem serviço de arquivos novo: volume baixo (até 30 por
ocorrência, 10 MB cada) e o backup do banco já cobre. Upload por rota própria (`application/octet-stream`, nome em
`X-Nome-Arquivo`), nunca dentro de JSON. Tipo conferido pelo conteúdo (assinatura): PDF, PNG, JPEG, WEBP, texto/CSV,
XLSX e DOCX; executável, ZIP solto, HTML/SVG e script são recusados. SHA-256 impede o mesmo arquivo duas vezes na
mesma ocorrência. Download sempre como anexo, com `nosniff` e CSP `sandbox`, auditado. Arquivar (quem enviou ou a
gestão) tira da lista sem apagar. Retenção: com `tenants.config.retencao_anexos_dias` (mínimo 30), o supervisor expurga o
conteúdo de anexos de ocorrências encerradas há mais tempo; fica o registro. Sem a política, nada é expurgado.
Corrigido junto: upload acima do limite derrubava a conexão (o navegador via "sem conexão"); agora recebe o 413 com a
mensagem.
**Fora:** antivírus no servidor (R-12 segue parcial: a lista fechada de tipos e o download como anexo reduzem o risco);
anexos em mensagens de WhatsApp/e-mail recebidas.

# T-039 — Métricas para coletor externo (F17, SUP-009, RNF-011)
**Contexto:** só havia log estruturado por requisição; sem números para painel ou alerta fora do sistema.
**Decisão:** `nucleo/metricas.js` em memória (sem dependência): contador e histograma de tempo das requisições por
modelo de rota e classe de status, mais medidas do banco (fila de jobs por estado, idade do heartbeat, entradas
aguardando e a mais antiga — RNF-004, meta 60 s —, divergências por tipo, ocorrências ativas/triagem/escalonadas),
totais de todas as organizações e sem nome de cliente, pessoa ou organização. `GET /api/metricas` no formato do
Prometheus, só com `SINAPSE_TOKEN_METRICAS` (24+) e `Authorization: Bearer`; sem a variável, a rota responde 404. Os
contadores zeram ao reiniciar (padrão do Prometheus).
**Fora:** traces distribuídos; com vários processos (web e worker), cada um expõe os seus contadores.

# T-040 — Lote de placas do onboarding (F18, ONB-006)
**Contexto:** o item "Placas e Renavam importados" do onboarding era marcado à mão; a planilha do cliente chegava à
Platform sem conferência e os erros só apareciam na pré-rodada.
**Decisão:** a Platform continua dona dos veículos; o Sinapse confere a planilha antes. `lotes_placas` e
`lote_placas_linhas` (021): cada linha fica aceita ou rejeitada com motivo (placa antiga ou Mercosul, dígito verificador
do Renavam, repetida no arquivo, já enviada em lote anterior). O mesmo arquivo não entra duas vezes. As aceitas do
último lote vão para a Platform pela exportação `platform_placas_onboarding` (com a confirmação já existente). Rejeições
voltam ao cliente; quando ficam de fora de propósito, Operações registra o tratamento com motivo. O item `placas` do
modelo padrão ganhou a verificação `placas_conferidas` (último lote sem rejeição pendente e exportação confirmada depois
dele). Organizações que já têm modelo salvo ganham a verificação ao editar o modelo; o checklist já aberto não muda.
**Fora:** conferir placa × CNPJ no Detran/SNE (é a Platform que consulta).

# T-041 — Onboarding pede ao cliente o que depende dele (F19, ONB-003)
**Contexto:** itens que dependem do cliente (contrato, credenciais, planilha de placas, adesão ao SNE) só andavam se
alguém lembrasse de cobrar.
**Decisão:** o item do modelo pode ter `pedidoCliente` (texto como o cliente entende, sem termo interno; 022 guarda no
item). O supervisor, a partir de 1 dia de onboarding, manda ao ponto focal principal uma mensagem só
(`onboarding_pendencias_cliente`) com o que falta e o prazo de cada item; repete a cada 3 dias, no máximo 3 vezes; depois do
terceiro pedido, abre ligação para o CS (uma vez). Item feito sai do pedido. Consentimento e opt-out valem; sem ponto
focal, nada é enviado (o item de ponto focal já vira tarefa). A mensagem avisa para nunca enviar senha. Organizações com
modelo salvo ganham os pedidos ao editar o modelo; checklist já aberto não muda.
**Fora:** canal de resposta estruturado (o cliente responde pela conversa, que vira ocorrência normal).

# T-042 — Checklist de alteração de cliente ativo (F20, ONB-011)
**Contexto:** mudar módulos, dados, carteira ou ponto focal de um cliente ativo dependia de lembrar de avisar a Platform,
o Financeiro e o cliente.
**Decisão:** terceiro tipo de checklist, `alteracao` (023), no mesmo motor do onboarding/offboarding: motivo obrigatório
(o que muda), só para conta ativa, um aberto por vez. Itens padrão: combinado por escrito com o cliente (CS), Platform
atualizada com arquivo confirmado (Operações; verificação `carteira_confirmada`: exportação de carteira ou
provisionamento confirmada depois da abertura), Financeiro avisado (OMIE é dele), ponto focal conferido (automático),
VIP revisto (opcional) e cliente avisado. Concluir não muda a situação da conta e publica `conta.alteracao_concluida`.
Volta da migração cancela as abertas e mantém o histórico.
**Fora:** abrir a alteração sozinho a partir de um evento (ex.: venda de expansão ganha) — fica para a configuração de
processos.

# T-043 — Conta sem ponto focal válido vira tarefa (F21, RN-002, GOV-007)
**Contexto:** a conta sem ponto focal só mostrava um alerta na tela; os contatos de rodada ficavam bloqueados sem
ninguém ser cobrado.
**Decisão:** `clientes/ponto-focal-saude.js` na varredura do supervisor, sem migração. Ponto focal válido = principal
vigente, sem opt-out e com canal autorizado (a mesma regra do envio, `escolherCanal`). Conta ativa ou em onboarding sem
isso gera tarefa para a equipe da conta (VIP → CS, demais → Suporte, exceção vale), uma vez por situação (a chave muda
quando o ponto focal muda). Com pendência de rodada aberta é risco: prazo de 2 h e tarefa também para a Supervisão,
avaliada a cada varredura (a pendência pode surgir depois). Quando o ponto focal fica válido, as tarefas se fecham sozinhas
com o nome cadastrado. O bloqueio de marcos críticos continua onde já estava (envio bloqueado e item obrigatório do
onboarding).

# T-044 — Aviso de transferência não aceita e testes da triagem (F22, DEV-004, INT-008)
**Contexto:** a equipe de destino já era avisada da transferência pendente, mas a equipe que pediu não sabia quando o
prazo de aceite vencia e a ocorrência ia para a contingência; a supervisão da triagem não tinha teste próprio.
**Decisão:** a rotina de avisos (`agenda.jobAvisar`) passa a notificar a equipe de origem, uma vez, quando o handoff
expira. Testes dedicados cobrem a triagem (prazo próprio vencido → nível 1 e tarefa da Supervisão, continua na coluna da
triagem) e o ciclo de avisos da transferência.

# T-045 — Conferência automática das telas em 360 px (F23, RNF-012)
**Contexto:** cada fatia conferia as próprias telas à mão no Playwright; não havia uma passada em todas as telas.
**Decisão:** `npm run telas` (scripts/telas.js) sobe o Sinapse em memória com a demonstração, entra com oito personas,
abre cada item do menu e as telas de detalhe (conta, ocorrência) e confere: sem rolagem lateral em 360 px, campo com
rótulo, botão/link com nome, imagem com alt, `lang="pt-BR"`, tela sem erro e sem erro de JavaScript. Usa o Playwright
da máquina (não é dependência do projeto nem entra no CI dos testes). Autoteste (`TELAS_AUTOTESTE=1`) prova que os
problemas são apontados. Resultado em 06/11: 25 telas, 351 elementos, nenhum problema.
**Fora:** contraste de cores e ordem de foco (auditoria WCAG completa com ferramenta própria).

# T-046 — Vínculo conta ↔ OMIE sem troca nem repetição silenciosa (F24, FIN-002)
**Contexto (defeito):** a importação do CSV do OMIE trocava o código OMIE da conta quando o arquivo trazia outro para o
mesmo CNPJ, sem avisar; e o mesmo código podia ficar em duas contas (não havia regra no banco). Dois testes antigos
registravam a troca silenciosa como esperada.
**Decisão:** a importação só vincula código a conta que ainda não tem; código diferente do atual vira divergência
`omie_codigo_diferente` e código que já é de outra conta vira `omie_codigo_em_outra_conta` (a linha aparece como erro,
nada é trocado). 024 cria o índice único (organização, código OMIE) nas contas ativas, só se não houver duplicata —
nesse caso registra aviso e não altera dados. Os testes antigos passaram a usar o código real da conta.

# T-047 — Vitrine da demonstração em /demo
**Contexto:** a demonstração abria com dados só em parte das áreas (treinamentos, VIP, incidentes, consultas, ligações,
plantão, onboarding e lote de placas apareciam vazios) e o login listava pessoas sem dizer o que mostrar com cada uma.
**Decisão:** `/demo` mostra os modelos de acesso (um cartão por pessoa fictícia, com o que o perfil faz e um roteiro de
telas); "Entrar" abre o sistema já na tela do roteiro. `modulos/demo/vitrine.js` completa o seed pelos **serviços
reais** (cliente ganho → conta e onboarding, lote de placas com rejeições, treinamento, pedido de VIP, incidente,
melhoria e release, volume de consultas com alerta, ligações no modo de treino, plantão e delegação). Ligada por padrão
na demonstração; `SINAPSE_DEMO_VITRINE=0` deixa só o cenário mínimo, que é a base dos testes (a vitrine tem teste
próprio). Sem demonstração ligada, `/demo` só avisa que o ambiente guarda dados reais: nada de login sem senha.
**Consequência:** o ambiente com dados reais não tem `/demo`; para apresentar junto da produção, publique um segundo
serviço com `SINAPSE_DEMO=1` (banco próprio).

# T-048 — Saúde da conta configurável por organização (F25, CS-002)
**Contexto:** a fórmula de saúde da conta era fixa no código; o requisito pede indicadores transparentes e configuráveis.
**Decisão:** os pontos de cada critério e o corte de "em risco" ficam em `tenants.config.saude` (definidos na
implantação, como a alçada de desconto e o aviso de credencial); valor ausente ou fora de 0–100 usa o padrão. O
dashboard Carteira mostra a fórmula em vigor. Sem tela de edição nesta fatia: mudar a régua é decisão de gestão e
entra na implantação.
**Consequência:** a mesma régua vale para todos da organização; editar pela tela, com aprovação e histórico, fica como
melhoria se a Brobot pedir.

# T-049 — Leads de fora do sistema por webhook (F26, CRM-002)
**Contexto:** a oportunidade só nascia digitada no Sinapse; site, formulários de evento e parceiros não tinham entrada.
**Decisão:** `POST /api/leads/{organização}` com o mesmo token da entrada de mensagens (`SINAPSE_TOKEN_ENTRADA`). O
`idLead` do sistema de origem é único por organização (025): reenviar devolve a mesma oportunidade (200). Contato
(telefone normalizado ou e-mail) com oportunidade em andamento não abre outra: o pedido fica na auditoria dela. O dono é
a pessoa do Comercial disponível com menos oportunidades em andamento; sem ninguém, fica sem dono para a gestão. Caminho
próprio (e não `/api/entrada/...`) para não colidir com a entrada de mensagens. O teste de token foi para
`nucleo/token-entrada.js`, usado pelas duas rotas.
**Probabilidade por etapa (CRM-004/015):** padrão no código, com a da organização em
`tenants.config.comercial.probabilidades` (inteiros 0–100; inválido volta ao padrão); a fórmula exibida é montada com
os valores em vigor.

# T-050 — Teto de avisos por hora e fila técnica (F27, COM-009, DEV-002, REC-005)
**Contexto:** o sino já não repetia o mesmo aviso, mas uma pessoa podia receber dezenas de avisos de uma vez; a
gravidade só aparecia na cor. Demandas técnicas não tinham uma visão única do pedido à validação.
**Decisão:** até 10 avisos não críticos por pessoa por hora; passou disso, um aviso de resumo e os demais ficam para o
ciclo seguinte (o lembrete só é marcado como avisado quando o aviso sai). Urgente (crítico) nunca espera e aparece
primeiro. A gravidade vai escrita no aviso e o número de não lidos entra no nome do botão. A aba "Fila técnica" do
Desenvolvimento lista, numa consulta só e paginada, o que aguarda aceite, o que está com o Desenvolvimento e o que voltou
aguardando a validação da operação, por prioridade e prazo.
**Consequência:** o teto é fixo no código (10/h); se a Brobot quiser outro número, vira configuração da organização.

# T-051 — Contraste AA, foco visível e teste de carga (F28, RNF-012, RNF-003)
**Contexto:** a conferência de telas não olhava contraste nem foco; não havia medida de desempenho.
**Decisão:** nível-alvo de acessibilidade WCAG AA. `npm run telas` passou a medir o contraste de todo texto visível
(4,5:1; 3:1 no texto grande), recusar tabindex positivo e percorrer com Tab conferindo foco visível; o autoteste injeta
5 problemas e precisa apontar os 5. Achado: o botão principal tinha 4,03:1; `--destaque` foi de #1683d2 para #1372bd
(5,04:1). A cor de marca da organização (white-label) só é aplicada se aguentar texto branco com 4,5:1; senão fica a
padrão. `npm run carga` sobe a demonstração completa e mede P50/P95 das chamadas das telas do dia a dia com usuários
simultâneos; sai com erro se o P95 passar de 2 s.
**Resultado medido (07/11, banco embutido, 4 núcleos):** 20 usuários P95 ≈ 0,2 s; 50 usuários P95 ≤ 0,73 s; cerca de
130 pedidos/s (limite do processo único). Repetir no ambiente de produção quando ele for dimensionado (R-06/R-07).

# T-052 — Envio em duas fases e job sem fim (auditoria de 08/11, R-20, R-21)
**Contexto:** o job `comunicacao.enviar` chamava o provedor dentro da própria transação. Uma falha entre o envio e o
commit desfazia a confirmação e o job reenviava. Pela política "não presumir entrega exatamente uma vez", isso é efeito
duplicado ao cliente.
**Decisão:**
- **Fase 1, na transação do job:** a interação passa a `enviando` (com `envio_iniciado_em`).
- **Fase 2, em transação própria (`depois`):** chama o provedor e confirma `enviada`. O worker agora entrega `{ db }` ao
  handler só para esse uso.
- **Provedor recusou** (erro comum): volta a `enfileirada` e o job retenta.
- **Pode ter saído** (`envioIncerto`: tempo esgotado na Meta, falha no meio pelo QR) ou queda do processo: fica
  `enviando`. Depois de 10 minutos o supervisor marca `incerta`, audita e cria a tarefa "conferir se chegou; reenviar
  só se não chegou". Nenhum reenvio automático.
- **Job sem fim:** na devolução de jobs presos, quem já esgotou as tentativas vai para a fila de falhas, com auditoria.

**Consequência:** em caso de dúvida, o sistema prefere pedir conferência humana a arriscar a duplicidade. A migração
026 é aditiva; a volta converte `enviando`/`incerta` em `falhou` com o motivo.

