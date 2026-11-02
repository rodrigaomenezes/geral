# Decisões técnicas — GuIA Brasil

Registradas em 02/11/2026, na criação do MVP. A Política de Engenharia (`../../docs/POLITICA_ENGENHARIA.md`) vale
para este projeto.

# G-001 — Node.js sem framework; IA como dependência opcional
**Decisão:** `node:http` e módulos próprios, como o Estadia (T-001). O único pacote é `@anthropic-ai/sdk`, opcional.
**Por quê:** MVP que sobe em qualquer lugar; mesma forma do outro projeto do repositório.

# G-002 — PWA em vez de app nativo no MVP
**Decisão:** app web instalável (manifest + service worker), JavaScript sem build.
**Por quê:** testar a proposta com usuários reais em dias, sem loja. Custo: sem geofencing nativo em segundo plano
(o passeio precisa da tela ligada ou do app aberto) e sem a IA do sistema. O documento de requisitos prevê nativo
para a versão de loja.

# G-003 — Um núcleo de regras compartilhado entre app e servidor
**Decisão:** `public/js/nucleo.js` (ES module puro) é importado pelo app e pelo servidor.
**Por quê:** a resposta offline e a resposta do servidor sem IA precisam ser iguais; uma regra só, testada uma vez.

# G-004 — Offline = conteúdo curado + regras; sem modelo de IA no aparelho por enquanto
**Decisão:** sem internet, a narração usa o pacote; a conversa responde por busca nas perguntas frequentes e
narrativas; a foto é identificada por GPS + bússola contra os pontos do pacote. O que não resolve vai para a fila.
**Por quê:** a IA no aparelho (Foundation Models da Apple, Gemini Nano) só é acessível em app nativo. A busca
local já resolve as perguntas mais comuns e é testável.

# G-005 — IA sempre com queda para o motor local
**Decisão:** qualquer falha da IA (erro, recusa, timeout de 45 s) devolve a resposta local com `erroIa`.
**Por quê:** o viajante nunca fica sem resposta (RNF10); o erro fica visível no log para diagnóstico.

# G-006 — Limite de chamadas por IP em memória
**Decisão:** janela deslizante de 40 chamadas de IA a cada 10 minutos por IP, em memória, uma réplica.
**Por quê:** proteger o custo de IA (RNF09) enquanto não há contas. Ao ter login, o limite passa a ser por
usuário e plano; com mais de uma réplica, precisa de armazenamento compartilhado.

# G-007 — Armazenamento do aparelho em localStorage
**Decisão:** pacote, conversa e fila em `localStorage` (com queda para memória). A fila guarda no máximo 4 fotos.
**Por quê:** o pacote de Salvador tem ~20 KB; localStorage é simples e síncrono. Quando os pacotes trouxerem
áudios e mapas (dezenas de MB), migrar para IndexedDB + Cache Storage, com nova decisão.

# G-008 — Feedback idempotente por id gerado no aparelho
**Decisão:** cada avaliação tem um id; o servidor ignora id repetido durante a vida do processo.
**Por quê:** a fila reenvia ao reconectar e não pode duplicar. Limitação: após reinício o conjunto de ids zera;
com banco de dados, virar chave única.
