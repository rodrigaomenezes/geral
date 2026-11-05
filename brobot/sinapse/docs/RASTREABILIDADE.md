# Rastreabilidade — requisito → código → teste

Base: *Especificação de Requisitos do ERP Operacional Brobot v1.0* (04/11/2026, estado PROPOSTO). Legenda:
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
