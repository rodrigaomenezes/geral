# Sinapse (ERP Operacional Brobot) — regras do projeto

ERP que gere o trabalho interno de Operações, Suporte e Customer Success da Brobot (cliente Brobot Tecnologia).
Fonte dos requisitos: *Especificação de Requisitos do ERP Operacional Brobot v1.0* (04/11/2026, documento do cliente,
**não versionado aqui** porque este repositório é público). Mapa requisito → código → teste:
`docs/RASTREABILIDADE.md`. Pilha: Node.js 22 sem framework (`node:http`), JavaScript CommonJS, PostgreSQL
(gerenciado via `DATABASE_URL` ou embutido via PGlite no Volume), front em JS puro (PWA, módulos ES, sem build).

**Visão do cliente (05/11/2026):** o Sinapse é o **único sistema de gestão** da Brobot. Operacional, CS, Suporte e
**Comercial** trabalham e se consolidam aqui; a Platform (ferramenta principal, produtos e consultas) e o OMIE
(financeiro) ficam conectados por integração. Nenhuma área deve precisar de planilha, Redmine ou ferramenta paralela.

Siga a **política permanente de engenharia** (`../../docs/POLITICA_ENGENHARIA.md` e `../../CLAUDE.md`). Antes de
mudança significativa, leia `ARCHITECTURE.md` e `DECISIONS.md` deste projeto.

## Regras do projeto
1. **Fronteiras de sistema:** a Platform Brobot executa consultas e guarda credenciais; o OMIE é dono do financeiro.
   O Sinapse nunca lê o banco da Platform, nunca guarda segredo de credencial, nunca emite NFS-e/boleto/baixa e
   nunca bloqueia cliente sem regra aprovada.
2. **Multiempresa no banco:** toda tabela de negócio tem `tenant_id` com Row Level Security. Consulta de negócio só
   por `db.comoTenant(...)`; `db.sistema(...)` só para login, fila de jobs, supervisor e migração.
3. **Máquina de estados:** transição de ocorrência só por `modulos/ocorrencias/maquina.js` (regra pura, testada) ou
   `alterarComMotivo` (rotina/intervenção, sempre com motivo). Ocorrência ativa sempre tem fila, prazo e próxima
   ação (o banco recusa o contrário). Resolver exige evidência; encerrar sem resolver exige motivo.
4. **Registro automático:** toda mudança grava evento no outbox (`eventos`) e auditoria (só anexação; o banco
   recusa UPDATE/DELETE) na mesma transação.
5. **Entrada durável e idempotente:** grava antes de processar; repetição (mesmo id do provedor, mesma chave de
   job, mesma pendência placa+erro) nunca duplica efeito.
6. **Nada de setInterval para regra:** tudo que é agendado é linha em `jobs` (retentativa com backoff, fila de
   falhas, reprocessamento auditado). Handler de job é idempotente; trabalho em outra transação vai em `depois`.
7. **Fornecedores atrás de adaptador** (`modulos/integracoes`) com versão de demonstração; o adaptador real só
   entra com a documentação oficial da API (nunca presumir endpoint).
8. **Migrações** numeradas com arquivo de volta (`.down.sql`); migração publicada não se edita (checksum).
9. **Front sem innerHTML** (`public/js/dom.js`), CSP sem inline, toda tela em 360 px, português claro.
10. Segredos só em variável de ambiente (`DATABASE_URL`, `SINAPSE_TOKEN_ENTRADA`, `SINAPSE_SENHA_ADMIN`).

## Verificações antes do PR
`npm test` nesta pasta (PGlite) e, se mexer em SQL, também com `TESTE_DATABASE_URL` apontando para um PostgreSQL
de teste (o CI roda os dois). Tela conferida em 360 px. Ao fim: arquivos, responsabilidades, dependências
afetadas, otimizações, verificações executadas (resultado real) e deficiências encontradas.
