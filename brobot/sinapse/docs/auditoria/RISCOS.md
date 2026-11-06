# Riscos — auditoria de 05/11/2026

Escala: severidade × probabilidade (Alta/Média/Baixa). Linhas conferidas no commit `528bcf2`.

| # | Risco | Onde | Sev. | Prob. | Impacto | Correção sugerida |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | **Modo demonstração ligado por padrão.** Sem `SINAPSE_DEMO=0`, qualquer pessoa entra como qualquer persona (inclusive Administração) **sem senha** pela rota `/api/sessao/demo`, e o simulador e o "reiniciar" ficam disponíveis | `server/config.js:15`; `identidade/rotas.js:37` | **Crítica** | Alta (padrão do deploy atual) | Acesso total sem autenticação assim que houver dado real | Em `NODE_ENV=production`, exigir `SINAPSE_DEMO` explícito (`0` ou `1`) e recusar subir com `1` quando `SINAPSE_AMBIENTE=producao`. Faixa "DEMONSTRAÇÃO" fixa na tela |
| R-02 | Dados fictícios semeados no banco quando o modo demo está ligado | `server/app.js:86` | Alta | Média | Dado fictício misturado com dado real; números de dashboard contaminados | Organização "demo" separada e marcada; produção recusa semear |
| R-03 | **TLS do PostgreSQL sem verificação de certificado** (`rejectUnauthorized:false` quando a URL tem `sslmode=require`) | `server/db/index.js:13` | Alta | Média | Interceptação (MITM) da conexão com o banco | `SINAPSE_DB_CA` (CA do provedor) com verificação ligada; desligar a verificação só com variável explícita, registrando aviso no log |
| R-04 | Login sem limite de tentativas nem bloqueio temporário | `identidade/rotas.js:30` | Alta | Média | Força bruta de senha | Limite por IP+e-mail (tabela, sem `setInterval`), atraso progressivo, auditoria |
| R-05 | Sem MFA para Administração e Supervisão (RNF-005) | identidade | Alta | Média | Conta privilegiada comprometida com uma senha | TOTP para perfis administrativos |
| R-06 | PGlite em produção: processo único, sem réplica, sem PITR; backup do Volume não configurado | `db/index.js:37`; Dockerfile `SINAPSE_DATA=/data/pg` | Alta | Média | Perda de dados se o Volume corromper; sem RPO/RTO | Produção com PostgreSQL gerenciado (`DATABASE_URL`) e backup diário + teste de restauração; PGlite só para demonstração |
| R-07 | Web, worker, supervisor e WhatsApp QR no mesmo processo | `server/app.js` | Média | Média | Travamento do processo para tudo; o supervisor não vigia a si mesmo | Papéis por variável (`SINAPSE_PAPEL=web|worker`) na mesma imagem; monitor externo do `/api/health/supervisor` (UptimeRobot/Railway) |
| R-08 | Monitor externo do supervisor não está configurado (AT-013 só testa o 503) | `/api/health/supervisor` | Média | Alta | Watchdog parado sem ninguém saber | Configurar o monitor externo e documentar quem recebe o alerta |
| R-09 | Webhook da Meta sem proteção de replay por tempo (só HMAC + dedup por id) | `whatsapp-rotas.js` | Baixa | Baixa | Status antigo reenviado; a dedup e a ordem de status mitigam | Rejeitar evento com timestamp muito antigo; registrar |
| R-10 | Sem HSTS | `http/servidor.js:20-27` | Baixa | Baixa | Downgrade em rede hostil (Railway já força HTTPS) | Cabeçalho `Strict-Transport-Security` em produção |
| R-11 | LGPD: sem retenção, anonimização, exportação ao titular nem registro de base legal | — | Alta | Alta (obrigação legal) | Não conformidade | Fatia própria (SUP-008/RNF-006) |
| R-12 | Anexos não existem (INT-009); quando entrarem, precisam de validação de tipo/tamanho/malware | — | Média | — | — | Upload próprio, tipos permitidos, limite, verificação |
| R-13 | WhatsApp por QR (Baileys) não é a API oficial: risco de bloqueio do número pela Meta | `integracoes/whatsapp-qr.js` | Média | Média | Número da empresa banido | Usar só com aceite registrado da Brobot; tela com aviso; API oficial recomendada |
| R-14 | Testes dependiam do relógio real (quebraram em 05/11 às 13h UTC) | `test/aceite.test.js` | Média | Ocorreu | CI vermelho sem defeito de produto | **Corrigido** no commit `c8d606b` (datas fixas no relógio simulado) |
| R-15 | Os layouts CSV de Platform e OMIE são **propostos pelo Sinapse**, não homologados com amostras reais | `integracoes/csv/*` | Alta | Alta | Importação falha ou interpreta errado no primeiro arquivo real | Pedir amostras sanitizadas; contratos versionados; estado AGUARDANDO_CONFIRMACAO nas exportações |
| R-16 | Exportação CSV não tem estado de confirmação (baixar ≠ aplicado no destino) | `integracoes/csv` | Alta | Alta | Ação dada como feita sem prova | Lotes com manifesto, hash e retorno obrigatório (adendo CSV §4–5) |
| R-17 | Sem lint nem análise estática no CI | `.github/workflows/sinapse.yml` | Baixa | — | Erros simples passam | `node --check` + ESLint sem dependência pesada |
| R-18 | Nomes reais de colaboradores em comentário de migração publicada (repositório público) | `005_modelos_mensagem.sql:2` | Baixa | Ocorreu | Exposição de nome interno | Não repetir; migração publicada não se edita (checksum): registrar e manter fora de novos arquivos |
| R-19 | Sessão de 12 h sem rotação nem encerramento por inatividade | `identidade/servico.js:61` | Baixa | Baixa | Sessão roubada vale mais tempo | Expiração por inatividade; rotação no login |
| R-20 | Motor de processos: passos com efeito externo (enviar, ligar) dependem da idempotência do job; evento atrasado é avaliado na foto do evento (correto), mas não há teste de execução dupla do mesmo passo após falha no meio | `processos/motor.js` | Média | Baixa | Mensagem duplicada ao cliente | Teste de caracterização "falha depois de enviar, antes de gravar" + chave por passo |

Verificados sem problema: senha com scrypt e sal; token de sessão guardado só como hash; cookie HttpOnly/SameSite/Secure;
origem verificada nos POST (CSRF); CSP sem inline; RLS com papel sem privilégio (`sinapse_app`) e teste A×B (AT-014);
`db.sistema` usado só em login, fila, supervisor e migração (4 arquivos); segredos AES-256-GCM; auditoria só anexação
no banco; `npm audit` sem vulnerabilidades.

## Situação depois das fatias aprovadas em 05/11
- **Mitigados (com teste):** R-01, R-02 (sem demonstração, nada é semeado), R-03, R-04, R-10, R-14, R-17 — commit F0 (T-019).
- **Aceito pelo cliente:** R-13 (WhatsApp por QR, com aviso na tela; T-020).
- **Encontrado e corrigido durante a F1:** processo padrão com definição inválida era pulado em silêncio na criação da
  organização (`processos/padroes.js`); agora só a falta de equipe é tolerada e há teste de guarda.
- **Em aberto:** R-05 (MFA), R-06/R-07/R-08 (banco de produção, papéis, monitor externo), R-09, R-11, R-12, R-15, R-16,
  R-18, R-19, R-20 — ver o plano.
- **Mitigados em 06/11 (F8a, com teste):** R-05 (MFA TOTP, obrigatório para a gestão), R-19 (sessão por
  inatividade), R-11 parcial (exportação e anonimização do titular; retenção automática segue em aberto).
- **Mitigado em parte em 06/11 (F16, com teste):** R-12 — anexos com lista fechada de tipos conferidos pelo conteúdo,
  10 MB, download sempre como anexo com CSP `sandbox`; falta antivírus no servidor.
