# Decisões técnicas — Estadia BR

Decisões de **produto** (regras de negócio, D-01 a D-31) ficam em `docs/Atividades_Estadia_BR.md`. Aqui ficam as
**técnicas**, com o porquê. T-001 a T-005 foram registradas em 23/10/2026 a partir do código e do README.

# T-001 — Node.js sem framework e sem dependência obrigatória
**Decisão:** `node:http` e módulos próprios; o único pacote (`@anthropic-ai/sdk`) é opcional.
**Por quê:** MVP de demonstração que sobe em qualquer lugar sem instalação; menos superfície para quebrar.

# T-002 — Log de eventos só de anexação com cadeia de hash como fonte da verdade
**Decisão:** todo fato vira evento em `events.jsonl` com o hash do anterior; estado, apuração e dossiê são
projetados dos eventos; correção é evento de retificação.
**Por quê:** o produto é **prova**: qualquer alteração no histórico precisa ser detectável.

# T-003 — Dados em arquivo num Volume, uma réplica
**Decisão:** pasta `ESTADIA_DATA` (Volume `/data` no Railway); um processo.
**Por quê:** simplicidade do MVP. Banco de dados entra quando volume ou concorrência pedirem (com decisão própria).

# T-004 — Fornecedores com modo sem conta externa
**Decisão:** WhatsApp manual (padrão), API oficial ou simulado; IA de fotos opcional que nunca bloqueia; Amélia
determinística com contrato estável para trocar por IA depois.
**Por quê:** demonstrar e operar sem contrato com fornecedor; trocar o fornecedor sem mudar o resto.

# T-005 — Política Permanente de Engenharia; boot nunca apaga dados reais
**Decisão:** a política (`../../docs/POLITICA_ENGENHARIA.md`) vale para o projeto. Primeiras aplicações: o boot só
recria dados marcados como demonstração (`directory.json.demonstracao`), e cadastros, links e dossiês passam a ser
gravados de forma atômica (`server/arquivo.js`).
**Por quê:** o boot recriava a demonstração quando não achava a empresa de exemplo, o que numa base real apagaria
toda a prova; gravação direta por cima podia deixar o cadastro pela metade num reinício.
