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

**A senha de todas as contas de demonstração é `estadia123`.** A tela de login tem atalhos para cada conta.

| Conta | Perfil | Papel na demonstração |
|---|---|---|
| `joao@tac.demo` | TAC (placa RTB-4F27) | Informa os dados à Amélia, registra chegada, início, término e saída, e envia o link ao destino |
| `operacao@rodoviasul.demo` | Transportadora | Cria operações, registra pagamentos, retifica dados, encaminha ao jurídico, encerra e vê relatórios |
| `portaria@serraazul.demo` | Embarcador/destinatário | Confirma pelo portal, registra a liberação e trata divergências |
| `doca@serraazul.demo` | Embarcador/destinatário | Confirma início e término ou contesta horários |
| `cd@horizonte.demo` | Outro destinatário | Mostra o isolamento entre organizações |
| `juridico@andradeprado.demo` | Jurídico | Vê só os casos encaminhados e registra o retorno |
| `admin@estadiabr.demo` | Administração | Reinício da demonstração, integridade, parâmetros, permissões e usuários |

### Dados de demonstração

| Operação | Situação | O que ela mostra |
|---|---|---|
| `OP-2026-0001` | Descarga livre para o teste ao vivo | Fluxo completo com João |
| `OP-2026-0002` | Outro destinatário | Isolamento: a Serra Azul não a enxerga |
| `OP-2026-0003` | Descarga de ontem | Confirmação via link, deslocamento de 612 m, divergência no início, 11h12 de estadia, **R$ 840,00** devidos e R$ 400,00 pagos (parcial) |
| `OP-2026-0004` | Carga com a mesma NF-e | 3h35, dentro do limite, **R$ 0,00**, encerrada. Aparece relacionada à 0003 nos relatórios |

### Roteiro sugerido (10 minutos)

1. **Celular com João:** na Amélia, digite ou fale *"Placa RTB4F27, carreta sider, descarga de 28 toneladas de açúcar no CD Jundiaí, nota fiscal 35261000184552"*. Toque em **Interpretar** e depois em **Confirmar dados**.
2. **Chegada:** registre a chegada com foto e GPS. O sistema gera o link seguro. Toque em **Enviar pelo WhatsApp**: o WhatsApp abre com a mensagem pronta para o responsável do destino.
3. **Confirmação pelo destino:** abra o link em outro aparelho, sem login, e toque em **CONFIRMAR CHEGADA**. O Limite de Estadia de 5h começa a contar nesse momento.
4. **Deslocamento:** no celular, toque em **Simular afastamento de 450 m**. Surge a ocorrência `DESLOCAMENTO_FORA_DO_LIMITE`.
5. **Sem sinal:** toque em **Simular sem sinal** e siga com início e término. Os registros ficam no aparelho e são enviados depois, com o horário original.
6. **Liberação e saída:** a Marina registra a liberação, o João confirma, e na saída fotografa o comprovante (GPS não é exigido). A apuração e o dossiê saem automaticamente.
7. **Transportadora (Carla):** em `OP-2026-0003`, mostre o cálculo (11,20 h × 30 t × R$ 2,50 = R$ 840,00), registre o pagamento do saldo, gere o dossiê, verifique a integridade e encaminhe ao jurídico.
8. **Relatórios:** indicadores operacionais, financeiros e jurídicos, e a relação carga × descarga pela NF-e.

**Para repetir os testes:** entre como **Administração → Reiniciar demonstração**. Em produção, desative com a variável `ESTADIA_DEMO_RESET=0`.

## O que mudou na versão 2.0

| Item do documento | Implementação |
|---|---|
| Marca e white-label (3) | Telas, mensagens e dossiê mostram apenas **Estadia BR** |
| Operações estanques (5, 51) | Cada operação é de **carga** ou **descarga**, com ID, eventos, apuração, dossiê e financeiro próprios. A relação entre elas aparece só nos relatórios (por NF-e) |
| Dados da operação (RF-02) | Tipo, implemento, capacidade, peso, volume, carga, NF-e, CT-e, MDF-e, local, data prevista, responsável e WhatsApp do destino |
| Amélia (épico 02, 36) | Texto ou áudio. O áudio é gravado e guardado como evidência; a transcrição usa o navegador quando disponível. O TAC confirma uma única vez e cada dado mostra o trecho de onde veio, sem inventar informação (RN-03) |
| Confirmação via WhatsApp (épicos 04, 21, 22, 38) | Link único, imprevisível e com validade (24h por padrão). Só permite aquela confirmação e mostra o mínimo necessário. Registra visualização, IP e dispositivo. Link expirado permite pedir outro |
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
│   ├── store.js    log de eventos append-only com cadeia de hash, evidências, links e dossiês
│   ├── auth.js     usuários, senhas (scrypt) e tokens assinados (HMAC)
│   └── seed.js     dados de demonstração
├── public/         app web (PWA) para celular e computador + confirmar.html (página do link)
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
