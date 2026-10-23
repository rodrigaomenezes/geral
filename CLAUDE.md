# Projetos de clientes (Menezes Gestão) — regras do repositório

Cada projeto fica na pasta do cliente (hoje: `brobot/estadia`, o Estadia BR) e tem o próprio `CLAUDE.md`,
`ARCHITECTURE.md` e `DECISIONS.md`. Interface e documentação em português do Brasil.

## Política de engenharia (permanente — `docs/POLITICA_ENGENHARIA.md`)
Arquitetura, estabilidade, segurança, manutenibilidade e evolução são requisitos de toda mudança: limites claros
entre módulos; contratos de API, eventos e dados preservados (incompatível = migração planejada + decisão
registrada); teste em toda regra e correção; entrada e transição validadas, idempotência no que é crítico; menor
privilégio e segredo protegido; sem trabalho redundante, otimização medida; falha externa, timeout, repetição e
concorrência tratadas; log útil sem credencial nem dado sensível; evolução de dados versionada com volta segura;
documentação atualizada; nenhuma camada, cache, serviço ou dependência sem justificativa escrita. **Antes** de
mudança significativa: ler o `ARCHITECTURE.md` e o `DECISIONS.md` do projeto e listar quem usa o que vai mudar;
refatoração grande só com diagnóstico, riscos e plano aprovados. **Pronto** = requisitos + contratos + verificações
executadas (nunca declarar "ok" o que não rodou) + documentação. Deficiência encontrada não fica calada:
problema → consequência → correção mínima.

## Como trabalhar
- Commits pequenos (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), testes junto com o código, um PR por mudança.
- Nunca peça senha ou token no chat: diga qual variável de ambiente criar.
- Ao fim: arquivos modificados, responsabilidades, dependências afetadas, otimizações, verificações executadas
  (com o resultado real) e deficiências encontradas.
