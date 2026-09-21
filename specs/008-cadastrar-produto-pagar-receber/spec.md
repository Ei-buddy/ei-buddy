# Feature Specification: Cadastrar produto e lançar pagar/receber por mensagem (NR-117)

**Feature Branch**: `feat/NR-117-cadastrar-produto-pagar-receber`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "NR-117 — agent: cadastrar produto e lançar contas a pagar e recebíveis avulsos por mensagem. US-069–071, RF-140–142."

**Ledger**: [NR-117](../../docs/processo/task-ledger.md) — `agent`: cadastrar produto e lançar pagar/receber por mensagem (2 dias; dep. NR-060, NR-061 e NR-062 ✅).

**Fonte de verdade**: esta spec organiza o recorte já documentado para o fluxo Spec Kit. Em conflito, prevalecem a [constitution](../../.specify/memory/constitution.md), o [escopo do MVP](../../docs/produto/escopo-mvp.md), as histórias e os requisitos rastreáveis.

| Artefato permanente                                                                                                                                 | Papel nesta spec                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [US-069](../../docs/produto/user-stories.md#us-069--cadastrar-produto-por-mensagem) / [RF-140](../../docs/produto/requisitos-funcionais.md)         | Cadastro de produto pela conversa                             |
| [US-010](../../docs/produto/user-stories.md#us-010--definir-preço-e-custo) / RF-020–021                                                             | Custo, preço; recusa no schema se venda menor que custo (API) |
| [US-009](../../docs/produto/user-stories.md#us-009--cadastrar-produto-com-código-de-barras) / RF-017–019                                            | Código de barras, duplicidade e código interno                |
| [US-070](../../docs/produto/user-stories.md#us-070--lançar-conta-a-pagar-por-mensagem) / [RF-141](../../docs/produto/requisitos-funcionais.md)      | Lançamento de conta a pagar                                   |
| [US-026](../../docs/produto/user-stories.md#us-026--lançar-conta-a-pagar) / RF-055–056                                                              | Mesmas regras de título a pagar do aplicativo                 |
| [US-071](../../docs/produto/user-stories.md#us-071--lançar-recebimento-avulso-por-mensagem) / [RF-142](../../docs/produto/requisitos-funcionais.md) | Recebível avulso (fora de venda)                              |
| [US-031](../../docs/produto/user-stories.md#us-031--lançar-recebimento-avulso) / RF-065                                                             | Mesmas regras de recebível avulso do aplicativo               |
| [US-050](../../docs/produto/user-stories.md#us-050--confirmar-ação-sensível) / RF-103–104                                                           | Confirmação antes de gravar qualquer mutação                  |
| [US-068](../../docs/produto/user-stories.md#us-068--usar-foto-do-código-de-barras) / NR-116                                                         | Código lido na foto alimenta o cadastro quando pedido         |
| Constitution — Princípios I e IV                                                                                                                    | Mesmo caso de uso do app; isolamento absoluto por empresa     |

## Clarifications

### Session 2026-09-21

- Q: Preço de venda menor que o custo — avisar e deixar seguir ou recusar? → A: **Recusar** com a mesma validação do `createProductInputSchema` / `POST /produtos` (sem gravação; mensagem clara). Não relaxar só no agente.
- Q: Conta com vencimento no passado “nasce overdue”? → A: Título persiste `status: open`; aparece na **faixa vencidas** (`listPayables` / `list_payables`), como no app.
- Q: EAN duplicado — “reutilizar cadastro”? → A: **Avisar e não duplicar** (`AppError.conflict` / texto NR-116 na foto). Reutilizar (vender, editar) fica fora desta fatia — app ou outros fluxos.
- Q: Paridade com o aplicativo nos SC — só stubs? → A: Laço com stubs/FakeLlm obrigatório na CI; **1–2 testes integrados** API + Postgres opcionais no quickstart quando `DATABASE_URL` estiver disponível.

## Escopo desta fatia

**Entra (NR-117):**

1. A lojista cadastra um produto pela conversa (descrição, custo e preço de venda, e demais campos opcionais aceitos pelo aplicativo), com confirmação explícita antes de gravar.
2. Quando o cadastro inclui código de barras já existente na empresa, a lojista é avisada e **não** se cria duplicata; não há fluxo conversacional de “reutilizar” o produto nesta fatia.
3. Quando o preço de venda é menor que o custo, o assistente **recusa** com a mesma validação do aplicativo (`createProductInputSchema`); nada é gravado.
4. A lojista lança uma conta a pagar pela conversa (fornecedor, descrição, valor e vencimento), com confirmação; vencimento no passado grava título `open` e aparece na faixa **vencidas** ao consultar vencimentos.
5. A lojista lança um valor a receber avulso (não originado de venda), com cliente, descrição, valor e vencimento, com confirmação.
6. Dados obrigatórios incompletos: o assistente pede o que falta e **não** inventa valor, vencimento, fornecedor, cliente nem descrição.
7. As três mutações usam os mesmos casos de uso e validações do aplicativo, respeitando a empresa da conversa.

**Fora desta fatia:**

| Fora agora                                                                 | Onde                       |
| -------------------------------------------------------------------------- | -------------------------- |
| Baixar títulos, ajustar estoque, cancelar ou devolver venda                | NR-118 / US-072–075        |
| Consultar estoque, pagar ou fiado (somente leitura)                        | NR-115 / US-065–067        |
| Venda, cobrança a terceiro e cadastro de cliente                           | NR-060 / US-048–052        |
| Foto de código sem completar cadastro (só encaminha o código)              | NR-116 / US-068            |
| RAG como fonte de preço, saldo ou vencimento                               | NR-120                     |
| Canal WhatsApp de produção, webhook Meta e vínculo do número da loja       | NR-113 / NR-046            |
| Recorrência complexa além do que o aplicativo já suporta em contas a pagar | Fora se não existir no app |

**Definition of Done (merge):** nos harnesses de engenharia existentes, um cadastro de produto completo por texto invoca o mesmo caso de uso do aplicativo (stubs na CI; integração Postgres conforme quickstart); código duplicado não cria segundo produto; conta a pagar com data passada entra na faixa vencidas; recebível avulso grava pelos mesmos campos do app; mensagens com dados faltantes pedem esclarecimento e não gravam parcial; toda gravação exige confirmação explícita e recusa ou expiração não altera dados; uma empresa nunca altera cadastro ou título de outra; venda continua sendo o fluxo `create_sale`, não confundido com recebível avulso.

## User Scenarios & Testing _(mandatory)_

Persona: **Cláudia**, lojista e `owner`. O canal desta tarefa continua sendo o harness de engenharia; WhatsApp de produção não faz parte do aceite.

### User Story 1 - Cadastrar produto pela conversa (Priority: P1)

Cláudia descreve o produto que acabou de chegar — nome, custo e preço — e confirma. O item entra no catálogo com as mesmas regras do aplicativo, inclusive código de barras quando ela informar ou quando vier de um pedido de cadastro com foto (NR-116).

**Why this priority**: sem produto no cadastro, a venda por mensagem e a consulta de estoque ficam incompletas no balcão.

**Independent Test**: enviar um pedido de cadastro com descrição, custo e preço; confirmar; conferir que `registerProduct` foi chamado com os mesmos args do app (e, com Postgres no quickstart, que o produto existe). Repetir com código já cadastrado (conflito) e com preço abaixo do custo (recusa de schema).

**Acceptance Scenarios** (US-069 · RF-140 · RF-017–021):

1. **Given** descrição, custo e preço de venda informados de forma inequívoca, **When** Cláudia confirma, **Then** o produto é criado pelo mesmo caso de uso do aplicativo e a resposta confirma o cadastro (incluindo identificação legível, ex. código interno).
2. **Given** um código de barras já cadastrado na empresa, **When** Cláudia tenta cadastrar de novo com esse código, **Then** é avisada do existente e MUST NOT criar duplicata; não há atalho conversacional para “usar o produto existente” nesta fatia.
3. **Given** preço de venda menor que o custo, **When** Cláudia envia os valores, **Then** a validação do aplicativo recusa antes de gravar (mensagem clara); MUST NOT haver proposta de confirmação com valores inválidos nem gravação após `sim`.
4. **Given** pedido de cadastro com foto e código lido (NR-116), **When** Cláudia informa nome, custo e preço e confirma, **Then** o produto é criado com aquele código; **When** faltam custo ou preço, **Then** o assistente pede o que falta e MUST NOT inventar nem gravar incompleto.
5. **Given** uma proposta de cadastro pendente, **When** Cláudia responde de forma ambígua ou após expiração, **Then** conta como recusa e nenhum produto é criado (RF-104).

---

### User Story 2 - Lançar conta a pagar pela conversa (Priority: P1)

Cláudia registra uma despesa que não pode esquecer — aluguel, fornecedor, valor e dia de vencimento — e confirma. A conta aparece nas visões do aplicativo com o status de vencimento correto.

**Why this priority**: contas a pagar são controle de caixa SHOULD do MVP e complementam a consulta já entregue (NR-115).

**Independent Test**: lançar “aluguel 1800 vence dia 10” com confirmação; conferir título no app. Repetir com vencimento no passado e com mensagem incompleta.

**Acceptance Scenarios** (US-070 · RF-141 · RF-055–056):

1. **Given** fornecedor, descrição, valor e vencimento informados, **When** Cláudia confirma, **Then** a conta a pagar é criada pelo mesmo caso de uso da [US-026](../../docs/produto/user-stories.md#us-026--lançar-conta-a-pagar).
2. **Given** vencimento no passado, **When** Cláudia confirma, **Then** o título é criado com `status: open` e aparece na faixa **vencidas** ao consultar contas a pagar (mesma regra do aplicativo).
3. **Given** dados obrigatórios ausentes (valor, vencimento, fornecedor ou descrição), **When** Cláudia envia o pedido, **Then** o assistente pede o que falta e MUST NOT inventar valor nem data.
4. **Given** recorrência suportada pelo aplicativo para contas a pagar, **When** Cláudia pede repetição e confirma, **Then** nascem os títulos previstos pelo caso de uso (a resposta deixa claro quantos títulos foram criados quando for mais de um).
5. **Given** proposta pendente, **When** Cláudia recusa ou a confirmação expira, **Then** nenhuma conta é lançada.

---

### User Story 3 - Lançar recebimento avulso pela conversa (Priority: P1)

Cláudia registra um valor a receber que não veio de venda — aluguel de vitrine, serviço avulso — com cliente, valor e vencimento, e confirma.

**Why this priority**: fecha o par financeiro com contas a pagar e evita misturar com o fluxo de venda.

**Independent Test**: enviar “a receber 500 do João na sexta, aluguel da vitrine”; confirmar; conferir recebível no app. Tentar pedido sem cliente ou sem valor.

**Acceptance Scenarios** (US-071 · RF-142 · RF-065):

1. **Given** cliente identificado, descrição, valor e vencimento, **When** Cláudia confirma, **Then** o recebível avulso é criado pelo mesmo caso de uso da [US-031](../../docs/produto/user-stories.md#us-031--lançar-recebimento-avulso).
2. **Given** pedido que descreve uma **venda** de produtos, **When** Cláudia envia, **Then** o assistente MUST NOT usar o fluxo de recebível avulso; a venda permanece no fluxo de venda existente.
3. **Given** dados obrigatórios incompletos, **When** Cláudia envia, **Then** o assistente pede o que falta e MUST NOT criar lançamento parcial.
4. **Given** nome de cliente ambíguo, **When** Cláudia pede o recebível, **Then** o assistente pede escolha ou identificação, alinhado às regras de cadastro/consulta de cliente — MUST NOT associar valor ao cliente errado.
5. **Given** proposta pendente, **When** Cláudia recusa ou expira, **Then** nenhum recebível é criado.

### Edge Cases

- Campos opcionais do produto (estoque inicial, categoria, fornecedor texto, unidade de medida) seguem o aplicativo: omitidos usam default do caso de uso; o assistente não inventa NCM/CFOP/CST se a lojista não pedir classificação fiscal.
- Valores monetários na mensagem são interpretados para centavos pelo mesmo contrato do app; o assistente não arredonda nem calcula margem — só repete o que o núcleo validou na proposta de confirmação.
- “Lançar pagar” e “conta a pagar” são o mesmo fluxo; “a receber” sem itens de venda é recebível avulso.
- Cliente pode ser referido por nome; resolução ambígua segue o mesmo padrão das outras tools (listar opções, não escolher sozinho).
- Empresa B nunca cria produto ou título visível na empresa A; identificadores alheios são tratados como inexistentes.
- Confirmação pendente de cadastro não é reutilizada para lançar conta nem recebível (e vice-versa); cada mutação tem sua própria proposta.
- Falha do caso de uso após confirmação produz mensagem clara de erro; não há gravação parcial nem segunda confirmação automática.
- Papel sem permissão de escrita no aplicativo recebe a mesma recusa do núcleo, não uma gravação pelo canal da conversa.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: O sistema MUST reconhecer pedidos de cadastro de produto, lançamento de conta a pagar e lançamento de recebível avulso na conversa. (US-069–071, RF-140–142)
- **FR-002**: O cadastro de produto MUST usar o mesmo caso de uso e validações do aplicativo, incluindo descrição, custo e preço obrigatórios. (US-069, RF-140, RF-017–020)
- **FR-003**: Para código de barras já cadastrado, o sistema MUST avisar e MUST NOT criar segundo produto com o mesmo código. (US-069, RF-018)
- **FR-004**: Para preço de venda menor que custo, o sistema MUST recusar com a mesma validação do aplicativo (`createProductInputSchema`) e MUST NOT gravar. (US-069, RF-020)
- **FR-005**: O lançamento de conta a pagar MUST usar o mesmo caso de uso do aplicativo, com fornecedor, descrição, valor e vencimento. (US-070, RF-141, RF-055–056)
- **FR-006**: Conta a pagar com vencimento no passado MUST ser criada como no aplicativo e MUST aparecer na faixa vencidas ao consultar vencimentos (`list_payables` / visão equivalente). (US-070)
- **FR-007**: O recebível avulso MUST usar o mesmo caso de uso do aplicativo e MUST NOT substituir ou duplicar o fluxo de venda. (US-071, RF-142, RF-065)
- **FR-008**: Para qualquer campo obrigatório ausente ou ambíguo, o sistema MUST pedir esclarecimento e MUST NOT inventar valor, data, fornecedor, cliente ou descrição. (US-070–071)
- **FR-009**: Toda mutação desta fatia MUST exigir confirmação explícita antes de gravar; resposta ambígua ou expirada MUST contar como recusa. (US-050, RF-103–104)
- **FR-010**: Cada operação MUST ser limitada à empresa da conversa; dado ou título de outra empresa MUST parecer inexistente. (Constitution IV)
- **FR-011**: O assistente MUST NOT calcular totais, margens, impostos ou parcelas; números na confirmação e na resposta vêm do núcleo determinístico. (Constitution — agente)
- **FR-012**: Testes automatizados MUST cobrir cadastro feliz, código duplicado, recusa de preço abaixo do custo, conta a pagar (incl. faixa vencidas), recebível avulso (incl. cliente ambíguo), recorrência quando suportada, dados incompletos, recusa/expiração, falha pós-confirmação, papel sem escrita, pendências não cruzadas e isolamento entre empresas.

### Key Entities

- **Produto cadastrado**: item da empresa com descrição, custo, preço de venda e identificadores (interno e opcionalmente código de barras).
- **Conta a pagar**: título de saída com fornecedor, descrição, valor, vencimento e status persistido (`open`, etc.); “vencida” na conversa refere-se à faixa de vencimentos.
- **Recebível avulso**: valor a receber não ligado a uma venda, associado a cliente, com descrição, valor e vencimento.
- **Proposta de confirmação**: resumo legível da mutação pendente, com expiração, independente por tipo de ação.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Em 100% dos cenários de cadastro confirmado com dados completos, o caso de uso recebe descrição, custo, preço e código informados; com integração Postgres do quickstart, o produto persistido coincide com esses valores.
- **SC-002**: Em 100% dos cenários de código duplicado, nenhum segundo produto com o mesmo EAN é criado.
- **SC-003**: Em 100% dos cenários de conta a pagar confirmada, o título coincide com valor e vencimento; quando a data é passada, a consulta de vencimentos inclui o título na faixa vencidas.
- **SC-004**: Em 100% dos cenários de recebível avulso confirmado, o título no aplicativo coincide com cliente, valor e vencimento; em 100% dos pedidos claramente de venda, o fluxo de venda é usado em vez de recebível avulso.
- **SC-005**: Em 100% dos cenários com dados obrigatórios faltando, nenhuma gravação ocorre até a lojista completar e confirmar.
- **SC-006**: Em 100% dos testes de recusa ou expiração, estoque, catálogo e títulos permanecem inalterados.
- **SC-007**: Em 100% dos testes entre duas empresas, nenhuma mutação afeta a outra empresa.
- **SC-008**: Um desenvolvedor reproduz todos os cenários P1 nos harnesses de engenharia sem WhatsApp de produção.

## Assumptions

- NR-060, NR-061 e NR-062 já fornecem laço de mensagens, confirmação persistente e memória da conversa; esta tarefa adiciona três tools de mutação (ou completa o laço conversacional até elas).
- Os casos de uso `registerProduct`, criação de conta a pagar e criação de recebível avulso já existem no núcleo e são reutilizados sem regra paralela.
- Unidade de medida e estoque inicial seguem defaults do contrato compartilhado quando a lojista não menciona.
- Integração com código de barras por foto limita-se a reutilizar o código lido na NR-116; não reabre decode nem visão.
- CI principal usa stubs/FakeLlm; paridade persistida opcional via 1–2 testes em `apps/api` com Postgres (quickstart).
- Baixas, ajustes de estoque e cancelamento de venda pertencem à NR-118, mesmo que ferramentas relacionadas existam em protótipo.

## Dependencies & Out of Scope

**Dependências:** NR-060 ✅ (runtime e catálogo base); NR-061 ✅ (confirmação); NR-062 ✅ (contexto); NR-116 ✅ (handoff de código na foto com pedido de cadastro); casos de uso de cadastro de produto e financeiro no núcleo.

**Fora de escopo explícito:** baixas e estornos; ajuste de estoque; cancelar/devolver venda; consultas somente leitura; venda e cobrança; RAG; WhatsApp Meta de produção; novas regras fiscais ou calendário além do aplicativo.
