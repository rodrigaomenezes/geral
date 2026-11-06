# Rastreabilidade — requisito → código → teste

Base: *Especificação de Requisitos do ERP Operacional Brobot v1.0* (04/11/2026, estado PROPOSTO). **Desde a auditoria de
05/11, a classificação oficial e mais rigorosa (testado × sem teste × parcial × bloqueado) está em
[`auditoria/MATRIZ_REQUISITOS.csv`](auditoria/MATRIZ_REQUISITOS.csv)**; esta página é o resumo por entrega. Legenda:
**✔ demonstrado** (funciona e tem teste ou tela), **◐ parcial** (base pronta, falta parte), **○ fase futura**.
Testes: `test/aceite.test.js` (AT-xxx) e `test/regras.test.js`.

## Matriz de aceite (seção 12)

| Teste | Situação | Onde |
| --- | --- | --- |
| AT-001 mensagem sem cliente | ✔ | `entrada/servico.js` · teste AT-001 |
| AT-002 webhook três vezes | ✔ | `entradas` única + auditoria · teste AT-002 |
| AT-003 responsável indisponível | ✔ | `identidade.resolverResponsavel`, supervisor · teste AT-003 |
| AT-004 Redmine indisponível | ✔ por desenho | Sinapse não depende do Redmine (nenhuma integração com ele) |
| AT-005 Platform indisponível | ✔ | job em retentativa, checkpoint/falhas em `integracoes` · teste AT-005 |
| AT-006 OMIE indisponível | ✔ | `omie-sync.js` mantém o último status · teste AT-006 |
| AT-007 WhatsApp falha | ✔ | `comunicacao/servico.js` (retentativa + e-mail) · teste AT-007 |
| AT-008 correção no D-3 | ✔ | `rodadas.revalidar` encerra o processo de cadência na hora · teste AT-008 |
| AT-009 pós-rodada sem correção | ✔ | comunicado no grupo, D+3 ao ponto focal, pendência persistente · teste AT-009 |
| AT-010 handoff não aceito | ✔ | supervisor → Contingência + tarefa · teste AT-010 |
| AT-011 concorrência | ✔ | trava otimista (`version`) + `FOR UPDATE` · teste AT-011 (PostgreSQL real no CI) |
| AT-012 evento após encerramento | ✔ | reabertura em até 7 dias · teste AT-012 |
| AT-013 watchdog parado | ✔ | `/api/health/supervisor` 503 · teste AT-013 |
| AT-014 tenant A lê B | ✔ | RLS + auditoria · teste AT-014 |
| AT-015 bloqueio por inadimplência | ✔ | recusado e auditado · teste AT-015 |
| AT-016 falha de migração | ✔ | migração transacional com volta · teste AT-016 |

## Regras de negócio (seção 7)

| Regra | Situação | Onde |
| --- | --- | --- |
| RN-001 VIP→CS, demais→Suporte, exceção | ✔ | `clientes.equipeDaConta`; CHECK de justificativa |
| RN-002 ponto focal obrigatório | ✔ | alertas da conta; tarefa antes do D-3; contato bloqueado sem canal |
| RN-003 D-4, D-3, intermediária, D-1 | ✔ | `rodadas/servico.js` (`MARCOS`) |
| RN-004 pós-rodada + D+3 sem apagar pendência | ✔ | `jobExecutar`, teste AT-009 |
| RN-005 correção cancela contatos | ✔ | `marcarCorrigida`, teste AT-008 |
| RN-006 ocorrência com vários veículos | ✔ | `ocorrencia_itens` |
| RN-007 handoff com aceite ou fallback | ✔ | máquina + supervisor |
| RN-008 sem dono/prazo/próxima ação | ✔ | CHECK `ativa_completa` |
| RN-009 evidência / motivo | ✔ | máquina + CHECKs |
| RN-010 bloqueio por CNPJ e critério de onboarding | ○ | depende de homologação (seção 16) |
| RN-011 OMIE autoritativo | ✔ | só leitura; nada financeiro é calculado |
| RN-012 regra versionada e reversível | ✔ | processos com versões imutáveis, restauração e simulação (`modulos/processos`) |
| RN-013 IA sem decisão | ✔ | não há IA; classificação determinística |
| RN-014 sem efeito duplicado | ✔ | chaves únicas em entradas, eventos, jobs, pendências, tarefas, contatos |
| RN-015 sem perda silenciosa | ✔ | fila de falhas + auditoria + interação marcada como falha |

## Requisitos funcionais (seção 6)

| Grupo | Demonstrado | Parcial / futuro |
| --- | --- | --- |
| GOV | 001 (organizações, equipes, perfis), 002 (VIP com critério/aprovador/validade), 003 (substituto), 004, 005, 006 (histórico), 007, 008 (feriados, expediente, SLA) | 009 delegação temporária ○, 010 matriz RACI na tela ○ |
| INT | 001, 002, 003, 004, 005, 007, 008, 010 (busca por cliente/CNPJ/protocolo) | 006 dividir/mesclar ◐ (tabela de vínculos pronta, sem tela), 009 anexos ○ |
| WFL | 001, 002, 003 (processos), 004, 005, 006, 007, 008, 009, 010, 011, 012, 013 (versões de processo), 014, 015 (concorrência e laço) | — |
| ONB | 001 (venda ganha cria o onboarding), 002 ◐, 004 ◐ (exportação de provisionamento) | 003, 005–012 ○ |
| PRE | 001, 002, 003, 004, 005, 006, 007, 008, 009, 010 (escalonamento), 012 (taxa de correção) | 011 comunicado final ◐ (resultado enviado; quem autoriza é pendência decisória) |
| POS | 001, 002, 003, 004, 005, 006, 007, 008, 010 | 009 recomendação de RCA ◐ (contador de recorrência) |
| REC | 002 (categorias), 003, 004 (erro técnico → Desenvolvimento) | 001, 005–008 ◐/○ (volumetria da Platform) |
| CRE | 001, 002 (status), 005, 006, 007, 008 | 003 consultas não geradas ○, 004 alerta de expiração ◐ (data exibida) |
| COM | 001, 003, 004, 005 (status de entrega real), 006, 007, 009, 010 (processo semanal com opt-out) | 002 aprovação de modelos ○, 008 central do cliente ○ (Platform) |
| CS | 001 (carteira VIP), 002 (saúde da conta com motivos), 003 ◐ (último login por CSV), 011 ◐ (Comercial no mesmo sistema), 010 (insights CaçaCondutores semanais, desligado até revisão) | 002–009, 011, 012 ○ (Fase 4) |
| DEV | 001, 002, 004, 005 | 003 sincronizar ferramenta técnica ○, 006 incidentes ○, 007 ◐, 008 ○ |
| FIN | 001, 002, 003, 005, 006, 007, 008, 009, 010 | 004 eventos ao Financeiro ◐ (outbox gravado, sem envio) |
| SUP | 001, 002, 003, 005, 006 (6 dashboards), 007, 009 (correlação por requisição), 010 (processos com simulação e restauração), 012 (automação × manual) | 004 reconciliação Platform ◐ (OMIE pronto), 008 LGPD ○, 011 contingência de canal ◐ |

## Não funcionais (seção 10)

RNF-002 durabilidade (entrada gravada antes de responder 202) ✔ · RNF-004 eventos em até 60 s (ciclo de 2 s) ✔ ·
RNF-005 TLS (Railway), segregação por organização ✔, MFA ○ · RNF-007 100% das transições com ator, motivo e
correlação ✔ · RNF-010 módulos coesos e testes ✔ · RNF-012 responsivo 360 px ✔. Os demais dependem de
dimensionamento e da infraestrutura definitiva.

## Decisões da reunião de 03/11/2026 (Suporte e Operações)

| Decisão / dor | Situação | Onde |
| --- | --- | --- |
| VIP sempre com o CS, demais com o Suporte | ✔ | RN-001 (`equipeDaConta`), passos com equipe "da conta" |
| 1 ponto focal (nome + contato) por cliente | ✔ | pontos focais com histórico; alerta e tarefa quando falta |
| Força-tarefa de pontos focais (CS: VIP; Suporte: demais) | ✔ | processo "Força-tarefa", botão "Executar agora" |
| Pré-rodada: D-3 WhatsApp → ligação (não atendeu: formaliza no grupo e com o ponto focal) → D-1 ligação + mensagem | ✔ | processo padrão de pré-rodada, ligação com resultado |
| Após a rodada oficial: comunicado de sucesso/falha por veículo pedindo aviso da correção | ✔ | processo de pós-rodada (comunicado no grupo) |
| Pós-rodada: grupo, depois de 3 dias um follow-up ao ponto focal e encerra | ✔ | processo de pós-rodada; a pendência segue visível |
| Placas recorrentes: Desenvolvimento aciona o Suporte (hoje por e-mail) | ✔ | processo "Erro de consulta: Desenvolvimento aciona o Suporte" |
| Mensagens padrão reescritas pela equipe | ◐ | modelos versionados em código; edição na tela na próxima entrega |
| Telas de sucesso da pré e pós-rodada (melhoria 6) | ◐ | indicadores no Painel; dashboards dedicados na próxima entrega |
| Insights CaçaCondutores 1x/semana (melhoria 5) | ◐ | processo semanal pronto, desligado até o texto ser revisado |
| Erros invisíveis, central de pendências, último login, frequência de consulta (melhorias 3, 4, 7, 8) | ○ | dependem de dados/telas da Platform |
| Treinamento coletivo do CS e documento por tela | ○ | Fase 4 (CS) |
| Pontos em aberto da reunião (critério VIP, regra "1 CNPJ desativa a rodada", formalização quando atende, quem autoriza o comunicado) | aguardando decisão | os processos permitem ajustar sem código quando forem decididos |

## Entrega de 05/11/2026 (Meu dia, Comercial, CSV)

| Item | Situação | Onde |
| --- | --- | --- |
| Meu dia: atrasado, hoje, transferências para a equipe, aguardando cliente, lembretes, oportunidades | ✔ | `modulos/agenda`, tela inicial |
| Lembretes pessoais e de equipe, recorrentes, adiar; criados também por processos | ✔ | passo "Criar lembrete" |
| Central de notificações (lembrete vencido, escalonamento, transferência) sem repetição | ✔ | sino no topo |
| Comercial: funil com teste antes do fechamento, quadro, indicadores, venda → onboarding | ✔ | `modulos/comercial` |
| Platform/OMIE por CSV (rodadas, credenciais, uso, situação financeira; exportações) | ✔ | `modulos/integracoes/csv` |
| Telefonia (treino, SIP/WebRTC, celular) ligada às tarefas de ligação dos processos | ✔ | `modulos/telefonia`, softphone |
| WhatsApp oficial: envio, webhook assinado, deduplicação, status entregue/lida | ✔ | `integracoes/whatsapp-*` |
| WhatsApp por QR, gravação, fila de ligações, templates fora da janela de 24 h | ○ | próximas entregas |
| Identidade visual Brobot | ✔ | `public/styles.css`, `public/fonts` |

## Entrega de 05/11/2026 (dashboards e mensagens)

| Item | Situação | Onde |
| --- | --- | --- |
| Dashboards: operação, rodadas (sucesso pré/pós — melhoria 6), carteira/CS, comercial, pessoas, automação | ✔ | `modulos/painel/dashboards.js`, tela Dashboards |
| Mensagens padrão editáveis com revisão (reunião 03/11: o Meira reescreve com as equipes) | ✔ | `comunicacao/modelos-servico.js`, tela Mensagens |
| Template da Meta por mensagem (envio fora da janela de 24 h) | ✔ | aprovação da mensagem |

## Entrega de 05/11/2026 (auditoria: F0 segurança, F1 quadro, WhatsApp QR)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Demonstração explícita em produção, faixa fixa, `SINAPSE_AMBIENTE=producao` (R-01/R-02) | ✔ testado | `config.js` · `test/seguranca.test.js` |
| TLS do PostgreSQL com verificação de certificado (R-03) | ✔ testado | `db/index.js` `opcoesTls` · `seguranca.test.js` |
| Limite de tentativas de login → 429 (R-04) | ✔ testado | `identidade/limitador.js` · `seguranca.test.js` |
| HSTS em produção; `npm run verificar` no CI (R-10, R-17) | ✔ | `http/servidor.js`, `scripts/verificar.js` |
| Testes não dependem mais do relógio real (R-14) | ✔ | `test/aceite.test.js` |
| Quadro (Kanban) de ocorrências com responsável, tarefas x/y e próxima ação; arrastar ou "Mover para…" = transição da máquina | ✔ testado | `ocorrencias/servico.js` `quadro`, tela Quadro · `test/quadro.test.js` |
| Tela não oferece "Assumir"/"Transferir" fora da equipe dona | ✔ testado | `maquina.acoesPermitidas` · `regras.test.js` |
| WhatsApp por QR Code: conectar, receber (dedup), responder, eco do celular, status, queda (INT-001, INT-007, COM-005, COM-007, BL-09) | ✔ testado com simulador | `integracoes/whatsapp-qr.js`, tela Canais · `canais.test.js` |
| Pré-rodada: ligação atendida formaliza o combinado no grupo (DP-08b) | ✔ testado | processo padrão · `processos.test.js` |
| Processo padrão inválido deixava de ser criado em silêncio | ✔ corrigido | `processos/padroes.js` · teste de guarda |

## Entrega de 05/11/2026 (F2 · CSV com lotes e usuários de teste)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Mapeamento de colunas do arquivo real, versionado por fluxo e auditado (adendo CSV §2–3, §10) | ✔ testado | `integracoes/csv/mapa.js`, `servico.js` · `test/csv-lotes.test.js` |
| Importação com estado completa/parcial e mapa usado; frescor por fluxo na tela | ✔ testado | migração 007 · `csv-lotes.test.js` |
| Exportação = lote aguardando confirmação; confirmar/falhou com evidência; atraso → divergência + tarefa (adendo CSV §4–6, SUP-004 parcial) | ✔ testado | `exportacoes`, `csv/lotes.js`, supervisor · `csv-lotes.test.js` |
| Usuários de teste por perfil com senha de variável de ambiente | ✔ testado | `identidade/usuarios-teste.js` · `seguranca.test.js` |
| Reprocessamento autorizado do mesmo arquivo, retorno automático do destino | ○ | próxima fatia de CSV |

## Entrega de 05/11/2026 (F3a · Comercial como CRM)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Catálogo de produtos com "exige teste" por produto (CRM-009, DP-04) | ✔ testado | `comercial/catalogo.js` · `test/comercial-crm.test.js` |
| Propostas versionadas, imutáveis depois de enviadas, com alçada de desconto (CRM-007, CRM-008) | ✔ testado | `comercial/propostas.js`, migração 008 · `comercial-crm.test.js` |
| Atividades da negociação e linha do tempo (CRM-005, CRM-010) | ✔ testado | `comercial/atividades.js` · `comercial-crm.test.js` |
| Suspender, retomar e reabrir com motivo (CRM-011) | ✔ testado | `comercial/servico.js` · `comercial-crm.test.js` |
| Migração dos negócios abertos do Pipedrive por CSV (CRM-018 parcial) | ✔ testado | `csv/importadores.js` `pipedrive_negocios` · `comercial-crm.test.js` |
| Datas sem hora corretas na tela; layout do funil comercial restaurado | ✔ corrigido | `db/index.js`, `dom.js`, `styles.css` · `regras.test.js` |
| Múltiplos funis, pessoas × organizações, renovação/expansão, previsão (CRM-001/003/014/015) | ○ | F3b |

## Entrega de 05/11/2026 (F3b · funis, pessoas e previsão)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Funis de aquisição, expansão e renovação com regras próprias (CRM-003 parcial, CRM-014) | ✔ testado | `comercial/servico.js`, migração 009 · `test/comercial-funis.test.js` |
| CS encaminha expansão/renovação ao Comercial pela Carteira (CS-011) | ✔ testado | rota `/api/comercial/encaminhar`, tela Carteira · `comercial-funis.test.js` |
| Pessoas da negociação sem duplicar por telefone/e-mail (CRM-001) | ✔ testado | `comercial/contatos.js` · `comercial-funis.test.js` |
| Previsão de fechamento ponderada por etapa e mês, com fórmula (CRM-015) | ✔ testado | `funil.previsao` · `comercial-funis.test.js` |

## Entrega de 05/11/2026 (F4 · onboarding e offboarding por checklist)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Venda de cliente novo abre o onboarding com checklist (ONB-001) | ✔ testado | `onboarding/servico.js`, `comercial/servico.js` · `test/onboarding.test.js` |
| Checklist por grupo: administrativa, técnica, financeira, relacionamento (ONB-002, 005, 007, 009) | ✔ testado | `onboarding/modelos.js` · `onboarding.test.js` |
| Verificação automática quando há dado (ponto focal, credenciais, provisionamento, 1ª rodada, OMIE) (ONB-008 parcial) | ✔ testado | `VERIFICACOES` · `onboarding.test.js` |
| Concluir só com tudo feito ou exceção aprovada por outra pessoa (ONB-010) | ✔ testado | migração 010 (CHECK) · `onboarding.test.js` |
| Item vencido vira tarefa da equipe (ONB-003 parcial) | ✔ testado | supervisor · `onboarding.test.js` |
| Modelo versionado, aberto não muda (ONB-011 parcial) | ✔ testado | `checklist_modelos` · `onboarding.test.js` |
| Offboarding com motivo, pendências conferidas, conta encerrada sem apagar (ONB-012, CS-012) | ✔ testado | `onboarding.test.js` |

## Entrega de 06/11/2026 (F5 · monitoramento de consultas, credenciais e reincidência)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Volumetria de consultas por CSV, por conta/produto/dia (REC-001, REC-002) | ✔ testado | importador `platform_consultas`, migração 011 · `test/monitoramento.test.js` |
| Consultas esperadas não geradas = erro invisível, com causa provável na credencial (CRE-003, BL-03) | ✔ testado | `monitoramento/regras.js` · `monitoramento.test.js` |
| Robô parado há 3 dias (REC-007) e erro técnico para o Desenvolvimento (REC-004) | ✔ testado | `monitoramento.test.js` |
| Uma ocorrência ativa por alerta (REC-003) | ✔ testado | `ocorrencias.alerta_chave` (índice único) · `monitoramento.test.js` |
| Credencial vencendo em até 15 dias (CRE-004) e reincidência na 3ª vez (POS-009) | ✔ testado | supervisor · `monitoramento.test.js` |
| Tela Consultas: esperado × gerado, erros por tipo, alertas abertos (REC-008) | ✔ | `public/js/telas/consultas.js` |

## Entrega de 06/11/2026 (F6 · treinamentos coletivos do CS)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Conta sem uso vira alerta para o CS oferecer treinamento (CS-004) | ✔ testado | `treinamentos.verificarInatividade` (supervisor) · `test/treinamentos.test.js` |
| Sessões coletivas, convites ao ponto focal, presença (CS-005) | ✔ testado | `treinamentos/servico.js`, migração 012 · `treinamentos.test.js` |
| Roteiro versionado por tela, imprimível (CS-006) | ✔ testado | `treinamento_roteiros` · `treinamentos.test.js` |
| Conta de demonstração, nunca de cliente (CS-007) | ✔ testado | `criarSessao` · `treinamentos.test.js` |
| Dúvidas, avaliação e próximo passo; ausente vira tarefa de reagendar (CS-008) | ✔ testado | `treinamentos.test.js` |
| Efetividade pelo uso antes × depois, presentes × ausentes (CS-009) | ✔ testado | `detalhe.efetividade` · `treinamentos.test.js` |

## Entrega de 06/11/2026 (F7 · Desenvolvimento)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Evidência sem segredo (senha, token, chave) (DEV-001) | ✔ testado | `nucleo/sanitizar.js` · `test/desenvolvimento.test.js` |
| Validação operacional depois da release, por quem não desenvolveu (DEV-005) | ✔ testado | `desenvolvimento/servico.js` · `desenvolvimento.test.js` |
| Incidentes: severidade, clientes afetados, aviso, linha do tempo, post-mortem obrigatório (DEV-006) | ✔ testado | migração 013 · `desenvolvimento.test.js` |
| Problema recorrente ligado à ação preventiva; ocorrências avisadas (DEV-007) | ✔ testado | `melhoria_ocorrencias` · `desenvolvimento.test.js` |
| Backlog com aprovação por outra pessoa e releases (DEV-008) | ✔ testado | `melhorias`, `releases` · `desenvolvimento.test.js` |
| Sincronizar com ferramenta técnica (DEV-003) | ○ bloqueado | sem API autorizada |

## Entrega de 06/11/2026 (F8a · MFA, sessão e LGPD)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Verificação em duas etapas (TOTP) com ativação por QR, login em duas etapas, sem reuso de código (RNF-005, R-05) | ✔ testado | `nucleo/totp.js`, `identidade` · `test/mfa-lgpd.test.js` |
| MFA obrigatório para Administração e Supervisão; redefinição pela Administração | ✔ testado | `http/servidor.js` · `mfa-lgpd.test.js` |
| Sessão expira por inatividade (R-19) | ✔ testado | `sessaoPorToken` · `mfa-lgpd.test.js` |
| Pedido do titular: localizar, exportar e anonimizar, auditado sem o dado (SUP-008, RNF-006) | ✔ testado | `modulos/lgpd` · `mfa-lgpd.test.js` |
| Backup/restauração, monitor externo, web × worker | ○ configuração | README, seção "Operação em produção" |

## Entrega de 06/11/2026 (F9 · Governança)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Delegação temporária com expiração, revogação e auditoria; sem corrente; repasse das abertas (GOV-009) | ✔ testado | `modulos/governanca`, `identidade.resolverResponsavel`, supervisor · `test/governanca.test.js` |
| Matriz RACI por processo, um aprovador, responsável vigente (delegado/substituto/plantão), sugestão inicial (GOV-010, GOV-003) | ✔ testado | `governanca/servico.js` · `governanca.test.js` |
| Plantão por equipe: ocorrência nova vai ao plantonista (GOV-008) | ✔ testado | `ocorrencias/servico.js` · `governanca.test.js` |
| SLA por contrato na conta, sem fator VIP (GOV-008) | ✔ testado | `ocorrencias/sla.js`, `contas.sla_contrato` · `governanca.test.js` |
| Unidades e cadastro de equipes/usuários por tela (GOV-001) | ○ pendente | — |

## Entrega de 06/11/2026 (F9b · Implantação real e Pessoas)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Implantação real sem demonstração: organização, feriados, matriz e primeira Administração por variável (GOV-001) | ✔ testado | `organizacao/implantacao.js` · `test/implantacao.test.js` |
| Cadastro de pessoas e equipes, senha temporária com troca obrigatória, perfil, substituto, desativar sem apagar (GOV-001) | ✔ testado | `identidade/pessoas.js` · `test/pessoas.test.js` |
| Trocar a própria senha e marcar ausência | ✔ testado | `/api/senha`, `/api/eu/disponivel` · `pessoas.test.js` |
| Unidades | ○ pendente | — |

## Entrega de 06/11/2026 (F10 · Ocorrências ligadas)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Relacionar, mesclar (duplicada → principal) e dividir ocorrências sem apagar (INT-006) | ✔ testado | `ocorrencias/vinculos.js` · `test/vinculos.test.js` |

## Entrega de 06/11/2026 (F11 · Relógio da espera)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Tempo de dependência externa (cliente/terceiro) separado e fora do prazo de resolução (WFL-006) | ✔ testado | `ocorrencias/sla.js`, `aplicar` · `test/espera.test.js` |

## Entrega de 06/11/2026 (F12 · VIP com aprovação)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| VIP por pedido e aprovação de outra pessoa, critério, validade, aviso, saída automática e histórico (GOV-002) | ✔ testado | `clientes/vip.js`, supervisor · `test/vip.test.js` |

## Entrega de 06/11/2026 (F13 · Ciência do escalonamento)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Escalonamento por níveis com ciência e ação registradas (WFL-007) | ✔ testado | `ocorrencias/escalonamento.js`, supervisor · `test/escalonamento.test.js` |
| Intervenção excepcional com justificativa e auditoria (WFL-014) | ✔ testado | `ocorrencias/servico.js reatribuir` · `escalonamento.test.js` |

## Entrega de 06/11/2026 (F14 · O que para em silêncio)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Filas paradas, rotinas inativas e webhooks interrompidos detectados (SUP-002) | ✔ testado | `supervisor/saude-canais.js` · `test/saude-canais.test.js` |

## Entrega de 06/11/2026 (F15 · Testes do que já existia)

| Item | Situação | Onde · teste |
| --- | --- | --- |
| Insights do CaçaCondutores 1x por semana, opt-out, sem repetir na semana, começa desligado (CS-010, BL-05, COM-010) | ✔ testado | processo padrão + `jobAgenda` · `test/insights-semanais.test.js` |
| Correção posterior ligada ao histórico original (POS-008) | ✔ testado | `rodadas.revalidar/marcarCorrigida` · `test/correcao-posterior.test.js` |
| Escalonar risco de rodada bloqueada (PRE-010) | ○ pendente | precisa de nova versão do processo padrão de pré-rodada (decisão do cliente sobre quando escalar) |
