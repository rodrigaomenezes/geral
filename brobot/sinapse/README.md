# Sinapse · ERP Operacional Brobot

Gestão do trabalho interno de **Operações, Suporte e Customer Success** da Brobot: entrada omnicanal, triagem,
ocorrências com máquina de estados e SLA, transferências com aceite, pré-rodada (D-4 → D-3 → ligação → D-1),
pós-rodada (D0 → D+3), carteira com VIP e pontos focais, supervisor independente e auditoria completa.
**Processos automáticos:** a operação escreve, em formulário, processos que o sistema segue sozinho (gatilho → condições →
passos → "para sozinho se"), com simulação, versões e restauração. Os processos da reunião de 03/11/2026 já vêm prontos.
**Dashboards** interativos por área e **mensagens padrão** editáveis com aprovação. **Telefonia** pelo navegador (treino, operadora SIP/WebRTC ou celular) e **WhatsApp oficial** da Meta.
**Meu dia** (tela inicial de cada pessoa), **lembretes** e **avisos**; **Comercial** com funil de aquisição e teste antes do
fechamento. A Platform Brobot continua dona das consultas e o OMIE, do financeiro: nesta fase os dados vão e voltam por
**CSV** (Integrações), com prévia antes de gravar.

**Fase 1 · demonstração.** Os dados são fictícios e o simulador reproduz os cenários de aceite da especificação.

## Rodar no computador

```bash
npm install
npm start          # http://localhost:3000 — cria o banco embutido em ./data/pg e a demonstração
npm test           # 50 testes: aceite AT-001 a AT-016, regras, processos, comercial, agenda, CSV, canais, dashboards e mensagens
```

Com PostgreSQL próprio: `DATABASE_URL=postgres://... npm start`. Testes contra um PostgreSQL de teste (o schema é
apagado): `TESTE_DATABASE_URL=postgres://... npm test`.

## Publicar no Railway

1. **New Service → GitHub Repo → `rodrigaomenezes/geral`**, branch publicada.
2. **Settings → Root Directory:** `brobot/sinapse` (o `railway.json` e o `Dockerfile` desta pasta são usados;
   `watchPatterns` faz só mudanças desta pasta publicarem).
3. **Banco** (escolha um):
   - **Volume** com mount path `/data` (PostgreSQL embutido, como o Estadia) — mais simples para a demonstração; ou
   - serviço **PostgreSQL** do Railway e a variável `DATABASE_URL=${{Postgres.DATABASE_URL}}` — recomendado para
     uso real (backup e restauração do provedor).
4. **Settings → Networking → Generate Domain.** Healthcheck: `/api/health`.

### Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | uma das duas | PostgreSQL gerenciado |
| `SINAPSE_DATA` | uma das duas | Pasta do banco embutido (o Dockerfile já define `/data/pg`) |
| `SINAPSE_DEMO` | **sim, para apresentar** | `1` liga a demonstração (login por persona **sem senha**, simulador, dados fictícios, faixa amarela no topo). No Railway (`NODE_ENV=production`), **sem esta variável a demonstração fica desligada** |
| `SINAPSE_AMBIENTE` | para dados reais | `producao` trava o ambiente: recusa `SINAPSE_DEMO=1`, exige `DATABASE_URL` e TLS verificado |
| `SINAPSE_DB_CA` | se o banco usar certificado próprio | Certificado da autoridade (PEM) do PostgreSQL; com `sslmode` na URL o certificado é sempre verificado |
| `SINAPSE_DB_TLS_INSEGURO` | não | `1` aceita certificado sem verificação (só fora de produção; fica registrado no log) |
| `SINAPSE_TOKEN_ENTRADA` | não | Token (24+ caracteres) do webhook `POST /api/entrada/{organização}/{canal}`; sem ele, a rota fica desligada |
| `SINAPSE_SENHA_TESTE` | para testar com e-mail e senha | Senha (12+) dos usuários de teste abaixo; trocar a variável troca a senha de todos no próximo deploy. Recusada com `SINAPSE_AMBIENTE=producao` |
| `SINAPSE_SENHA_ADMIN` | não | Senha (12+) do `admin@sinapse.demo`, usada só ao criar a demonstração |
| `SINAPSE_CHAVE` | para guardar segredos | Chave (32+ caracteres) que cifra a senha dos ramais SIP e o token do WhatsApp |
| `META_APP_SECRET` | para o WhatsApp oficial | App Secret do app da Meta: confere a assinatura do webhook |
| `WA_VERIFY_TOKEN` | para o WhatsApp oficial | Texto que você inventa e repete no painel da Meta ao cadastrar o webhook `https://SEU-LINK/api/whatsapp/webhook` |

### Usuários de teste (e-mail e senha)

Com `SINAPSE_SENHA_TESTE` definida, a organização Brobot ganha um usuário por perfil, todos com essa senha:

| E-mail | Perfil |
| --- | --- |
| `admin@brobot.com.br` | Administração |
| `gestor@brobot.com.br` | Supervisão (gestão) |
| `suporte1@brobot.com.br`, `suporte2@brobot.com.br` | Suporte |
| `cs@brobot.com.br` | Customer Success |
| `operacional@brobot.com.br` | Operações |
| `comercial@brobot.com.br` | Comercial |
| `financeiro@brobot.com.br` | Financeiro |
| `dev@brobot.com.br` | Desenvolvimento |

Entram por **Entrar com e-mail e senha** na tela inicial. Eles também voltam quando a demonstração é reiniciada.

Segurança no login: 5 senhas erradas por e-mail (ou 30 por endereço) em 15 min bloqueiam novas tentativas até a janela vencer.

Monitor externo (ex.: UptimeRobot) em `/api/health/supervisor`: responde 503 se o supervisor parar.

## Como apresentar

Roteiro de 15 minutos em [`docs/ROTEIRO_APRESENTACAO.md`](docs/ROTEIRO_APRESENTACAO.md). Mapa dos requisitos:
[`docs/RASTREABILIDADE.md`](docs/RASTREABILIDADE.md). Como está montado: [`ARCHITECTURE.md`](ARCHITECTURE.md).
