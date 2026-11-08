# Arquitetura — Sinapse (ERP Operacional Brobot)

Como o sistema está montado hoje. Mudou a forma? Atualize este arquivo na mesma mudança. Decisões e o porquê:
`DECISIONS.md`. Requisitos atendidos: `docs/RASTREABILIDADE.md`.

## Visão geral

Monólito modular (seção 11 da especificação): um processo Node.js com API HTTP, worker da fila de jobs e
supervisor; PostgreSQL como única fonte de verdade.

```
Navegador (PWA, JS puro)          Webhooks (WhatsApp/e-mail/portal/API)      Monitor externo
        │ cookie de sessão               │ x-sinapse-token                      │ /api/health/supervisor
        ▼                                ▼                                      ▼
server/http/servidor.js — rotas, sessão, permissão por rota, CSRF (origem), CSP, JSON ≤ 1 MB, erro padronizado
        │
        ├─ modulos/identidade    sessão (token aleatório, hash no banco), RBAC, MFA, cadastro de pessoas e equipes, substituto, personas da demo
        ├─ modulos/clientes      carteira, VIP, roteamento RN-001, pontos focais com histórico, bloqueio (recusado sem regra)
        ├─ modulos/entrada       inbox durável + deduplicação, identificação por telefone E.164, classificação, triagem
        ├─ modulos/ocorrencias   máquina de estados (pura), SLA por calendário (puro), handoff, tarefas, resposta no canal
        ├─ modulos/rodadas       teste D-4 e resultado D0 na Platform, pendências, revalidação; publica os fatos para os processos
        ├─ modulos/agenda        Meu dia, lembretes (pessoa/equipe, recorrência, adiar) e central de notificações
        ├─ modulos/comercial     funil de aquisição com teste antes do fechamento; venda ganha → conta em onboarding + CS
        ├─ modulos/integracoes/csv  importar (prévia → aplicar, hash único) e exportar CSV com Platform e OMIE
        ├─ modulos/telefonia     central de ligações (portada do Lumen): treino, SIP/WebRTC (JsSIP), celular; conclui a tarefa de ligação
        ├─ modulos/processos     motor de processos escritos pela operação: gatilho → condições → passos → "para sozinho se"
        ├─ modulos/comunicacao   mensagens padrão editáveis (rascunho → revisão → aprovada), consentimento, janela, retentativa, fallback, template Meta
        ├─ modulos/organizacao   implantação de uma organização (real ou demonstração): equipes, rotinas, processos, matriz
        ├─ modulos/governanca    delegação temporária, matriz RACI com responsável vigente, plantão por equipe, SLA de contrato
        ├─ modulos/supervisor    varredura de invariantes, escalonamento, handoff vencido, heartbeat, fila de falhas
        ├─ modulos/painel        indicadores da seção 13 e 6 dashboards (blocos = tabela de dados; gráfico, tabela e CSV leem a mesma)
        ├─ modulos/integracoes   Platform e OMIE (demonstração + CSV), WhatsApp oficial (Meta Cloud API, webhook assinado) ou por QR Code (Baileys, sessão no Volume), e-mail (demonstração)
        └─ modulos/demo          dados fictícios, vitrine /demo e simulador (só com SINAPSE_DEMO ligado)
        │
server/jobs/fila.js — fila durável no PostgreSQL (FOR UPDATE SKIP LOCKED), backoff, fila de falhas, recorrentes; efeito externo em duas fases (T-052)
server/db — adaptador pg | PGlite, `comoTenant` (RLS) / `sistema`, migrações versionadas com volta
```

Dependências entre módulos são só para **baixo** (rotas → serviço → banco; `rodadas`/`entrada`/`supervisor` usam
o serviço público de `ocorrencias`, `clientes` e `comunicacao`; nenhum usa SQL de tabela de outro módulo para
escrever, exceto o adaptador de demonstração da Platform, que lê a tabela do próprio simulador).

## Dados

Migrações `001` a `005` (fundação, processos, meu dia/comercial/CSV, canais, mensagens), cada uma com `.down.sql`. Principais tabelas:

| Tabela | Papel |
| --- | --- |
| `tenants`, `equipes`, `usuarios`, `sessoes` | Organizações, filas (inclui Triagem e Contingência), pessoas, sessões |
| `contas`, `pontos_focais`, `credenciais_ref`, `status_financeiro` | Carteira; credencial só com status e referência; financeiro mínimo do OMIE |
| `entradas` | Inbox durável, único por (organização, origem, id do provedor) |
| `ocorrencias`, `ocorrencia_itens`, `ocorrencia_vinculos`, `interacoes`, `handoffs`, `tarefas` | Atendimento |
| `rodadas`, `pendencias`, `contatos_programados` | Pré e pós-rodada; pendência única por placa+erro enquanto aberta |
| `eventos` | Outbox com o contrato canônico (event_id, schema_version, aggregate, correlation, idempotency_key…) |
| `auditoria` | Só anexação (gatilho recusa UPDATE/DELETE) |
| `processos`, `processo_versoes`, `processo_execucoes`, `processo_passos_log` | Processos automáticos: versão ativada imutável (gatilho), execução presa à versão, registro de cada passo |
| `lembretes`, `notificacoes` | Lembretes (pessoa ou equipe; recorrentes) e avisos por pessoa (chave única: não repete) |
| `oportunidades` | Funil comercial; CHECK: aberta tem próxima ação, negociação/ganho exigem teste aprovado, ganha tem conta |
| `importacoes`, `uso_contas` | Arquivos CSV aplicados (hash único, erros por linha) e uso da Platform por conta (último login) |
| `telefonia_config`, `telefonia_ramais`, `chamadas`, `chamada_eventos` | Telefonia: provedor por organização, ramal SIP (senha cifrada), ligações com estados e eventos |
| `whatsapp_numeros` | Número da organização (um ativo): oficial (token cifrado; o webhook acha a organização pelo `phone_number_id`) ou QR (`status`, `ultimo_erro`; sessão em `/data/wa-sessoes`) |
| `modelos_mensagem` | Versões das mensagens padrão por organização; aprovada é imutável; template da Meta opcional |
| `jobs`, `integracoes`, `divergencias`, `sistema` | Fila durável, saúde/checkpoint das integrações, reconciliação, heartbeat/relógio |

Invariantes garantidas **pelo banco** (CHECK): ocorrência ativa tem fila, prazo e próxima ação (RN-008); resolvida
tem evidência e encerrada sem resolução tem motivo (RN-009); tarefa tem fila (GOV-004); VIP tem critério e
aprovador; exceção de roteamento tem justificativa; pendência corrigida tem evidência.

## Segurança

- **Isolamento:** RLS em todas as tabelas de negócio; as transações de usuário rodam com `SET LOCAL ROLE
  sinapse_app` (sem privilégio de dono) e `app.tenant_id`. Pedido de id de outra organização = 404 + auditoria.
- **Sessão:** token aleatório de 32 bytes em cookie HttpOnly/SameSite=Lax (Secure em produção); no banco só o hash.
- **Permissão** por rota (`permissoes.js`); Financeiro vê detalhe financeiro, os demais só "atenção financeira".
- **CSRF:** POST exige JSON e origem igual ao host. **CSP** sem inline; front sem `innerHTML`.
- Webhook com token comparado em tempo constante. Nenhum segredo, senha ou certificado é guardado.
- **Ambiente (T-019):** em produção a demonstração (login sem senha) só liga com `SINAPSE_DEMO=1` e aparece numa faixa
  fixa; `SINAPSE_AMBIENTE=producao` recusa demonstração, banco embutido e TLS do banco sem verificação. Login com
  limite de tentativas (5 por e-mail / 30 por endereço em 15 min). HSTS em produção.

## Motor de processos

Um processo é `{ gatilho, condicoes[], passos[], encerrarSe[] }` (`modulos/processos/catalogo.js` e `regras.js`, puros).
- **Gatilhos:** eventos do outbox (ocorrência aberta/mudou/em espera/escalonada/reaberta, pré-rodada com pendências,
  rodada executada) ou por conta ("Executar agora" e semanal).
- **Passos:** esperar (horas ou relativo ao D0), enviar mensagem (ponto focal, grupo do cliente ou ambos), ligar e
  esperar o resultado (atendeu/não atendeu), criar tarefa, mudar prioridade, mudar equipe, nota, escalar. Cada passo
  pode ter "só se…".
- **Execução:** `processos.despachar` (5 s) lê o outbox, inicia execuções e reavalia o "para sozinho se" das execuções da
  mesma conta/ocorrência; `processo.avancar` roda os passos numa transação até uma espera; `processos.agenda` (1 h)
  dispara os semanais. Correção confirmada encerra na hora a cadência da conta (`rodadas` chama `motor.reavaliar`).
- **Segurança:** rascunho → ativar (anterior "substituída") → restaurar; simulação num item real sem gravar; evento
  causado por uma execução não dispara o mesmo processo; mais de 5 inícios em 24 h no mesmo item são contidos e viram
  divergência no Supervisor.
- **Padrões** (`padroes.js`): pré-rodada (D-3, ligação, formalização se não atender, D-1), pós-rodada (comunicado no
  grupo + follow-up D+3), força-tarefa de ponto focal, erro de consulta aciona o Suporte, cliente sem retorno, VIP com
  prioridade alta, insights semanais do CaçaCondutores (desligado até revisão do texto).

## Integração por CSV (fase atual)

A Platform e o OMIE ainda não têm API conectada: cada lado exporta um CSV e o outro importa.
- **Importar:** resultado de rodada por veículo (pré-rodada D-4 ou oficial D0; a rodada passa a `fonte = 'csv'` e o
  Sinapse deixa de chamar o adaptador para ela), status de credenciais (coluna de senha é recusada), uso/último login,
  situação financeira do OMIE (CNPJ desconhecido vira divergência). Sempre prévia → aplicar; mesmo arquivo não entra
  duas vezes; uma transação por arquivo.
- **Exportar:** novos clientes para o OMIE, provisionamento e carteira (com VIP) para a Platform, pendências abertas.
  Proteção contra injeção de fórmula; cada exportação fica na auditoria.

## Tempo, jobs e supervisor

Tudo que acontece "depois" é um job: `entrada.processar`, `rodada.pre_rodada` (D-4), `rodada.executar` (D0), `comunicacao.enviar`, `omie.sincronizar` (10 min) e
`supervisor.varrer` (1 min). O ciclo do worker (2 s) só procura o que venceu. O relógio (`nucleo/relogio.js`) pode
ser adiantado na demonstração para mostrar a cadência inteira em minutos.

## Testes e publicação

`npm test` (`node:test`, servidor real; PGlite em memória ou `TESTE_DATABASE_URL`). CI:
`.github/workflows/sinapse.yml` roda nos dois motores. Publicação: Railway com `Dockerfile` e `railway.json`
(Root Directory `brobot/sinapse`; Volume em `/data` ou `DATABASE_URL`).

## Limites conhecidos (deficiências registradas)

- **Adaptadores reais** (Platform, OMIE, WhatsApp Cloud API, e-mail) não existem: dependem da documentação oficial
  e das pendências decisórias da seção 16. Consequência: a demonstração não conversa com sistemas reais.
- **Uma réplica:** o relógio da demonstração fica em memória por processo, e o PGlite tem uma conexão só. Para
  mais de uma réplica, usar `DATABASE_URL` e desligar o ajuste de relógio (`SINAPSE_DEMO=0`).
- **Outbox só com consumidor interno:** o motor de processos consome os eventos (`publicado_em`); ainda não há envio
  para sistemas externos (Comercial/Financeiro).
- **Marca:** cores, nome e logo vêm de `tenants.config.marca` (`/marca/<arquivo>` em `public/marca`); o material oficial
  da Brobot ainda não foi aplicado.
- A tabela `contatos_programados` (cadência fixa da 001) ficou sem uso desde a 002; não foi removida (migração aditiva).
- **Canais:** telefonia (treino, SIP, celular), WhatsApp oficial e por QR Code prontos (tela Canais); faltam do Lumen a
  gravação de ligações e a fila de ligações. O QR não é a API oficial: risco de bloqueio do número (T-020). O template da Meta (fora da janela de 24 h) é informado por mensagem padrão.
- **Marca:** identidade Brobot aplicada a partir do site (azul, Montserrat servida localmente, botões em pílula); o
  wordmark é desenhado em CSS até chegar o arquivo oficial do logo (SVG).
- **Limitador de login na memória do processo:** vale para uma réplica; com várias, passa para tabela.
- **Quadro (Kanban):** uma consulta por carga (25 cartões por coluna, tarefas agregadas só dos cartões exibidos);
  colunas = estados da máquina; arrastar chama a mesma transição do detalhe.
- **Fora desta fase:** offboarding, CS (treinamentos coletivos), incidentes, base de conhecimento, anexos, LGPD
  (exportação/anonimização), MFA, OpenAPI/AsyncAPI publicados, modo escuro. Ver `docs/RASTREABILIDADE.md`.
- Listas da carteira e da triagem usam subconsultas por linha limitadas à página (25–30 linhas); medir antes de
  otimizar quando houver volume real.
