# GuIA Brasil — regras do projeto

Guia turístico com IA (PWA + Node). Interface, conteúdo e documentação em português do Brasil.
Marca: **GuIA Brasil**, com o "IA" destacado (classe `.ia` no logotipo).

- Antes de mudar: ler `ARCHITECTURE.md` e `DECISIONS.md`.
- Regras de guia (proximidade, narração, foto offline, resposta local) só em `public/js/nucleo.js`, com teste.
- Pacote novo em `pacotes/`: precisa passar em `validarPacote` (o servidor não sobe com pacote inválido).
  Conteúdo: só fatos verificáveis; lenda marcada como lenda; nunca preço, horário ou segurança inventados.
- A IA sempre tem queda para o motor local; nenhuma rota pode depender só dela.
- Chave da IA só em variável de ambiente (`ANTHROPIC_API_KEY`).
- Diferenças entre navegador e app Android só em `public/js/plataforma.js`; o Java (`android/`) não decide alertas.
- Verificações: `npm test`, a tela conferida em 360 px (incluindo modo offline) e, se mexer em `android/`, `./build.sh`.
