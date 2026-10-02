# Feature Specification: Assistente servido sempre pela OpenAI

**Feature Branch**: `feat/melhorias-agente-ia`

**Created**: 2026-10-01

**Status**: Draft

**Input**: Decisões fechadas em 2026-10-01. O processo que responde mensagem usa a OpenAI. A CI prova o laço com decisão escrita no teste. O reconhecedor por regex sai.

**Ledger**: sem NR nova. Revisão parcial da [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md): a consequência “modo falso obrigatório no local” deixa de valer. O runtime, o modelo inicial e “tools + `domain` calculam” permanecem.

**Fonte de verdade**: esta spec registra o recorte fechado antes do plano. Em conflito, prevalecem a [constitution](../../.specify/memory/constitution.md), a ADR-0010 revisada e os IDs `RF` / `RNF` já entregues nas fatias NR-060 a NR-121.

| Artefato permanente                                                                          | Papel nesta spec                                                            |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [ADR-0010](../../docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md)                             | Runtime Mastra e `gpt-4o-mini`. Esta fatia revisa só o modo local sem chave |
| [RNF-010](../../docs/produto/requisitos-nao-funcionais.md)                                   | Provedor ausente não derruba o resto da API                                 |
| [RNF-067](../../docs/produto/requisitos-nao-funcionais.md) / constitution V                  | Porta com adaptador falso na CI; adaptador real fora do merge               |
| [NR-116](../../docs/processo/task-ledger.md) / [spec 007](../007-foto-codigo-barras/spec.md) | Foto continua fora do modelo                                                |
| [NR-121](../../docs/processo/task-ledger.md) / [spec 003](../003-studio-harness/spec.md)     | Studio continua; o relé não interpreta                                      |

## Clarifications

### Session 2026-10-01

- Q: A CI também chama a OpenAI? → A: Não. O processo que serve mensagem usa a OpenAI. A CI fica sem rede. O dublê só aceita decisão escrita com `script()`. O regex sai. `AGENT_PROVIDER` deixa de ser modo do servidor.
- Q: Sem `OPENAI_API_KEY`, a API recusa subir? → A: Não. A API sobe. O assistente fica indisponível até a chave existir. Com a chave, o único provedor montado é o Mastra.
- Q: O painel do Studio sai? → A: Não. Com a chave, cada turno gasta uma chamada, dentro de `processMessage`. O relé só encaminha o texto. Sem a chave, o Studio não monta.
- Q: As duas cópias de cada tool se fundem? → A: Não. O Mastra continua só escolhendo a tool (`execute` devolve os argumentos, `maxSteps: 1`). Confirmação e gravação ficam no `processMessage` e no catálogo.
- Q: A foto vai para o modelo ler o código de barras? → A: Não. O `FakeBarcodeDecoder` permanece. Um leitor de barras local fica para outro recorte.

## Escopo desta fatia

**Entra:**

1. Quem responde mensagem (HTTP do harness, Studio e webhook) usa o Mastra com a OpenAI quando a chave existe.
2. Sem chave, a API sobe e as rotas do assistente respondem indisponível. Venda, estoque e login seguem.
3. O reconhecedor de frases em português sai. Mutação, consulta e recusa deixam de ser regex.
4. O dublê de teste permanece, só com `script()`. A CI não chama a OpenAI.
5. Revisão parcial da ADR-0010 e dos textos que ainda dizem que o local sobe no falso.

**Fora desta fatia:**

| Fora agora                                                | Onde                                         |
| --------------------------------------------------------- | -------------------------------------------- |
| Fundir o `generate` do Mastra com o `execute` do catálogo | ADR-0010; confirmação é máquina nossa        |
| Leitor de barras de imagem, e mandar a foto à OpenAI      | Outro recorte; NR-116 permanece no dublê     |
| `WHATSAPP_PROVIDER=fake` e o aceite no chip               | [NR-046](../../docs/processo/task-ledger.md) |
| Abrir o assistente em produção sem `AGENT_HARNESS`        | FR-001b, já no porteiro                      |
| Trocar `gpt-4o-mini`, o RAG por trigrama ou o teto de IA  | ADR-0010, ADR-0017, RNF-072 / RNF-073        |
| Provar na CI que uma frase solta escolhe a tool certa     | Smoke manual com chave, fora do merge        |

## User Scenarios & Testing

### User Story 1 - Assistente local fala com a OpenAI (Priority: P1)

Com `OPENAI_API_KEY` no ambiente e fora de produção, uma mensagem no harness ou no Studio é interpretada pelo modelo. Não existe interruptor `fake` no servidor.

**Independent Test**: subir a API com a chave, enviar uma consulta pelo `POST /agent/messages` e ver uma tool do catálogo na resposta. Sem a variável `AGENT_PROVIDER`.

**Acceptance Scenarios**:

1. **Given** a chave definida e `NODE_ENV` diferente de `production`, **When** o processo sobe, **Then** o runtime do assistente é o Mastra e nenhuma frase é interpretada por regex.
2. **Given** a chave definida, **When** o lojista de fixture pede uma ação que grava valor, **Then** a proposta pede confirmação e o caso de uso só roda no "sim".

### User Story 2 - Sem chave o ERP continua (Priority: P1)

**Independent Test**: subir a API sem `OPENAI_API_KEY`. Login e uma rota que não é do assistente respondem. `POST /agent/messages` responde 503 `UNAVAILABLE`. O Studio não monta.

**Acceptance Scenarios**:

1. **Given** a chave ausente, **When** o processo sobe, **Then** a API escuta e o assistente fica indisponível, com motivo explícito.
2. **Given** a chave ausente, **When** alguém abre o painel do Studio, **Then** `/api/agents` não lista o harness.

### User Story 3 - O merge não chama a OpenAI (Priority: P1)

**Independent Test**: a suíte de `agent` e da rota do assistente passa sem `OPENAI_API_KEY` e sem rede. Um teste que precisa de uma tool chama `script()` com a decisão. Uma frase sem roteiro devolve `unknown`.

**Acceptance Scenarios**:

1. **Given** um teste com `script('lança aluguel…', create_payable)`, **When** o laço roda, **Then** a confirmação e o "sim" gravam os mesmos centavos de antes.
2. **Given** o dublê sem `script()` e o texto "quanto vendi hoje?", **When** `decide` roda, **Then** a decisão é `unknown`.
3. **Given** a suíte na CI, **When** ela termina, **Then** nenhum teste chamou a OpenAI.

## Requirements

### Functional

- **FR-001**: Com `OPENAI_API_KEY` e o porteiro do assistente aberto, o processo monta somente `createMastraLlm`. O servidor não instancia o dublê.
- **FR-002**: Sem `OPENAI_API_KEY`, `motivoDoAgenteIndisponivel` devolve motivo e o runtime do assistente não é montado. O processo não encerra.
- **FR-003**: A variável `AGENT_PROVIDER` sai do schema de ambiente. Valor antigo no `.env` não religa um modo falso.
- **FR-004**: `FakeLlm.decide` consulta só o mapa de `script()`. Sem roteiro, devolve `unknown`. Não há reconhecedor de consulta, mutação nem recusa.
- **FR-005**: `createAgentRuntime` sem `llm` continua podendo usar o dublê, para teste. A composição da API não usa esse default quando serve mensagem.
- **FR-006**: O relé `studio-harness` permanece. Ele não chama a OpenAI. O modelo do turno continua dentro de `processMessage`.
- **FR-007**: Em `production` sem `AGENT_HARNESS=1`, o assistente continua indisponível, mesmo com chave.
- **FR-008**: As tools do Mastra continuam com `execute` identidade. O catálogo continua sendo quem chama `core` depois da confirmação quando `mutatesValue`.
- **FR-009**: Foto de código de barras continua em `tratarFoto` com `FakeBarcodeDecoder`, antes de `decide()`. A imagem não entra no prompt.
- **FR-010**: A ADR-0010 ganha revisão parcial, no mesmo mudança que o código, retirando “modo falso obrigatório no local”. `docs/arquitetura/integracoes/mastra.md`, o README de `packages/agent` e os exemplos de ambiente acompanham.

### Non-functional

- **NFR-001**: Indisponibilidade da OpenAI não derruba o restante da API (RNF-010).
- **NFR-002**: A CI não usa adaptador real (constitution V).
- **NFR-003**: A chave não entra em spec, teste, log nem arquivo versionado (RNF-022).

## Success Criteria

- **SC-001**: Suíte de `packages/agent` e dos testes do assistente em `apps/api` verde sem `OPENAI_API_KEY`.
- **SC-002**: Com chave, um turno de consulta no harness local passa pelo Mastra. Sem chave, o mesmo endpoint responde 503 e o restante da API responde.
- **SC-003**: Nenhum teste restante depende de frase em português para escolher tool, salvo os que gravam a decisão com `script()`.
- **SC-004**: Textos de ADR, integração Mastra, README do agent e `.env.example` não instruem `AGENT_PROVIDER=fake` como modo do servidor.

## Assumptions

- O modelo continua `openai/gpt-4o-mini`, configurável por `AGENT_MODEL`.
- O teto mensal já recusa o turno sem chamar modelo. Esta fatia não muda esse texto nem o contador.
- O porteiro `AGENT_HARNESS` em produção permanece como está.
