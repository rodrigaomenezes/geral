# Estadia BR

Plataforma de gestão, comprovação e rastreabilidade de eventos logísticos de carga e descarga.
Projeto interno: cliente **Brobot Tecnologia** · requisitos **Menezes Gestão** · versão **DEV 2.0 (05/10/2026)** · MVP funcional de demonstração.

> As telas usadas pelos usuários mostram apenas a marca **Estadia BR** (white-label, seção 3 do documento). Os nomes Brobot e Menezes Gestão aparecem só neste repositório.

**Demonstração no ar:** https://estadia-production-1784.up.railway.app (Railway)

## Como rodar

Requer apenas **Node.js 20 ou superior**. Não há dependências para instalar.

```bash
cd brobot/estadia
npm start          # http://localhost:3000
npm test           # testes automatizados dos critérios de aceite
npm run reset      # apaga os dados locais; o próximo start recria a demonstração
```

### Como entrar

- **Motorista:** aba **Sou motorista**, com celular e código de 4 números. João: `(11) 98888-0001`, código `1234`. Ana: `(11) 98888-0002`, código `1234`. A sessão fica salva no celular por 30 dias.
- **Empresas:** aba **Sou da empresa**, com e-mail e senha `estadia123`. A tela tem atalhos para cada conta.

| Conta | Perfil | Papel na demonstração |
|---|---|---|
| João, `(11) 98888-0001` | Motorista (placa RTB-4F27) | Opera sozinho no celular: escolhe a viagem, confere a carga, registra os passos |
| `operacao@rodoviasul.demo` | Transportadora | Cria operações, acompanha mensagens, registra pagamentos, retifica, encaminha ao jurídico e vê relatórios |
| `portaria@serraazul.demo` | Embarcador/destinatário | Pode confirmar pelo portal, mas no MVP confirma respondendo no WhatsApp |
| `cd@horizonte.demo` | Outro destinatário | Mostra o isolamento entre organizações |
| `juridico@andradeprado.demo` | Jurídico | Vê só os casos encaminhados |
| `admin@estadiabr.demo` | Administração | Reinício da demonstração, integridade, parâmetros e usuários |

## App do motorista

O motorista opera sozinho. Portaria, embarcador e transportadora não precisam instalar nem acessar nada: tudo chega e volta pelo WhatsApp.

1. **Entrar:** com celular e código de 4 números. Fica conectado.
2. **Escolher a viagem:** o app mostra as viagens cadastradas para a placa dele. É um toque em **É ESSA · COMEÇAR**, sem digitar código. Se não houver viagem, ele pode usar a Amélia (voz ou texto) ou digitar o código.
3. **Conferir a carga:** placa, carga, peso, nota e destino na tela, com **ESTÁ CERTO** ou **TEM ERRO · FALAR COM A AMÉLIA**.
4. **Um passo de cada vez,** com um botão gigante e frases do dia a dia:
   **CHEGUEI** → **COMEÇOU A DESCARGA** → **TERMINOU A DESCARGA** → **FUI LIBERADO** → **SAÍ DO LOCAL**.
   - Quando a foto é obrigatória (chegada e comprovante de saída), a câmera abre direto.
   - Nos outros passos, uma pergunta simples ("A descarga começou agora?") evita toque sem querer.
   - O horário registrado é o do toque, e o GPS é capturado sozinho.
5. **Confirmação pelo WhatsApp:**
   - A cada passo, o sistema manda uma mensagem para a portaria pedindo **SIM** ou **NÃO**, com um link para ver a foto e o local.
   - Chegada, liberação e saída também geram um aviso para a transportadora, que responde **OK**.
   - O motorista vê no próprio passo: *enviado ✓*, *chegou no celular ✓✓*, *leu*, *confirmou às 06:20* ou *respondeu NÃO*. O celular vibra quando chega uma confirmação.
6. **Tempo de espera grande na tela:** começa quando a portaria confirma a chegada e mostra quando vencem as 5 horas.
7. **Se der problema:**
   - **Sem internet:** o app guarda tudo no celular e envia sozinho depois.
   - **Contato sem número:** o app pede o WhatsApp da portaria e reenvia a mensagem.
   - **Ninguém respondeu em 5 minutos:** aparecem as opções *Mandar de novo*, *Mandar pelo meu WhatsApp* e *Responderam no meu WhatsApp*. Nesta última, o motorista envia o print da conversa, que vira evidência.
8. **Fim da viagem:** o app mostra o tempo de estadia e o valor, e tem o botão **RECEBI UM VALOR** para registrar pagamentos.
9. **Ajuda:** o botão *Falar com a transportadora* abre o WhatsApp dela com a mensagem pronta.

### Como a resposta do WhatsApp vira confirmação

| Resposta da pessoa | O que o sistema registra |
|---|---|
| SIM, S, OK, Confirmo, Certo, 👍, 1 | Confirmação do passo (pedido) ou recebimento do aviso, com nome, número, horário e o texto da resposta |
| NÃO, N, Negativo, ❌, 2 | Divergência para análise. O registro do motorista fica preservado |
| Outra coisa | Resposta guardada e mensagem automática pedindo SIM ou NÃO |

Cada mensagem guarda no log imutável: o envio, o status de entrega e leitura, as respostas e o resultado. Tudo entra no dossiê.

### Modos de envio do WhatsApp

| Modo | Quando | Como funciona |
|---|---|---|
| `simulado` | Padrão da demonstração | As mensagens vão para o **celular simulado** em `/whatsapp.html`, onde você faz o papel da portaria ou da transportadora e responde SIM/NÃO/OK |
| `api` | Com a API oficial configurada | Envio pelo número da empresa (WhatsApp Business Cloud API). Respostas e status de entrega e leitura chegam pelo webhook `POST /api/whatsapp/webhook` |
| `manual` | Sem API e fora da demonstração | O app abre o WhatsApp do próprio motorista com a mensagem pronta. A confirmação vem pelo link da mensagem ou pelo print da resposta |

Variáveis para o modo `api`:

| Variável | Uso |
|---|---|
| `WHATSAPP_TOKEN` | Token de acesso |
| `WHATSAPP_PHONE_ID` | Número remetente |
| `WHATSAPP_VERIFY_TOKEN` | Verificação do webhook |
| `WHATSAPP_APP_SECRET` | Valida a assinatura das chamadas |
| `WHATSAPP_MODE` | Força um dos modos acima |

Para iniciar conversas fora da janela de 24h, a Meta exige *templates* aprovados. Isso precisa ser contratado e validado pelo time técnico.

### Roteiro sugerido (10 minutos, dois celulares)

1. **Celular 1, motorista:** entre como João, toque em **É ESSA · COMEÇAR** e depois em **ESTÁ CERTO**.
2. **Chegada:** toque em **CHEGUEI**, tire a foto e toque em **SIM, ENVIAR**.
3. **Celular 2, portaria:** abra `/whatsapp.html` (em *Ferramentas da demonstração* há um atalho), entre na conversa da Marina, veja a mensagem com o link da foto e toque em **SIM**.
4. **Confirmação:** no celular 1 aparece "Confirmado por Marina" e o tempo de espera começa.
5. **Divergência:** siga com **COMEÇOU A DESCARGA**. Desta vez, no simulador, responda **NÃO**: vira divergência.
6. **Até o fim:** **TERMINOU**, **FUI LIBERADO** e **SAÍ DO LOCAL** (foto do comprovante). Veja a tela final com tempo e valor.
7. **Computador, Carla (transportadora):** abra a operação, veja o quadro *Mensagens de WhatsApp* com cada resposta, e o dossiê. Em `OP-2026-0003` há um histórico completo com R$ 840,00 devidos.

**Para repetir:** use **Administração → Reiniciar demonstração**.

## O que mudou na versão 2.0

| Item do documento | Implementação |
|---|---|
| Marca e white-label (3) | Telas, mensagens e dossiê mostram apenas **Estadia BR** |
| Operações estanques (5, 51) | Cada operação é de **carga** ou **descarga**, com ID, eventos, apuração, dossiê e financeiro próprios. A relação entre elas aparece só nos relatórios (por NF-e) |
| Dados da operação (RF-02) | Tipo, implemento, capacidade, peso, volume, carga, NF-e, CT-e, MDF-e, local, data prevista, responsável e WhatsApp do destino |
| Amélia (épico 02, 36) | Texto ou áudio. O áudio é gravado e guardado como evidência; a transcrição usa o navegador quando disponível. O TAC confirma uma única vez e cada dado mostra o trecho de onde veio, sem inventar informação (RN-03) |
| Confirmação via WhatsApp (épicos 04, 21, 22, 38) | A **resposta** SIM/NÃO/OK no WhatsApp confirma o evento ou o recebimento. A mensagem também leva um link único, que expira e mostra a foto e o local. Envio, entrega, leitura e resposta ficam auditados |
| Limite de Estadia (RN-10, 22) | Começa na **confirmação da chegada** e vai até a **liberação** (marco final a homologar). A tela mostra uma contagem regressiva |
| Cálculo (RN-23 a 27) | Até 5h: **R$ 0,00**. Acima de 5h: **tempo total × capacidade × R$ 2,50**. Exemplo do documento (6h × 30 t = R$ 450,00) coberto por teste |
| Versionamento (RN-28) | Regras `ESTADIA-REF 0.1` (antiga) e `ESTADIA-BR 2.0` (vigente), com vigência, fórmula, capacidade, tempo e resultado gravados em cada apuração |
| Deslocamento (épico 05) | Raio fixo de **300 m** sobre o local cadastrado (ou a posição da chegada). O app envia a posição a cada 2 min; acima do limite, registra `DESLOCAMENTO_FORA_DO_LIMITE`, que entra no dossiê |
| Saída (RN-17 a 19) | Foto do documento ou comprovante obrigatória; GPS não obrigatório |
| Liberação (RF-31/32) | Documento de liberação opcional; confirmação da liberação pelo TAC |
| Conciliação (épico 14) | Valor devido, pagamentos com origem, saldo e status: `AGUARDANDO_PAGAMENTO`, `PAGAMENTO_PARCIAL`, `PAGO`, `VALOR_DIVERGENTE`, `EM_TRATATIVA`. Gerar o dossiê não encerra a operação |
| Status (épico 15) | De `CRIADA` a `ENCERRADA`, calculados a partir dos eventos |
| Transportadora (4.3) | Novo perfil: cria operações, acompanha valores, registra pagamentos, encaminha ao jurídico e encerra |
| Jurídico (épico 17) | Encaminhamento com observação e valor; retorno com status e resultado |
| Auditoria (RF-50) | Cada evento guarda origem (app, portal, link WhatsApp, Amélia, automático), IP e dispositivo. A retificação registra valor anterior, novo e motivo |
| Permissões (RF-52) | Matriz visualizar, criar, editar, confirmar, encaminhar, registrar pagamento, exportar e administrar, visível na administração |
| Relatórios (épicos 23, 47) | Indicadores operacionais, financeiros, de evidências e jurídicos, por operação e com relação carga × descarga |
| Dossiê (épico 16) | Gerado automaticamente na saída, com versões. Inclui dados informados, marcos, confirmações, fotos, ocorrências, notificações, apuração, pagamentos, negociações, retificações, jurídico e trilha de auditoria. Exporta em PDF (impressão) e arquivo |

### Pontos que dependem do time técnico ou de validação

- **WhatsApp automático:** nesta versão o link é gerado automaticamente, mas o envio é feito pelo WhatsApp do próprio usuário (`wa.me`), com registro do envio. O disparo automático exige o provedor oficial (API do WhatsApp Business), com templates aprovados, webhook e custo, conforme a seção 37.
- **Amélia:** o interpretador atual é determinístico (padrões de texto) e a transcrição de voz depende do navegador. A troca por uma API de IA e de transcrição pode manter o mesmo contrato (`/api/amelia/interpretar` e `/api/amelia/confirmar`).
- **Marco final e frações de hora:** o cálculo usa a liberação como marco final e minutos exatos. Os dois pontos estão listados para validação jurídica na seção 45.
- **Monitoramento de posição:** funciona com o app aberto. O rastreamento em segundo plano exige app nativo.

## Arquitetura

```
brobot/estadia/
├── server/
│   ├── server.js   API REST, página pública do link, eventos em tempo real (SSE)
│   ├── domain.js   regras: marcos, status, permissões, apuração, conciliação, deslocamento
│   ├── amelia.js   interpretação de texto em dados estruturados
│   ├── whatsapp.js envio (API/simulado/manual), webhook e leitura das respostas
│   ├── store.js    log de eventos append-only com cadeia de hash, evidências, links e dossiês
│   ├── auth.js     usuários, senhas (scrypt) e tokens assinados (HMAC)
│   └── seed.js     dados de demonstração
├── public/         app web (PWA): modo motorista, portal, confirmar.html (link) e whatsapp.html (simulador)
├── test/           testes automatizados (node:test)
└── demo-conceitual/index.html   protótipo visual usado na venda (versão 1.0)
```

Os dados ficam em `data/` (ou no caminho de `ESTADIA_DATA`):

- `events.jsonl`: eventos imutáveis, cada um com o hash do anterior;
- `photos/`: fotos e áudios, nomeados pelo próprio hash;
- `links.json`: tokens dos links (no log fica só o hash do token);
- `dossies/`: dossiês gerados;
- `directory.json`: organizações e usuários.

| Variável | Uso |
|---|---|
| `PORT` | Porta HTTP |
| `ESTADIA_DATA` | Pasta de dados (no Railway, o volume em `/data`) |
| `ESTADIA_SECRET` | Chave de assinatura das sessões |
| `ESTADIA_DEMO_RESET` | `0` desativa o reinício da demonstração e a simulação de deslocamento |
| `ESTADIA_LINK_TTL_HORAS` | Validade dos links de confirmação (padrão 24) |
| `ESTADIA_BASE_URL` | Endereço público usado nos links (opcional; por padrão vem do próprio acesso) |

## Publicação

- **Railway:** serviço a partir deste repositório, com *Root Directory* = `brobot/estadia`. O `railway.json` e o `Dockerfile` cuidam do build. Use um volume em `/data` e a variável `ESTADIA_SECRET`.
- **Docker:** `docker build -t estadia . && docker run -p 3000:3000 -v estadia-data:/data estadia`.

Ao subir a versão 2.0 num ambiente que tinha dados de demonstração da 1.0, o servidor recria a demonstração automaticamente no novo formato.
