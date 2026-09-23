# Feature Specification: Conversar com o assistente pelo WhatsApp

**Feature Branch**: `feat/NR-046-whatsapp-meta-cloud-api`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "Criar a integração com o WhatsApp de forma que o usuário possa conversar com o agente de IA pelo chat do WhatsApp. Só quem tem cadastro e está ativo conversa; a identidade é o número de quem enviou a mensagem, normalizado antes da comparação (o WhatsApp muitas vezes omite o 9 do celular brasileiro). O assistente consulta e altera os mesmos dados do aplicativo. O aceite usa a linha de teste já escolhida."

**Ledger**: [NR-046](../../docs/processo/task-ledger.md) — canal WhatsApp real para a lojista falar com o assistente (depende de NR-045 ✅ e NR-113 🟨).

**Fonte de verdade**: esta spec organiza o recorte pedido para o fluxo Spec Kit. Em conflito, prevalecem a [constitution](../../.specify/memory/constitution.md) (um núcleo, dois canais), a [ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md) e as histórias já rastreáveis.

| Artefato permanente                                                                                                                                                                                                | Papel nesta spec                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [US-046](../../docs/produto/user-stories.md) / [RF-094](../../docs/produto/requisitos-funcionais.md), [RF-095](../../docs/produto/requisitos-funcionais.md), [RF-132](../../docs/produto/requisitos-funcionais.md) | Quem pode falar e o que acontece com número desconhecido ou trocado                            |
| [US-047](../../docs/produto/user-stories.md) e histórias de mensagem já entregues (consulta, cadastro, lançamentos, confirmação)                                                                                   | O que a conversa é capaz de fazer                                                              |
| Constitution — Princípios I e IV                                                                                                                                                                                   | Mesmos casos de uso do aplicativo; uma loja não vê a outra                                     |
| [ADR-0012](../../docs/decisoes/adr/0012-identidade-do-canal-whatsapp.md)                                                                                                                                           | Celular do owner é o vínculo; só a primeira empresa; número desconhecido não revela informação |

## Escopo desta fatia

**Entra:**

1. A lojista dona do cadastro conversa com o assistente no chat do WhatsApp da linha de teste do produto e recebe resposta útil na mesma conversa.
2. Antes de qualquer consulta ou alteração, o sistema reconhece quem fala pelo celular de quem enviou a mensagem, comparado ao celular do cadastro depois da normalização descrita abaixo.
3. Só conversa quem tem cadastro e está ativo. Número desconhecido, cadastro inativo ou celular que deixou de ser o atual não consulta nem altera dado, e a resposta não revela se aquele número existe no produto.
4. A conversa usa as mesmas capacidades que a lojista já tem ao falar com o assistente no produto (consultar e registrar), com as mesmas confirmações, os mesmos limites de conta restrita e o isolamento por empresa.
5. O aceite desta fatia é uma conversa real na linha de teste já escolhida (número de exibição +1 555 155-0338). Credenciais dessa linha não fazem parte desta especificação.

**Fora desta fatia:**

| Fora agora                                                                                   | Onde                                                                                                 |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Enviar cobrança ou comprovante ao cliente final, consentimento e opt-out desse cliente       | RF-015, RF-016 — permanece regra existente; não é o aceite desta conversa                            |
| Mensagens de modelo para retomar contato depois da janela em que o provedor só aceita modelo | Fora do aceite; se a janela estiver fechada, a lojista vê uma recusa clara em vez de silêncio eterno |
| Staff, contador e demais papéis operando o canal                                             | ADR-0012 — só o owner                                                                                |
| Escolher outra empresa quando a mesma pessoa tem mais de uma                                 | ADR-0012 — o celular cola na primeira empresa; as outras seguem no aplicativo                        |
| Código de posse enviado ao chip para criar o vínculo                                         | Abdicado na ADR-0012                                                                                 |
| Áudio, figurinha e outros tipos que não sejam texto                                          | Fora do aceite                                                                                       |
| Foto na conversa                                                                             | Fora do aceite desta fatia (o assistente já trata foto noutros recortes; aqui a prova é texto)       |

**Definition of Done:** na linha de teste, a dona com cadastro ativo envia um texto, é reconhecida mesmo se o número chegar sem o 9, recebe resposta do assistente e uma consulta simples devolve dado só da empresa dela. Um número sem cadastro, inativo ou antigo não obtém dado nem alteração. A mesma pergunta no aplicativo e no WhatsApp não diverge de regra.

## User Scenarios & Testing _(mandatory)_

Persona: **Cláudia**, lojista e dona do cadastro, com celular ativo no produto. Ela escreve para a linha de teste do EiBuddy no WhatsApp.

### User Story 1 - Conversar com o assistente no WhatsApp (Priority: P1)

Cláudia manda uma mensagem de texto para o número do produto e o assistente responde na mesma conversa, como já responde quando ela fala pelo produto.

**Why this priority**: sem ida e volta no chat, não existe canal WhatsApp para a lojista.

**Independent Test**: com o celular de Cláudia igual ao cadastro ativo, enviar uma saudação ou um pedido simples de consulta na linha de teste e receber uma resposta coerente na mesma conversa, sem abrir o aplicativo.

**Acceptance Scenarios**:

1. **Given** Cláudia com cadastro ativo e celular igual ao número de quem envia, **When** ela manda um texto para a linha do produto, **Then** o assistente responde na mesma conversa em linguagem que ela entende.
2. **Given** uma pergunta que o assistente já sabe responder no produto (por exemplo, situação de estoque ou de contas), **When** ela faz a mesma pergunta no WhatsApp, **Then** a resposta usa os dados da empresa dela e não inventa número, nome nem valor.
3. **Given** um pedido que grava ou altera dado e que no produto exige confirmação, **When** ela pede pelo WhatsApp, **Then** nada é gravado até a confirmação explícita, com a mesma regra do aplicativo.
4. **Given** a conta em estado restrito (consulta permitida, gravação não), **When** ela pede uma alteração, **Then** o assistente explica o limite e não grava; uma consulta permitida continua respondendo.

---

### User Story 2 - Só cadastro ativo entra (Priority: P1)

Quem não está cadastrado, quem foi desativado ou quem usa um celular que já não é o do cadastro não conversa com o assistente e não descobre informação do produto.

**Why this priority**: o chat é uma porta para dados da loja. Sem essa barragem, qualquer chip consulta o negócio.

**Independent Test**: enviar texto de um número que não está no cadastro, de um cadastro inativo e de um celular substituído no aplicativo; em nenhum caso há consulta, gravação ou texto que confirme que o número existe.

**Acceptance Scenarios**:

1. **Given** um número sem cadastro, **When** a pessoa manda mensagem, **Then** o sistema não consulta nem altera dado e a resposta não informa se o número está ou não cadastrado.
2. **Given** um cadastro inativo (pessoa removida ou conta desativada), **When** o celular antigo manda mensagem, **Then** o tratamento é o mesmo do número desconhecido.
3. **Given** Cláudia trocou o celular no aplicativo, **When** o número anterior manda mensagem, **Then** ele deixa de operar e o número novo, se ativo, passa a operar.
4. **Given** o celular de um funcionário ou de um cliente da loja, **When** essa pessoa manda mensagem ao número do produto, **Then** ela não opera o assistente da loja.

---

### User Story 3 - Reconhecer o celular com ou sem o 9 (Priority: P1)

O WhatsApp frequentemente entrega o celular brasileiro sem o nono dígito. Cláudia continua sendo a mesma pessoa se o cadastro tem `41 98888-8888` e a mensagem chega como `41 8888-8888`.

**Why this priority**: sem essa equivalência, a dona cadastrada é tratada como desconhecida e o canal não funciona no Brasil.

**Independent Test**: cadastrar `41988888888` (41 98888-8888), simular ou receber o mesmo celular como `4188888888` (41 8888-8888) e confirmar que a conversa é autorizada. Repetir no inverso, com espaços, traços e prefixo do Brasil (`55`).

**Acceptance Scenarios**:

1. **Given** o cadastro guarda o celular com o 9 depois do DDD, **When** a mensagem chega com o mesmo DDD e os mesmos oito dígitos finais sem o 9, **Then** os dois são a mesma pessoa e a conversa segue.
2. **Given** o cadastro guarda o celular sem máscara e a mensagem chega com espaços, traços ou parênteses, **When** se compara, **Then** só os dígitos contam e a pessoa é reconhecida.
3. **Given** a mensagem inclui o código do país `55` e o cadastro guarda só DDD e número (ou o contrário), **When** se compara, **Then** a pessoa ainda é reconhecida.
4. **Given** dois cadastros que só diferem pelo 9 inserido no lugar errado ou por outro DDD, **When** a mensagem chega, **Then** não há reconhecimento cruzado: só a forma canônica da mesma assinante autoriza.

---

### User Story 4 - A conversa obedece a empresa dela (Priority: P2)

Cláudia com mais de uma empresa fala, no WhatsApp, apenas pela primeira empresa ligada àquele celular. Dados de outra empresa não aparecem.

**Why this priority**: evita mistura de lojas; o seletor de empresa continua no aplicativo.

**Independent Test**: dona com duas empresas pergunta um dado que existe só na segunda; a resposta não traz esse dado. Um segundo cadastro não lê a primeira empresa.

**Acceptance Scenarios**:

1. **Given** o celular vinculado à primeira empresa de Cláudia, **When** ela pergunta ou pede um lançamento, **Then** tudo ocorre nessa empresa.
2. **Given** dado que existe só em outra empresa, **When** ela pergunta no WhatsApp, **Then** esse dado não aparece e nada é alterado lá.
3. **Given** outra lojista, **When** ela conversa do celular dela, **Then** não vê nem altera a empresa de Cláudia.

### Edge Cases

- Mensagem vazia ou só com espaços: nenhuma consulta nem gravação; se a pessoa for autorizada, o assistente pede um pedido em texto.
- O mesmo texto entregue duas vezes: consulta pode repetir a resposta; gravação não duplica venda, título ou cadastro.
- Número curto demais, com DDD ausente ou com quantidade de dígitos que não é celular brasileiro nem o formato internacional equivalente: tratado como não reconhecido, sem revelar cadastro.
- Celular fixo (oito dígitos locais sem ser móvel): não recebe o 9 inserido à força se isso o transformaria em outro número; sem correspondência exata após tirar máscara e código do país, não autoriza.
- Cláudia escreve de um celular e o cadastro está com o outro: não autoriza, mesmo que o nome seja o dela.
- Pedido ambíguo ou incompleto: o assistente pede o que falta e não inventa valor, data, produto nem cliente.
- Fora da janela em que o provedor aceita resposta livre: a lojista não fica sem explicação permanente; a fatia não exige mensagem de modelo.
- Linha de teste indisponível ou credencial ausente no ambiente: a conversa não é simulada como sucesso; o aceite real não passa.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST permitir que a dona do cadastro envie texto ao número do produto no WhatsApp e receba a resposta do assistente na mesma conversa.
- **FR-002**: O sistema MUST identificar a pessoa pelo número de quem enviou a mensagem, nunca pelo número da linha do produto.
- **FR-003**: O sistema MUST normalizar os dois lados antes de comparar: descartar máscara (espaços, traços, parênteses e sinal de mais), ignorar um prefixo de país `55` quando presente, e tratar como iguais o móvel brasileiro com e sem o nono dígito depois do DDD (exemplo: `4188888888` e `41988888888`).
- **FR-004**: O sistema MUST autorizar a conversa somente quando o número normalizado for o celular atual de um cadastro ativo cujo papel na empresa vinculada é o de dona.
- **FR-005**: Cadastro ativo, nesta fatia, MUST significar pessoa que concluiu o cadastro, não foi removida nem desativada, e cujo celular no cadastro ainda é o que enviou a mensagem. Troca de celular no aplicativo MUST revogar o número anterior na hora.
- **FR-006**: Número sem cadastro, cadastro inativo, papel que não é o de dona ou número que não casa após a normalização MUST NOT consultar nem alterar dado, e MUST NOT receber texto que confirme a existência do cadastro.
- **FR-007**: A conversa MUST usar as mesmas regras do aplicativo para consulta, registro, confirmação antes de gravar, recusa de dado incompleto e conta restrita (consulta segue; gravação não).
- **FR-008**: Toda consulta ou alteração MUST valer apenas para a empresa vinculada àquele celular (a primeira, quando houver mais de uma) e MUST NOT expor dado de outra empresa.
- **FR-009**: Reentrega da mesma mensagem MUST NOT duplicar uma gravação já confirmada.
- **FR-010**: O aceite MUST ser demonstrável na linha de teste de exibição +1 555 155-0338. Identificadores e segredo de acesso dessa linha MUST permanecer apenas na configuração do ambiente, nunca nesta especificação nem no repositório.

### Key Entities

- **Cadastro da dona**: pessoa com celular obrigatório, situação ativa ou inativa, e vínculo de dona com uma empresa. O celular atual é a credencial da conversa.
- **Empresa vinculada**: a empresa (a primeira, se houver várias) sobre a qual a conversa pode consultar e registrar.
- **Mensagem recebida**: texto, número de quem enviou (antes e depois da normalização) e o fato de ter sido autorizada ou ignorada.
- **Resposta do assistente**: texto devolvido na mesma conversa, ou silêncio sem vazamento quando a mensagem não é autorizada.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Numa prova na linha de teste, a dona com cadastro ativo envia um texto e vê a primeira resposta do assistente na mesma conversa em até 1 minuto, em condições normais da linha.
- **SC-002**: Em 100% dos casos de prova, o par com e sem o nono dígito (`4188888888` / `41988888888`), com ou sem máscara e com ou sem `55`, autoriza a mesma dona; um DDD diferente não autoriza.
- **SC-003**: Em 100% dos casos de prova, número sem cadastro, cadastro inativo e celular substituído não alteram dado e não recebem informação que confirme cadastro ou saldo.
- **SC-004**: Uma consulta já coberta pelo assistente no produto, repetida no WhatsApp pela mesma dona, devolve o mesmo fato de negócio (mesmo item, mesmo valor, mesma empresa).
- **SC-005**: Nenhuma gravação de prova ocorre sem a confirmação que o aplicativo já exige, e uma mensagem reentregue não cria um segundo registro.

## Assumptions

- Quem conversa é a dona do cadastro, não a equipe nem o cliente da loja. Isso já está decidido para o canal.
- "Ativo" não exige mensalidade em dia nesta fatia. Conta restrita por cobrança continua podendo consultar e não podendo gravar, como no aplicativo.
- O nono dígito só é inserido no móvel brasileiro de dez dígitos nacionais (DDD + oito dígitos), logo após o DDD. Não se insere 9 em número que já tem onze dígitos nacionais, nem em número que não seja do Brasil.
- A linha +1 555 155-0338 é o número do produto que recebe a conversa de teste. O celular que autoriza continua sendo o da dona cadastrada, em geral um celular brasileiro.
- Credenciais da linha de teste são configuradas no ambiente de quem for executar o aceite. Não são copiadas para documento, código ou histórico de versão.
- Foto, áudio e mensagem de modelo ficam fora do aceite. Texto é suficiente para provar a conversa.
- Janela em que o provedor recusa resposta livre não bloqueia o desenho: a dona recebe orientação de escrever de novo, sem a fatia precisar de modelo aprovado.
