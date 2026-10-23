# Política Permanente de Engenharia e Evolução do Sistema

> Vale para todos os sistemas do Rodrigo Menezes (Menezes Gestão, Lumen Operações, Estadia e os próximos).
> Texto aprovado em 22/10/2026. A seção "Como cumprir neste projeto", no fim, traduz cada item para este
> repositório. Mudar a política = mudar este arquivo em todos os repositórios.

Trate a arquitetura, a estabilidade, a segurança, a manutenibilidade e a capacidade de evolução como requisitos
permanentes do projeto.

Antes de implementar novas funcionalidades, analise o impacto sobre a arquitetura existente e respeite os seguintes
critérios:

1. **Limites arquiteturais:** cada módulo deve ter responsabilidades definidas, interfaces explícitas e dependências
   controladas. Evite dependências circulares e acesso indevido à implementação interna de outros módulos.
2. **Compatibilidade:** preserve os contratos existentes de APIs, eventos, banco de dados e integrações. Quando uma
   mudança incompatível for necessária, planeje uma migração controlada.
3. **Testabilidade:** novas regras de negócio e correções devem ter testes adequados. Corrija falhas e regressões
   antes de considerar a implementação concluída.
4. **Integridade:** valide entradas e transições de estado, utilize transações quando necessárias e garanta que
   operações críticas não produzam duplicações ou inconsistências.
5. **Segurança:** respeite autenticação, autorização, isolamento de dados, gerenciamento seguro de segredos e
   princípio do menor privilégio.
6. **Eficiência:** evite trabalho redundante, dependências não utilizadas, consultas repetidas e processamento
   desnecessário. Identifique gargalos por evidências e meça os resultados das otimizações relevantes.
7. **Resiliência:** trate falhas de serviços externos, timeouts, tentativas de repetição, concorrência e operações
   idempotentes conforme o risco de cada funcionalidade.
8. **Observabilidade:** implemente logs úteis, tratamento consistente de erros e mecanismos de diagnóstico sem
   registrar credenciais ou dados sensíveis desnecessariamente.
9. **Evolução do banco de dados:** versionar migrações, avaliar compatibilidade com versões anteriores e definir
   procedimentos seguros de recuperação.
10. **Manutenibilidade:** mantenha documentação arquitetural atualizada, código legível, convenções consistentes e
    dependências explícitas.
11. **Entrega segura:** valide alterações por meio de testes, análise estática, verificações de tipos e build,
    conforme as ferramentas existentes. Não declare uma verificação concluída se ela não foi executada.
12. **Mudanças incrementais:** prefira alterações pequenas, rastreáveis e reversíveis. Antes de uma refatoração
    abrangente, apresente o diagnóstico, os riscos e o plano de execução.
13. **Prevenção de complexidade:** não crie camadas, abstrações, serviços, caches ou microserviços sem uma
    justificativa técnica concreta.
14. **Critérios de conclusão:** uma funcionalidade só deve ser considerada pronta quando atender aos requisitos,
    respeitar os contratos arquiteturais, passar pelas verificações aplicáveis e possuir documentação compatível com
    a mudança.

Mantenha um arquivo de arquitetura e um registro das decisões técnicas relevantes. Antes de cada mudança
significativa, consulte esses documentos e atualize-os quando necessário.

Se identificar uma deficiência arquitetural que aumente o risco de novas implementações, não a ignore
silenciosamente. Explique o problema, a consequência e a correção mínima recomendada.

**Objetivo final:** permitir que o sistema cresça em funcionalidades e integrações sem transformar cada nova
implementação em uma fonte crescente de falhas, retrabalho, lentidão ou complexidade.

## Rotina obrigatória de cada mudança

1. **Antes:** ler `ARCHITECTURE.md` e `DECISIONS.md`; listar quem usa o que vai mudar (contratos, eventos, tabelas,
   telas); se a mudança é grande ou incompatível, apresentar diagnóstico, riscos e plano e esperar o ok.
2. **Durante:** a menor alteração que resolve; teste junto com o código; nada de camada, cache ou serviço novo sem
   motivo escrito.
3. **Antes do PR:** rodar todas as verificações do projeto (lista abaixo) e anotar o resultado real de cada uma.
   Verificação não executada é declarada como "não executada", nunca como "ok".
4. **Ao fim:** atualizar `ARCHITECTURE.md` (se mudou a forma do sistema), `DECISIONS.md` (se houve decisão
   técnica), o registro de dívidas e o README; responder com arquivos modificados, responsabilidades, dependências
   afetadas, otimizações (com medida, quando relevante), verificações executadas e deficiências encontradas
   (problema → consequência → correção mínima).

## Como cumprir neste repositório

Este repositório guarda projetos de clientes, cada um na própria pasta (hoje: `brobot/estadia`). Cada projeto tem o
próprio `CLAUDE.md`, `ARCHITECTURE.md` e `DECISIONS.md`. A política vale para todos.

### Estadia BR (`brobot/estadia`)

| Item | Como se cumpre aqui | Verificado por |
| --- | --- | --- |
| 1. Limites | `server/domain.js` (regras puras: marcos, status, apuração, permissões), `store.js` (log), `auth.js` (cadastros e sessão), `whatsapp.js`, `visao.js`, `amelia.js` (fornecedores), `server.js` (HTTP). Regra nova vai para `domain.js`, não para o roteador | Testes de regra |
| 2. Compatibilidade | O log de eventos é a fonte da verdade: tipo de evento e campo de payload nunca mudam de sentido; mudança = tipo novo ou campo novo. Rotas `/api/*`, link de confirmação e contrato da Amélia (`/api/amelia/*`) preservados. Regra de cálculo versionada (`ESTADIA-BR 2.x`) | `test/estadia.test.js` |
| 3. Testes | `node:test` com servidor real e pasta de dados temporária; critério de aceite novo = teste novo | `npm test` |
| 4. Integridade | Log só de anexação com cadeia de hash (`/api/admin/integrity`); idempotência por `clientEventId`; cadastros e links gravados de forma atômica (`server/arquivo.js`) | Testes |
| 5. Segurança | Sessão assinada (HMAC, `ESTADIA_SECRET`), senhas com scrypt, perfis por organização (cada uma vê só o que é dela), webhook com assinatura da Meta, token do link fora do log (só o hash) | Testes de isolamento |
| 6. Eficiência | Sem dependência obrigatória; medir antes de otimizar (ver deficiência 3) | — |
| 7. Resiliência | App do motorista guarda offline e reenvia; WhatsApp com modos manual/API/simulado; IA de fotos opcional que nunca bloqueia o registro | Testes |
| 8. Observabilidade | Erro padronizado `{ erro, mensagem }`; 500 sem detalhes para o usuário; nunca logar foto, áudio, token ou corpo de requisição | Revisão |
| 9. Dados | Evento nunca é editado (retificação = evento novo); dados no Volume `/data`; boot só recria dados **marcados como demonstração** | Teste "Boot nunca apaga…" |
| 10. Manutenção | `brobot/estadia/ARCHITECTURE.md`, `DECISIONS.md`, `README.md` e `docs/Atividades_Estadia_BR.md` atualizados na mesma mudança | Revisão |
| 11. Entrega | `npm test` em `brobot/estadia` (o CI `estadia.yml` repete); tela em 360 px | CI |
| 12–14 | Mudanças pequenas por PR; nada de camada, framework ou banco novo sem decisão registrada; pronto = requisitos + testes executados + documentação | Modelo de PR |

#### Deficiências encontradas (problema → consequência → correção mínima)

1. **[Corrigida] O boot apagava tudo quando não achava a empresa de exemplo** (`server/server.js`: faltando
   `porto-santos`, transportadora, PIN ou frota, o servidor "recriava a demonstração") → numa base real, um reinício
   apagaria o log de eventos, as fotos e os dossiês, que são a prova jurídica do cliente → agora só dados com a marca
   `demonstracao` (gravada ao semear) podem ser recriados sozinhos. A demonstração já no ar, criada antes da marca,
   não é mais recriada sozinha: use **Administração → Reiniciar demonstração** uma vez.
2. **[Corrigida] Cadastros, links e dossiês gravados direto por cima** (`writeFileSync`) → um reinício no meio da
   gravação deixaria `directory.json` pela metade e o sistema não subiria → gravação em temporário + troca atômica.
3. **Reinício da demonstração ligado por padrão** (`ESTADIA_DEMO_RESET` só desliga com `0`) → num ambiente com
   cliente real, um administrador apaga toda a prova com um clique → definir `ESTADIA_DEMO_RESET=0` em todo ambiente
   real; quando o primeiro cliente real entrar, inverter o padrão (desligado em produção).
4. **Cada consulta varre o log inteiro, e a lista não tem paginação** (`GET /api/operations` monta o estado de todas
   as operações; `store.forOp` filtra todos os eventos a cada uma) →
   custo cresce com operações × eventos e a tela fica lenta com volume real → medir o tempo de `GET /api/operations`
   com uma base de teste grande; passando de ~300 ms, manter um índice `opId → eventos` no `append` (sem banco novo).
5. **`server/server.js` com 1.200 linhas e todas as rotas numa função** → toda mudança mexe no mesmo arquivo e
   aumenta o risco de efeito colateral → ao mexer numa área, extrair as rotas dela para `server/rotas/<area>.js`,
   sem framework novo.
6. **`render.yaml` com dados em `/tmp`** → publicar pelo Render perde tudo a cada reinício → a publicação oficial é
   o Railway com Volume em `/data`; apagar o `render.yaml` quando o dono confirmar que não é usado.
7. **Sem versão de formato nos cadastros e nos eventos** → uma mudança incompatível futura não tem caminho de
   atualização → na primeira mudança assim, gravar `versaoEsquema` em `directory.json` e um atualizador no boot,
   com cópia antes (sem apagar nada).
