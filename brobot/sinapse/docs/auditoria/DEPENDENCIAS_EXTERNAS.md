# Dependências externas — classificação (05/11/2026)

Classes: **DEMO** (simulador), **CSV** (arquivo nos dois sentidos, layout proposto), **PARCIAL**, **REAL HOMOLOGADA**.
Nenhuma integração está REAL HOMOLOGADA hoje.

| Sistema | Sentido | Classe | Onde | O que falta |
| --- | --- | --- | --- | --- |
| Platform Brobot: rodadas, resultado por veículo | entra | CSV (layout proposto) + DEMO | `integracoes/csv`, `platform-demo.js` | Amostra real sanitizada, dono do arquivo, periodicidade, identificador estável da rodada/veículo |
| Platform: credenciais (só status/metadados) | entra | CSV (proposto) | `integracoes/csv` | Amostra; confirmar que não há segredo no arquivo |
| Platform: uso / último login | entra | CSV (proposto) | `uso_contas` | Amostra; base legal da telemetria |
| Platform: provisionamento (onboarding) | sai | CSV (proposto) | exportação | **Capacidade de importação na Platform não comprovada**; arquivo de retorno |
| Platform: volumetria de placas recorrentes, consultas não geradas | entra | AUSENTE | — | Layout e dado na Platform |
| OMIE: situação financeira mínima | entra | CSV (proposto) + DEMO | `omie-sync.js`, `omie-demo.js` | Amostra real; quem extrai; frequência |
| OMIE: eventos operacionais ao Financeiro | sai | PARCIAL (outbox gravado, exportação) | `eventos`, exportação | Layout aceito pelo OMIE; retorno de confirmação |
| Pipedrive (migração) | entra | AUSENTE | — | Exportação real (negócios, pessoas, organizações, atividades, notas, campos) |
| WhatsApp Cloud API (Meta) | dois sentidos | PARCIAL (código conforme a documentação oficial; sem conta real testada) | `whatsapp-cloud.js`, `whatsapp-rotas.js` | Número, token (`SINAPSE_CHAVE` para cifrar), `META_APP_SECRET`, `WA_VERIFY_TOKEN`, templates aprovados |
| WhatsApp por QR (Baileys 7.0.0-rc14) | dois sentidos | PARCIAL (testado com simulador; não oficial) | `whatsapp-qr.js` | Aceite do risco pela Brobot; Volume para a sessão |
| E-mail | dois sentidos | DEMO | `mensageria-demo.js` | Provedor (SMTP/API), domínio, SPF/DKIM |
| Telefonia SIP/WebRTC | sai | PARCIAL (JsSIP; testado em modo treino) | `telefonia/*`, `public/vendor/jssip.min.js` | Operadora com WSS, ramais |
| Railway (hospedagem) | — | Configurado pelo cliente | `Dockerfile`, `railway.json` | Serviço, Volume `/data` ou PostgreSQL gerenciado, domínio, monitor externo |
| Redmine | — | Sem integração (por desenho) | — | Inventário para migração do histórico |
