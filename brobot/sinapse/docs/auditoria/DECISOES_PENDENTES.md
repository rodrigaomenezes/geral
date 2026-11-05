# Decisões pendentes (bloqueantes primeiro)

**Respondidas em 05/11 ("tudo sim"):** DP-03 = os dois provedores (QR implementado com aviso de risco); DP-08b = opção (a);
DP-11 = opção (a), colunas pelos estados; F0 aprovada. DP-01: segue **demonstração** até haver banco gerenciado e MFA
(a pergunta era a/b; "sim" foi lido como manter a apresentação).

| # | Decisão | Origem | Opções | Consequência de cada uma |
| --- | --- | --- | --- | --- |
| DP-01 | **Ambiente que a Brobot vai acessar agora é demonstração ou produção?** | Diretriz §4; R-01 | (a) demonstração com dados fictícios e aviso fixo; (b) produção com dados reais | (a) mantém o login por persona; (b) exige DP-02, MFA, `SINAPSE_DEMO=0`, banco gerenciado e backup **antes** do primeiro dado real |
| DP-02 | Banco de produção | R-06 | (a) PostgreSQL gerenciado do Railway; (b) PGlite no Volume | (a) backup/PITR do provedor, réplica; (b) mais simples, sem PITR, processo único |
| DP-03 | WhatsApp: API oficial, QR ou os dois | Pedido de 05/11 ("inclua o QR Code"); R-13 | (a) só oficial; (b) QR enquanto a oficial não sai; (c) os dois, um ativo por vez (implementado) | QR tem risco de bloqueio do número; oficial exige conta Meta e templates |
| DP-04 | Teste/piloto obrigatório antes do fechamento para **todo** produto? | Pedido de 05/11 ("padrão aquisição com fase de teste") × Diretriz CRM-012 ("sem obrigatoriedade presumida") | (a) obrigatório sempre (hoje, CHECK no banco); (b) por produto, configurável | (b) exige catálogo de produtos (CRM-009) e migração aditiva que relaxa o CHECK por produto |
| DP-05 | Layouts CSV de Platform e OMIE | Adendo CSV; **resposta de 05/11: as amostras não podem ser obtidas agora** | (a) manter os layouts propostos e publicar os modelos para quem extrai; (b) **mapeamento de colunas na importação** (a pessoa liga cada coluna do arquivo real ao campo do Sinapse na prévia, e o mapa fica salvo e versionado por fluxo) | Proposta: (a)+(b) na F2. Os contratos seguem PENDENTE DE VALIDAÇÃO até o primeiro arquivo real passar pela prévia; nenhuma ação é dada como feita só porque um CSV foi gerado |
| DP-06 | Critério VIP (quem aprova, validade) | Reunião 03/11, ponto em aberto | — | GOV-002 fica parcial |
| DP-07 | Regra "1 CNPJ com erro desativa a rodada" | Foto pré-rodada; RN-010 | Condições e quem autoriza | Não será automatizada até a decisão |
| DP-08 | Quem autoriza o comunicado pós-rodada | Reunião 03/11 | — | PRE-011 parcial |
| DP-08b | **Divergência encontrada:** a ata diz "se não atender, formaliza por mensagem no grupo e para o ponto focal" e deixa em aberto o caso em que atende; a foto da pré-rodada diz "2ª ligação + mensagem caso não atenda; **caso atenda, formalizar no grupo**" | Ata 03/11 × foto Pré-rodada | (a) atendeu → formaliza o combinado no grupo; não atendeu → mensagem no grupo e ao ponto focal (junta as duas fontes); (b) manter como está | Hoje o processo padrão só formaliza quando **não** atende. A correção é de configuração do processo (editável na tela Processos, nova versão auditada), sem código novo. Confirme a (a) |
| DP-09 | Critério de sucesso do onboarding por produto | RN-010; ONB-008/010 | — | Onboarding pode ser montado com checklist configurável e critério "a homologar" |
| DP-10 | Central de pendências do cliente: o Sinapse fornece os dados e a Platform exibe? | COM-008; BL-04 | — | Sem decisão, fica fora |
| DP-11 | Kanban de tickets: colunas por **estado da ocorrência** ou por **etapa de trabalho configurável**? | Pedido de 05/11 ("tickets com tarefas… visão Kanban") | (a) estados da máquina (sem schema novo); (b) colunas configuráveis por equipe | (a) arrastar = transição validada pela máquina (com evidência/motivo quando exigido); (b) exige tabela e regra nova |
| DP-12 | Documentos originais | Diretriz §0.3 | Recebidos em 05/11: especificação, ata e 5 fotos (Melhorias Plataforma, Placas Recorrentes, Pré-rodada, Pós-rodada, Onboarding), guardados **fora do repositório** (área temporária da sessão). **Falta a foto Treinamentos CS** | CS-005…009 seguem pela especificação; a foto pode trazer detalhe novo |
