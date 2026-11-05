# Roteiro da apresentação (≈ 15 minutos)

Antes: abra o link publicado, entre como **Marina Costa (Supervisão)** e, **no dia da apresentação**, use
Simulador → *Reiniciar demonstração* (as datas das rodadas são relativas ao momento em que a demonstração é criada).
Deixe outra aba (janela anônima) com **Rafael Lima (Suporte)**.

## 0. Cada pessoa abre o sistema no "Meu dia" (1 min)
Entre como **Rafael (Suporte)**: o Meu dia junta o que está atrasado, o que vence hoje, as transferências para a equipe
e os lembretes (com adiar e "feito"). O sino mostra os avisos (lembrete vencido, escalonamento, transferência).

## 1. A tese (1 min)
"Hoje a coordenação é manual: planilhas, e-mail, Redmine, WhatsApp. No Sinapse **nenhuma ocorrência fica sem dono,
prazo ou próxima ação**, e toda mudança deixa rastro." Mostre o **Painel**: *órfãs 0* e *sem próxima ação 0*, com
meta zero, garantidos pelo banco de dados e não só pela tela.

## 2. Entrada e triagem (3 min)
1. **Simulador → AT-001**: mensagem de número desconhecido. Abra **Triagem**: ela está lá com prazo. Classifique
   (escolha *Expresso Vale Verde*): sendo VIP, a ocorrência vai para **Customer Success**.
2. **Simulador → AT-002**: o mesmo webhook chegou 3 vezes; existe **uma** ocorrência só. No **Supervisor**,
   "Webhooks repetidos ignorados" mostra as repetições, também registradas na **Auditoria**.

## 3. Atendimento com regras (3 min)
Abra uma ocorrência do Suporte como Rafael: *Assumir*, *Aguardar cliente* (exige motivo e data de revisão, no
máximo 3 dias), *Resolver* (exige evidência), *Transferir* para o Desenvolvimento (a equipe de origem continua dona
até o aceite). Responda ao cliente: a mensagem sai pelo canal de origem com status de entrega. Mostre a **linha do
tempo**: cada passo tem quem, quando e por quê.

## 4. Processos que o sistema segue sozinho (5 min)
Abra **Processos**: a cadência combinada na reunião de 03/11 está escrita em português ("Quando… Se… 1. Esperar até
D-3 2. Enviar… Para sozinho se…"). Abra o da pré-rodada → **Editar** → mostre os passos, clique em **Simular num item
real** (nada é gravado) e volte sem ativar.

**Rodadas → Transportadora Rota Sul** (D-4 hoje): a pré-rodada testou na Platform, normalizou os erros (vínculo SNE,
certificado) e abriu **uma** ocorrência; o processo está "aguardando" o D-3 (veja "Processos automáticos" na rodada).
1. **Simulador → +1 dia**: o aviso D-3 sai sozinho.
2. **Simulador → +1 dia**: aparece a tarefa **Ligar para…** em **Tarefas**. Registre como **Não atendeu**, depois
   *Processar fila agora*: a formalização sai no **grupo do cliente** e para o **ponto focal**.
3. **Simulador → Correção pelo cliente**: escolha as placas da Rota Sul → *Cliente corrigiu*. Na rodada, clique em
   **Revalidar na Platform** em cada placa: o ERP confirma tecnicamente, fecha a pendência, **encerra o processo** (o D-1 não sai) e
   resolve a ocorrência com a evidência da consulta (AT-008).
4. **TransMinas Fretes** (rodada já executada): o comunicado de sucesso/falha foi para o grupo, o follow-up D+3 está
   agendado, e a pendência **persistente** continua visível: encerrar o contato não é resolver o problema (AT-009).
5. **Processos → Força-tarefa: ponto focal → Executar agora**: só a conta sem ponto focal recebe a tarefa (VIP para o
   CS, demais para o Suporte); ao cadastrar o ponto focal, o processo para sozinho.

## 5. Resiliência (2 min)
- **Simulador → whatsapp: derrubar**, responda a um cliente e use *+1 hora* quatro vezes: o WhatsApp é retentado
  e a mensagem cai para **e-mail** (AT-007). Fora da janela de envio (8h–20h) a mensagem espera a manhã. Restaure.
- **omie: derrubar**: a situação financeira fica com a data da última sincronização, sem inventar status (AT-006).
- **AT-003**: Rafael indisponível → *Processar fila agora* → as ocorrências dele vão para a Bianca (substituta).
- A transferência "Timeout recorrente na consulta do DETRAN-SP" não foi aceita em 2 horas: com os avanços do
  relógio ela já está na **Contingência**, com tarefa de escalonamento para a Supervisão (AT-010).

## 5b. Comercial e integrações (3 min)
- Entre como **Patrícia (Comercial)** → **Comercial**: o funil em quadro. Abra a *Agro Transportes Paraná* (teste
  aprovado) → *Avançar para Negociação* → *Fechar venda*: a conta nasce em onboarding, o CS recebe o onboarding e
  Operações a tarefa de provisionar na Platform. Tente avançar uma oportunidade sem teste: o sistema não deixa.
- Entre como **Pedro (Operações)** → **Integrações**: importe um CSV de resultado de pré-rodada (o modelo está em
  "Colunas esperadas"), veja a prévia e aplique: a rodada, as pendências e a cadência aparecem sozinhas. Baixe a
  carteira com a coluna VIP para a Platform.

## 6. Segurança e governança (2 min)
- **AT-014**: tentativa de ler um dado da organização "Parceiro White-label": o banco não devolve nada e a tentativa
  fica auditada.
- **AT-015**: pedido de bloqueio por inadimplência sem regra aprovada: nenhuma ação na Platform.
- Entre como **Carla (Financeiro)** e como **Rafael**: o Financeiro vê "Em atraso"; o Suporte vê só "Atenção:
  consulte o Financeiro" (dado financeiro mínimo).

## Fechamento
Mostre `docs/RASTREABILIDADE.md`: a matriz AT-001 a AT-016 roda automaticamente a cada mudança (40 testes, em
PostgreSQL de verdade), com as fases seguintes (onboarding, CS e adaptadores reais da Platform e do OMIE) mapeadas
nas pendências decisórias da seção 16.
