# Estadia · Brobot Tecnologia

Plataforma de gestão e comprovação de eventos logísticos de carga e descarga.
Cliente: **Brobot Tecnologia** · Requisitos: **Menezes Gestão** · Versão **0.1 (MVP funcional de demonstração)**

Cada marco da operação (chegada, início, término, liberação, saída) é registrado com autor, horário, local e evidência. Depois a outra parte confirma ou contesta o registro, e tudo vira um dossiê digital rastreável.

**Demonstração no ar:** https://estadia-production-1784.up.railway.app (Railway)

## Como rodar

Requer apenas **Node.js 20 ou superior**. Não há dependências para instalar.

```bash
cd brobot/estadia
npm start          # http://localhost:3000
npm test           # testes automatizados dos critérios de aceite
npm run reset      # apaga os dados e recria a demonstração no próximo start
```

Na primeira execução o sistema cria organizações, usuários e operações fictícias. **A senha de todos os usuários é `estadia123`.** A tela de login tem atalhos para cada conta.

| Usuário | Perfil | Para que serve na demonstração |
|---|---|---|
| `joao@tac.demo` | TAC (placa RTB-4F27) | Identifica a operação `OP-2026-0001` e registra os marcos pelo celular |
| `portaria@serraazul.demo` | Destino · Serra Azul | Confirma chegada, libera o veículo, gera dossiê, encaminha à advocacia |
| `doca@serraazul.demo` | Destino · Serra Azul | Confirma início e término da descarga |
| `cd@horizonte.demo` | Destino · Mercado Horizonte | Mostra o isolamento: não enxerga as operações da Serra Azul |
| `juridico@andradeprado.demo` | Advocacia | Vê somente dossiês encaminhados e atualiza o status |
| `admin@brobot.demo` | Administrador | Usuários, todas as operações e verificação da cadeia de integridade |

### Roteiro sugerido para apresentar (10 minutos)

1. Abra duas janelas: **João** (de preferência no celular) e **Marina** (no computador).
2. João identifica `OP-2026-0001` e registra a **chegada**. O app captura o horário do toque, o GPS do aparelho e a foto da câmera.
3. A pendência aparece na hora para Marina, com foto e mapa. Ela **confirma** ou clica em **Não reconheço este registro** para abrir uma divergência.
4. João toca **Simular sem sinal** e registra o **início**. O registro fica salvo no aparelho e é enviado quando o sinal volta, mantendo o horário original.
5. Siga até o término, a liberação, a ciência do TAC e a saída. A **apuração** é registrada automaticamente.
6. Abra `OP-2026-0003`, uma operação histórica com divergência e 6h20 de excedente. Gere o **dossiê**, clique em **Verificar integridade**, imprima ou salve em PDF e **encaminhe à advocacia**.
7. Entre como Helena (advocacia) e mostre que ela só vê o que foi encaminhado.

**Para repetir os testes:** entre como **Administrador → Administração → Reiniciar demonstração**. Tudo é apagado e os dados iniciais são recriados (todos precisam entrar de novo). Em produção real, desative com a variável `ESTADIA_DEMO_RESET=0`. Os registros em si nunca podem ser apagados individualmente: o log é imutável por regra de negócio.

Para testar GPS e câmera de verdade no celular, o endereço precisa ser **HTTPS** (ou `localhost`). Pela rede local em `http://`, o navegador bloqueia o GPS e o evento é gravado com a observação "localização indisponível". Use a publicação descrita abaixo ou um túnel HTTPS (ex.: `cloudflared tunnel --url http://localhost:3000`).

## O que está implementado

| Épico do documento | Situação nesta versão |
|---|---|
| 01 Identificação da operação | Código da operação + placa vinculam o TAC. Uma operação não aceita outro motorista. |
| 02 Registro da chegada | Horário, GPS (com precisão) e foto obrigatória. A foto é guardada com hash SHA-256. |
| 03–07 Confirmações | Confirmação sempre pela outra parte, sem alterar o horário original. |
| 06 Término | Não pode ser anterior ao início (RN). |
| 08 Liberação | Evento próprio do destino, com ciência do TAC registrada separadamente (17:32 ≠ 17:35). |
| 09 Saída | Distinta da liberação. Uma saída sem liberação gera alerta, não bloqueio. |
| 10 Divergências | Contestação com horário reconhecido pela parte, alertas automáticos (cerca geográfica, falta de GPS, sincronização tardia, falta de confirmação) e tratamento da ocorrência. |
| 11 Offline | Fila no IndexedDB, reenvio automático, idempotência por `clientEventId` e horário do acontecimento separado do horário de recebimento. |
| 12 Linha do tempo | Registro, confirmação, divergência e tratamento aninhados, com hash de cada evento. |
| 13 Apuração | Regra versionada (`ESTADIA-REF v0.1`), histórico de apurações e cenários com marcos alternativos. |
| 14 Dossiê digital | Snapshot imutável com hash SHA-256, verificação no navegador e versão para impressão/PDF. |
| 15 Encaminhamento jurídico | Critérios de aptidão, envio e acompanhamento de status pela advocacia. |
| 16 Permissões | Perfis TAC, destino, advocacia e admin, com isolamento entre organizações. |
| 17 Auditoria | Log somente-anexação com cadeia de hash. Qualquer edição no arquivo é detectada. |

**Ressalva:** a franquia de 5h e o valor de R$ 1,38 por tonelada/hora são parâmetros de **referência** (Lei 11.442/2007, art. 11). Os marcos de contagem e os valores precisam de validação jurídica antes do uso real, e a plataforma não apresenta o resultado como conclusão jurídica.

## Arquitetura

```
brobot/estadia/
├── server/
│   ├── server.js   API REST, eventos em tempo real (SSE) e arquivos estáticos
│   ├── domain.js   regras de negócio puras: marcos, sequência, confirmação, apuração, alertas
│   ├── store.js    log de eventos append-only com cadeia de hash, fotos e dossiês
│   ├── auth.js     usuários, senhas (scrypt) e tokens assinados (HMAC)
│   └── seed.js     dados de demonstração
├── public/         app web (PWA) único para celular e computador; funciona offline
├── test/           testes automatizados (node:test)
└── demo-conceitual/index.html   protótipo visual navegável usado na venda
```

Os dados ficam em `data/` (ou no caminho de `ESTADIA_DATA`):

- `events.jsonl`: um evento por linha, cada um com o hash do anterior;
- `photos/`: fotos nomeadas pelo próprio hash;
- `dossies/`: snapshots dos dossiês;
- `directory.json`: organizações e usuários.

A modelagem por eventos segue o documento ("o Estadia deve trabalhar com eventos, e não somente com status"). O status da operação é sempre calculado a partir dos eventos.

### Principais rotas da API

| Método | Rota | Uso |
|---|---|---|
| POST | `/api/login` | Autenticação |
| GET | `/api/operations` | Operações visíveis para o usuário |
| POST | `/api/operations` | Cadastrar operação (destino) |
| POST | `/api/operations/identify` | TAC identifica a operação (código + placa) |
| GET | `/api/operations/:id` | Detalhe: linha do tempo, apuração, alertas e ações disponíveis |
| POST | `/api/operations/:id/events` | Registrar marco, confirmação, divergência ou tratamento |
| POST | `/api/operations/:id/dossie` | Gerar dossiê |
| POST | `/api/operations/:id/encaminhar` | Encaminhar à advocacia |
| GET | `/api/dossies/:hash` | Conteúdo do dossiê |
| GET | `/api/admin/integrity` | Verificar a cadeia de eventos |

## Publicar na internet

O GitHub guarda o código, mas não executa servidores. Para ter um link público com HTTPS:

- **Railway**: crie um serviço a partir deste repositório no GitHub e, em *Settings*, defina **Root Directory** = `brobot/estadia`. O `railway.json` e o `Dockerfile` cuidam do resto. Adicione um **Volume** com *mount path* `/data` para os dados sobreviverem a novos deploys, e a variável `ESTADIA_SECRET` com um valor aleatório. Em *Networking*, clique em *Generate Domain* para ter o link HTTPS.
- **Render.com**: o arquivo `render.yaml` na raiz do repositório já está configurado. Em *New → Blueprint*, escolha este repositório. No plano gratuito os dados são apagados quando o serviço reinicia, o que serve para demonstração. Para guardar dados, adicione um disco persistente e aponte `ESTADIA_DATA` para ele.
- **Docker** (qualquer provedor): `docker build -t estadia . && docker run -p 3000:3000 -v estadia-data:/data estadia`.

## Próximos passos sugeridos para o time da Brobot

- Correção formal de eventos (novo evento que referencia o original), já prevista nas RNs.
- Banco de dados (PostgreSQL) mantendo o modelo de eventos, e armazenamento de fotos em objeto (S3).
- App nativo ou PWA com captura em segundo plano, além de notificações push para liberação e pendências.
- Assinatura digital e carimbo de tempo (ICP-Brasil) nos dossiês.
- Integrações com TMS/WMS/YMS e cadastro de operações via API.
- Validação jurídica dos marcos e parâmetros da apuração.
