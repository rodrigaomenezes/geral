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

# G-009 — Companheiro de caminhada no núcleo, com prioridade fixa e intervalos medidos
**Decisão:** o modo Passeio vira o companheiro: `proximoAlerta` escolhe um alerta por vez na ordem importante >
chegada > logo à frente > dica > novidade. Avisos importantes furam a frequência; dicas e novidades esperam 20 s.
Frequência normal caiu de 90 s para 45 s (pouca: 4 min; muita: 15 s). `decidirNarracao` foi removida.
**Por quê:** simulando a rota de Salvador a 1,3 m/s, com 90 s o guia atravessava 2 pontos calado e nunca dava as
dicas; com estes valores cobre 11 de 11 pontos e 4 de 4 avisos sem repetir (teste `rota de Salvador no modo normal`).

# G-010 — "Logo à frente" só com direção conhecida
**Decisão:** a direção vem do próprio trajeto (últimos 40 m), não da bússola; sem pelo menos 15 m andados, o
companheiro não anuncia nada à distância.
**Por quê:** a bússola mostra para onde o celular aponta, não para onde a pessoa anda; anunciar sem direção levaria
a falar do que ficou para trás.

# G-011 — Tela acesa durante a caminhada (Wake Lock)
**Decisão:** ao começar a caminhar o app pede para manter a tela acesa e pede de novo ao voltar a ficar visível.
**Por quê:** num PWA o GPS e a voz param quando a tela apaga. Custo: bateria. A versão nativa (G-002) troca isso por
geofencing em segundo plano.

# G-012 — Avisos configuráveis por tipo, com regra própria para o segundo plano
**Decisão:** cada tipo (importante, você chegou, logo à frente, dicas, novidades) tem um modo: *avisar e notificar*,
*só com o app aberto* ou *desligado*. Em segundo plano o núcleo só considera os tipos em *notificar*. Há um limite
opcional por hora (4, 8 ou 15) que não vale para avisos importantes. Padrão: importante e chegada notificam; o resto
só com o app aberto.
**Por quê:** a pessoa pediu para escolher o que recebe e com que frequência; o aviso de segurança não pode sumir por
causa de um limite de quantidade. Um tipo "só no app" que fosse decidido em segundo plano seria gasto sem ser visto.

# G-013 — App Android: WebView + serviço de GPS em primeiro plano que alimenta o núcleo em JavaScript
**Decisão:** `android/` gera um APK que abre o app web e acrescenta a ponte `GuiaNativo`: um serviço em primeiro plano
(notificação fixa "caminhando com você") mantém o GPS com a tela bloqueada e entrega cada posição ao JavaScript, que
decide o alerta com o mesmo `nucleo.js`; voz pelo TextToSpeech e notificação nativa. A WebView não é pausada.
Compilado como o Estadia (aapt + javac + dalvik-exchange) contra o `android.jar` da API 23, único disponível no
build; APIs de Android 8+ (canais, serviço em primeiro plano) por reflexão e `targetSdkVersion 28`.
**Por quê:** num navegador o GPS e o JavaScript congelam com a tela bloqueada (G-011); duplicar as regras em Java
criaria dois comportamentos para manter. `targetSdk 28` dispensa o tipo de serviço exigido no Android 14 e instala
direto no celular (piloto). **Antes da Play Store:** compilar com o SDK 34+ (Gradle ou Actions com Android SDK),
`targetSdk` atual, `foregroundServiceType="location"` e pedido de notificação do Android 13.
**Risco:** se o Android encerrar a tela do app (pouca memória), o serviço continua mas sem quem decida o alerta.
Não foi testado num aparelho.

# G-014 — iPhone: planejado como app nativo; até lá, o app web
**Decisão:** sem Mac/Xcode e conta Apple Developer neste ambiente, o iPhone continua no app web (com notificações só
enquanto o Safari mantiver o app ativo, iOS 16.4+ e app adicionado à tela inicial). Plano: casca nativa (Swift ou
Capacitor) com monitoramento de regiões do CoreLocation (até 20 regiões por vez, renovadas conforme a pessoa anda)
e notificações locais, reaproveitando o mesmo núcleo.
**Por quê:** o iOS não permite GPS contínuo em segundo plano para páginas web; regiões monitoradas são o caminho que
gasta menos bateria e funciona até com o app fechado.

# G-015 — "Sua IA": a pessoa conecta a própria conta (OpenRouter, login OAuth com PKCE)
**Decisão:** em Viagem, *Conectar minha IA* leva ao login da OpenRouter (PKCE S256, `state` contra falsificação);
na volta, o app troca o código por uma chave da conta da pessoa e guarda **só no aparelho**. Conversa e foto mandam
essa chave por cabeçalho (`x-guia-ia-chave`, `x-guia-ia-modelo`); o servidor monta o mesmo contexto do guia e chama
a OpenRouter com ela, sem gravar nem registrar a chave. Ordem de uso: IA da pessoa > IA do servidor > conteúdo local.
Erro 401 desconecta e avisa; 402 avisa falta de créditos; em qualquer erro a resposta cai no conteúdo local (G-005).
Modelo padrão `openrouter/auto`, trocável na tela. No Android o login abre dentro do app (openrouter.ai liberado
na WebView).
**Por quê:** a pessoa pediu para usar a própria IA sem chave. Em nov/2026: "Entrar com ChatGPT" (plano Plus/Pro)
existe, mas app hospedado precisa de aprovação da OpenAI; a assinatura do Claude é proibida em apps de terceiros
(Anthropic, fev/2026); a OpenRouter é a única aberta a qualquer app hoje. O servidor (e não o navegador) chama a IA
para reaproveitar o guia.js sem duplicar o contexto e as regras.
**Limite:** login com Google não funciona dentro da WebView do Android (o Google bloqueia); no app, use e-mail.
O "Entrar com ChatGPT" entra como segundo provedor quando a OpenAI aprovar.

# G-016 — O app não depende de um destino escolhido para funcionar
**Decisão:** conversa e foto aceitam pedido sem `pacoteId` (o servidor usa um "sem destino" vazio: com IA responde
pelo conhecimento geral e pela posição; sem IA orienta a escolher destino ou conectar a IA). Quando só existe um
destino, o app baixa sozinho na primeira abertura. Ao abrir o Passeio o app lê o GPS uma vez para mostrar
distâncias e, longe de todos os pontos (>2 km), explica e oferece a simulação. Erros de GPS mostram o caminho exato
nos ajustes (iPhone: Sites do Safari). No iPhone, o primeiro toque em "Ouvir" avisa que o modo silencioso cala a voz.
**Por quê:** no iPhone, o atalho da tela inicial tem armazenamento separado do Safari: o destino baixado no Safari
não existia no atalho, e sem destino o app bloqueava conversa, foto e GPS sem dizer por quê ("nada funciona"). Os
registros do servidor confirmaram: nenhuma pergunta chegava.

# G-017 — Qualquer lugar: destino montado na hora com Wikipédia e OpenStreetMap
**Decisão:** em Viagem a pessoa busca uma cidade ou lugar (OpenStreetMap/Nominatim) ou toca *Guia de onde estou*
(GPS). O servidor monta um pacote no formato de sempre (`validarPacote`) com até 30 artigos da Wikipédia em português
que têm coordenadas num raio de 10 km, o resumo de cada um em três níveis e a fonte (link do artigo, CC BY-SA, exibido
no cartão). O app guarda em "meus lugares" (até 10) e usa como qualquer destino: narração, companheiro, offline.
Cache em memória por 24 h; chamadas ao Nominatim espaçadas em ≥1 s e identificadas (User-Agent), como pede a
política de uso. No Passeio, *Usar minha localização* lê o GPS com o toque da pessoa e mostra o resultado; o cartão
da simulação tem *Usar meu GPS de verdade*.
**Por quê:** só havia Salvador; o app não servia em nenhum outro lugar. Curar conteúdo cidade a cidade não escala no
teste; a Wikipédia dá texto verificável com licença que permite reuso com atribuição.
**Limites:** sem curadoria (pode entrar rua ou escola com artigo); sem avisos de segurança; Nominatim público não é
para volume alto (com muitos usuários, trocar por serviço pago ou próprio, com decisão nova).

# G-018 — Pontos turísticos pelo Wikidata, com filtro por tipo; "você está em" pelo mapa
**Decisão:** o destino gerado (G-017) passa a ter o Wikidata como fonte principal: itens com coordenada num raio de
3 km (10 km se vierem menos de 8), mantidos só os de tipo turístico (igreja, museu, mercado, praça, monumento,
cultura, patrimônio histórico, natureza) pelo tipo (P31), pela descrição ou pelo começo do nome. Emissoras, rádio,
jornal, shopping, hotel, estádio, aeroporto, município e bairro ficam de fora (patrimônio tombado entra mesmo se for
empresa). O texto vem do artigo da Wikipédia ligado ao item; sem artigo, da descrição do Wikidata (fonte "Wikidata",
CC0). Os artigos com coordenada da Wikipédia continuam como complemento, com o mesmo filtro e sem repetir o mesmo
lugar. Uma fonte fora do ar não derruba a outra. Nova rota `GET /api/onde` (Nominatim reverso no nível do prédio): o
Passeio mostra "Você está em Mercado de Arte Popular · Centro · Feira de Santana" e o cartão "longe" passa a oferecer
"Guia de Feira de Santana".
**Por quê:** teste em campo no Mercado de Arte Popular de Feira de Santana: o app não disse onde a pessoa estava e o
roteiro trouxe só emissoras de TV e rádio, porque eram os únicos artigos da Wikipédia com coordenada perto; o mercado
(tombado, com artigo) só tem a coordenada no Wikidata. Conferido nos serviços reais em 04/11/2026: com o filtro, Feira
fica com 47 de 57 itens (mercado, Painéis do MAP, igrejas, coretos, museu, monumentos) e Ouro Preto com 60 de 102.
O Overpass (OpenStreetMap) foi considerado e descartado: respondeu "sem capacidade" (502) e passou de 25 s no teste.
**Limites:** inventários municipais entram inteiros (ex.: um clube num prédio de interesse histórico); destinos
gerados antes desta versão continuam no aparelho até tocar de novo em *Guia de onde estou* ou buscar a cidade.

# G-019 — Mais conteúdo e respostas fora do roteiro: artigo completo, pesquisa na Wikipédia e busca na web da IA
**Decisão:**
1. **Destino gerado com o artigo inteiro.** Até 50 pontos (antes 30; o raio só amplia se houver menos de 15). Para os
   40 mais perto com artigo, o servidor baixa o texto completo (um pedido por artigo, 6 de cada vez, cache de 24 h):
   as seções viram narração longa (até 1.600 caracteres), até 4 curiosidades e uma pergunta pronta por seção
   ("Qual a história de...?", "Como é a arquitetura de...?"), com as palavras que as pessoas usam para perguntar.
   Isso funciona também sem internet, porque fica no destino guardado. Nome sem o parêntese da Wikipédia.
2. **Pergunta em destino gerado chega ao servidor.** O destino gerado só existe no aparelho; o servidor respondia
   404 "Pacote não encontrado" a toda pergunta, foto e avaliação feita nele (e o app mostrava isso como resposta).
   Agora o id (`lugar-m12-255-m38-966`) dá o centro e o servidor monta o destino de novo, quase sempre vindo do cache.
3. **Sem IA, pesquisa na Wikipédia.** Quando o roteiro não tem pergunta pronta que responda, o servidor procura o
   trecho que responde no artigo do ponto em foco, no artigo da cidade e nos 3 primeiros da busca da Wikipédia (só
   os que citam a cidade no título ou no trecho). Vence o trecho com mais palavras da pergunta, com sinônimos de
   turismo (comida/culinária, festa/festival, fundou/fundação, construiu/construção) e sem palavras genéricas
   ("cidade", "lugar"). A resposta diz "Pesquisei na Wikipédia (artigo ...)" e traz o link. Sem trecho bom, não inventa.
4. **Com IA, busca na web.** Claude do servidor usa a ferramenta `web_search_20250305` (até 3 buscas por pergunta,
   localizada na cidade do destino; US$ 10 por 1.000 buscas, além dos tokens). A IA da pessoa (OpenRouter) usa o
   plugin `web` (até 4 resultados; cobrado dos créditos dela). As fontes citadas aparecem como links na conversa.
**Por quê:** teste em campo: "os pontos que ele carrega são poucos, ele não responde perguntas e as informações sobre
os pontos são poucas"; pediu mais informação "mesmo que pesquisando no Google". Busca do Google por API exige chave e
cobrança à parte; a busca na web das próprias IAs já está nas contas que o app usa, e a Wikipédia serve sem IA.
Conferido com a Wikipédia real em 08/11/2026: o artigo do Mercado Municipal de Feira de Santana tem 3 seções
(História, Arquitetura, Tombamento); a pesquisa sem IA respondeu "quem construiu o mercado", "quando foi tombado",
"quem foi Tiradentes" (Ouro Preto), "quem fundou" e "comida típica" (Salvador), e recusou um trecho de Olinda para Ouro
Preto.
**Limites:** sem IA a pesquisa só acha o que a Wikipédia diz com palavras parecidas com as da pergunta ("quem fundou
Feira de Santana" ainda pega uma frase ruim); a IA no servidor depende de criar a variável `ANTHROPIC_API_KEY`.
Destino gerado agora pesa até ~300 KB no aparelho (10 lugares guardados ≈ 3 MB do localStorage).
