# Feature Specification: Foto do código de barras por mensagem (NR-116)

**Feature Branch**: `feat/NR-116-foto-codigo-barras`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "a task — NR-116: o lojista manda a foto de um código de barras na conversa para não digitar no balcão. US-068, RF-137–139."

**Ledger**: [NR-116](../../docs/processo/task-ledger.md) — `agent`: foto do código de barras (SHOULD) (2 dias; dep. NR-060, NR-061 e NR-062 ✅).

**Fonte de verdade**: esta spec organiza o recorte já documentado para o fluxo Spec Kit. Em conflito, prevalecem a [constitution](../../.specify/memory/constitution.md), o [escopo do MVP](../../docs/produto/escopo-mvp.md), as histórias e os requisitos rastreáveis.

| Artefato permanente                                                                                                                            | Papel nesta spec                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [US-068](../../docs/produto/user-stories.md#us-068--usar-foto-do-código-de-barras) / [RF-137–139](../../docs/produto/requisitos-funcionais.md) | Jornada e recusas da foto do código                                       |
| [US-049](../../docs/produto/user-stories.md#us-049--lançar-venda-por-mensagem) / RF-100–102, RF-136                                            | Venda pela conversa, depois que o produto da foto é identificado          |
| [US-050](../../docs/produto/user-stories.md#us-050--confirmar-ação-sensível) / RF-103–104                                                      | Confirmação obrigatória antes de lançar a venda                           |
| [US-069](../../docs/produto/user-stories.md#us-069--cadastrar-produto-por-mensagem) / RF-140                                                   | Destino do pedido explícito de cadastro; execução completa fica na NR-117 |
| [US-009](../../docs/produto/user-stories.md#us-009--cadastrar-produto-com-código-de-barras) / RF-018                                           | Localizar produto existente pelo código lido — mesma regra do aplicativo  |
| Constitution — Princípios I e IV                                                                                                               | Mesmo caso de uso do app; isolamento absoluto por empresa                 |

## Clarifications

### Session 2026-09-18

- Q: Quando a Cláudia manda só a foto de um produto que já existe, e não diz como pagou, o que o assistente deve fazer? → A: Pergunta o que falta (pagamento). Com a forma clara nesta ou na próxima mensagem, aí sim pede confirmação da venda daquele produto. Não inventa pagamento e não esquece o produto que acabou de ler.
- Q: Depois dessa pergunta, se a próxima mensagem não for um pagamento, o que acontece com o produto da foto? → A: Solta o item da foto e atende o pedido novo (consulta, cadastro, outra foto, etc.). Não confirma venda antiga no silêncio.

## Escopo desta fatia

**Entra (NR-116):**

1. A lojista envia uma foto de código de barras na conversa; o assistente lê o código sem ela digitar.
2. Sem pedido de cadastro, código lido e produto existente: o assistente trata a foto como item de venda. Se faltar pagamento, pergunta; com a forma clara nesta ou na próxima mensagem, pede confirmação e só então grava.
3. Com pedido explícito de cadastro na mesma mensagem, código lido: o assistente trata a foto como cadastro, não como venda, e encaminha o código ao fluxo de cadastro por texto.
4. Foto ilegível, ou código lido sem produto e sem pedido de cadastro: recusa clara e orientação para vender ou cadastrar por texto. Não oferece item avulso e não pergunta se cadastra.

**Fora desta fatia:**

| Fora agora                                                                   | Onde                                 |
| ---------------------------------------------------------------------------- | ------------------------------------ |
| Completar o cadastro do produto (nome, custo, preço, confirmação e gravação) | NR-117 / US-069                      |
| Consultar estoque, contas a pagar ou fiado por nome                          | NR-115 / US-065–067                  |
| Lançar contas, baixar títulos, ajustar estoque, cancelar ou devolver         | NR-117–118                           |
| Canal WhatsApp de produção, mídia da Meta e vínculo do número da loja        | NR-113 / NR-046                      |
| Foto de produto para o catálogo, galeria ou identidade visual                | Fora do MVP                          |
| Leitor de código no aplicativo (câmera do PDV)                               | US-009 / US-014 (já entregue no app) |
| Busca semântica em conversas ou RAG                                          | NR-120                               |

**Definition of Done (merge):** nos harnesses de engenharia existentes, uma foto sem pedido de cadastro cujo código existe vira item da venda; se faltar pagamento, o assistente pergunta e só pede confirmação quando a forma estiver clara (nesta ou na próxima mensagem); uma foto com pedido explícito de cadastro não vira venda e entrega o código ao cadastro por texto; foto ilegível e código sem produto são recusados com orientação por texto, sem item avulso e sem convite a cadastrar; uma empresa nunca vê produto de outra; a foto em si não grava produto, venda nem cadastro sem passar pelos fluxos já existentes.

## User Scenarios & Testing _(mandatory)_

Persona: **Cláudia**, lojista e `owner`. O canal desta tarefa continua sendo o harness de engenharia; WhatsApp de produção não faz parte do aceite.

### User Story 1 - Vender a partir da foto, sem digitar o código (Priority: P1)

Cláudia fotografa o código no balcão e manda a imagem na conversa, sem pedir cadastro. O assistente lê o código, encontra o produto da loja e trata a mensagem como item de venda. Se ela não disser como pagou, ele pergunta — e não inventa Pix nem dinheiro. Com a forma de pagamento clara nesta ou na próxima mensagem, segue o fluxo já existente de lançar venda, inclusive a confirmação antes de gravar.

**Why this priority**: é o valor da história SHOULD — não digitar no balcão — e desbloqueia a foto como entrada da venda já existente.

**Independent Test**: enviar uma foto cujo código corresponde a um produto da empresa, sem pagamento; conferir o pedido do que falta. Em seguida informar a forma de pagamento e conferir que a confirmação é daquele produto, e que só lança depois do “sim”, com os mesmos dados que o aplicativo usaria.

**Acceptance Scenarios** (US-068 · RF-137 · RF-018 · US-049 · US-050):

1. **Given** uma foto sem pedido de cadastro, sem forma de pagamento, e um código lido cujo produto existe na empresa, **When** Cláudia envia só a foto, **Then** o assistente trata como item de venda daquele produto, pergunta a forma de pagamento e MUST NOT pedir confirmação ainda nem inventar pagamento.
2. **Given** o produto já identificado pela foto nesta ou na mensagem anterior, **When** Cláudia informa a forma de pagamento de modo inequívoco, **Then** o assistente pede confirmação da venda daquele produto (uma unidade, preço do cadastro) e só grava no “sim”.
3. **Given** a proposta de venda a partir da foto, **When** Cláudia confirma, **Then** a venda é a mesma do aplicativo para aquele produto; **When** recusa ou deixa expirar, **Then** nada é lançado.
4. **Given** o produto identificado pela foto, **When** ainda faltam cliente (fiado) ou quantidade além da unidade, **Then** o assistente pede o que falta e MUST NOT inventar cliente, preço, desconto ou pagamento.
5. **Given** que o assistente acabou de perguntar a forma de pagamento da foto, **When** Cláudia envia um pedido que não é pagamento, **Then** o item da foto é solto, o pedido novo é atendido e MUST NOT haver confirmação da venda anterior.

---

### User Story 2 - Recusar foto ilegível ou código sem produto (Priority: P1)

Quando a foto não dá para ler, ou o código não está no cadastro e Cláudia não pediu para cadastrar, o assistente recusa e pede venda ou cadastro **por texto**. Ele não improvisa item avulso e não pergunta se ela quer cadastrar.

**Why this priority**: o critério de aceite da história exige caminho de erro explícito; adivinhar produto ou oferecer cadastro espontâneo geraria lançamento errado no balcão.

**Independent Test**: enviar uma imagem que não contém código legível e outra cujo código não existe na empresa, ambas sem pedido de cadastro; conferir recusa, orientação por texto e ausência de venda, cadastro ou item avulso.

**Acceptance Scenarios** (US-068 · RF-139):

1. **Given** uma foto da qual o código não pode ser lido, **When** Cláudia envia, **Then** o assistente recusa a foto e pede para vender ou cadastrar por texto; nenhuma venda nem cadastro começa.
2. **Given** um código lido sem produto na empresa e sem pedido de cadastro na mensagem, **When** Cláudia envia a foto, **Then** o assistente recusa, pede descrição por texto, MUST NOT oferecer item avulso e MUST NOT perguntar se cadastra.
3. **Given** uma recusa destes dois tipos, **When** a conversa continua, **Then** estoque, cadastro e caixa permanecem inalterados.

---

### User Story 3 - Foto com pedido explícito de cadastro (Priority: P1)

Cláudia manda a foto e pede para cadastrar aquele código. O assistente lê o código e trata a mensagem como cadastro, não como venda. Completar nome, custo, preço e gravar o produto é o fluxo de cadastro por mensagem (NR-117); nesta fatia o código lido chega até esse fluxo e a venda não é aberta.

**Why this priority**: a história distingue os dois usos da mesma foto; tratar cadastro como venda silenciosa quebraria a intenção da lojista.

**Independent Test**: enviar foto com pedido explícito de cadastro cujo código é lido; conferir que não há proposta de venda e que o código fica disponível para o cadastro por texto, sem inventar nome, custo ou preço.

**Acceptance Scenarios** (US-068 · RF-138 · US-069):

1. **Given** uma foto cuja mensagem pede cadastro e o código é lido, **When** Cláudia envia, **Then** o assistente trata como cadastro de produto — não como item de venda — e encaminha o código ao fluxo de cadastro por texto.
2. **Given** esse pedido de cadastro, **When** o produto daquele código já existe na empresa, **Then** o assistente avisa o existente e MUST NOT lançar venda nem criar produto duplicado nesta fatia.
3. **Given** esse pedido de cadastro, **When** ainda faltam nome, custo ou preço, **Then** o assistente MUST NOT inventar esses dados nem gravar produto incompleto; a gravação completa permanece no cadastro por mensagem (NR-117).

### Edge Cases

- Foto sem texto acompanhante conta como **sem** pedido de cadastro e segue a história de venda: identifica o produto e, sem pagamento, pergunta a forma.
- A forma de pagamento pode vir **na mesma mensagem** da foto ou **na mensagem seguinte**; o assistente não esquece o produto que acabou de ler **enquanto essa mensagem seguinte for o pagamento**. Pagamento inequívoco nessa janela gera o pedido de confirmação, não a gravação direta.
- Se a mensagem seguinte **não** for um pagamento (consulta, cadastro, outra foto, outro produto, conversa nova), o item da foto é **solto**: o assistente atende o pedido novo e MUST NOT confirmar a venda antiga no silêncio.
- Pedido de cadastro precisa ser explícito na mensagem da foto (“cadastra”, “cadastrar este código” e equivalentes); intenção ambígua não vira cadastro sozinha.
- Mais de um código legível na mesma foto: o assistente recusa e pede uma foto (ou o texto) de um único produto; não escolhe um código sozinho.
- Quantidade omitida na venda pela foto é **uma unidade**; quantidade maior só entra se o texto da mesma conversa a informar, pelas regras já existentes da venda.
- A foto identifica o produto; preço, desconto, cliente e pagamento continuam as regras da venda por mensagem — a foto não altera cálculo nem permite pular confirmação.
- Empresa B nunca identifica produto pelo código da empresa A; código alheio é tratado como inexistente nesta empresa.
- Mensagem só de texto, sem foto, não entra nesta fatia: busca por nome ou código digitado permanece o comportamento já entregue.
- Várias fotos no mesmo envio: nesta fatia vale uma foto por vez; o assistente pede para reenviar um produto por mensagem.
- Falha ao ler a imagem (arquivo vazio, tipo não suportado, imagem corrompida) equivale a foto ilegível: recusa e orientação por texto.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST aceitar uma foto de código de barras na conversa e tentar ler o código, sem exigir que a lojista o digite. (US-068)
- **FR-002**: Sem pedido explícito de cadastro, com código lido e produto existente na empresa, o sistema MUST tratar a foto como item de venda daquele produto. Se a forma de pagamento não estiver clara, MUST perguntar e MUST NOT confirmar nem gravar. Com a forma inequívoca na mesma mensagem ou na seguinte, MUST pedir confirmação daquele produto e só gravar após o aceite. (RF-137, US-049, US-050)
- **FR-003**: A identificação do produto pelo código lido MUST usar a mesma regra e fonte de verdade do aplicativo ao localizar produto por código de barras. (RF-018, Constitution I)
- **FR-004**: Com pedido explícito de cadastro na mensagem da foto e código lido, o sistema MUST tratar a mensagem como cadastro de produto, MUST NOT abrir venda, e MUST encaminhar o código ao fluxo de cadastro por texto. (RF-138, US-069)
- **FR-005**: Quando a foto for ilegível, o sistema MUST recusar a foto e orientar venda ou cadastro por texto, sem iniciar venda nem cadastro. (RF-139)
- **FR-006**: Quando o código for lido, o produto não existir na empresa e a mensagem não pedir cadastro, o sistema MUST recusar, orientar descrição por texto, MUST NOT oferecer item avulso e MUST NOT perguntar se cadastra. (RF-139)
- **FR-007**: A foto MUST NOT criar item avulso, MUST NOT inventar produto, preço, custo, cliente ou pagamento, e MUST NOT gravar venda sem a confirmação já exigida para ação que mexe em valor.
- **FR-008**: Cada leitura e cada busca de produto MUST ser limitada à empresa da conversa. Código ou produto de outra empresa MUST parecer inexistente e nunca ser revelado. (Constitution IV)
- **FR-009**: A foto MUST servir só para obter o código nesta conversa. MUST NOT virar imagem de catálogo, MUST NOT ser enviada a terceiro e MUST NOT ser reapresentada como se fosse dado de outra empresa.
- **FR-010**: Quantidade omitida na venda pela foto MUST ser uma unidade. Quantidade maior só entra se informada na conversa, pelas regras da venda por mensagem.
- **FR-011**: Mais de um código legível na mesma foto, ou mais de uma foto no mesmo envio, MUST ser recusado com pedido de um produto por vez.
- **FR-012**: Pedido de cadastro MUST ser explícito. Foto sem texto ou com texto que só descreve a venda MUST seguir FR-002, não FR-004.
- **FR-013**: Testes automatizados MUST cobrir: foto só (produto existente → pede pagamento, sem confirmação); foto ou turno seguinte com forma de pagamento (confirmação daquele produto + “sim” grava); mensagem seguinte que não é pagamento (solta o item e atende o pedido novo); foto ilegível; código sem produto sem pedido de cadastro (recusa sem item avulso e sem convite a cadastrar); foto com pedido explícito de cadastro (não vira venda); produto já existente no pedido de cadastro; isolamento entre empresas.
- **FR-014**: Depois de identificar o produto pela foto, o sistema MUST reutilizar esse produto quando a forma de pagamento chegar na mensagem seguinte; MUST NOT exigir que a lojista reenvie a foto nem redigite o código. MUST NOT inventar pagamento, cliente ou desconto para pular essa pergunta. Se a mensagem seguinte não for um pagamento, MUST soltar o item da foto, atender o pedido novo e MUST NOT confirmar a venda anterior no silêncio.

### Key Entities

- **Foto do código**: imagem enviada na conversa cuja única função nesta fatia é revelar um código de barras.
- **Código lido**: identificador de produto obtido da foto (código de barras / EAN), válido só no contexto da empresa da conversa.
- **Pedido de cadastro**: intenção explícita na mensagem da foto de criar produto, distinta da intenção de vender.
- **Item de venda pela foto**: produto já cadastrado na empresa, identificado pelo código lido, candidato a entrar na venda por mensagem (uma unidade, salvo quantidade informada). Permanece só até a mensagem seguinte ser um pagamento; qualquer outro pedido o solta.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em 100% dos envios de foto sem pedido de cadastro e sem pagamento cujo código existe na empresa, o assistente identifica o produto e pergunta a forma de pagamento, sem confirmação e sem gravar. Em 100% dos casos em que a forma chega nesta ou na mensagem seguinte, a confirmação é daquele produto e a gravação só ocorre após o aceite. Em 100% dos casos em que a mensagem seguinte não é pagamento, o item da foto é solto, o pedido novo é atendido e nenhuma venda antiga é confirmada.
- **SC-002**: Em 100% das fotos ilegíveis, a lojista recebe recusa e convite a vender ou cadastrar por texto, sem venda nem cadastro iniciados.
- **SC-003**: Em 100% dos códigos lidos sem produto e sem pedido de cadastro, a recusa não oferece item avulso e não pergunta se cadastra.
- **SC-004**: Em 100% das fotos com pedido explícito de cadastro e código lido, o assistente não abre venda e o código fica disponível para o cadastro por texto.
- **SC-005**: Em 100% dos testes entre duas empresas, o código de uma nunca identifica o produto da outra.
- **SC-006**: Em 100% dos caminhos de recusa, estoque, cadastro e caixa permanecem inalterados.
- **SC-007**: Um desenvolvedor reproduz todos os cenários P1 nos harnesses de engenharia sem WhatsApp de produção, sem digitar o código nos casos em que a foto é legível.

## Assumptions

- NR-060, NR-061 e NR-062 já fornecem o laço de mensagens, a confirmação de ação sensível e a identidade isolada da conversa; esta tarefa adiciona a foto como entrada para identificar o produto.
- Localizar produto pelo código de barras já é a fonte de verdade do aplicativo (RF-018) e está disponível para reutilização; esta fatia não cria regra paralela de catálogo.
- Lançar a venda depois da identificação reutiliza o fluxo já existente de venda por mensagem (US-049) e a confirmação (US-050); a foto não redefine cálculo, desconto, pagamento, NFC-e nem item avulso.
- Completar o cadastro (nome, custo, preço, confirmação e gravação) é a NR-117 / US-069. Nesta fatia, o pedido explícito de cadastro só muda a rota: não vender, preservar o código lido, não inventar campos.
- Foto sem texto é venda em potencial, nunca cadastro espontâneo — alinhado ao critério “não pergunta se cadastra”. Sem pagamento, a pergunta é só a forma; o produto lido permanece **somente** se a mensagem seguinte for o pagamento. Outro pedido solta o item.
- O aceite desta SHOULD ocorre no harness de engenharia; receber a imagem pelo WhatsApp de produção é NR-046.
- Uma unidade é o padrão de um bipo no balcão quando a lojista não diz a quantidade.

## Dependencies & Out of Scope

**Dependências:** NR-060 ✅ (runtime e venda por mensagem); NR-061 ✅ (confirmação); NR-062 ✅ (contexto isolado por empresa); localização de produto por código de barras já existente no núcleo.

**Fora de escopo explícito:** gravar produto novo (NR-117); WhatsApp de produção e mídia da Meta (NR-113 / NR-046); foto como imagem de catálogo; leitor de câmera do aplicativo; consultas NR-115; RAG; novas regras de venda, preço ou estoque.
