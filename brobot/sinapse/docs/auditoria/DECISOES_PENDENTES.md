# Decisões pendentes (bloqueantes primeiro)

| # | Decisão | Origem | Opções | Consequência de cada uma |
| --- | --- | --- | --- | --- |
| DP-01 | **Ambiente que a Brobot vai acessar agora é demonstração ou produção?** | Diretriz §4; R-01 | (a) demonstração com dados fictícios e aviso fixo; (b) produção com dados reais | (a) mantém o login por persona; (b) exige DP-02, MFA, `SINAPSE_DEMO=0`, banco gerenciado e backup **antes** do primeiro dado real |
| DP-02 | Banco de produção | R-06 | (a) PostgreSQL gerenciado do Railway; (b) PGlite no Volume | (a) backup/PITR do provedor, réplica; (b) mais simples, sem PITR, processo único |
| DP-03 | WhatsApp: API oficial, QR ou os dois | Pedido de 05/11 ("inclua o QR Code"); R-13 | (a) só oficial; (b) QR enquanto a oficial não sai; (c) os dois, um ativo por vez (implementado) | QR tem risco de bloqueio do número; oficial exige conta Meta e templates |
| DP-04 | Teste/piloto obrigatório antes do fechamento para **todo** produto? | Pedido de 05/11 ("padrão aquisição com fase de teste") × Diretriz CRM-012 ("sem obrigatoriedade presumida") | (a) obrigatório sempre (hoje, CHECK no banco); (b) por produto, configurável | (b) exige catálogo de produtos (CRM-009) e migração aditiva que relaxa o CHECK por produto |
| DP-05 | Layouts CSV de Platform e OMIE | Adendo CSV | Enviar amostras reais sanitizadas de cada fluxo | Sem amostra, os contratos seguem como "PENDENTE DE VALIDAÇÃO" |
| DP-06 | Critério VIP (quem aprova, validade) | Reunião 03/11, ponto em aberto | — | GOV-002 fica parcial |
| DP-07 | Regra "1 CNPJ com erro desativa a rodada" | Foto pré-rodada; RN-010 | Condições e quem autoriza | Não será automatizada até a decisão |
| DP-08 | Quem autoriza o comunicado pós-rodada e o que fazer quando o cliente atende a ligação | Reunião 03/11 | — | PRE-011 parcial |
| DP-09 | Critério de sucesso do onboarding por produto | RN-010; ONB-008/010 | — | Onboarding pode ser montado com checklist configurável e critério "a homologar" |
| DP-10 | Central de pendências do cliente: o Sinapse fornece os dados e a Platform exibe? | COM-008; BL-04 | — | Sem decisão, fica fora |
| DP-11 | Kanban de tickets: colunas por **estado da ocorrência** ou por **etapa de trabalho configurável**? | Pedido de 05/11 ("tickets com tarefas… visão Kanban") | (a) estados da máquina (sem schema novo); (b) colunas configuráveis por equipe | (a) arrastar = transição validada pela máquina (com evidência/motivo quando exigido); (b) exige tabela e regra nova |
| DP-12 | Documentos originais: as seis fotos manuscritas não estão salvas no ambiente (foram vistas na conversa) | Diretriz §0.3 | Enviar como arquivo para guardar fora do repositório público | A matriz usa a especificação e a ata da reunião, que estão disponíveis |
