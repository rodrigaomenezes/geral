# 📦 Estadia BR — Atividades para o Time de Desenvolvimento

**Produto:** Estadia BR — Plataforma de Gestão e Comprovação de Eventos Logísticos
**Base:** Documento de Atividades DEV 2.0 (05/10/2026) + decisões tomadas na construção e nos testes do MVP de demonstração
**Objetivo deste material:** descrever o **sistema ideal** em atividades prontas para o backlog, indicando o que entra no **MVP** e o que deve ficar com a **estrutura pronta** para ser ligado depois, sem refazer o produto.

---

## 🧭 Como ler este documento

Cada atividade segue o modelo padrão (Objetivo → User Story → RF → RN → RNF → QA → Protótipo).
Dentro dos **RF**, cada item tem uma etiqueta de fase:

| Etiqueta | Significado |
|---|---|
| **[MVP]** | Precisa funcionar no lançamento. |
| **[ESTRUTURA]** | Não aparece para o usuário no MVP, mas o modelo de dados, as permissões e as regras já devem nascer prontos para receber a função. |
| **[COMPLETO]** | Função do sistema completo. Entra depois do MVP, sem mudar o que já existe. |

### 🔑 Princípios que valem para todas as atividades

1. **Tudo é evento.** Cada etapa da operação é um registro próprio, com quem, quando, onde, como, de qual aparelho e com qual evidência. Nada é sobrescrito.
2. **Registro ≠ confirmação.** Quem registra e quem confirma geram eventos diferentes, cada um com o seu horário.
3. **Carga e descarga são operações independentes.** Podem ser relacionadas depois só para análise.
4. **O motorista opera sozinho no MVP.** O app conduz um passo por vez. As outras partes (portaria, destino, embarcador, transportadora) confirmam **por WhatsApp, sem instalar nada**.
5. **Regras de cálculo são versionadas.** Mudar um parâmetro cria uma versão nova e não altera operações já apuradas.
6. **Marca neutra (white-label).** O usuário final só vê **Estadia BR**.
7. **Honestidade de status.** O sistema nunca mostra "enviado" ou "confirmado" sem ter certeza.

### 📋 Índice de atividades

| # | Atividade | Fase principal |
|---|---|---|
| 01 | Organizações, usuários, perfis e permissões | MVP |
| 02 | Acesso simplificado do motorista (celular + PIN) | MVP |
| 03 | Criação e identificação da operação | MVP |
| 04 | Amélia — assistente por texto e áudio | MVP |
| 05 | Tela do motorista guiada por "próximo passo" | MVP |
| 06 | Registro da chegada | MVP |
| 07 | Contatos do local e número informado na hora | MVP |
| 08 | Mensagens pelo WhatsApp do próprio motorista | MVP |
| 09 | Envio automático pela API oficial do WhatsApp | COMPLETO (estrutura no MVP) |
| 10 | Link seguro e página de confirmação | MVP |
| 11 | Limite de Deslocamento do Local (300 m) | MVP |
| 12 | Início e término da carga/descarga e suas confirmações | MVP |
| 13 | Liberação para viagem e sua confirmação | MVP |
| 14 | Saída do local | MVP |
| 15 | Linha do tempo e status da operação | MVP |
| 16 | Motor de apuração e versionamento de regras | MVP |
| 17 | Conciliação financeira | MVP (P1) |
| 18 | Dossiê Digital e exportação | MVP |
| 19 | Encaminhamento jurídico | MVP (P1) |
| 20 | Funcionamento offline e sincronização | MVP |
| 21 | Auditoria, imutabilidade e retificação | MVP |
| 22 | Portal Web do destino e da transportadora | MVP |
| 23 | Alertas e pendências | MVP |
| 24 | Relatórios e indicadores | MVP (P1) / COMPLETO |
| 25 | Administração, parâmetros e integrações | MVP |
| 26 | Ambiente de demonstração e treinamento | MVP |
| 27 | Segurança, LGPD e qualidade transversal | MVP |
| 28 | Relação entre carga e descarga e integrações externas | COMPLETO (estrutura no MVP) |

---

---

# 🆕 Nova Atividade – 01 · Organizações, usuários, perfis e permissões

## 🎯 Objetivo
Criar a base multiempresa do Estadia BR: cada pessoa pertence a uma organização e vê somente as operações das quais a sua organização participa. É a fundação de segurança e de isolamento de dados de todo o produto.

---

## 👤 User Story
**Como** administrador da plataforma
**Quero** cadastrar organizações, usuários e seus perfis de acesso
**Para** garantir que cada participante veja e faça apenas o que lhe cabe em cada operação

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve permitir cadastrar organizações dos tipos: TAC (autônomo), transportadora, embarcador, destinatário, jurídico e administração.
2. **[MVP]** O sistema deve permitir cadastrar usuários vinculados a uma organização, com nome, e-mail e/ou celular e perfil.
3. **[MVP]** O sistema deve oferecer os perfis: **Motorista (TAC)**, **Destino/Embarcador**, **Transportadora**, **Jurídico** e **Administrador**.
4. **[MVP]** O sistema deve controlar as permissões: visualizar, criar, editar, registrar, confirmar, tratar divergência, registrar pagamento, gerar dossiê, encaminhar, encerrar, exportar, relatórios e administrar.
5. **[MVP]** O sistema deve listar para cada usuário somente as operações em que a sua organização é parte.
6. **[MVP]** O sistema deve permitir desativar um usuário sem apagar o seu histórico.
7. **[ESTRUTURA]** O sistema deve permitir que uma organização tenha vários locais (unidades/portarias), cada um com endereço e ponto de referência no mapa.
8. **[COMPLETO]** O sistema deve permitir que o administrador crie perfis personalizados a partir das permissões existentes.
9. **[COMPLETO]** O sistema deve permitir convidar usuários por link, com o próprio usuário definindo a senha.

---

## 📜 Regras de Negócio (RN)
1. Um usuário **não pode** ver dados de organizações que não participam da operação.
2. Permissões por perfil no MVP:

| Perfil | Pode |
|---|---|
| Motorista (TAC) | visualizar, registrar marcos, confirmar, registrar valor recebido |
| Destino/Embarcador | visualizar, registrar marcos, confirmar, tratar divergência, gerar dossiê, exportar, relatórios |
| Transportadora | visualizar, criar e editar operações, registrar pagamento, gerar dossiê, encaminhar ao jurídico, encerrar, exportar, relatórios |
| Jurídico | visualizar operações encaminhadas, registrar tratamento e resultado, exportar |
| Administrador | tudo, inclusive administrar |

3. O jurídico só vê operações que **foram encaminhadas** a ele.
4. Usuários e organizações não são excluídos fisicamente. São desativados, e o histórico permanece.
5. As telas para o usuário final **não podem** exibir as marcas Brobot, Menezes Gestão ou nomes internos de projeto (white-label).

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. O isolamento entre organizações deve ser garantido no servidor, nunca apenas escondendo itens na tela.
2. Senhas e PINs devem ser armazenados apenas como hash com algoritmo resistente (ex.: scrypt/bcrypt/argon2).
3. A sessão do portal Web deve expirar em **até 12 horas** sem uso.
4. A marca exibida deve vir de configuração, permitindo white-label futuro sem alterar o produto.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** que existem duas transportadoras com operações diferentes, **quando** um usuário da transportadora A listar operações, **então** não deve ver nenhuma operação da transportadora B.
- **Dado** um usuário Jurídico, **quando** acessar o sistema, **então** deve ver apenas operações encaminhadas ao jurídico.
- **Dado** um usuário Motorista, **quando** tentar acessar a área de administração, **então** o acesso deve ser negado.
- **Dado** que um usuário foi desativado, **quando** abrir uma operação antiga, **então** o nome dele deve continuar aparecendo nos eventos que registrou.
- **Dado** qualquer tela, PDF ou mensagem enviada ao usuário final, **quando** for exibida, **então** não deve aparecer Brobot nem Menezes Gestão.

---

## 🎨 Protótipo Visual
[Link do Figma — Administração › Usuários e Organizações]

> Lista de usuários com filtro por organização e perfil; formulário de cadastro; selo do perfil ao lado do nome; estado "desativado" em cinza.

---

---

# 🆕 Nova Atividade – 02 · Acesso simplificado do motorista (celular + PIN)

## 🎯 Objetivo
Permitir que o caminhoneiro, com pouca familiaridade com tecnologia, entre no app só com **número de celular e um PIN de 4 dígitos**, e continue conectado no próprio aparelho, sem precisar lembrar e-mail ou senha.

---

## 👤 User Story
**Como** motorista (TAC)
**Quero** entrar no app com meu celular e um PIN curto
**Para** começar a registrar a operação sem dificuldade e sem perder tempo na portaria

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve oferecer duas formas de entrada: **"Sou motorista"** (celular + PIN) e **"Empresa"** (e-mail + senha).
2. **[MVP]** O sistema deve aceitar o celular em qualquer formato (com ou sem DDD 55, parênteses, traços ou espaços).
3. **[MVP]** O sistema deve manter o motorista conectado no aparelho após o primeiro acesso.
4. **[MVP]** O sistema deve exibir uma mensagem simples quando o PIN estiver errado.
5. **[MVP]** O sistema deve permitir que o administrador ou a transportadora redefina o PIN do motorista.
6. **[COMPLETO]** O sistema deve permitir que o motorista crie ou recupere o PIN por código enviado por SMS/WhatsApp.
7. **[COMPLETO]** O sistema deve permitir desbloqueio por biometria do aparelho.

---

## 📜 Regras de Negócio (RN)
1. O PIN tem exatamente **4 dígitos**.
2. Após **5 tentativas erradas**, o acesso daquele celular fica bloqueado por **10 minutos**.
3. A sessão do motorista dura **30 dias** no próprio aparelho.
4. Cada celular corresponde a **um único** motorista ativo.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A tela de entrada deve ter **no máximo 2 campos** e um botão principal.
2. O teclado numérico deve abrir automaticamente nos campos de celular e PIN.
3. O login deve responder em **até 2 segundos** em rede 4G.
4. As mensagens devem usar linguagem do dia a dia, sem termos técnicos.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** um motorista cadastrado, **quando** digitar celular e PIN corretos, **então** deve entrar direto na tela de viagens.
- **Dado** que o motorista errou o PIN 5 vezes, **quando** tentar a 6ª vez, **então** deve ver "Muitas tentativas. Espere 10 minutos e tente de novo."
- **Dado** que o motorista entrou hoje, **quando** abrir o app 10 dias depois, **então** não deve precisar entrar de novo.
- **Dado** o celular digitado como "(11) 98888-0001" ou "11988880001", **quando** entrar, **então** ambos devem ser aceitos.

---

## 🎨 Protótipo Visual
[Link do Figma — Login com abas "Sou motorista" / "Empresa"]

> Botões grandes, fonte grande, teclado numérico, ícone de caminhão na aba do motorista.

---

---

# 🆕 Nova Atividade – 03 · Criação e identificação da operação

## 🎯 Objetivo
Garantir que cada operação de **carga** ou **descarga** tenha identidade única e os dados mínimos para rastrear todos os eventos que vierem depois.

---

## 👤 User Story
**Como** transportadora (ou motorista no campo)
**Quero** criar e identificar a operação com veículo, motorista, local e documentos
**Para** que todos os registros seguintes fiquem ligados à operação certa

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve permitir que a transportadora crie uma operação de **carga** ou de **descarga**.
2. **[MVP]** O sistema deve gerar automaticamente um identificador único legível (ex.: **OP-2026-0001**).
3. **[MVP]** O sistema deve registrar: tipo, motorista, veículo (placa), implemento, capacidade em toneladas, transportadora, embarcador/destinatário, local, data prevista, NF-e, CT-e, MDF-e, carga, peso, volume e observações.
4. **[MVP]** O sistema deve exibir ao motorista a lista de viagens atribuídas a ele.
5. **[MVP]** O sistema deve permitir que o motorista **identifique** a operação no campo, conferindo e completando os dados (inclusive pela Amélia).
6. **[MVP]** O sistema deve registrar a identificação como evento próprio ("Operação identificada pelo TAC").
7. **[ESTRUTURA]** O sistema deve aceitar operações criadas pelo próprio motorista, para o TAC que trabalha sem transportadora cadastrada.
8. **[COMPLETO]** O sistema deve importar operações a partir de NF-e/CT-e/MDF-e (XML ou chave de acesso).

---

## 📜 Regras de Negócio (RN)
1. Cada operação possui **um único** identificador, que nunca é reaproveitado.
2. Uma operação **não compartilha** eventos críticos com outra operação.
3. Carga e descarga são operações **estanques**: uma não depende da outra para avançar.
4. A **capacidade do veículo** é obrigatória para a apuração. Sem ela, a apuração fica pendente.
5. A chegada só pode ser registrada **depois** que a operação foi identificada.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A criação da operação deve ser concluída em **até 2 segundos**.
2. Os campos de documento fiscal devem validar formato (ex.: chave com 44 dígitos) sem bloquear quem ainda não tem o documento.
3. O formulário deve funcionar em celular, tablet e desktop.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** que a transportadora preencheu os dados mínimos, **quando** salvar, **então** o sistema deve gerar um ID único no formato OP-AAAA-NNNN.
- **Dado** duas operações criadas em sequência, **quando** comparadas, **então** os IDs devem ser diferentes.
- **Dado** uma operação de carga e uma de descarga do mesmo veículo, **quando** a de carga for encerrada, **então** a de descarga deve continuar no seu próprio estado.
- **Dado** uma operação sem capacidade informada, **quando** for apurada, **então** o sistema deve indicar "capacidade não informada" e não calcular valor.
- **Dado** uma operação não identificada, **quando** o motorista tentar registrar a chegada, **então** o sistema deve pedir primeiro a identificação.

---

## 🎨 Protótipo Visual
[Link do Figma — Nova operação (portal) / Minhas viagens (app)]

> Cartão de viagem com placa em destaque, local e tipo (carga/descarga) com cores diferentes.

---

---

# 🆕 Nova Atividade – 04 · Amélia — assistente por texto e áudio

## 🎯 Objetivo
Reduzir digitação e erros: o motorista fala ou escreve do jeito dele ("placa RTB4F27, 30 toneladas de soja, nota 123...") e a Amélia transforma isso em dados estruturados para ele conferir com **um único toque**.

---

## 👤 User Story
**Como** motorista (TAC)
**Quero** informar os dados da operação por áudio ou texto
**Para** não precisar preencher formulário e evitar erros

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve permitir que o motorista escreva os dados em texto livre.
2. **[MVP]** O sistema deve permitir que o motorista grave um áudio.
3. **[MVP]** O sistema deve identificar: placa, implemento, tipo de carga, peso, volume, capacidade, NF-e, CT-e, MDF-e, local e tipo de operação.
4. **[MVP]** O sistema deve mostrar, ao lado de cada dado extraído, o **trecho da fala/texto** de onde ele veio.
5. **[MVP]** O sistema deve apresentar os dados para **uma confirmação única** antes de gravar.
6. **[MVP]** O sistema deve permitir corrigir um dado antes de confirmar.
7. **[MVP]** O sistema deve pedir que o motorista repita quando não entender a mensagem.
8. **[ESTRUTURA]** O sistema deve guardar o áudio original e a transcrição vinculados ao evento de identificação.
9. **[COMPLETO]** O sistema deve transcrever o áudio no servidor por API de transcrição, de forma assíncrona, com fila, nova tentativa e reprocessamento.
10. **[COMPLETO]** O sistema deve usar IA generativa para extração, mantendo as regras de não inventar dados.

---

## 📜 Regras de Negócio (RN)
1. A Amélia **não pode** criar informação que não esteja na fala/texto do motorista ou no cadastro.
2. Dados de alta relevância (placa, capacidade, documentos fiscais, tipo de operação) **só valem depois** da confirmação do motorista.
3. Se um dado extraído divergir do cadastro, o sistema deve mostrar os dois e deixar o motorista escolher.
4. O áudio original segue a política de retenção definida para evidências.
5. Áudio não compreendido **não** gera dado. O sistema pede nova informação.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A interpretação de texto deve responder em **até 3 segundos**.
2. O áudio processado no servidor deve ter resultado em **até 60 segundos**, com aviso "estou ouvindo seu áudio" enquanto isso.
3. Custos e limites da API de IA devem ser monitorados (RNF-06).
4. Se a IA externa estiver fora do ar, o sistema deve cair para a extração por regras, sem travar o motorista.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** o texto "placa RTB4F27 com 30 toneladas de soja, NF 12345", **quando** a Amélia interpretar, **então** deve mostrar placa RTB4F27, capacidade/peso 30 t, carga soja e NF-e 12345, cada um com o seu trecho.
- **Dado** um texto sem placa, **quando** a Amélia interpretar, **então** a placa não deve ser preenchida com nenhum valor inventado.
- **Dado** os dados extraídos, **quando** o motorista tocar em "Está certo", **então** os dados devem ser gravados em um único evento com a origem "Amélia".
- **Dado** um áudio inaudível, **quando** processado, **então** o sistema deve pedir "Não entendi, pode repetir?".

---

## 🎨 Protótipo Visual
[Link do Figma — Amélia: microfone grande, campo de texto, cartão de conferência]

> Botão de microfone dominante, lista de dados com o trecho entre aspas, botões "Está certo" e "Corrigir".

---

---

# 🆕 Nova Atividade – 05 · Tela do motorista guiada por "próximo passo"

## 🎯 Objetivo
Fazer o motorista operar **sozinho**, sem treinamento: o app mostra **um único botão grande com o próximo passo** (CHEGUEI → COMECEI → TERMINEI → FUI LIBERADO → SAÍ) e explica em linguagem simples o que está acontecendo.

---

## 👤 User Story
**Como** motorista com pouca familiaridade com tecnologia
**Quero** ver sempre um só botão dizendo o que fazer agora
**Para** registrar tudo certo sem me perder em menus

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve exibir, para a viagem ativa, **apenas o próximo passo** como botão principal.
2. **[MVP]** O sistema deve exibir os passos na sequência: identificar → **CHEGUEI** → **COMECEI** → **TERMINEI** → **FUI LIBERADO** → **SAÍ**.
3. **[MVP]** O sistema deve mostrar uma faixa de progresso com os passos feitos, o atual e os que faltam.
4. **[MVP]** O sistema deve mostrar, após cada passo, quem já confirmou e quem ainda falta confirmar.
5. **[MVP]** O sistema deve mostrar o relógio da estadia (tempo desde a chegada confirmada e quanto falta para as 5 horas).
6. **[MVP]** O sistema deve abrir a câmera direto quando o passo exigir foto.
7. **[MVP]** O sistema deve mostrar o aviso "Registrado no celular, vai enviar quando tiver sinal" quando estiver sem internet.
8. **[MVP]** O sistema deve atualizar a tela sozinho quando alguém confirmar pelo link (sem o motorista recarregar).
9. **[COMPLETO]** O sistema deve ler em voz alta a instrução do passo atual (acessibilidade).

---

## 📜 Regras de Negócio (RN)
1. Um passo só aparece quando o anterior foi registrado (a chegada exige identificação, o início exige chegada, e assim por diante).
2. A **saída** pode ser registrada mesmo que liberação ou término não tenham sido confirmados, mas o sistema deve avisar o que ficou pendente.
3. Nenhum passo pode ser desfeito pelo motorista. Correções seguem a Atividade 21.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. Botões principais com área de toque mínima de **56 px** de altura.
2. Textos com no máximo **2 linhas** por instrução e sem jargão ("Chegou? Toque aqui").
3. Funcionar como app instalável (PWA) em Android e iOS, sem loja na fase MVP.
4. Contraste **WCAG 2.1 AA**, legível ao sol.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** uma viagem identificada, **quando** o motorista abrir o app, **então** deve ver só o botão "CHEGUEI".
- **Dado** que o motorista tocou em CHEGUEI e tirou a foto, **quando** o registro concluir, **então** o botão principal passa a ser "COMECEI".
- **Dado** que o destino confirmou a chegada pelo link, **quando** o motorista estiver com o app aberto, **então** a tela deve mostrar "Portaria confirmou" sem recarregar.
- **Dado** que faltam confirmações, **quando** o motorista registrar a saída, **então** o sistema deve listar o que ficou sem confirmação.

---

## 🎨 Protótipo Visual
[Link do Figma — App do motorista: viagem ativa]

> Botão verde de largura total, ícone do passo, faixa de progresso, relógio da estadia, lista "quem confirmou".

---

---

# 🆕 Nova Atividade – 06 · Registro da chegada

## 🎯 Objetivo
Produzir o primeiro marco comprovável da operação: **foto + localização + data/hora + motorista**, registrados no momento em que o caminhão chega.

---

## 👤 User Story
**Como** motorista (TAC)
**Quero** registrar minha chegada com foto e localização
**Para** ter prova do horário em que cheguei ao local

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve permitir registrar a chegada com o botão **CHEGUEI**.
2. **[MVP]** O sistema deve exigir uma fotografia no momento da chegada.
3. **[MVP]** O sistema deve capturar a localização GPS disponível.
4. **[MVP]** O sistema deve gravar data/hora do aparelho, data/hora do servidor, usuário, aparelho, IP e origem.
5. **[MVP]** O sistema deve associar foto, localização, data, hora, usuário e operação ao evento de chegada.
6. **[MVP]** O sistema deve registrar a ocorrência **GPS_INDISPONIVEL** quando não houver localização e seguir com o fluxo.
7. **[MVP]** O sistema deve, logo após a chegada, levar o motorista para **avisar a portaria/destino** (Atividade 08).

---

## 📜 Regras de Negócio (RN)
1. Registrar a chegada **não significa** que o destino confirmou a chegada.
2. A foto de chegada é **obrigatória**. Sem foto, o passo não avança.
3. O GPS é desejado, mas **não bloqueia** a chegada. A falta vira ocorrência técnica.
4. O horário do aparelho não pode estar mais de **5 minutos no futuro** em relação ao servidor. Nesse caso, o sistema avisa para conferir o relógio.
5. A posição da chegada passa a ser o **ponto de referência** da operação quando o local não tiver ponto cadastrado.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A foto deve ser comprimida no aparelho (alvo: até **1 MB**) antes do envio.
2. Arquivos de evidência aceitos até **6 MB**.
3. A captura de GPS deve desistir em **até 15 segundos** sem travar a tela.
4. O registro deve funcionar sem internet (Atividade 20).

---

## 🧪 Critérios de Aceite (QA)
- **Dado** uma operação identificada, **quando** o motorista tocar em CHEGUEI e tirar a foto, **então** o evento deve ser gravado com foto, GPS, horário do aparelho e do servidor.
- **Dado** que o GPS está desligado, **quando** registrar a chegada, **então** o evento deve ser gravado com a ocorrência GPS_INDISPONIVEL.
- **Dado** que o motorista cancelou a câmera, **quando** tentar concluir, **então** o sistema deve pedir a foto novamente.
- **Dado** a chegada registrada, **quando** o destino ainda não confirmou, **então** o status deve ser "Aguardando confirmação da chegada".

---

## 🎨 Protótipo Visual
[Link do Figma — Passo CHEGUEI: câmera, prévia da foto, indicador de GPS]

---

---

# 🆕 Nova Atividade – 07 · Contatos do local e número informado na hora

## 🎯 Objetivo
Garantir que o aviso chegue à **pessoa certa naquele momento** (o porteiro do turno, o conferente, o encarregado), mesmo que ela não esteja cadastrada.

---

## 👤 User Story
**Como** motorista
**Quero** informar na hora o WhatsApp de quem está me atendendo na portaria
**Para** que a confirmação vá para quem realmente está no local

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve sugerir o contato cadastrado do local/destino para cada aviso.
2. **[MVP]** O sistema deve permitir, no mesmo passo, **"Mandar para outro número"**, digitando nome (opcional) e celular.
3. **[MVP]** O sistema deve **lembrar** o número informado na operação e sugeri-lo nos próximos avisos da mesma operação.
4. **[MVP]** O sistema deve registrar o contato informado como evento ("Contato informado"), com quem informou e quando.
5. **[MVP]** O sistema deve permitir trocar o destinatário de um aviso já preparado e ainda não confirmado.
6. **[ESTRUTURA]** O sistema deve guardar a lista de contatos por local/unidade, com o papel de cada um (portaria, expedição, recebimento).
7. **[COMPLETO]** O sistema deve sugerir o contato pelo turno/horário cadastrado no local.

---

## 📜 Regras de Negócio (RN)
1. O número informado na hora vale **apenas para aquela operação**. Não altera o cadastro do local.
2. Todo contato informado fica no histórico. Trocar o número não apaga o anterior.
3. O número precisa ter DDD. Sem DDI, assume-se Brasil (+55).

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. O campo de celular deve aceitar colar número copiado do WhatsApp.
2. A troca de número deve exigir **no máximo 2 toques** além da digitação.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** o aviso de chegada, **quando** o motorista escolher "Mandar para outro número" e digitar (11) 97777-1234, **então** o WhatsApp deve abrir **no mesmo toque** com esse número e a mensagem pronta.
- **Dado** que um número foi informado na chegada, **quando** o motorista for avisar o início, **então** esse número deve vir sugerido.
- **Dado** um número informado na hora, **quando** a transportadora abrir a operação, **então** deve ver quem informou o contato e quando.

---

## 🎨 Protótipo Visual
[Link do Figma — Folha "Agora avise a portaria" com contato sugerido e "outro número"]

---

---

# 🆕 Nova Atividade – 08 · Mensagens pelo WhatsApp do próprio motorista

## 🎯 Objetivo
No MVP, sem depender da API oficial, usar o **WhatsApp do celular do motorista** para enviar a mensagem pronta com o link de confirmação. A confirmação acontece quando a outra pessoa **abre o link e toca em CONFIRMAR**.

---

## 👤 User Story
**Como** motorista operando sozinho
**Quero** que o app abra meu WhatsApp com a mensagem pronta para a portaria
**Para** pedir a confirmação sem digitar nada e sem a empresa ter custo com API

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve gerar, após cada marco (chegada, início, término, liberação), uma mensagem pronta com: operação, placa, motorista, marco, horário e **link seguro de confirmação**.
2. **[MVP]** O sistema deve abrir o WhatsApp do motorista **no mesmo toque** do botão **ENVIAR NO WHATSAPP**, com destinatário e texto preenchidos.
3. **[MVP]** O sistema deve marcar o aviso como **"Aguardando envio"** até o motorista voltar ao app.
4. **[MVP]** O sistema deve perguntar ao motorista, ao voltar, se a mensagem foi enviada, e só então marcar "Enviada pelo motorista".
5. **[MVP]** O sistema deve marcar **"Link aberto"** quando o destinatário abrir o link, e **"Confirmado"** quando tocar em CONFIRMAR.
6. **[MVP]** O sistema deve permitir **reenviar** um aviso sem resposta.
7. **[MVP]** O sistema deve oferecer alternativa **"Mostrar na tela"** (QR code/código) para quando a pessoa está ao lado e não usa WhatsApp.
8. **[MVP]** O sistema deve informar, na saída, que "a transportadora acompanha pelo sistema" (sem mensagem extra).
9. **[ESTRUTURA]** O sistema deve gravar cada mensagem como registro auditável com o modo de envio (motorista, API ou simulado).
10. **[ESTRUTURA]** O sistema deve ter um parâmetro de ambiente que define o modo de envio (**manual**, **api** ou **simulado**), sendo **manual** o padrão quando não houver API configurada.

---

## 📜 Regras de Negócio (RN)
1. **A resposta da outra parte pelo link é o que vale como confirmação.** O envio não é confirmação.
2. O sistema **nunca** pode exibir "enviado" para uma mensagem que só foi preparada.
3. No modo manual, o sistema **não sabe** se a mensagem foi entregue ou lida. Ele só sabe se o link foi aberto ou confirmado, e deve dizer isso com clareza.
4. No MVP, as mensagens vão só para quem confirma no local (portaria/destino). A transportadora acompanha pelo portal.
5. O texto da mensagem usa a marca **Estadia BR** e linguagem simples: "👉 Para **CONFIRMAR**, toque no link".

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A abertura do WhatsApp deve acontecer de forma síncrona com o toque, para não ser bloqueada pelo celular.
2. Deve funcionar em Android e iOS com WhatsApp e WhatsApp Business.
3. A mensagem deve ter **no máximo 600 caracteres**.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** a chegada registrada, **quando** o motorista tocar em ENVIAR NO WHATSAPP, **então** o WhatsApp deve abrir com o número e o texto com link.
- **Dado** o WhatsApp aberto e a mensagem não enviada, **quando** o motorista voltar ao app, **então** o status deve continuar "Aguardando envio", nunca "Enviada".
- **Dado** a segunda, terceira e quarta mensagens da mesma viagem, **quando** o motorista tocar em enviar, **então** cada uma deve abrir o WhatsApp igual à primeira.
- **Dado** que o destinatário abriu o link, **quando** a transportadora olhar a operação, **então** deve ver "Link aberto às HH:MM".

---

## 🎨 Protótipo Visual
[Link do Figma — Folha de envio: contato, botão verde "ENVIAR NO WHATSAPP", "Mostrar na tela", status honesto]

---

---

# 🆕 Nova Atividade – 09 · Envio automático pela API oficial do WhatsApp

## 🎯 Objetivo
No sistema completo, o Estadia BR envia as mensagens **sozinho**, por número oficial, recebe status de entrega/leitura e entende respostas como "SIM", "OK" e "NÃO". Assim o motorista não precisa nem abrir o WhatsApp.

---

## 👤 User Story
**Como** transportadora
**Quero** que o sistema dispare automaticamente as confirmações por um número oficial
**Para** ter prova de envio, entrega e leitura sem depender do celular do motorista

---

## ✅ Requisitos Funcionais (RF)
1. **[COMPLETO]** O sistema deve disparar automaticamente a mensagem ao destino após cada marco, com o link seguro.
2. **[COMPLETO]** O sistema deve receber pelo webhook os status: enviada, entregue, lida e falha.
3. **[COMPLETO]** O sistema deve interpretar respostas de texto: **SIM/OK/CONFIRMO/👍** = confirmar; **NÃO/❌** = divergência; outras = encaminhar para análise.
4. **[COMPLETO]** O sistema deve usar templates aprovados pela Meta para iniciar conversas.
5. **[COMPLETO]** O sistema deve avisar também a transportadora nos marcos configurados.
6. **[COMPLETO]** O sistema deve tentar novamente envios com falha e registrar **WHATSAPP_FALHA**.
7. **[ESTRUTURA]** O sistema deve usar o mesmo registro de mensagens do modo manual, só mudando o modo de envio, para que relatórios e dossiê não mudem.
8. **[ESTRUTURA]** O sistema deve ter um simulador de WhatsApp para testes e demonstração, ativado só em ambiente de teste.

---

## 📜 Regras de Negócio (RN)
1. A confirmação por resposta de texto vale **somente** se vier do número para o qual a mensagem foi enviada.
2. Falha no WhatsApp **não pode** apagar ou travar o evento original. O motorista pode mandar pelo próprio celular.
3. Uma resposta "NÃO" registra **divergência**, não cancela o registro do motorista.
4. A troca de modo manual → API não altera operações já registradas.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. O webhook deve validar a assinatura da Meta antes de aceitar qualquer dado.
2. O envio deve ocorrer em **até 10 segundos** após o marco.
3. Custos por conversa devem ser monitorados por organização.
4. As credenciais da API ficam apenas em variáveis de ambiente, nunca em tela ou log.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** o modo API ativo, **quando** a chegada for registrada, **então** a mensagem deve sair sozinha e o status evoluir para "Entregue" e "Lida".
- **Dado** que o porteiro respondeu "ok", **quando** o webhook chegar, **então** a chegada deve ficar confirmada com origem "WhatsApp (resposta)".
- **Dado** um webhook sem assinatura válida, **quando** recebido, **então** deve ser rejeitado.
- **Dado** a API fora do ar, **quando** o envio falhar, **então** deve aparecer o alerta de falha e a opção "enviar pelo meu WhatsApp".

---

## 🎨 Protótipo Visual
[Link do Figma — Histórico de mensagens com ícones ✓ ✓✓ e "lida"]

---

---

# 🆕 Nova Atividade – 10 · Link seguro e página de confirmação

## 🎯 Objetivo
Permitir que portaria, destino ou embarcador **confirmem um marco sem instalar nada**: abrem o link do WhatsApp, reconhecem o caminhão e tocam em **CONFIRMAR** (ou **NÃO CONFERE**).

---

## 👤 User Story
**Como** responsável pelo destino
**Quero** confirmar a chegada (e os demais marcos) por um link
**Para** validar a presença e a operação do veículo de forma rápida

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve gerar um link único por marco e destinatário.
2. **[MVP]** A página deve mostrar só o necessário: operação, placa, motorista, marco, local, data/hora e foto do marco.
3. **[MVP]** A página deve oferecer **CONFIRMAR** e **NÃO CONFERE** (com campo de motivo).
4. **[MVP]** O sistema deve registrar na confirmação: data/hora do servidor, identificação do responsável (nome/telefone do link), operação, origem "link", IP e aparelho.
5. **[MVP]** O sistema deve registrar "link aberto" na primeira abertura.
6. **[MVP]** O sistema deve exibir aviso de link expirado com o botão **"Pedir novo link"**.
7. **[MVP]** O sistema deve permitir que a pessoa anexe uma foto pela página (ex.: comprovante de liberação), quando o marco permitir.
8. **[MVP]** A página deve mostrar "Já confirmado em DD/MM HH:MM" se o marco já tiver sido confirmado.
9. **[COMPLETO]** O sistema deve permitir confirmar com identificação por código enviado ao celular, para maior força de prova.

---

## 📜 Regras de Negócio (RN)
1. O link vale por **24 horas** (parâmetro configurável).
2. O link é **não previsível**, ligado a **uma** operação e a **uma** ação. Não dá acesso ao resto da operação.
3. Cada marco só pode ser confirmado **uma vez**. Cliques repetidos não geram nova confirmação.
4. A confirmação é um **evento independente** e **não altera** o horário do registro original.
5. **A confirmação da chegada inicia a contagem do Limite de Estadia (5 h).**
6. "NÃO CONFERE" gera **divergência** para análise. Não apaga o registro do motorista.
7. O link deve funcionar mesmo que o confirmador não tenha cadastro no sistema.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A página deve carregar em **até 2 segundos** em 4G e funcionar sem login.
2. O banco guarda apenas o **hash** do token do link, nunca o token em texto.
3. Página responsiva, com botões grandes e sem marca interna.
4. A página não deve ser indexada por buscadores.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** um link válido, **quando** o responsável tocar em CONFIRMAR, **então** a chegada fica confirmada com horário próprio, e o relógio das 5 horas começa.
- **Dado** um link com mais de 24 horas, **quando** aberto, **então** a página deve mostrar "Link expirado" e o botão "Pedir novo link".
- **Dado** um link de confirmação de chegada, **quando** alguém tentar ver documentos de outra etapa, **então** não deve haver acesso.
- **Dado** que o responsável tocou em NÃO CONFERE com o motivo "placa diferente", **quando** a transportadora abrir a operação, **então** deve ver a divergência com o motivo.
- **Dado** um marco já confirmado, **quando** o link for aberto de novo, **então** deve mostrar "Já confirmado" sem duplicar o evento.

---

## 🎨 Protótipo Visual
[Link do Figma — Página pública de confirmação]

> Foto do caminhão no topo, placa em fonte grande, botão verde CONFIRMAR, botão discreto NÃO CONFERE.

---

---

# 🆕 Nova Atividade – 11 · Limite de Deslocamento do Local (300 m)

## 🎯 Objetivo
Registrar, como evento para análise, quando o veículo se afasta mais de **300 metros** do local durante a operação, sem tirar conclusões jurídicas automáticas.

---

## 👤 User Story
**Como** sistema
**Quero** comparar a posição do veículo com o ponto de referência da operação
**Para** registrar deslocamentos relevantes no Dossiê

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve usar o parâmetro **Limite de Deslocamento do Local = 300 metros**.
2. **[MVP]** O sistema deve comparar cada posição recebida com o ponto de referência (local cadastrado ou posição da chegada).
3. **[MVP]** O sistema deve registrar a ocorrência **DESLOCAMENTO_FORA_DO_LIMITE** com distância, posição, horário e limite usado.
4. **[MVP]** O sistema deve exibir a ocorrência na linha do tempo, nos alertas e no Dossiê.
5. **[MVP]** O sistema deve verificar a posição em cada marco registrado com GPS.
6. **[COMPLETO]** O sistema deve verificar a posição periodicamente em segundo plano durante a operação (com permissão do motorista).
7. **[COMPLETO]** O sistema deve permitir raio diferente por local, versionado.

---

## 📜 Regras de Negócio (RN)
1. O limite padrão é **300 metros**.
2. A ocorrência **não determina** fraude, má-fé ou responsabilidade. É uma divergência para análise.
3. Para não poluir o histórico, uma nova ocorrência só é registrada após **30 minutos** da anterior, se o veículo continuar fora.
4. Sem GPS, não há ocorrência de deslocamento. Há ocorrência de GPS indisponível.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. O cálculo de distância deve considerar a curvatura da Terra (fórmula de haversine), com precisão de metros.
2. O monitoramento em segundo plano não pode consumir mais de **5% de bateria por hora**.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** um ponto de referência, **quando** o motorista registrar um marco a 450 m dele, **então** deve ser criada a ocorrência DESLOCAMENTO_FORA_DO_LIMITE com 450 m.
- **Dado** a posição a 120 m, **quando** verificada, **então** nenhuma ocorrência deve ser criada.
- **Dado** a ocorrência registrada, **quando** o Dossiê for gerado, **então** ela deve aparecer com a observação "evento para análise".

---

## 🎨 Protótipo Visual
[Link do Figma — Alerta de deslocamento e mapa no Dossiê]

---

---

# 🆕 Nova Atividade – 12 · Início e término da carga/descarga e suas confirmações

## 🎯 Objetivo
Registrar quando a carga/descarga **começou** e **terminou**, cada uma com a sua confirmação pelo destino, como eventos separados.

---

## 👤 User Story
**Como** motorista ou operador do local
**Quero** registrar o início e o término da operação e pedir a confirmação do destino
**Para** comprovar quanto tempo a atividade realmente levou

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve permitir registrar **INÍCIO** (botão COMECEI) com data, hora, usuário, origem, GPS quando houver e observação.
2. **[MVP]** O sistema deve permitir registrar **TÉRMINO** (botão TERMINEI) com foto/documento opcional, observação, data, hora e usuário.
3. **[MVP]** O sistema deve gerar, para cada um, o aviso e o link de confirmação ao destino (Atividades 08 e 10).
4. **[MVP]** O sistema deve permitir que o destino confirme pelo link ou pelo portal.
5. **[MVP]** O sistema deve permitir que o destino também registre início e término pelo portal.

---

## 📜 Regras de Negócio (RN)
1. Registro e confirmação são **eventos distintos**, com horários próprios.
2. O início só pode ser registrado após a chegada. O término, só após o início.
3. Quem registra **não pode** confirmar o próprio registro. A confirmação vem da outra parte.
4. A confirmação não sobrescreve o horário do registro.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. O registro deve funcionar offline.
2. O portal do destino deve refletir o registro do motorista em **até 5 segundos** (atualização ao vivo).

---

## 🧪 Critérios de Aceite (QA)
- **Dado** a chegada registrada, **quando** o motorista tocar em COMECEI, **então** o início deve ser gravado e o aviso preparado.
- **Dado** o início registrado pelo motorista, **quando** o mesmo motorista tentar confirmar, **então** o sistema não deve permitir.
- **Dado** o término registrado às 14:00 e confirmado às 14:20, **quando** a linha do tempo for exibida, **então** devem aparecer os dois horários.

---

## 🎨 Protótipo Visual
[Link do Figma — Passos COMECEI / TERMINEI e cartões de confirmação no portal]

---

---

# 🆕 Nova Atividade – 13 · Liberação para viagem e sua confirmação

## 🎯 Objetivo
Registrar formalmente que o veículo foi **liberado para seguir viagem**. É o **marco final** usado na apuração da estadia.

---

## 👤 User Story
**Como** responsável pelo destino (ou o motorista, no MVP)
**Quero** registrar e confirmar a liberação do veículo
**Para** formalizar o fim da estadia e permitir a apuração

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve permitir que o **destino** registre a liberação pelo portal.
2. **[MVP]** O sistema deve permitir que o **motorista** registre a liberação (botão **FUI LIBERADO**) quando estiver operando sozinho.
3. **[MVP]** O sistema deve permitir anexar ou fotografar o documento/comprovante de liberação.
4. **[MVP]** O sistema deve pedir a confirmação da outra parte (destino confirma o registro do motorista e vice-versa).
5. **[ESTRUTURA]** O sistema deve ter um parâmetro por organização: "liberação só pelo destino" ou "liberação pelo motorista com confirmação do destino".

---

## 📜 Regras de Negócio (RN)
1. **Liberação não é saída.** São eventos distintos.
2. A liberação só pode ser registrada após o término.
3. **Decisão do MVP:** o motorista pode registrar a liberação, mas ela **precisa da confirmação do destino**. Sem confirmação, o Dossiê mostra "liberação registrada pelo TAC, não confirmada".
4. O horário da **liberação registrada** é o marco final da apuração (regra ESTADIA-BR 2.0).

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. O anexo do comprovante deve aceitar foto e PDF até 6 MB.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** o término registrado, **quando** o motorista tocar em FUI LIBERADO, **então** a liberação é gravada e o aviso ao destino é preparado.
- **Dado** a liberação registrada pelo motorista e não confirmada, **quando** o Dossiê for gerado, **então** deve indicar "não confirmada pelo destino".
- **Dado** a liberação registrada, **quando** a saída ainda não ocorreu, **então** o status deve ser "Liberada", não "Saída registrada".

---

## 🎨 Protótipo Visual
[Link do Figma — Passo FUI LIBERADO com foto do comprovante]

---

---

# 🆕 Nova Atividade – 14 · Saída do local

## 🎯 Objetivo
Concluir o ciclo operacional com a **foto do documento/comprovante de saída**, sem exigir GPS.

---

## 👤 User Story
**Como** motorista
**Quero** registrar minha saída com a foto do comprovante
**Para** encerrar minha parte da operação com prova

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve permitir registrar a saída (botão **SAÍ**).
2. **[MVP]** O sistema deve exigir a foto do documento/comprovante de liberação ou saída.
3. **[MVP]** O sistema deve capturar GPS se disponível, sem exigir.
4. **[MVP]** O sistema deve disparar a **apuração** automaticamente após a saída.
5. **[MVP]** O sistema deve mostrar ao motorista o resumo: tempo de estadia e valor devido calculado.

---

## 📜 Regras de Negócio (RN)
1. GPS **não é obrigatório** na saída. A falta dele não impede o registro.
2. A foto fica **vinculada** ao evento de saída.
3. A saída exige a chegada registrada.
4. Depois da saída, o motorista não registra mais marcos. Ele ainda pode informar o valor recebido.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. O resumo final deve aparecer em **até 3 segundos** após o registro (ou assim que sincronizar, se offline).

---

## 🧪 Critérios de Aceite (QA)
- **Dado** o GPS desligado, **quando** registrar a saída com foto, **então** o registro deve ser aceito.
- **Dado** a saída sem foto, **quando** tentar concluir, **então** o sistema deve pedir a foto.
- **Dado** a saída registrada, **quando** concluída, **então** a apuração deve ser feita e o valor exibido ao motorista.

---

## 🎨 Protótipo Visual
[Link do Figma — Passo SAÍ e tela de resumo final]

---

---

# 🆕 Nova Atividade – 15 · Linha do tempo e status da operação

## 🎯 Objetivo
Mostrar a história completa da operação em ordem cronológica e um **status único e claro** que diga em que ponto ela está.

---

## 👤 User Story
**Como** usuário autorizado
**Quero** ver todos os eventos em ordem e o status atual
**Para** entender o histórico sem precisar perguntar a ninguém

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve exibir a linha do tempo com cada evento, seu horário, autor, origem e evidências.
2. **[MVP]** O sistema deve mostrar, na linha do tempo, os horários do aparelho e do servidor quando forem diferentes (eventos offline).
3. **[MVP]** O sistema deve exibir mensagens de WhatsApp, ocorrências, apuração, pagamentos, dossiês e encaminhamentos na mesma linha do tempo.
4. **[MVP]** O sistema deve calcular o status a partir dos eventos, na seguinte lista:

```text
CRIADA
AGUARDANDO_CHEGADA
CHEGADA_REGISTRADA
AGUARDANDO_CONFIRMACAO_CHEGADA
CHEGADA_CONFIRMADA
OPERACAO_INICIADA
INICIO_CONFIRMADO
OPERACAO_FINALIZADA
TERMINO_CONFIRMADO
LIBERADA
LIBERACAO_CONFIRMADA
SAIDA_REGISTRADA
EM_APURACAO
APURADA
AGUARDANDO_PAGAMENTO
PAGAMENTO_PARCIAL
PAGO
VALOR_DIVERGENTE
EM_TRATATIVA
ENCAMINHADA_JURIDICO
ENCERRADA
```

5. **[MVP]** O sistema deve permitir filtrar operações por status no portal.

---

## 📜 Regras de Negócio (RN)
1. O status é **consequência dos eventos**. Ninguém altera o status à mão, exceto por eventos (pagamento, tratativa, encaminhamento, encerramento).
2. Cada evento tem o seu próprio horário. A confirmação não sobrescreve o horário original.
3. **CHEGADA_REGISTRADA** dura até o aviso ser preparado. Depois a operação passa a **AGUARDANDO_CONFIRMACAO_CHEGADA**.
4. **EM_APURACAO** vale enquanto houver dado faltante para o cálculo (ex.: capacidade). **APURADA** vale quando o resultado é R$ 0,00.
5. **ENCERRADA** só ocorre por ação de quem tem permissão "encerrar". Gerar o Dossiê **não** encerra a operação.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A linha do tempo deve carregar em **até 2 segundos** para operações com até 500 eventos.
2. Atualização ao vivo nas telas abertas, sem recarregar.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** chegada às 09:14 confirmada às 09:21, **quando** a linha do tempo for exibida, **então** deve mostrar "Chegada registrada 09:14" e "Chegada confirmada 09:21".
- **Dado** a saída registrada e valor devido de R$ 450 sem pagamento, **quando** o status for calculado, **então** deve ser AGUARDANDO_PAGAMENTO.
- **Dado** o Dossiê gerado, **quando** nada mais acontecer, **então** o status não deve ser ENCERRADA.

---

## 🎨 Protótipo Visual
[Link do Figma — Linha do tempo vertical com ícones por tipo de evento e selo de status]

---

---

# 🆕 Nova Atividade – 16 · Motor de apuração e versionamento de regras

## 🎯 Objetivo
Calcular automaticamente o **valor devido de estadia** a partir dos eventos, com regra versionada e transparente (mostrando a conta feita).

---

## 👤 User Story
**Como** sistema
**Quero** apurar o tempo efetivo e o valor devido conforme a regra vigente
**Para** que transportadora e motorista saibam exatamente quanto é devido e por quê

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve calcular o **tempo efetivo** = horário da **liberação registrada** − horário da **confirmação da chegada**.
2. **[MVP]** O sistema deve aplicar a regra vigente na data da chegada.
3. **[MVP]** O sistema deve exibir a memória de cálculo (marcos, tempo, capacidade, valor, fórmula, versão e resultado).
4. **[MVP]** O sistema deve mostrar, durante a operação, o relógio da estadia e o horário em que as 5 horas se completam.
5. **[MVP]** O sistema deve recalcular a apuração quando um marco for retificado, registrando a nova apuração sem apagar a anterior.
6. **[ESTRUTURA]** O sistema deve guardar as regras como versões com: identificador, versão, data de vigência, limite, valor por t·h, marco inicial, marco final e tipo de fórmula.
7. **[COMPLETO]** O sistema deve permitir que o administrador cadastre uma nova versão de regra pela tela.

---

## 📜 Regras de Negócio (RN)
1. **Limite de Estadia: 5 horas.**
2. Tempo efetivo **≤ 5 h** → **Valor devido = R$ 0,00**.
3. Tempo efetivo **> 5 h** → **Valor devido = Tempo efetivo TOTAL × Capacidade do veículo (t) × R$ 2,50 por t·h**.
4. **É proibido** calcular apenas o excedente (tempo − 5 h) na regra vigente.
5. Exemplo de referência: 6 h × 30 t × R$ 2,50 = **R$ 450,00**.
6. Regra vigente: **ESTADIA-BR 2.0**, vigente desde **01/10/2026** (marco inicial = chegada confirmada, marco final = liberação). A versão anterior (ESTADIA-REF 0.1, calculada sobre o excedente) fica preservada para operações antigas.
7. Uma operação apurada **mantém** a versão da regra usada, mesmo que surja uma regra nova.
8. Sem chegada confirmada, a apuração fica **pendente**. O sistema informa o motivo e não calcula.
9. Os marcos, o tratamento de frações e a capacidade considerada dependem de **validação jurídica**. Por isso devem ser parâmetros, não código fixo.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. Valores monetários com arredondamento em **2 casas** (meio para cima) e tempo em minutos.
2. A troca de regra não pode exigir alteração estrutural do sistema.
3. A apuração deve ser determinística: os mesmos eventos geram sempre o mesmo resultado.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** a chegada confirmada às 08:00 e a liberação às 12:30, **quando** apurada, **então** o valor devido deve ser R$ 0,00.
- **Dado** 6 h de tempo efetivo e 30 t, **quando** apurada, **então** o valor deve ser R$ 450,00, e não R$ 75,00.
- **Dado** uma operação de setembro/2026, **quando** apurada, **então** deve usar a regra ESTADIA-REF 0.1 e mostrar essa versão.
- **Dado** a chegada não confirmada, **quando** a apuração for solicitada, **então** deve indicar "aguardando confirmação da chegada".

---

## 🎨 Protótipo Visual
[Link do Figma — Cartão de apuração com memória de cálculo]

---

---

# 🆕 Nova Atividade – 17 · Conciliação financeira

## 🎯 Objetivo
Comparar o que é **devido** com o que foi **pago** e mostrar o saldo, identificando pagamento parcial, divergência e tratativas.

---

## 👤 User Story
**Como** transportadora ou motorista
**Quero** registrar quanto foi efetivamente recebido
**Para** saber se existe saldo pendente e agir sobre ele

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve armazenar o **VALOR_DEVIDO** da apuração.
2. **[MVP]** O sistema deve permitir registrar **VALOR_PAGO** (um ou vários pagamentos), com data, origem e observação.
3. **[MVP]** O sistema deve calcular **SALDO_PENDENTE = VALOR_DEVIDO − VALOR_PAGO**.
4. **[MVP]** O sistema deve permitir registrar as origens: acordo direto, pagamento comercial, retenção, pagamento administrativo, decorrente de negociação, decorrente de processo jurídico e outros.
5. **[MVP]** O sistema deve permitir marcar a operação **EM_TRATATIVA** com observação.
6. **[MVP]** O motorista deve poder informar **"Recebi R$ X"** pelo app de forma simples.
7. **[COMPLETO]** O sistema deve anexar comprovante de pagamento e conciliar com extrato bancário.

---

## 📜 Regras de Negócio (RN)
1. Pago = devido → **PAGO**.
2. 0 < pago < devido → **PAGAMENTO_PARCIAL**.
3. Devido > 0 e nada pago → **AGUARDANDO_PAGAMENTO**.
4. Pago ≠ devido (inclusive acima) → **VALOR_DIVERGENTE**.
5. Negociação em andamento → **EM_TRATATIVA**.
6. Pagamentos não são apagados. Correções são feitas por retificação auditada.
7. A operação não é encerrada só porque o Dossiê foi gerado.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. Valores em reais com 2 casas e separadores no padrão brasileiro.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** um devido de R$ 840 e um pagamento de R$ 400, **quando** registrado, **então** o saldo deve ser R$ 440 e o status PAGAMENTO_PARCIAL.
- **Dado** um devido de R$ 450 e um pagamento de R$ 450, **quando** registrado, **então** o status deve ser PAGO.
- **Dado** que o motorista informou "Recebi R$ 300", **quando** a transportadora abrir, **então** deve ver o pagamento com a origem informada pelo TAC.

---

## 🎨 Protótipo Visual
[Link do Figma — Cartão financeiro: devido, pago, saldo e lista de pagamentos]

---

---

# 🆕 Nova Atividade – 18 · Dossiê Digital e exportação

## 🎯 Objetivo
Reunir em um único documento, verificável, todos os eventos, evidências, cálculos e mensagens da operação, para negociação ou uso jurídico.

---

## 👤 User Story
**Como** usuário autorizado
**Quero** gerar o Dossiê Digital completo da operação
**Para** ter todas as provas organizadas em um só lugar

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve gerar o Dossiê com: dados da operação, TAC, veículo, transportadora, destino, documentos, todos os marcos e confirmações, fotos, localizações, ocorrências, deslocamentos, apuração, devido, pago, saldo, negociações, encaminhamentos, **mensagens de WhatsApp** e auditoria.
2. **[MVP]** O sistema deve mostrar, para cada informação, a **origem** (app, link, portal, Amélia, WhatsApp, retificação).
3. **[MVP]** O sistema deve exportar o Dossiê para **impressão/PDF** e em **JSON** estruturado.
4. **[MVP]** O sistema deve incluir no Dossiê um **código de integridade** (resumo criptográfico) que permita verificar que não houve alteração.
5. **[MVP]** O sistema deve registrar cada geração do Dossiê como evento, com versão e autor.
6. **[COMPLETO]** O sistema deve gerar PDF assinado digitalmente (ICP-Brasil) e página pública de verificação por QR code.

---

## 📜 Regras de Negócio (RN)
1. O Dossiê **preserva a origem** de cada dado.
2. Eventos críticos **nunca são apagados**. Correções aparecem como retificações, mostrando o valor anterior e o novo.
3. Cada nova geração cria uma nova versão. As versões anteriores ficam acessíveis.
4. Ocorrências (como deslocamento) aparecem como "evento para análise", sem juízo de culpa.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A geração deve ocorrer em **até 5 segundos** para operações com até 50 fotos.
2. Layout próprio para impressão em A4, com a marca Estadia BR.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** uma operação concluída, **quando** o Dossiê for gerado, **então** deve conter todos os marcos com horários de registro e de confirmação.
- **Dado** uma operação com WhatsApp, **quando** o Dossiê for gerado, **então** deve listar cada mensagem com destinatário, modo, status e horário.
- **Dado** um Dossiê exportado, **quando** um evento for alterado na base, **então** a verificação de integridade deve acusar a diferença.

---

## 🎨 Protótipo Visual
[Link do Figma — Dossiê: capa, resumo, linha do tempo, evidências, apuração]

---

---

# 🆕 Nova Atividade – 19 · Encaminhamento jurídico

## 🎯 Objetivo
Permitir enviar o Dossiê ao jurídico e acompanhar o tratamento e o resultado, sem decisões jurídicas automáticas.

---

## 👤 User Story
**Como** transportadora
**Quero** encaminhar o Dossiê ao jurídico e acompanhar o retorno
**Para** cobrar o saldo devido com base em provas

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve permitir encaminhar a operação ao jurídico, com destinatário (escritório/organização) e observação.
2. **[MVP]** O sistema deve registrar data, hora, responsável, destinatário, status e observação.
3. **[MVP]** O sistema deve permitir ao jurídico registrar status (em análise, notificado, em acordo, ajuizado, resolvido, arquivado) e resultado.
4. **[MVP]** O sistema deve mostrar ao jurídico apenas as operações encaminhadas a ele.
5. **[COMPLETO]** O sistema deve permitir encaminhar várias operações em lote, com totalização de saldo.

---

## 📜 Regras de Negócio (RN)
1. Só pode ser encaminhada a operação **com saída registrada** e **Dossiê gerado**.
2. Uma operação só é encaminhada **uma vez**. Novos andamentos são registrados no mesmo caso.
3. O sistema **não toma** decisões jurídicas automaticamente.
4. Operação encerrada não pode ser encaminhada.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. Acesso do jurídico somente leitura aos eventos, com escrita apenas no tratamento jurídico.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** uma operação sem Dossiê, **quando** tentar encaminhar, **então** o sistema deve informar "Gere o dossiê digital antes de encaminhar".
- **Dado** uma operação encaminhada, **quando** o jurídico registrar "acordo — R$ 440", **então** o histórico deve mostrar o andamento com autor e horário.

---

## 🎨 Protótipo Visual
[Link do Figma — Modal de encaminhamento e painel do jurídico]

---

---

# 🆕 Nova Atividade – 20 · Funcionamento offline e sincronização

## 🎯 Objetivo
Garantir que nenhum registro se perca em pátios e estradas sem sinal: o motorista registra normalmente e o app envia quando a conexão voltar.

---

## 👤 User Story
**Como** motorista
**Quero** registrar os eventos mesmo sem internet
**Para** não perder provas em locais com baixa cobertura

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O app deve guardar no próprio celular os eventos e fotos pendentes.
2. **[MVP]** O app deve manter uma fila de envio e mostrar quantos itens faltam sincronizar.
3. **[MVP]** O app deve sincronizar automaticamente quando a conexão voltar.
4. **[MVP]** O app deve abrir e mostrar a viagem ativa mesmo sem internet.
5. **[MVP]** O app deve permitir preparar a mensagem de WhatsApp mesmo offline (o link é gerado com o evento).
6. **[COMPLETO]** O app deve sincronizar em segundo plano, mesmo fechado.

---

## 📜 Regras de Negócio (RN)
1. O horário **original** do evento é preservado.
2. O horário de recebimento no servidor é guardado **separadamente**.
3. O mesmo evento **não pode** ser processado duas vezes (identificador único gerado no aparelho).
4. Eventos offline seguem as mesmas regras de sequência dos eventos online.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A sincronização deve resistir a perda de conexão, duplicidade, timeout, fechamento do app, falha do servidor e reprocessamento.
2. A fila deve aguentar pelo menos **50 eventos com fotos** sem perder dados.
3. O servidor não pode perder eventos aceitos (gravação confirmada antes da resposta).

---

## 🧪 Critérios de Aceite (QA)
- **Dado** o celular em modo avião, **quando** o motorista registrar a chegada, **então** o app deve mostrar "Registrado no celular" e enviar ao reconectar.
- **Dado** que o mesmo evento foi enviado 3 vezes por queda de rede, **quando** o servidor processar, **então** deve existir um único evento.
- **Dado** uma chegada registrada offline às 09:14 e sincronizada às 09:40, **quando** exibida, **então** deve mostrar 09:14 como horário do evento e 09:40 como recebimento.

---

## 🎨 Protótipo Visual
[Link do Figma — Indicador de fila offline no topo do app]

---

---

# 🆕 Nova Atividade – 21 · Auditoria, imutabilidade e retificação

## 🎯 Objetivo
Garantir que toda informação crítica responda **quem, quando, o quê, onde, como, de qual aparelho, valor anterior, valor novo e evidência**, e que nada seja apagado.

---

## 👤 User Story
**Como** transportadora, jurídico ou auditor
**Quero** ver o histórico completo e confiável de cada operação
**Para** usar os registros como prova

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve gravar cada evento em um registro **somente de inclusão**, encadeado por resumo criptográfico (cada registro referencia o anterior).
2. **[MVP]** O sistema deve gravar em cada evento: autor, organização, horário do aparelho, horário do servidor, origem, aparelho, IP, GPS e evidências.
3. **[MVP]** O sistema deve permitir **retificar** campos autorizados (ex.: horário de um marco, capacidade, placa), exigindo **motivo** e guardando o valor anterior e o novo.
4. **[MVP]** O sistema deve oferecer ao administrador a **verificação de integridade** da cadeia de eventos.
5. **[MVP]** O sistema deve exibir as retificações na linha do tempo e no Dossiê.
6. **[COMPLETO]** O sistema deve ancorar periodicamente o resumo da cadeia em um carimbo de tempo externo.

---

## 📜 Regras de Negócio (RN)
1. Eventos críticos **não podem** ser alterados nem apagados. Correção = novo evento de retificação.
2. Retificação exige **motivo** e permissão "editar".
3. Retificação de marco **recalcula** a apuração, mantendo a apuração anterior no histórico.
4. A confirmação de um marco retificado deve ser **solicitada de novo** à outra parte.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A verificação de integridade de 100 mil eventos deve concluir em **até 30 segundos**.
2. Logs técnicos não podem conter senhas, PINs, tokens de link ou credenciais.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** um evento gravado, **quando** alguém alterar o arquivo/base diretamente, **então** a verificação de integridade deve apontar o evento quebrado.
- **Dado** uma retificação da capacidade de 30 t para 32 t com motivo, **quando** a apuração for exibida, **então** deve mostrar o novo valor e o histórico com 30 → 32 e o motivo.
- **Dado** uma retificação sem motivo, **quando** enviada, **então** deve ser recusada.

---

## 🎨 Protótipo Visual
[Link do Figma — Modal "Retificar" e painel "Integridade"]

---

---

# 🆕 Nova Atividade – 22 · Portal Web do destino e da transportadora

## 🎯 Objetivo
Dar a destino, embarcador e transportadora uma visão **ao vivo** das operações, com as ações que cabem a cada um, já que no MVP eles acompanham pelo portal e não por mensagem.

---

## 👤 User Story
**Como** transportadora ou destino
**Quero** acompanhar as operações em tempo real e agir sobre elas
**Para** confirmar, registrar e tratar divergências sem depender de telefonemas

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O portal deve listar operações com filtros por status, tipo, período, placa e motorista.
2. **[MVP]** O portal deve atualizar a lista e a operação aberta automaticamente quando houver novo evento.
3. **[MVP]** O portal deve permitir ao destino registrar e confirmar marcos e tratar divergências.
4. **[MVP]** O portal deve permitir à transportadora criar operações, registrar pagamentos, gerar dossiê, encaminhar e encerrar.
5. **[MVP]** O portal deve mostrar o relógio da estadia das operações em andamento.
6. **[MVP]** O portal deve mostrar o histórico de mensagens de WhatsApp de cada operação com o status honesto de cada uma.

---

## 📜 Regras de Negócio (RN)
1. Cada perfil só vê os botões das ações que pode executar.
2. Ações no portal geram eventos com origem "portal" e o usuário autenticado.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. O portal deve funcionar em Chrome, Edge, Safari e Firefox (últimas 2 versões).
2. Atualizações ao vivo devem chegar em **até 5 segundos**.
3. A lista deve aguentar **10 mil operações** com paginação.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** o portal aberto, **quando** o motorista registrar a chegada no app, **então** a operação deve mudar de status no portal sem recarregar.
- **Dado** um usuário do destino, **quando** abrir a operação, **então** não deve ver o botão "Encaminhar ao jurídico".

---

## 🎨 Protótipo Visual
[Link do Figma — Portal: lista de operações e tela de operação]

---

---

# 🆕 Nova Atividade – 23 · Alertas e pendências

## 🎯 Objetivo
Avisar de forma proativa o que precisa de atenção: quem não respondeu, limite de 5 h próximo, deslocamentos, falhas de envio e divergências.

---

## 👤 User Story
**Como** transportadora ou motorista
**Quero** ser avisado das pendências da operação
**Para** agir antes que a prova fique incompleta

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve gerar o alerta **SEM_RESPOSTA** quando um aviso ficar **15 minutos** sem confirmação, registrando a tentativa.
2. **[MVP]** O sistema deve oferecer o botão "Reenviar" a partir do alerta.
3. **[MVP]** O sistema deve alertar quando o limite de 5 h estiver a **30 minutos** de ser atingido e quando for ultrapassado.
4. **[MVP]** O sistema deve alertar deslocamento fora do limite, falha de WhatsApp, NÃO CONFERE e GPS indisponível.
5. **[COMPLETO]** O sistema deve enviar os alertas por push/WhatsApp à transportadora.

---

## 📜 Regras de Negócio (RN)
1. "Destino não confirma" mantém a operação pendente e **registra a tentativa**. Não confirma por omissão.
2. Alertas não alteram eventos. Só informam.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. Alertas devem ser recalculados a cada novo evento e a cada minuto em operações abertas.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** um aviso de chegada preparado há 16 minutos sem confirmação, **quando** a operação for aberta, **então** deve aparecer "ainda não respondeu (16 min)".
- **Dado** 4h35 de estadia, **quando** exibido o relógio, **então** deve aparecer o alerta de proximidade do limite.

---

## 🎨 Protótipo Visual
[Link do Figma — Faixa de alertas por nível (atenção / crítico)]

---

---

# 🆕 Nova Atividade – 24 · Relatórios e indicadores

## 🎯 Objetivo
Dar visão operacional e financeira consolidada para mostrar quanto tempo se perde em estadias e quanto deve ser recuperado.

---

## 👤 User Story
**Como** transportadora ou destino
**Quero** relatórios de tempo, valores e divergências
**Para** tomar decisões e cobrar o que é devido

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve exibir: quantidade de operações, tempo médio, operações acima de 5 h, valor devido, pago, saldo e percentual recuperado.
2. **[MVP]** O sistema deve exibir: operações com divergência, deslocamentos acima de 300 m, tempo médio entre chegada e confirmação, e entre início e término.
3. **[MVP]** O sistema deve exibir: operações encaminhadas ao jurídico e operações com foto/GPS.
4. **[MVP]** O sistema deve permitir filtrar por período, local, transportadora e motorista.
5. **[MVP]** O sistema deve exportar relatórios em CSV.
6. **[COMPLETO]** O sistema deve oferecer painéis de BI e ranking de locais com maior tempo de espera.

---

## 📜 Regras de Negócio (RN)
1. Cada organização vê apenas indicadores das suas operações.
2. Operações em andamento não entram nas médias de tempo final.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. Relatórios de até 12 meses devem carregar em **até 5 segundos**.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** 10 operações no mês com 3 acima de 5 h, **quando** o relatório for aberto, **então** deve mostrar "3 operações acima do limite (30%)".

---

## 🎨 Protótipo Visual
[Link do Figma — Relatórios: cartões de indicadores e tabela]

---

---

# 🆕 Nova Atividade – 25 · Administração, parâmetros e integrações

## 🎯 Objetivo
Centralizar a configuração do produto: usuários, organizações, regras de cálculo, limites, modo de WhatsApp, integridade e auditoria.

---

## 👤 User Story
**Como** administrador
**Quero** configurar parâmetros e integrações em um só lugar
**Para** adaptar o produto sem precisar mudar o sistema

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve permitir gerenciar usuários e organizações (Atividade 01).
2. **[MVP]** O sistema deve exibir as versões de regra de cálculo e a vigente.
3. **[MVP]** O sistema deve exibir o modo de WhatsApp em uso (pelo celular do motorista, API oficial ou simulador).
4. **[MVP]** O sistema deve executar a verificação de integridade dos eventos.
5. **[ESTRUTURA]** Parâmetros configuráveis: limite de estadia, valor t·h, limite de deslocamento, validade do link, tempo para alerta SEM_RESPOSTA.
6. **[COMPLETO]** O sistema deve permitir configurar white-label (logo, nome, cores, domínio) por cliente.

---

## 📜 Regras de Negócio (RN)
1. Alterar parâmetro de cálculo cria **nova versão** com data de vigência. Nunca altera a anterior.
2. Somente o perfil Administrador acessa esta área.
3. Toda alteração administrativa gera registro de auditoria.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. Credenciais de integração ficam em variáveis de ambiente ou cofre de segredos, nunca visíveis na tela.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** o modo de WhatsApp configurado como manual, **quando** o administrador abrir a área, **então** deve ver "WhatsApp: pelo celular do motorista".
- **Dado** uma nova regra vigente a partir de 01/01/2027, **quando** uma operação de dezembro/2026 for apurada, **então** deve usar a regra anterior.

---

## 🎨 Protótipo Visual
[Link do Figma — Administração: abas Usuários, Regras, Integrações, Integridade]

---

---

# 🆕 Nova Atividade – 26 · Ambiente de demonstração e treinamento

## 🎯 Objetivo
Permitir apresentar e testar o produto várias vezes com dados de exemplo, voltando ao ponto inicial com um clique, sem afetar dados reais.

---

## 👤 User Story
**Como** equipe comercial ou de testes
**Quero** reiniciar a demonstração com dados de exemplo
**Para** repetir o fluxo completo quantas vezes precisar

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve oferecer, apenas em ambiente de demonstração, o botão **"Reiniciar demonstração"**.
2. **[MVP]** O sistema deve recriar organizações, usuários e operações de exemplo (em andamento, isolamento, histórica com pagamento parcial e encerrada sem valor).
3. **[MVP]** O sistema deve exibir ao motorista as "Ferramentas da demonstração" (ex.: simular deslocamento) somente em ambiente de demonstração.
4. **[ESTRUTURA]** O sistema deve ter um parâmetro que indica se o ambiente é de demonstração ou produção.

---

## 📜 Regras de Negócio (RN)
1. Em **produção**, o reinício e as ferramentas de demonstração **não existem**.
2. Eventos simulados ficam marcados como "[simulado em demonstração]".

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. O reinício deve concluir em **até 5 segundos**.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** o ambiente de demonstração, **quando** o administrador tocar em "Reiniciar demonstração", **então** todas as operações de teste voltam ao estado inicial.
- **Dado** o ambiente de produção, **quando** o administrador abrir a área, **então** o botão de reinício não deve aparecer.

---

## 🎨 Protótipo Visual
[Link do Figma — Administração › Demonstração]

---

---

# 🆕 Nova Atividade – 27 · Segurança, LGPD e qualidade transversal

## 🎯 Objetivo
Definir as qualidades obrigatórias que valem para todo o produto: proteção de dados pessoais, segurança, disponibilidade, observabilidade e desempenho em campo.

---

## 👤 User Story
**Como** cliente do Estadia BR
**Quero** ter meus dados e provas protegidos e disponíveis
**Para** confiar no sistema como base de cobrança e de defesa

---

## ✅ Requisitos Funcionais (RF)
1. **[MVP]** O sistema deve exibir aviso de privacidade no primeiro acesso do motorista e na página de confirmação.
2. **[MVP]** O sistema deve registrar o consentimento/ciência do motorista para uso de câmera e localização.
3. **[MVP]** O sistema deve oferecer ao administrador a exportação dos dados de uma pessoa (direito de acesso da LGPD).
4. **[COMPLETO]** O sistema deve aplicar a política de retenção (anonimizar ou excluir dados pessoais após o prazo, preservando a prova pelo tempo legal).

---

## 📜 Regras de Negócio (RN)
1. Dados tratados: nome, telefone, CPF, dados profissionais, localização, imagens, documentos, veículos e operações. Só se coleta o necessário para a prova (minimização).
2. A localização só é capturada nos marcos (e no monitoramento, se autorizado). Nunca fora de uma operação ativa.
3. A exclusão de dados pessoais não pode destruir a prova de operações em disputa. Nesses casos, o dado é bloqueado e não apagado, até o fim do prazo legal.
4. Evidências são acessíveis somente a participantes autorizados da operação.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. Todo tráfego com **HTTPS/TLS 1.2+**.
2. Evidências armazenadas com criptografia em repouso e volume persistente com backup diário.
3. Disponibilidade alvo de **99,5%** no MVP. Nenhum evento aceito pode ser perdido.
4. Observabilidade: monitorar APIs, filas, sincronizações, integrações (WhatsApp/IA), erros e notificações, com alerta para falhas.
5. Telas críticas do motorista com resposta em **até 2 segundos** em 4G.
6. A arquitetura deve permitir crescimento de usuários, operações, organizações, evidências e mensagens sem reescrita (ex.: troca de armazenamento de arquivos para objeto e de banco por um relacional, mantendo o modelo de eventos).
7. Limite de tentativas em login e páginas públicas para evitar abuso.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** um acesso HTTP sem TLS, **quando** feito, **então** deve ser redirecionado para HTTPS.
- **Dado** um usuário de outra organização com a URL de uma foto, **quando** tentar abrir, **então** o acesso deve ser negado.
- **Dado** a reinicialização do servidor, **quando** voltar, **então** todos os eventos aceitos antes devem estar presentes.

---

## 🎨 Protótipo Visual
[Link do Figma — Aviso de privacidade e permissões do app]

---

---

# 🆕 Nova Atividade – 28 · Relação entre carga e descarga e integrações externas

## 🎯 Objetivo
Preparar o produto para crescer: relacionar carga e descarga para análise e integrar com TMS, ERP e documentos fiscais, **sem criar dependência operacional** entre operações.

---

## 👤 User Story
**Como** transportadora
**Quero** relacionar operações de carga e descarga e integrar com meus sistemas
**Para** ter visão da viagem inteira e evitar digitação duplicada

---

## ✅ Requisitos Funcionais (RF)
1. **[ESTRUTURA]** O sistema deve guardar NF-e, CT-e, MDF-e, veículo, TAC e período de cada operação de forma pesquisável, permitindo relacionar carga e descarga.
2. **[COMPLETO]** O sistema deve sugerir relações entre carga e descarga pelos documentos fiscais e pelo veículo.
3. **[COMPLETO]** O sistema deve oferecer API pública autenticada para criar operações e consultar eventos e apurações.
4. **[COMPLETO]** O sistema deve enviar webhooks de eventos para sistemas do cliente (TMS/ERP).
5. **[COMPLETO]** O sistema deve integrar com sindicatos e órgãos (fora do MVP, conforme roadmap).

---

## 📜 Regras de Negócio (RN)
1. A relação entre carga e descarga é **apenas analítica**. Uma operação nunca bloqueia nem altera a outra.
2. Integrações externas geram eventos com origem "integração" e ficam sujeitas à mesma auditoria.
3. Fora do escopo inicial: sindicatos, portal ANTT, Painel Logístico Nacional, IA jurídica autônoma, negociação automática, marketplace, TMS/WMS/YMS completos, pagamentos bancários automáticos e analytics avançado.

---

## ⚙️ Requisitos Não Funcionais (RNF)
1. A API deve ser versionada e documentada (OpenAPI), com autenticação por chave por organização.
2. Webhooks com assinatura e nova tentativa automática.

---

## 🧪 Critérios de Aceite (QA)
- **Dado** uma carga e uma descarga com a mesma NF-e, **quando** o relatório de viagem for aberto, **então** devem aparecer relacionadas, cada uma com o seu status independente.

---

## 🎨 Protótipo Visual
[Link do Figma — Relatório de viagem (carga + descarga)]

---

---

# 📌 Anexo A — Matriz dos marcos (decisão consolidada)

| Marco | Quem registra | Quem confirma | Evidência | GPS |
|---|---|---|---|---|
| Identificação | TAC (Amélia) | — (confirmação única do TAC) | Texto/áudio | Não |
| Chegada | TAC | Destino/portaria (link) | **Foto obrigatória** + localização | Sim (falta = ocorrência) |
| Início | TAC ou destino | A outra parte | Registro | Se disponível |
| Término | TAC ou destino | A outra parte | Foto/documento opcional | Se disponível |
| Liberação | Destino **ou TAC (MVP)** | A outra parte (obrigatória se foi o TAC) | Comprovante quando houver | Não obrigatório |
| Saída | TAC | — | **Foto do comprovante obrigatória** | Não obrigatório |

---

# 📌 Anexo B — Decisões tomadas no MVP

| # | Decisão | Motivo | Como evolui |
|---|---|---|---|
| D-01 | Motorista opera sozinho, guiado por um botão de "próximo passo". | Público com pouca afinidade com tecnologia. | Mantém-se. O portal ganha mais recursos. |
| D-02 | Confirmações pelo **WhatsApp do próprio motorista**, com link (modo manual é o padrão). | Sem custo e sem aprovação da API da Meta para lançar. | Ligar a API oficial (Atividade 09) sem mudar fluxo nem dados. |
| D-03 | A confirmação vale pelo **clique no link**, não pelo envio. | O envio pelo celular do motorista não informa entrega. | Com a API, somam-se entrega/leitura e resposta "SIM". |
| D-04 | O status nunca diz "enviado" sem certeza. | Teste real mostrou mensagens marcadas como enviadas que não saíram. | Mantém-se. |
| D-05 | Número de quem está na portaria pode ser informado **na hora**. | O contato cadastrado nem sempre é quem atende. | Contatos por local/turno. |
| D-06 | O TAC pode registrar a liberação, com confirmação obrigatória do destino. | O motorista não pode ficar travado esperando o destino registrar. | Parâmetro por organização. |
| D-07 | A transportadora acompanha pelo portal ao vivo, sem mensagens no MVP. | Menos envios para o motorista fazer. | Avisos automáticos via API. |
| D-08 | Regra ESTADIA-BR 2.0 (5 h, R$ 2,50 t·h, tempo total, chegada confirmada → liberação), versionada e vigente desde 01/10/2026. | Regra consolidada pelo cliente. | Novas versões após validação jurídica. |
| D-09 | Registro de eventos somente de inclusão, com cadeia de integridade. | Força de prova do Dossiê. | Carimbo de tempo externo / assinatura ICP-Brasil. |
| D-10 | Amélia com extração por regras e transcrição do aparelho no MVP. | Custo zero e previsível na fase inicial. | IA generativa + transcrição no servidor. |
| D-11 | Validade do link de 24 h, com "Pedir novo link". | Segurança sem travar quem confirma depois. | Parâmetro por organização. |
| D-12 | Ambiente de demonstração com "Reiniciar demonstração". | Vender e treinar repetidas vezes. | Inexistente em produção. |

---

# 📌 Anexo C — Pontos que ainda dependem de validação

- **Jurídico:** marco legal de início e fim da contagem, tratamento de frações de hora, capacidade considerada, força de prova da confirmação por link, prazos de retenção.
- **Técnico:** provedor e custos da API do WhatsApp e da IA; app nativo × PWA (monitoramento de GPS em segundo plano exige app nativo); banco relacional e armazenamento de evidências em nuvem; domínio **stadiabr.com.br**.
