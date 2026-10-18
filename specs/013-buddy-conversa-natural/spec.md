# Feature Specification: Buddy com conversa natural

**Feature Branch**: `013-buddy-conversa-natural`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Reestruturar o assistente para conversar como um atendente que conhece a loja: entender o contexto, perguntar quando tiver dúvida, assumir só o que o sistema sabe, retomar o pedido depois de um desvio e responder em português comum, sem nada técnico na tela. Fonte: `docs/prd/feature-buddy-conversa-natural.md`."

## Clarifications

### Session 2026-10-06

- Q: O PRD retira o bloqueio mensal de uso de IA, mas a constitution e o RNF-073 exigem teto configurável. Como fica? → A: O teto continua configurável e vem desligado por padrão. Na prática, nenhum assinante tem limite; o mecanismo fica para quando houver necessidade, sem emenda da constitution.

## Escopo desta fatia

O Buddy já cadastra, vende, consulta e cobra pelo WhatsApp ([spec 012](../012-buddy-operacao-whatsapp/spec.md)), mas conversa como um sistema. No teste manual, “O João quer comprar café” virou “Nao encontrei esse cliente.”. Depois do cadastro do João, “ele quer comprar café” virou uma consulta de estoque com o código interno do produto e “Localizacao indisponivel”. Esta fatia muda **como** o Buddy conversa. **O que** ele sabe consultar e gravar continua o mesmo.

**Entra:**

1. Respostas redigidas a partir do dado real consultado, em português comum, sem código interno, nome de campo ou valor em centavos.
2. Tom próximo e direto, com respostas curtas.
3. Perguntar o que falta numa única mensagem e assumir só o que o cadastro já sabe.
4. Confirmação e correção em linguagem natural, com uma trava: resposta que traz dado novo ou ressalva nunca grava.
5. Contexto da conversa: “ele”, “esse café”, “a venda de agora” resolvidos pelo que acabou de ser dito.
6. Cliente ou produto inexistente: oferecer o cadastro e retomar o pedido original sozinho.
7. Fora do escopo, recusas e erros explicados no mesmo tom.
8. Limite de raciocínio por mensagem, com saída elegante.
9. O mesmo comportamento no WhatsApp, no chat do aplicativo e no ambiente de testes da engenharia.

**Fora desta fatia:**

| Fora agora                                                        | Por quê                                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Novas capacidades de consulta ou de gravação                      | A lista da spec 012 continua a mesma; esta fatia muda a conversa, não o que se grava                     |
| Foto de código de barras                                          | Retirada nesta fatia; foto recebe o pedido de texto já usado para outras mídias. Regressão aceita no PRD |
| Lembrar preferências da dona entre conversas, ou aprender com ela | O contexto vale só para a conversa ativa                                                                 |
| Áudio e figurinha                                                 | Continuam recebendo o pedido de texto                                                                    |

**Relação com specs anteriores:** onde esta spec conflitar com a [spec 012](../012-buddy-operacao-whatsapp/spec.md) ou com o [PRD Buddy no WhatsApp](../../docs/prd/feature-buddy-whatsapp.md), prevalece esta. Ficam substituídos: o “sim inequívoco” como única forma de aceite, os textos fixos de resposta e de confirmação, o tratamento da foto e o modelo inicial. O ritmo de resposta no WhatsApp (lido, digitando, mensagens em partes, espera da rajada) da [spec 011](../011-resposta-natural-whatsapp/spec.md) continua valendo.

**Definition of Done:** no caso do João, a dona pede a venda, o Buddy oferece cadastrar, cadastra no aceite, retoma a venda sem ela repetir, pergunta só a forma de pagamento, propõe, aceita uma correção natural e grava com os dados corrigidos. Em nenhuma resposta aparece código interno, nome de campo ou valor em centavos.

## User Scenarios & Testing _(mandatory)_

Persona: **Cláudia**, dona da loja, já autorizada a falar com o Buddy. Usa o WhatsApp no balcão, entre um atendimento e outro, e escreve como fala.

### User Story 1 - Ler respostas sem nada técnico (Priority: P1)

Cláudia pergunta algo ou pede uma ação e recebe uma resposta curta, em português comum, com nomes e valores em reais, sem código interno, nome de campo ou centavos.

**Why this priority**: é o defeito mais visível hoje e o que mais tira a confiança dela no produto. Vale para todas as outras histórias.

**Independent Test**: fazer uma consulta de estoque, uma busca de produto e uma edição de preço, e conferir que nenhuma resposta traz identificador interno, código de produto interno, nome de campo, nome de ferramenta ou valor em centavos.

**Acceptance Scenarios**:

1. **Given** um produto “café em grãos” com 0 unidades e preço R$ 25,00, **When** Cláudia pergunta “quanto tem de café?”, **Then** a resposta traz o nome, a quantidade e o preço em reais, sem código interno e sem informar campo vazio como “localização indisponível”.
2. **Given** um produto cadastrado, **When** ela pede para mudar o preço de venda para 14, **Then** a confirmação fala em “preço de venda” e “R$ 14,00”, e não em nome de campo nem em código interno.
3. **Given** qualquer resposta pronta para envio que ainda contenha identificador interno, nome de campo ou valor em centavos, **When** o envio vai acontecer, **Then** a resposta é refeita uma vez e, se o termo persistir, o trecho é retirado antes de chegar a ela.
4. **Given** uma resposta comum, **When** ela é enviada, **Then** tem até 3 linhas, salvo lista com mais de 3 itens, e no máximo 1 emoji.

---

### User Story 2 - Pedir o que falta numa só mensagem (Priority: P1)

Cláudia pede uma venda sem dizer tudo. O Buddy usa o que o cadastro já sabe (preço de tabela, quantidade 1) e pergunta numa única mensagem só o que ninguém sabe, como a forma de pagamento.

**Why this priority**: perguntar campo por campo é o “interrogatório” robotizado; não perguntar inventa dado. É o centro de “quando tiver dúvida, pergunte”.

**Independent Test**: pedir “vende um café pro Pedro” com o Pedro e o café cadastrados, e conferir que o Buddy pergunta só a forma de pagamento e depois propõe 1 café ao preço de tabela.

**Acceptance Scenarios**:

1. **Given** cliente e produto cadastrados, **When** Cláudia pede a venda sem quantidade, preço e pagamento, **Then** o Buddy pergunta só a forma de pagamento e nada é proposto ainda.
2. **Given** a forma de pagamento respondida, **When** o Buddy propõe a venda, **Then** a proposta usa quantidade 1 e o preço de tabela, e os dois aparecem explicitamente na confirmação.
3. **Given** mais de um dado faltando, **When** o Buddy pergunta, **Then** todos aparecem numa única mensagem.
4. **Given** “adicione café” sem os dados do produto, **When** o Buddy responde, **Then** ele pede numa única mensagem o que é obrigatório (descrição, unidade, custo e preço de venda) e diz o que é opcional, e nada é cadastrado.
5. **Given** dois produtos ou dois clientes compatíveis com o que ela disse, **When** o Buddy responde, **Then** ele lista as opções pelo nome e pergunta qual, sem escolher sozinho.

---

### User Story 3 - Confirmar e corrigir falando normalmente (Priority: P1)

O Buddy pede confirmação com as próprias palavras. Cláudia responde “fechou” para aceitar ou “não, são 3” para corrigir, e nada é gravado por engano.

**Why this priority**: é o único ponto em que a conversa vira gravação. A naturalidade só é aceitável com a trava que impede gravar uma resposta que carrega correção.

**Independent Test**: com uma venda proposta, responder “não, são 3”, conferir que nada foi gravado e que veio uma nova proposta com 3; depois responder “fechou” e conferir a venda gravada com 3.

**Acceptance Scenarios**:

1. **Given** uma proposta pendente, **When** Cláudia responde com concordância pura (“sim”, “fechou”, “isso aí”, “manda ver”), **Then** a gravação acontece com os dados da proposta.
2. **Given** uma proposta pendente, **When** a resposta traz número, valor, nome, forma de pagamento ou ressalva (“mas”, “né?”, “acho que”), **Then** nada é gravado e o Buddy apresenta uma nova proposta com o dado corrigido.
3. **Given** uma proposta pendente, **When** ela recusa, **Then** a proposta é cancelada e nada é gravado.
4. **Given** uma proposta pendente há mais de 5 minutos, **When** ela responde “sim”, **Then** nada é gravado.
5. **Given** uma proposta pendente, **When** ela muda de assunto, **Then** a proposta é cancelada e a mensagem é tratada como pedido novo.
6. **Given** uma gravação aceita, **When** ela termina, **Then** a mensagem de conclusão descreve o que de fato foi gravado.
7. **Given** um perfil sem permissão de escrita, **When** aceita uma proposta, **Then** nada é gravado e a resposta explica o motivo.

---

### User Story 4 - Ser entendida pelo que acabou de dizer (Priority: P2)

Depois de falar do João, Cláudia escreve “ele quer comprar 2 cafés”. O Buddy entende que “ele” é o João e segue a venda, sem pedir o nome e sem consultar estoque.

**Why this priority**: sem contexto, toda mensagem recomeça do zero e a conversa parece com uma máquina. Depende das histórias 1 a 3 para a venda em si.

**Independent Test**: cadastrar ou citar um cliente, mandar em seguida uma frase com “ele” e conferir que a ação usa esse cliente; repetir depois de 2 horas paradas e conferir que o Buddy pergunta de quem se trata.

**Acceptance Scenarios**:

1. **Given** um cliente citado ou resolvido na conversa ativa, **When** Cláudia se refere a ele por “ele”, **Then** o Buddy usa esse cliente sem pedir o nome.
2. **Given** um produto citado na conversa ativa, **When** ela fala “esse café”, **Then** o Buddy usa esse produto.
3. **Given** mais de 2 horas sem mensagem, **When** ela usa “ele”, **Then** o Buddy pergunta de quem se trata.
4. **Given** duas empresas diferentes, **When** cada dona conversa, **Then** nenhuma conversa enxerga cliente, produto ou venda da outra.

---

### User Story 5 - Cadastrar no meio do pedido sem recomeçar (Priority: P2)

Cláudia pede uma venda para alguém que não está cadastrado. O Buddy oferece cadastrar ou seguir sem cliente e, depois do cadastro, continua a venda de onde parou.

**Why this priority**: é o caso exato do teste manual. Depende do contexto (história 4) para guardar a intenção durante o desvio.

**Independent Test**: sem um João cadastrado, mandar “O João quer comprar café”, aceitar o cadastro e conferir que o Buddy retoma a venda sem ela repetir o pedido.

**Acceptance Scenarios**:

1. **Given** nenhum João cadastrado, **When** Cláudia escreve “O João quer comprar café”, **Then** o Buddy oferece cadastrar o João (só o nome basta) ou registrar a venda sem cliente, e não encerra o pedido.
2. **Given** a mesma situação com pagamento no fiado, **When** o Buddy oferece as opções, **Then** registrar sem cliente não é oferecido.
3. **Given** o cadastro do João aceito, **When** ele conclui, **Then** o Buddy retoma a venda: pergunta o que ainda falta ou apresenta a proposta, sem ela repetir.
4. **Given** um produto não encontrado numa venda, **When** o Buddy responde, **Then** ele oferece cadastrar o produto, pedindo os dados obrigatórios, e retoma a venda depois do cadastro aceito.
5. **Given** “cadastra o João e vende 2 cafés pra ele”, **When** o Buddy responde, **Then** ele propõe primeiro o cadastro e, depois do aceite, a venda.
6. **Given** um cliente com telefone ou documento igual a outro já cadastrado, **When** o cadastro é proposto, **Then** vale a regra de cadastro parecido já existente.

---

### User Story 6 - Ouvir “não” e “deu errado” com naturalidade (Priority: P3)

Quando Cláudia pede algo que o Buddy não faz, algo que é recusado por regra, ou quando uma gravação falha, a resposta vem no mesmo tom das outras e diz o que fazer.

**Why this priority**: são casos menos frequentes, mas hoje são os mais robotizados (lista de ferramentas internas, mensagem técnica colada).

**Independent Test**: pedir “me conta uma piada”, pedir para importar o extrato e tentar cadastrar um produto com preço abaixo do custo; conferir as três respostas.

**Acceptance Scenarios**:

1. **Given** um pedido fora do que o Buddy faz, **When** ele responde, **Then** diz que não faz isso e dá até 3 exemplos do que pode fazer, em palavras comuns, sem nome interno.
2. **Given** um pedido recusado por regra (certificado, extrato e conciliação, nota avulsa, apagar conta bancária ou contato), **When** ele responde, **Then** diz que não faz isso por aqui, que nada foi feito e onde fazer.
3. **Given** uma gravação recusada pela regra de negócio, **When** ele responde, **Then** explica o motivo em linguagem comum, diz o que ajustar e não afirma que gravou.
4. **Given** o serviço de IA ou o banco indisponível, **When** chega uma mensagem, **Then** ela recebe uma frase fixa pedindo para tentar de novo em instantes, e nada é gravado.

---

### User Story 7 - Mesmo Buddy em todo canal, sem travar (Priority: P3)

Cláudia recebe o mesmo comportamento no WhatsApp e no chat do aplicativo. Um pedido complicado demais não trava a conversa nem gera resposta inventada.

**Why this priority**: garante que a engenharia testa o mesmo que vai para a dona e que o custo e a espera de uma mensagem ficam limitados.

**Independent Test**: mandar a mesma conversa nos dois canais e no ambiente de testes e comparar o comportamento; forçar um pedido que exige mais de 5 etapas e conferir a resposta.

**Acceptance Scenarios**:

1. **Given** a mesma conversa no WhatsApp, no chat do aplicativo e no ambiente de testes da engenharia, **When** o Buddy responde, **Then** o comportamento é o mesmo; só a formatação de saída muda por canal.
2. **Given** um pedido que exigiria mais de 5 etapas de raciocínio, **When** o limite é atingido, **Then** o Buddy diz o que entendeu até ali, pergunta como seguir e nada é gravado.
3. **Given** uma foto enviada, **When** o Buddy responde, **Then** pede o pedido por texto.
4. **Given** o Buddy processando uma mensagem demorada no WhatsApp, **When** o tempo passa, **Then** o indicador de digitando continua visível até a resposta.

### Edge Cases

- “Sim” enviado depois que a proposta expirou: nada é gravado, e o Buddy diz que a proposta venceu e oferece refazer.
- Resposta de aceite só com emoji (👍): conta como concordância pura.
- Resposta “pode, mas no pix”: ressalva com dado novo; nunca grava, vira nova proposta.
- A mesma mensagem de aceite entregue duas vezes pelo WhatsApp: uma gravação só.
- Dois Joãos cadastrados: o Buddy lista pelo nome (e algum dado de diferença, como o telefone) e pergunta qual.
- Cliente citado só pelo apelido, que não bate com nenhum cadastro: tratado como cliente não encontrado.
- Cadastro proposto durante a venda e recusado: o Buddy pergunta se segue sem cliente ou se encerra; nada é gravado.
- Conversa parada por mais de 2 horas com uma intenção em andamento: a intenção deixa de valer e um pedido novo é tratado do zero.
- Mudança de assunto no meio da retomada depois de um cadastro: a intenção antiga é abandonada.
- Mensagem vazia ou só com espaços: pedido de texto, sem resposta longa.
- Pedido de valor que o sistema não tem (por exemplo, a margem de um produto sem custo): o Buddy diz que não tem o dado, sem inventar.

## Requirements _(mandatory)_

### Functional Requirements

**Redação e apresentação** (RF-096, RNF-054)

- **FR-001**: O Buddy MUST redigir cada resposta a partir do resultado real da consulta ou da gravação, sem inventar valor, quantidade, data ou nome.
- **FR-002**: Nenhuma resposta, em nenhum canal, MUST conter identificador interno, código de produto interno, nome de campo, nome de ferramenta, valor em centavos ou mensagem técnica de validação.
- **FR-003**: Valores MUST aparecer em reais no formato brasileiro, e formas de pagamento como dinheiro, pix, débito, crédito ou fiado.
- **FR-004**: Resposta que, antes do envio, ainda contenha um dos termos proibidos em FR-002 MUST ser refeita uma vez; se o termo persistir, o trecho MUST ser retirado antes do envio.
- **FR-005**: A maioria das respostas MUST ter até 3 linhas; lista só com mais de 3 itens; no máximo 1 emoji por mensagem; o Buddy MUST NOT descrever como funciona por dentro e MUST cumprimentar só quando a dona cumprimentar.
- **FR-006**: Campo sem valor (por exemplo, localização não cadastrada) MUST ser omitido da resposta, e não informado como indisponível.

**Perguntar e assumir** (RF-100, RF-102, US-049)

- **FR-007**: Faltando dado necessário para a ação, o Buddy MUST perguntar tudo o que falta numa única mensagem e MUST NOT propor a ação antes.
- **FR-008**: Na venda, preço não informado MUST usar o preço de tabela do produto, e quantidade não informada MUST ser 1; os dois MUST aparecer explicitamente na confirmação.
- **FR-009**: A forma de pagamento MUST ser sempre perguntada quando não for dita.
- **FR-010**: Com mais de um cliente ou produto compatível, o Buddy MUST listar as opções pelo nome e perguntar qual, sem escolher sozinho.
- **FR-011**: Produto novo MUST exigir descrição, unidade, custo e preço de venda, e o Buddy MUST dizer o que é obrigatório e o que é opcional.

**Proposta, aceite e correção** (RF-103, RF-104, US-050)

- **FR-012**: Nenhuma ação que cria, altera ou marca registro como deletado, ou que envia mensagem a terceiro, MUST acontecer sem proposta e aceite.
- **FR-013**: A gravação MUST usar os dados guardados na proposta, e não a frase da confirmação.
- **FR-014**: O Buddy MUST redigir a confirmação com as próprias palavras, incluindo tudo o que foi assumido (FR-008).
- **FR-015**: Concordância pura MUST contar como aceite.
- **FR-016**: Resposta com dado novo (número, valor, nome, forma de pagamento) ou ressalva MUST NOT contar como aceite; MUST cancelar a proposta atual e gerar uma nova proposta com o dado corrigido.
- **FR-017**: Recusa MUST cancelar a proposta sem gravar; mudança de assunto MUST cancelar a proposta e tratar a mensagem como pedido novo.
- **FR-018**: Proposta MUST expirar em 5 minutos; resposta depois disso MUST NOT gravar.
- **FR-019**: MUST existir no máximo uma proposta pendente por conversa; pedido com duas gravações MUST ser proposto uma de cada vez.
- **FR-020**: A mensagem depois de uma gravação MUST descrever o que de fato foi gravado.
- **FR-021**: Perfil sem permissão de escrita MUST NOT gravar, mesmo com aceite.
- **FR-022**: A mesma mensagem entregue de novo MUST NOT gerar segunda gravação.

**Contexto da conversa** (RF-105, RF-106, US-051)

- **FR-023**: O contexto ativo MUST ser formado pelas últimas 12 mensagens da conversa vigente mais um resumo das entidades da conversa: clientes, produtos e vendas citados ou resolvidos, a proposta pendente e a intenção em andamento.
- **FR-024**: O resumo de entidades MUST NOT ser exibido à dona.
- **FR-025**: Depois de 2 horas sem mensagem, o histórico ativo e o resumo de entidades MUST deixar de valer para ações novas; referência como “ele” MUST ser perguntada de novo.
- **FR-026**: A conversa MUST ser isolada por empresa e por canal; nenhuma conversa MUST enxergar entidade de outra empresa.
- **FR-027**: O que já foi dito na conversa ativa MUST NOT ser perguntado de novo.

**Entidade inexistente e retomada** (RF-098, RF-099, US-048)

- **FR-028**: Cliente não encontrado MUST levar à oferta de cadastrar (só o nome basta) ou de registrar sem cliente; no fiado, registrar sem cliente MUST NOT ser oferecido.
- **FR-029**: Produto não encontrado MUST levar à oferta de cadastrar, pedindo os dados obrigatórios.
- **FR-030**: Depois do cadastro aceito, o Buddy MUST retomar a intenção em andamento sem a dona repetir o pedido.
- **FR-031**: A regra de cadastro parecido (telefone ou documento repetido) MUST valer também para o cadastro feito no meio de outro pedido.

**Fora do escopo, recusas e falhas** (RF-097, RF-149, RF-150, RF-151, RNF-054)

- **FR-032**: Pedido fora do que o Buddy faz MUST ser respondido dizendo que não faz isso e dando até 3 exemplos do que pode fazer, em palavras comuns.
- **FR-033**: As recusas existentes (certificado, extrato e conciliação, nota avulsa, apagar conta bancária ou contato) MUST continuar, com a regra vinda do sistema e redigidas no mesmo tom.
- **FR-034**: Gravação recusada pela regra de negócio MUST ser explicada em linguagem comum, com o que ajustar, e MUST NOT ser apresentada como sucesso.
- **FR-035**: Falha inesperada (serviço de IA ou banco indisponível) MUST receber uma frase fixa pedindo nova tentativa, sem gravar.

**Limites, canais e uso** (RNF-006, RNF-072, RNF-073, RNF-075)

- **FR-036**: Cada mensagem MUST ter no máximo 5 etapas de raciocínio; ao atingir o limite, o Buddy MUST dizer o que entendeu e perguntar como seguir, sem gravar.
- **FR-037**: O indicador de digitando no WhatsApp MUST continuar visível enquanto a mensagem é processada.
- **FR-038**: WhatsApp, chat do aplicativo e ambiente de testes da engenharia MUST ter o mesmo comportamento de conversa; só a formatação de saída MAY variar por canal.
- **FR-039**: O uso de IA MUST ser registrado por empresa e por etapa de raciocínio, sem aparecer na conversa.
- **FR-040**: O teto de uso de IA por empresa MUST continuar configurável e MUST vir desligado por padrão; sem teto configurado, nenhuma empresa é bloqueada nem recebe aviso de limite.
- **FR-041**: Ao serviço de IA MUST ir só o necessário para a mensagem: o contexto ativo e o resumo de entidades, sem histórico além da janela e sem imagem.
- **FR-042**: Foto MUST receber o pedido por texto já usado para outras mídias.

### Key Entities _(include if feature involves data)_

- **Conversa**: o diálogo entre a dona e o Buddy num canal, identificado por empresa, canal e celular (ou sessão, no aplicativo). Tem um momento de última mensagem, usado para o corte de 2 horas.
- **Mensagem**: cada turno da dona ou do Buddy numa conversa. Só as 12 mais recentes da conversa ativa entram no contexto.
- **Resumo de entidades da conversa**: o que a conversa sabe sem mostrar: clientes, produtos e vendas citados ou resolvidos (com a referência interna de cada um), a proposta pendente e a intenção em andamento. Zera com o corte de 2 horas.
- **Intenção em andamento**: um pedido interrompido por um desvio (por exemplo, a venda que espera o cadastro do cliente), com o que já foi dito e o que falta.
- **Proposta de gravação**: a ação que o Buddy quer executar, com os dados exatos que serão gravados, o prazo de 5 minutos e o estado (pendente, aceita, recusada, corrigida, expirada). No máximo uma pendente por conversa.
- **Registro de uso de IA**: por empresa e por etapa de raciocínio, para acompanhamento interno.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: No conjunto de conversas de avaliação, 0% das respostas contém identificador interno, código de produto interno, nome de campo, nome de ferramenta ou valor em centavos.
- **SC-002**: Em 100% dos casos de teste em que a resposta à proposta traz dado novo ou ressalva, nada é gravado.
- **SC-003**: Em pelo menos 90% das conversas de avaliação em que falta dado, o Buddy pergunta tudo o que falta numa única mensagem.
- **SC-004**: Em pelo menos 90% das conversas de avaliação com cadastro no meio do pedido, a venda é retomada sem a dona repetir o pedido.
- **SC-005**: No caso do João (cliente novo, produto cadastrado), a dona conclui a venda com no máximo 4 mensagens depois do pedido inicial (aceitar o cadastro, informar o pagamento, aceitar a venda e uma correção opcional).
- **SC-006**: Pelo menos 90% das respostas do conjunto de avaliação têm até 3 linhas, sem contar listas com mais de 3 itens.
- **SC-007**: Em pelo menos 95% das consultas, a resposta chega em até 5 segundos; em pelo menos 95% das ações com confirmação, em até 8 segundos (meta medida, não bloqueio).
- **SC-008**: 100% das conversas do conjunto de avaliação têm o mesmo comportamento no WhatsApp, no chat do aplicativo e no ambiente de testes.
- **SC-009**: Em 100% dos casos de teste com referência (“ele”, “esse café”) dentro da conversa ativa, o Buddy usa a entidade certa; depois de 2 horas paradas, pergunta de quem se trata.

## Assumptions

- O conjunto de conversas de avaliação nasce do roteiro manual de prompts existente, reescrito com uma conversa por fluxo desta spec, e roda contra o modelo real antes de cada liberação e a cada troca de modelo. Ele bloqueia a liberação, mas não o fluxo de revisão do dia a dia.
- Os limiares de 90% e 95% são metas iniciais para a primeira medição; podem ser ajustados com base no piloto, sem mudar o comportamento descrito.
- O modelo de IA é configurável. O padrão e a regra de troca estão no PRD de origem; trocar de modelo não muda esta spec.
- Histórico, resumo de entidades, propostas e uso de IA ficam nas tabelas da própria aplicação, isoladas por empresa, como no contexto de conversa já entregue. Nenhum armazenamento de terceiros guarda a conversa.
- A lista de capacidades de consulta e de gravação, o soft-delete de cliente e produto, o cancelamento de venda e a edição de um registro por vez continuam como na spec 012.
- “Concordância pura” é uma resposta sem dado novo e sem ressalva; emoji de aprovação conta como concordância.
- O prazo de 5 minutos da proposta e o corte de 2 horas da conversa continuam os valores já em vigor.
- O ritmo do WhatsApp (lido, digitando, mensagens em partes, espera da rajada) da spec 011 continua igual.
