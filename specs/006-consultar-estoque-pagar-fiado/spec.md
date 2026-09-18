# Feature Specification: Consultar estoque, pagar e fiado por mensagem (NR-115)

**Feature Branch**: `feat/NR-115-consultar-estoque-pagar-fiado`

**Created**: 2026-09-18

**Status**: Draft

**Input**: User description: "NR-115 — agent: consultar estoque, contas a pagar e saldo em carteira (fiado) por mensagem. US-065–067, RF-133–135."

**Ledger**: [NR-115](../../docs/processo/task-ledger.md) — `agent`: consultar estoque, a pagar e fiado por mensagem (2 dias; dep. NR-060, NR-061 e NR-062 ✅).

**Fonte de verdade**: esta spec organiza o recorte já documentado para o fluxo Spec Kit. Em conflito, prevalecem a [constitution](../../.specify/memory/constitution.md), o [escopo do MVP](../../docs/produto/escopo-mvp.md), as histórias e os requisitos rastreáveis.

| Artefato permanente                                                                                                                                   | Papel nesta spec                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [US-065](../../docs/produto/user-stories.md#us-065--consultar-estoque-por-mensagem) / [RF-133](../../docs/produto/requisitos-funcionais.md)           | Consulta de estoque por mensagem                                   |
| [US-066](../../docs/produto/user-stories.md#us-066--consultar-contas-a-pagar-por-mensagem) / [RF-134](../../docs/produto/requisitos-funcionais.md)    | Consulta de contas a pagar por vencimento                          |
| [US-067](../../docs/produto/user-stories.md#us-067--consultar-saldo-em-carteira-por-mensagem) / [RF-135](../../docs/produto/requisitos-funcionais.md) | Consulta de saldo devedor do cliente                               |
| [US-011](../../docs/produto/user-stories.md#us-011--consultar-estoque) / RF-022                                                                       | Fonte e apresentação do saldo, preço, localização e “sem controle” |
| [US-029](../../docs/produto/user-stories.md#us-029--ver-contas-a-vencer) / RF-061–062                                                                 | Agrupamento e destaque de vencimentos                              |
| [US-007](../../docs/produto/user-stories.md#us-007--saldo-em-carteira-fiado) / RF-013–014                                                             | Saldo em carteira como fonte do fiado                              |
| Constitution — Princípios I e IV                                                                                                                      | Mesmo caso de uso do app; isolamento absoluto por empresa          |

## Escopo desta fatia

**Entra (NR-115):**

1. A lojista consulta, por mensagem, o saldo de um produto e recebe saldo, preço e localização; produto sem controle de estoque é explicitamente identificado.
2. A lojista pergunta o que vence e recebe contas vencidas, de hoje, da semana e do mês, com os totais de cada grupo.
3. A lojista pergunta quanto um cliente deve e recebe o saldo em carteira, inclusive confirmação explícita quando o saldo é zero.
4. As três consultas usam a mesma fonte de verdade e as mesmas regras do aplicativo, respeitando a empresa da conversa.
5. Consultas são informativas: não criam, alteram, baixam, enviam nem exigem confirmação.

**Fora desta fatia:**

| Fora agora                                                           | Onde                     |
| -------------------------------------------------------------------- | ------------------------ |
| Cadastro de produto quando a busca não o encontra                    | NR-117 / US-069          |
| Foto de código de barras                                             | NR-116 / US-068          |
| Lançar contas, baixar títulos, ajustar estoque, cancelar ou devolver | NR-117–118               |
| Enviar cobrança ou qualquer mensagem a terceiro                      | NR-060 / NR-061 e NR-046 |
| Canal WhatsApp de produção e vínculo do número da loja               | NR-113 / NR-046          |
| Busca semântica em conversas ou RAG como fonte de números            | NR-120                   |

**Definition of Done (merge):** nos harnesses de engenharia existentes, uma consulta de estoque devolve saldo, preço e localização ou “sem controle”; uma consulta de contas a pagar devolve os quatro grupos com totais ou declara que não há vencimentos; uma consulta de fiado devolve o saldo correto, inclusive zero; nome ambíguo não é escolhido silenciosamente; uma empresa nunca vê resultado de outra; as consultas não produzem efeito de negócio nem pedem confirmação.

## User Scenarios & Testing _(mandatory)_

Persona: **Cláudia**, lojista e `owner`. O canal desta tarefa continua sendo o harness de engenharia; WhatsApp de produção não faz parte do aceite.

### User Story 1 - Consultar estoque sem sair da conversa (Priority: P1)

Cláudia pergunta quanto tem de um produto para responder ao cliente no balcão. Ela recebe o saldo, o preço e a localização que veria no aplicativo. Se o produto não controla estoque, recebe essa informação em vez de saldo zero.

**Why this priority**: estoque é uma consulta MUST do MVP e evita que a lojista abandone a conversa no meio do atendimento.

**Independent Test**: enviar uma pergunta com um produto existente e conferir que os dados coincidem com a consulta correspondente no aplicativo.

**Acceptance Scenarios** (US-065 · RF-133 · RF-022):

1. **Given** um produto encontrado que controla estoque, **When** Cláudia pergunta seu nome ou “quanto tem de [produto]?”, **Then** recebe saldo, preço e localização corretos.
2. **Given** um produto encontrado sem controle de estoque, **When** Cláudia o consulta, **Then** recebe “sem controle de estoque”, e não saldo zero.
3. **Given** que nenhum produto corresponde à busca, **When** Cláudia consulta, **Then** é avisada de que não o encontrou e pode optar por cadastrá-lo por texto em fluxo futuro; esta consulta não abre nem executa cadastro.

---

### User Story 2 - Ver contas a pagar por vencimento (Priority: P1)

Cláudia pergunta o que vence para organizar o caixa. Ela recebe uma visão clara das contas vencidas, de hoje, da semana e do mês, com o total em cada grupo. Se não houver contas no período, a conversa diz isso explicitamente.

**Why this priority**: antecipar vencimentos é consulta MUST do MVP e evita atraso por falta de visibilidade.

**Independent Test**: preparar contas em cada faixa de vencimento, enviar “o que vence essa semana?” e conferir grupos, totais e destaque das vencidas contra a visão do aplicativo.

**Acceptance Scenarios** (US-066 · RF-134 · RF-061–062):

1. **Given** contas abertas em faixas distintas, **When** Cláudia pergunta o que vence, **Then** recebe vencidas, hoje, semana e mês, cada grupo com seu total.
2. **Given** contas vencidas, **When** Cláudia consulta os vencimentos, **Then** elas aparecem com destaque antes das demais.
3. **Given** nenhuma conta a pagar no período consultado, **When** Cláudia pergunta o que vence, **Then** recebe confirmação explícita de que não há vencimentos.

---

### User Story 3 - Consultar o fiado de um cliente (Priority: P1)

Cláudia pergunta quanto um cliente está devendo antes de vender novamente. A conversa informa o saldo em carteira. Um cliente sem dívida recebe confirmação clara de saldo zerado. Se mais de um cliente corresponder ao nome, Cláudia escolhe qual deles quer consultar.

**Why this priority**: o fiado é financeiro e uma escolha errada de cliente pode levar a uma venda indevida.

**Independent Test**: consultar um cliente com dívida, outro com saldo zero e um nome que corresponda a mais de um cadastro; conferir que o resultado ou a desambiguação coincide com os dados da empresa.

**Acceptance Scenarios** (US-067 · RF-135 · RF-013–014):

1. **Given** um cliente com saldo devedor, **When** Cláudia pergunta quanto ele deve, **Then** recebe o saldo em carteira correto.
2. **Given** um cliente sem saldo devedor, **When** Cláudia consulta o fiado, **Then** recebe confirmação explícita de saldo zerado.
3. **Given** dois ou mais clientes que correspondem ao nome informado, **When** Cláudia consulta o fiado, **Then** o assistente lista opções para escolha e não seleciona um cliente sozinho.
4. **Given** nenhum cliente correspondente na empresa, **When** Cláudia consulta o fiado, **Then** é avisada de que o cliente não foi encontrado e nenhum saldo é inventado.

### Edge Cases

- Uma pergunta que mistura mais de uma consulta pede que a lojista escolha uma consulta por vez nesta fatia; respostas não combinam dados de entidades diferentes.
- Se a pergunta não indicar produto ou cliente de forma suficiente, o assistente pede o nome ou outra identificação; não escolhe por aproximação insegura.
- Dados ausentes de saldo, preço ou localização são apresentados como indisponíveis, sem fabricar valores.
- Empresa B nunca recebe produto, conta ou saldo de cliente da empresa A; resultado alheio é tratado como inexistente.
- Falha ao obter os dados produz uma resposta clara de indisponibilidade, sem mostrar dado parcial ou antigo como se fosse atual.
- Consultar não cria confirmação pendente e não altera estoque, títulos, saldo em carteira ou cadastro.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST reconhecer e atender pedidos de consulta de estoque, contas a pagar por vencimento e saldo em carteira de cliente na conversa. (US-065–067, RF-133–135)
- **FR-002**: A consulta de estoque MUST retornar o saldo, o preço e a localização do produto encontrado usando a mesma regra e fonte de verdade da consulta do aplicativo. (US-065, RF-133, RF-022)
- **FR-003**: Para produto sem controle de estoque, a consulta MUST informar explicitamente “sem controle de estoque” e MUST NOT apresentar zero como saldo. (US-065, RF-022)
- **FR-004**: Para produto não encontrado, a consulta MUST informar a ausência e MUST NOT criar, alterar ou simular cadastro de produto. (US-065)
- **FR-005**: A consulta de contas a pagar MUST apresentar contas abertas agrupadas em vencidas, hoje, semana e mês, com o total de cada grupo, usando a mesma regra do aplicativo. (US-066, RF-134, RF-061–062)
- **FR-006**: Contas vencidas MUST receber destaque claro na resposta de vencimentos. (US-066, RF-062)
- **FR-007**: Quando não houver contas a pagar no período consultado, o sistema MUST responder explicitamente que não há vencimentos. (US-066)
- **FR-008**: A consulta de fiado MUST retornar o saldo em carteira do cliente identificado usando a mesma regra e fonte de verdade do aplicativo. (US-067, RF-135, RF-013–014)
- **FR-009**: Para cliente sem saldo devedor, a consulta MUST declarar explicitamente saldo zerado. (US-067)
- **FR-010**: Para nome de cliente ambíguo, o sistema MUST listar alternativas suficientes para escolha e MUST NOT selecionar um cliente sozinho. (US-067)
- **FR-011**: Para produto ou cliente sem identificação inequívoca, o sistema MUST pedir esclarecimento ou informar ausência; MUST NOT inventar entidade, saldo, preço, localização ou vencimento.
- **FR-012**: Cada consulta MUST ser limitada à empresa da conversa. Dado de outra empresa MUST parecer inexistente e nunca ser revelado. (Constitution IV)
- **FR-013**: As consultas MUST ser somente leitura: MUST NOT criar confirmação pendente, nem alterar estoque, títulos, saldo em carteira, cadastros ou comunicações a terceiros. (Constitution — Produto)
- **FR-014**: O sistema MUST manter a equivalência entre aplicativo e conversa: a conversa chama o mesmo caso de uso e aplica as mesmas validações do aplicativo, sem regra de negócio paralela. (Constitution I)
- **FR-015**: Testes automatizados MUST cobrir produto controlado, produto sem controle, produto ausente, os quatro grupos de vencimento, ausência de vencimentos, fiado devedor, saldo zero, nome ambíguo, isolamento entre empresas e ausência de efeitos de escrita.

### Key Entities

- **Produto consultado**: item identificado na empresa, com preço, localização e situação de controle de estoque.
- **Visão de vencimentos**: contas a pagar abertas agrupadas por prazo — vencidas, hoje, semana e mês — e seus totais.
- **Saldo em carteira**: valor devedor associado a um cliente da empresa, usado para representar o fiado.
- **Consulta por mensagem**: pedido somente de leitura, ligado à identidade da conversa e à empresa que a possui.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em 100% dos cenários de produto encontrado, a resposta contém saldo, preço e localização que coincidem com a consulta do aplicativo.
- **SC-002**: Em 100% dos cenários de produto sem controle ou não encontrado, a resposta informa a condição correta e não apresenta saldo enganoso.
- **SC-003**: Em 100% dos cenários com contas abertas, a resposta contém os grupos vencidas, hoje, semana e mês e os totais corretos; em 100% dos cenários vazios, declara não haver vencimentos.
- **SC-004**: Em 100% dos cenários de cliente identificado, a resposta mostra o saldo em carteira correto, inclusive zero; em 100% dos nomes ambíguos, não escolhe um cliente sem confirmação da lojista.
- **SC-005**: Em 100% dos testes entre duas empresas, nenhuma consulta retorna dado da outra empresa.
- **SC-006**: Em 100% dos testes de consulta, não há alteração de estoque, título, saldo em carteira, cadastro, confirmação pendente ou mensagem a terceiro.
- **SC-007**: Um desenvolvedor reproduz todos os cenários P1 nos harnesses de engenharia sem WhatsApp de produção.

## Assumptions

- NR-060, NR-061 e NR-062 já fornecem o laço de mensagens, a proteção de ações sensíveis e a identidade isolada da conversa; esta tarefa adiciona apenas consultas dedicadas.
- Os casos de uso de estoque, vencimentos e saldo em carteira já são as fontes de verdade do aplicativo e estão disponíveis para reutilização.
- “Semana” e “mês” mantêm a mesma definição da visão de contas a pagar existente; esta tarefa não cria novos filtros de calendário.
- A consulta de produto usa o nome informado na mensagem; código de barras por imagem é escopo da NR-116.
- Cadastro após produto ausente é somente uma orientação ao próximo fluxo; executar o cadastro pertence à NR-117.

## Dependencies & Out of Scope

**Dependências:** NR-060 ✅ (runtime e ferramentas base); NR-061 ✅ (confirmação de ações sensíveis); NR-062 ✅ (contexto isolado por empresa); casos de uso existentes de estoque, contas a pagar e carteira.

**Fora de escopo explícito:** mutações de estoque, contas ou carteira; cadastro de produto; foto de código; envio de cobrança; RAG; WhatsApp de produção; novas regras financeiras ou novas definições de calendário.
