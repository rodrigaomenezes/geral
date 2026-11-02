# GuIA Brasil · MVP de teste

Guia turístico com IA no celular: **narra o lugar onde você está**, **explica fotos** (monumento, obra, prato,
placa em outro idioma) e **conversa como um guia** — também **sem internet**, com o pacote da viagem baixado antes.

Requisitos completos: documento "Guia Turístico com IA — Levantamento de Requisitos" (Claude Docs).
Este MVP cobre RF01 (com o companheiro de caminhada), RF02, RF03, RF05, RF06 (via foto com IA), RF07, RF10 (básico) e RF12. Ficam para depois:
vídeo (RF04), diário (RF08), roteiros (RF09), contas e pagamento (RF11), afiliados, painel B2B e modo grupo.

## Rodar no computador

```bash
cd menezes-gestao/guia-brasil
npm install        # só instala o pacote opcional da IA
npm start          # http://localhost:3000
npm test           # 31 testes (núcleo, companheiro, servidor e Sua IA)
```

Sem chave de IA o app funciona no **modo local**: narração, perguntas frequentes e identificação de foto por GPS
e bússola, com o conteúdo curado do pacote. Para ligar a IA (conversa aberta e visão de qualquer foto), crie a
variável de ambiente **`ANTHROPIC_API_KEY`** no servidor — nunca coloque a chave no código ou no chat.

**Sua IA, sem chave:** em *Viagem → Sua IA*, a pessoa toca *Conectar minha IA (OpenRouter)*, entra na conta dela
e autoriza. A partir daí a conversa e a foto usam a IA dela, cobrada dos créditos dela, e a conexão fica só no
aparelho. Dá para trocar o modelo (padrão `openrouter/auto`) e desconectar. No app Android, entre com e-mail: o
login com Google não funciona dentro de apps.

| Variável | Para quê | Padrão |
|---|---|---|
| `ANTHROPIC_API_KEY` | Liga a IA (Claude) | sem IA |
| `GUIA_IA_MODELO` | Modelo usado | `claude-opus-5-5` |
| `GUIA_IA` | `0` desliga a IA mesmo com chave | — |
| `GUIA_DADOS` | Pasta das avaliações (`feedback.jsonl`) | `./dados` |
| `PORT` | Porta HTTP | `3000` |

## Testar no celular

No ar: **https://geral-production.up.railway.app** (publica sozinho a cada merge na branch principal).

GPS, câmera, bússola e instalação como app exigem **HTTPS**. O caminho mais simples é o Railway, igual ao Estadia:

1. Railway → *New Project* → *Deploy from GitHub repo* → `rodrigaomenezes/geral`.
2. Em *Settings*: **Root Directory** = `/menezes-gestao/guia-brasil`, **Builder** = Dockerfile, **Healthcheck Path** =
   `/api/health`. Serviços novos do Railway ignoram o `railway.json`; por isso a configuração é feita na tela.
3. Em *Variables*: crie `ANTHROPIC_API_KEY` (opcional) e adicione um **Volume** em `/data` para guardar as avaliações.
4. *Generate Domain* (porta 8080) e abra o endereço no celular. No Chrome (Android) ou Safari (iPhone): *Adicionar à tela inicial*.

### App Android (segundo plano)

Para receber os avisos com a tela bloqueada, instale o APK:

```bash
cd menezes-gestao/guia-brasil/android && ./build.sh   # dist/GuIA-Brasil-piloto.apk
```

No celular: abra o arquivo `.apk`, permita *instalar apps desta fonte*, abra o GuIA Brasil e permita localização
e notificações. Ao tocar *Começar a caminhar* aparece a notificação fixa "GuIA Brasil está caminhando com você":
a partir daí os avisos marcados para notificar chegam com a tela bloqueada. Se o celular tiver economia de bateria
agressiva (Xiaomi, Samsung, Motorola), coloque o GuIA Brasil como *sem restrição* de bateria.
Use sempre a mesma chave de assinatura (`GUIA_KEYSTORE`/`GUIA_KEYPASS`) para o Android aceitar as atualizações.

### Roteiro de teste

1. **Viagem** → *Baixar para usar offline* no pacote de Salvador.
2. **Companheiro de caminhada** (aba Passeio): toque *Começar a caminhar* e siga andando. O guia acompanha o trajeto
   e avisa sozinho: *Você chegou* (narra o ponto), *Logo à frente* (ponto a até 200 m na direção em que você anda),
   *Importante*, *Dica* e *Novidade*. Ao encerrar, mostra o resumo: distância, tempo e lugares conhecidos.
   Em Viagem dá para marcar *Começar o companheiro ao abrir o app* e escolher, **por tipo de aviso**, se ele
   avisa e notifica, só avisa com o app aberto ou fica desligado, além da frequência e de um limite por hora.
   Fora de Salvador: marque **Simular caminhada** e use *Andar até o próximo ponto* (11 pontos, do Mercado Modelo
   ao Pelourinho).
3. **Conversa**: pergunte por texto ou voz ("quem fundou Salvador?", "o que é acarajé?"). Para perguntas livres,
   conecte sua IA em *Viagem → Sua IA*.
4. **Foto**: fotografe qualquer coisa. Com IA, ela explica o que for; sem IA, reconhece os pontos do pacote pela
   posição e direção da câmera.
5. **Offline**: ative o modo avião. O app abre, narra, responde o que está no pacote e guarda o resto; ao voltar
   a internet, responde o que ficou na fila.
6. Marque **Isso está errado** em respostas ruins: vira linha em `dados/feedback.jsonl` para a curadoria.

## Limitações conhecidas deste MVP

- **Coordenadas aproximadas** no pacote de Salvador: conferir em campo antes de abrir ao público (Fase 0).
- **No navegador** o companheiro precisa do app aberto (a tela fica acesa); com a tela bloqueada o navegador para
  o GPS e a voz. **No app Android** funciona com a tela bloqueada. **No iPhone** só o app web por enquanto (G-014).
- App Android de piloto: `targetSdk 28` e instalação direta; para a Play Store precisa do build com SDK atual (G-013).
  Não foi testado em aparelho.
- Sem mapa desenhado: a tela mostra a lista por distância com seta de direção (mapa offline entra com MapLibre).
- IA local no aparelho ainda não usada: offline, a conversa responde só o que está no pacote (decisão G-004).
- Voz e ditado dependem do navegador; o ditado não existe no Firefox nem em alguns Androids. **No iPhone a voz
  fica muda com o modo silencioso ligado** (o app avisa no primeiro "Ouvir").
- No iPhone, o atalho da tela inicial guarda os dados separado do Safari: destino, conexão da IA e preferências
  precisam ser feitos dentro do atalho (o destino único é baixado sozinho).
- Sem contas, pagamento nem limite por usuário (só por IP).

Arquitetura e decisões: [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`DECISIONS.md`](DECISIONS.md).
