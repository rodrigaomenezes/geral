# Estadia BR — regras do projeto

Plataforma de gestão e comprovação de eventos logísticos de carga e descarga (cliente Brobot Tecnologia). As telas
mostram só a marca **Estadia BR**. Requisitos: `docs/Atividades_Estadia_BR.md` (decisões de produto D-xx).
Pilha: Node.js 20+ sem framework (`node:http`), JavaScript CommonJS, dados em arquivos (log de eventos JSONL com
cadeia de hash), front em JS puro (PWA), app Android fino em `android/`. **Sem dependência obrigatória; não mudar a
pilha sem decisão registrada.**

Siga a **política permanente de engenharia** (`../../docs/POLITICA_ENGENHARIA.md` e `../../CLAUDE.md`). Antes de
mudança significativa, leia `ARCHITECTURE.md` e `DECISIONS.md` deste projeto.

## Regras do projeto
1. **O log de eventos é a prova:** só anexação; nunca editar ou apagar evento (correção = retificação, um evento
   novo). Tipo e campo de evento não mudam de sentido.
2. **Nada apaga dados reais:** recriar/reiniciar só vale para dados marcados como demonstração. Ambiente com cliente
   real roda com `ESTADIA_DEMO_RESET=0`.
3. Regra de negócio em `server/domain.js` (pura, testada); `server.js` só faz HTTP.
4. Cada organização vê só o que é dela; permissão checada no servidor em toda rota.
5. Repetir uma ação (toque duplo, reenvio offline, webhook repetido) nunca duplica: `clientEventId`.
6. Arquivos de estado gravados com `gravarAtomico` (`server/arquivo.js`).
7. Fornecedores (WhatsApp, IA de fotos, Amélia) atrás de interface com modo sem conta externa; a IA nunca bloqueia
   um registro.
8. Segredos só em variável de ambiente (`ESTADIA_SECRET`, `WHATSAPP_*`, `ANTHROPIC_API_KEY`); nunca em código,
   log ou chat. Token do link fica fora do log (só o hash).
9. Celular primeiro: toda tela em 360 px; motorista com botões grandes e frases do dia a dia.

## Verificações antes do PR
`npm test` (nesta pasta) e tela conferida em 360 px. Ao fim: arquivos, responsabilidades, dependências afetadas,
otimizações, verificações executadas (resultado real) e deficiências encontradas.
