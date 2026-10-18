# Feature Specification: Resposta natural no WhatsApp

**Feature Branch**: `011-resposta-natural-whatsapp`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "Aprimorar o agente de IA na qualidade percebida pelo usuário. Quando o usuário enviar uma mensagem: aparecer o status de lido; aparecer a animação de digitando; o agente dividir a resposta em mais de uma mensagem para ficar mais legível; o agente formatar o texto para o WhatsApp; o agente esperar um pouco antes de responder, para concatenar caso o usuário divida o próprio texto em mais de uma mensagem."

## Escopo desta fatia

**Entra:**

1. Na conversa da lojista com o assistente no WhatsApp, cada mensagem dela passa a **lida** assim que o produto a aceita.
2. Antes de cada texto de resposta, ela vê a animação de **digitando**.
3. Uma resposta longa ou com mais de uma ideia chega em mais de uma mensagem, na ordem, fácil de ler no celular.
4. O texto usa só a formatação que o chat do WhatsApp mostra (negrito, itálico, quebras de linha, listas simples).
5. Se ela manda vários textos em sequência, o assistente espera uma pausa curta, junta esses textos em um só pedido e responde uma única vez.

**Fora desta fatia:**

| Fora agora                                                           | Por quê                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| O mesmo ritmo (lido, digitando, várias bolhas) no chat do aplicativo | Esses sinais são do chat do WhatsApp; o aplicativo já mostra a conversa na tela dele |
| Mudar o que o assistente sabe consultar, registrar ou confirmar      | Esta fatia muda só quando a resposta começa e como ela aparece                       |
| Envio a cliente final (cobrança, comprovante, opt-out)               | Continua regra já existente; não é a conversa da lojista com o assistente            |
| Áudio, figurinha e outros tipos que não sejam texto                  | O aceite desta fatia é texto. Foto continua com o comportamento já entregue          |
| Marcar como lida a resposta do assistente no celular da lojista      | Quem lê é ela; o produto só controla o sinal das mensagens que ela enviou            |

**Definition of Done:** numa conversa autorizada no WhatsApp, a lojista vê a mensagem como lida, depois o “digitando”, e recebe a resposta em uma ou mais mensagens legíveis, com formatação do WhatsApp. Dois textos enviados em sequência rápida são respondidos juntos; um texto enviado depois da pausa é um pedido novo.

## User Scenarios & Testing _(mandatory)_

Persona: **Cláudia**, lojista já autorizada a conversar com o assistente no WhatsApp. Ela escreve do celular, muitas vezes em mais de um balão, e lê a resposta na mesma conversa.

### User Story 1 - Saber que a mensagem foi lida (Priority: P1)

Cláudia manda um texto e, em seguida, vê na conversa que o assistente já leu, mesmo que a resposta ainda não tenha chegado.

**Why this priority**: sem o “lido”, a espera parece mensagem perdida. É o primeiro sinal de que a conversa está viva.

**Independent Test**: enviar um texto numa conversa autorizada e observar o status da mensagem dela passar a lido antes da resposta, sem precisar de um segundo texto.

**Acceptance Scenarios**:

1. **Given** Cláudia autorizada, **When** ela envia um texto, **Then** essa mensagem aparece como lida na conversa dela antes de qualquer resposta do assistente.
2. **Given** ela envia três textos em sequência rápida, **When** cada um é aceito, **Then** cada um aparece como lido, sem esperar a resposta.
3. **Given** uma mensagem vazia ou só com espaços de uma conversa autorizada, **When** ela é aceita, **Then** aparece como lida e o assistente não inventa uma resposta longa; se responder, pede um pedido em texto.

---

### User Story 2 - Ver que o assistente está digitando (Priority: P1)

Depois do lido, Cláudia vê a animação de “digitando” enquanto o assistente prepara o texto, e de novo entre uma mensagem e outra quando a resposta vem em partes.

**Why this priority**: o “digitando” explica a espera e evita que ela repita o pedido achando que ninguém está respondendo.

**Independent Test**: enviar um pedido que o assistente sabe responder e observar a animação de digitando antes do primeiro texto da resposta. Numa resposta em várias mensagens, observar a animação de novo antes de cada parte seguinte.

**Acceptance Scenarios**:

1. **Given** um pedido que receberá resposta, **When** o assistente começa a preparar o texto, **Then** Cláudia vê “digitando” antes do primeiro balão da resposta.
2. **Given** uma resposta dividida em mais de uma mensagem, **When** uma parte já foi entregue e ainda há outra, **Then** “digitando” volta a aparecer antes da parte seguinte.
3. **Given** “digitando” visível, **When** a última parte da resposta é entregue, **Then** a animação some.
4. **Given** “digitando” visível, **When** o assistente não consegue responder, **Then** a animação some e ela recebe um aviso curto de que não deu para responder agora, em vez de “digitando” permanente.

---

### User Story 3 - Juntar textos enviados em sequência (Priority: P1)

Cláudia costuma escrever o pedido em mais de um balão (“lança uma venda”, depois “2 coca”, depois “fiado pro João”). O assistente espera ela parar e trata o conjunto como um único pedido.

**Why this priority**: responder ao primeiro fragmento produz confirmação errada e faz ela repetir o resto. A qualidade percebida depende de ouvir o pedido inteiro.

**Independent Test**: enviar dois ou mais textos com menos de cerca de 3 segundos entre um e outro e verificar uma única resposta, que considera o texto completo, na ordem em que ela escreveu.

**Acceptance Scenarios**:

1. **Given** Cláudia envia dois ou mais textos e o intervalo entre um e o próximo fica abaixo de cerca de 3 segundos, **When** o assistente vai responder, **Then** trata a sequência como um só pedido, na ordem de chegada, e manda uma única sequência de resposta.
2. **Given** o primeiro texto já está como lido, **When** o segundo texto chega antes do fim da pausa, **Then** a resposta ainda não começou e o segundo texto entra no mesmo pedido.
3. **Given** ela fica em silêncio por cerca de 3 segundos depois do último texto, **When** a pausa se completa, **Then** o assistente responde com base em tudo o que chegou até ali.
4. **Given** a resposta de um pedido já começou, **When** ela envia um texto novo, **Then** esse texto não é misturado ao pedido em andamento; depois que a resposta atual termina, ele entra num pedido seguinte, sozinho ou junto com o que ela enviar na pausa nova.
5. **Given** um único texto e silêncio em seguida, **When** a pausa termina, **Then** o assistente responde a esse texto, sem esperar mais mensagens.

---

### User Story 4 - Ler a resposta em mensagens curtas (Priority: P2)

Quando a resposta tem mais de uma ideia ou não cabe numa leitura rápida no celular, Cláudia recebe mais de uma mensagem, cada uma com um pedaço completo, na ordem em que as ideias foram escritas.

**Why this priority**: um bloco único longo é difícil de ler no WhatsApp e parece menos uma conversa. A divisão só vale quando melhora a leitura; uma resposta curta continua em uma mensagem.

**Independent Test**: obter uma resposta com explicação e uma pergunta de confirmação, e ver pelo menos duas mensagens, a pergunta na última. Obter uma resposta de uma linha (por exemplo, um total) e ver uma única mensagem.

**Acceptance Scenarios**:

1. **Given** uma resposta curta, de uma ideia só, **When** o assistente responde, **Then** chega uma única mensagem.
2. **Given** uma resposta com mais de uma ideia, um parágrafo longo ou uma lista, **When** o assistente responde, **Then** chega em mais de uma mensagem, cada uma terminando numa frase ou item completo.
3. **Given** a resposta inclui uma pergunta de confirmação, **When** as mensagens são enviadas, **Then** a pergunta fica sozinha na última mensagem, para ela responder em seguida.
4. **Given** a resposta traz valor em dinheiro, nome de produto ou quantidade, **When** a mensagem é dividida, **Then** esse dado não é cortado no meio.
5. **Given** uma resposta muito longa, **When** é dividida, **Then** ela não vira uma rajada: no máximo cinco mensagens naquele turno, ainda na ordem das ideias.

---

### User Story 5 - Ver o texto no formato do WhatsApp (Priority: P2)

Destaques, listas e quebras de linha aparecem como o chat do WhatsApp sabe mostrar. Cláudia não vê símbolos de formatação crua que o chat não desenha.

**Why this priority**: negrito e lista ajudam a achar o valor e o nome no celular; formatação que não renderiza parece texto quebrado.

**Independent Test**: pedir um resumo com um valor e uma lista e conferir negrito de destaque, itens em linhas separadas e ausência de títulos com `#`, asteriscos duplos ou tabelas.

**Acceptance Scenarios**:

1. **Given** o assistente quer destacar um rótulo ou um valor (nome, total, vencimento), **When** a mensagem chega, **Then** o destaque usa o negrito do WhatsApp (um asterisco de cada lado) e aparece em negrito no chat.
2. **Given** uma lista de itens, **When** a mensagem chega, **Then** cada item fica em sua própria linha, com um marcador simples, sem tabela.
3. **Given** qualquer resposta desta conversa, **When** Cláudia lê no WhatsApp, **Then** não aparecem títulos com `#`, negrito com dois asteriscos, links no formato de colchetes nem tabelas.
4. **Given** um nome de produto ou observação que já contém asterisco, sublinhado ou til, **When** a mensagem é enviada, **Then** esses caracteres aparecem como texto, e não ligam nem desligam formatação sem querer.

### Edge Cases

- Texto duplicado entregue duas vezes na mesma pausa: entra uma vez só no pedido; gravação continua sem duplicar venda, título ou cadastro.
- Muitas mensagens seguidas, todas dentro da pausa: viram um único pedido, na ordem, e ainda geram no máximo cinco mensagens de resposta.
- Nova mensagem no meio do “digitando” ou entre balões da resposta: não altera o texto que já está sendo enviado; vira o próximo pedido.
- Falha ao mostrar lido ou “digitando”: a resposta ainda é enviada. O sinal de presença não bloqueia a conversa.
- Conversa de número desconhecido, cadastro inativo ou celular antigo: continua sem consultar nem alterar dado e sem revelar se o número existe. Se houver uma resposta curta de recusa, ela também passa por lido, “digitando” e formatação de WhatsApp. A pausa de juntar textos também vale, para não responder a um fragmento.
- Mensagem que não é texto (foto, áudio, figurinha): não entra na concatenação desta fatia e não atrasa os textos. Foto segue a regra já existente. Textos na pausa continuam sendo juntados entre si.
- Confirmação (“sim”, “pode”) enviada depois que a pergunta já chegou: é um pedido novo, não é colada na pergunta. A mesma palavra enviada ainda dentro da pausa, antes de qualquer resposta, faz parte do pedido em montagem.
- Pausa interrompida o tempo todo: cada texto novo reinicia a espera de cerca de 3 segundos. A resposta começa cerca de 3 segundos após o último texto da sequência, não após o primeiro.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST marcar como lida cada mensagem de texto aceita na conversa da lojista com o assistente, antes de responder e antes de terminar a espera por mais textos.
- **FR-002**: O sistema MUST mostrar a animação de “digitando” nessa conversa quando o assistente começa a preparar a resposta, e de novo antes de cada mensagem seguinte do mesmo turno.
- **FR-003**: O sistema MUST encerrar a animação de “digitando” quando a última mensagem do turno é entregue, e também quando o assistente não consegue responder.
- **FR-004**: Se o assistente não consegue responder, o sistema MUST avisar em uma mensagem curta, em linguagem de conversa, que não foi possível responder agora.
- **FR-005**: O sistema MUST esperar cerca de 3 segundos após o último texto de uma sequência antes de tratar o pedido. Texto novo nesse intervalo reinicia a espera e entra no mesmo pedido.
- **FR-006**: O sistema MUST montar o pedido na ordem de chegada dos textos da sequência, sem descartar e sem repetir texto já aceito.
- **FR-007**: O sistema MUST produzir uma única sequência de resposta por sequência de textos juntados.
- **FR-008**: Texto que chega depois que a resposta da sequência anterior já começou MUST ficar para o pedido seguinte, sem alterar as mensagens que já estão saindo.
- **FR-009**: Resposta de uma única ideia curta MUST ser enviada em uma mensagem. Resposta com mais de uma ideia, parágrafo longo ou lista MUST ser enviada em mais de uma mensagem.
- **FR-010**: Cada mensagem da resposta MUST terminar em limite natural (fim de frase, item ou pergunta), sem cortar palavra, valor em dinheiro, quantidade ou nome.
- **FR-011**: Quando a resposta pede confirmação, a pergunta de confirmação MUST ser a última mensagem do turno e MUST ocupar essa mensagem sozinha.
- **FR-012**: Um turno de resposta MUST ter no máximo cinco mensagens.
- **FR-013**: O texto enviado MUST usar apenas formatação que o chat do WhatsApp exibe: negrito com um asterisco de cada lado, itálico com sublinhado, riscado com til e monoespaçado com três crases, além de quebras de linha.
- **FR-014**: O texto enviado MUST NOT usar título com `#`, negrito com dois asteriscos, link no formato de colchetes ou tabela.
- **FR-015**: Caracteres de formatação que já fazem parte de um nome, valor ou observação da loja MUST aparecer literais na conversa.
- **FR-016**: Listas MUST mostrar um item por linha.
- **FR-017**: As mensagens de uma resposta MUST chegar na ordem das ideias, sem omissão silenciosa de parte.
- **FR-018**: A demora para marcar lido, mostrar “digitando” ou dividir a resposta MUST NOT mudar a regra do pedido: mesmos dados, mesma confirmação, mesmo isolamento entre lojas e nenhuma gravação duplicada.
- **FR-019**: Falha ao marcar lido ou ao mostrar “digitando” MUST NOT impedir o envio da resposta.

### Key Entities

- **Mensagem recebida**: um texto da lojista na conversa, com a ordem e o momento em que chegou, e o estado de lido na conversa dela.
- **Sequência em espera**: os textos ainda não tratados, acumulados enquanto a pausa de cerca de 3 segundos não se completa. Vira um único pedido ao fim da pausa.
- **Turno de resposta**: o conjunto ordenado de mensagens que o assistente envia para um pedido, com no máximo cinco partes.
- **Sinal de presença**: o “lido” nas mensagens dela e o “digitando” antes de cada mensagem da resposta.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em pelo menos 95% das mensagens de texto aceitas numa conversa autorizada, a lojista vê o status de lido em até 2 segundos após o envio, antes da resposta.
- **SC-002**: Em pelo menos 95% dos turnos que recebem resposta, a animação de “digitando” aparece antes do primeiro texto e deixa de aparecer até 2 segundos depois da última mensagem do turno.
- **SC-003**: Quando ela envia dois ou mais textos com intervalo menor que cerca de 3 segundos, 100% desses casos geram um único pedido, usando o texto completo na ordem, e nenhuma resposta parcial ao primeiro fragmento.
- **SC-004**: Um texto enviado mais de cerca de 3 segundos depois do anterior, com a resposta anterior já iniciada, é tratado como pedido novo em 100% dos casos observados.
- **SC-005**: Em uma amostra de respostas longas (mais de uma ideia ou uma lista), pelo menos 90% chegam em duas a cinco mensagens, e nenhuma mensagem da amostra corta palavra, valor, quantidade ou nome no meio.
- **SC-006**: Respostas de uma ideia curta permanecem em uma mensagem em pelo menos 95% dos casos.
- **SC-007**: Em uma amostra de respostas com destaque ou lista, 100% mostram o destaque em negrito no chat do WhatsApp e os itens em linhas separadas, e 0% mostram `#`, asterisco duplo ou tabela.
- **SC-008**: A lojista consegue ler uma resposta dividida e identificar o valor ou a pergunta de confirmação sem rolar dentro de um único bloco de texto, na primeira leitura, em pelo menos 90% das respostas longas avaliadas.

## Assumptions

- O canal desta fatia é a conversa já existente da lojista com o assistente no WhatsApp. Quem pode conversar, o que a conversa é capaz de fazer e o isolamento entre lojas não mudam.
- “Cerca de 3 segundos” é a pausa de silêncio depois do último texto. Foi escolhida para ela terminar de escrever sem a resposta cortar o raciocínio, e para a espera não parecer travada. Texto novo dentro dessa janela reinicia a contagem.
- Durante a pausa a mensagem já está lida, e “digitando” só aparece quando a resposta de fato começa. Mostrar “digitando” no meio da pausa faria ela parar de completar o pedido.
- Entre uma mensagem e outra da mesma resposta há uma espera breve, com “digitando”, suficiente para a conversa parecer sequencial e curta o bastante para não parecer falha (bem abaixo da pausa de 3 segundos).
- Resposta “curta, de uma ideia só” é um cumprimento, um único número ou uma frase que cabe numa leitura rápida sem rolagem. O que passa disso, ou o que traz lista ou pergunta de confirmação junto com uma explicação, é resposta longa.
- O teto de cinco mensagens por turno evita enxurrada. Uma resposta que ainda ficaria longa dentro desse teto continua quebrada só em limites naturais, mesmo que cada parte fique um pouco maior.
- Foto e demais tipos que não são texto ficam fora da concatenação e fora da divisão exigida aqui. A legenda que já vem junto da foto continua parte daquela foto.
- Número sem permissão de conversar segue a regra atual de recusa sem revelar cadastro. Os sinais de presença dessa recusa curta seguem esta fatia para a conversa não parecer diferente ou muda.
- Não há grupo nesta conversa: a sequência é sempre da mesma pessoa, no mesmo chat com o assistente.
