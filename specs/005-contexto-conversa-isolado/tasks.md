---
description: 'Task list for NR-062 isolated conversation context'
---

# Tasks: Contexto de conversa isolado por empresa (NR-062)

**Input**: Design documents from `/specs/005-contexto-conversa-isolado/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos — constitution V, FR-019 e `plan.md` (Vitest; Postgres real em `db`; relógio injetado; sem OpenAI na CI). Anáfora com modelo real é smoke manual no harness.

**Organization**: Por user story da spec (US1–US6). Identidade da conversa (NR-061, `number_from` + UNIQUE 0018) já existe — tarefas gravam `messages`, recortam o `decide` e expurgam.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem depender de tarefa incompleta)
- **[Story]**: US1…US6 mapeiam as jornadas da spec
- Todo item tem caminho de arquivo

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Índice da janela e porta no núcleo — sem lógica de laço ainda

- [x] T001 Criar `packages/db/src/migrations/0019_conversation_messages_idx.sql` com índice `messages (company_id, conversation_id, created_at DESC) WHERE deleted_at IS NULL`. Sem colunas novas; sem rename de `number_from`; sem tocar em `confirmations`
- [x] T002 [P] Declarar em `packages/core/src/ports/conversations.ts` os tipos de `specs/005-contexto-conversa-isolado/contracts/conversation-store.md` e `conversation-purge.md`: `ConversationRole` (`user` \| `assistant` \| `system`), `StoredMessage` (`body` text NOT NULL; `toolCalls` jsonb opcional; `createdAt`), `ActiveContext` (`messages` 0..12 ordem cronológica; `idle` boolean), `AppendTurn` (`userBody`, `assistantBody`, `at`), `ConversationStore` (`loadActive(companyId, conversationKey, now, options?)` — defaults `idleMs = 7_200_000`, `window = 12`; **não** cria row; `append` faz upsert), `ConversationPurgeRepository` (`deleteMessagesOlderThan`, `closeConversationsWithoutMessages`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Porta no núcleo, upsert compartilhado, fake in-memory, laço passando `history` — **bloqueia** todas as stories. Store Postgres entra na US2.

**⚠️ CRITICAL**: Nenhuma user story começa antes deste checkpoint

- [x] T003 Reexportar `ConversationStore`, `ActiveContext`, `AppendTurn`, `StoredMessage`, `ConversationPurgeRepository` em `packages/core/src/index.ts` (bloco de portas, junto de `ConfirmationStore`)
- [x] T004 Extrair upsert de identidade para `packages/db/src/conversation-identity.ts`: `(company_id, channel, number_from)` vigente (`deleted_at IS NULL`); `number_from` vazio → fail-closed; SELECT → INSERT `ON CONFLICT (company_id, channel, number_from) WHERE deleted_at IS NULL DO NOTHING` → SELECT de novo. Mapear `app:{companyId}:{userId}` → `channel=app`; `wa:{companyId}:{peer}` → `channel=whatsapp` — [conversation-identity 004](../004-sensitive-action-confirm/contracts/conversation-identity.md)
- [x] T005 Fazer `packages/db/src/confirmation-repository.ts` usar `conversation-identity.ts` (zero mudança de comportamento). `pnpm --filter @na-regua/db exec vitest run src/confirmation-repository.test.ts` continua verde
- [x] T006 Em `packages/agent/src/types.ts`: reexportar a porta de `@na-regua/core`; `AgentRuntime.conversations?: ConversationStore`; `LlmPort.decide` aceita `history?: readonly { role, body }[]` (0..12) conforme `specs/005-contexto-conversa-isolado/contracts/llm-history.md`
- [x] T007 Implementar `InMemoryConversationStore` em `packages/agent/src/conversations.ts`: `loadActive` **não** cria chave; idle se última `createdAt <= now - idleMs` ⇒ `idle: true` e `messages: []`; senão últimas `window` (default 12) em ordem cronológica; `append` cria o fio; loja B na chave da A não lê/escreve a A; `app:` ≠ `wa:`
- [x] T008 Em `packages/agent/src/create-runtime.ts`: opção `conversations?: ConversationStore`; default `new InMemoryConversationStore()` nos testes
- [x] T009 Em `packages/agent/src/process-message.ts`: ramo **sem** pendência de confirmação chama `loadActive(ctx.companyId, conversationKey, ctx.now)` e passa `history` ao `decide`; ramo `tratarConfirmacao` **não** chama `decide` nem `loadActive` para anáfora; após reply visível (`answer` \| `clarify` \| `unknown` \| `confirmation`) chama `append` com `at: ctx.now` (par user/assistant); `ignored` **não** grava; falha de `append` não desfaz `execute` (log sem `body`, RNF-034)
- [x] T010 Atualizar `FakeLlm.decide` em `packages/agent/src/fake-llm.ts` para aceitar `history` e **ignorar** no reconhecedor (frases completas inalteradas)
- [x] T011 Reexportar `InMemoryConversationStore` e tipos em `packages/agent/src/index.ts`
- [x] T012 Ajustar `packages/agent/src/process-message.test.ts`, `packages/agent/src/create-runtime.test.ts` e `packages/agent/src/mastra-llm.ts` (`decide` com `history` opcional) até `pnpm --filter @na-regua/agent test` verde **sem** Postgres — laço NR-060/061 continua; `maxSteps: 1` inalterado

**Checkpoint**: Porta única; laço compila com `history`; in-memory é o default dos testes — stories podem começar

---

## Phase 3: User Story 1 — Resolver “ele” e “essa venda” no fio ativo (Priority: P1) 🎯 MVP

**Goal**: Dois turnos no mesmo fio ativo: o segundo com pronome aponta para a entidade ancorada (via `history` no `LlmPort`). Sem histórico, o laço NR-060 segue. Ambíguo (dois candidatos) → esclarecer, zero mutação da errada.

**Independent Test**: stub de `LlmPort` que lê `history` e devolve `send_charge` com o `customerId` da âncora; segunda mensagem `"manda a cobrança pra ele"`; `kind: confirmation` daquele cliente. Sem `history` / primeira mensagem com nome explícito → caminho antigo.

### Tests for User Story 1

> Escrever primeiro; devem **falhar** até T009/T014 passarem `history` de verdade

- [x] T013 [P] [US1] Em `packages/agent/src/process-message.test.ts`: stub `LlmPort` — turno 1 ancora cliente em `history`/`toolCalls`; turno 2 `"manda a cobrança pra ele"` recebe `history` com o turno 1 e devolve tool com o **mesmo** `customerId`; FakeLlm inalterado nas consultas
- [x] T014 [P] [US1] Em `packages/agent/src/process-message.test.ts`: sem store / primeira mensagem com nome na própria frase → `decide` com `history` vazio ou ausente; laço NR-060 (consulta / mutação) não quebra
- [x] T015 [US1] Em `packages/agent/src/process-message.test.ts`: stub com **dois** candidatos no `history` devolve `type: 'text'` (esclarecer) e **não** chama `execute` de `send_charge`

### Implementation for User Story 1

- [x] T016 [US1] Em `packages/agent/src/process-message.ts` + `InMemoryConversationStore`: `append` grava `toolCalls` com ids resolvidos da tool proposta/executada (`customerId` / `saleId` / `productId` quando existirem no args/saída) — metadado daquele turno, não perfil permanente
- [x] T017 [US1] Em `packages/agent/src/mastra-llm.ts`: incluir `history` no `generate` (lista de mensagens **ou** prefixo compacto ≤ 12 turnos); MUST NOT importar `@mastra/memory`; tools continuam identidade

**Checkpoint**: RF-105 no laço com stub; ainda volátil (in-memory)

---

## Phase 4: User Story 2 — Uma loja não herda a conversa da outra (Priority: P1)

**Goal**: Store Postgres + RLS: loja B não lê, não grava e não ancora o fio da loja A (ausência, nunca o corpo). `companyId` da assinatura ganha se divergir da chave.

**Independent Test**: duas empresas no Postgres; `loadActive(B, chaveDaA)` → `undefined`; `append` da B não insere `messages` da A; stub de anáfora na B **não** vê o João da A.

### Tests for User Story 2

> Escrever primeiro contra o store real (`describe.skipIf(!DATABASE_URL)` / `test-support.ts` como `packages/db/src/appointments.test.ts`)

- [x] T018 [P] [US2] Isolamento em `packages/db/src/conversation-repository.test.ts`: `loadActive(empresaB, chaveDaA, now)` → `undefined`; `append(empresaB, turnoNaChaveDaA)` não cria `messages` com `company_id` da A
- [x] T019 [P] [US2] Em `packages/agent/src/process-message.test.ts`: dois runtimes / dois `companyId` (InMemory): history da A **não** entra no `decide` da B; “ele” na B não ancora o cliente da A
- [x] T020 [US2] Teste: `app:{id}:{userId}` e `wa:{id}:{peer}` são fios distintos (dois `append`, `loadActive` de um não devolve o outro) em `packages/db/src/conversation-repository.test.ts` — **não** unificar HTTP×Studio

### Implementation for User Story 2

- [x] T021 [US2] Implementar `createConversationStore(sql)` em `packages/db/src/conversation-repository.ts`: todo método em `withTenant(sql, companyId, …)`; `append` usa `conversation-identity.ts`; INSERT em `messages` com `role` `user`\|`assistant`, `body` NOT NULL, `created_at = turn.at` (não `now()` do banco); `loadActive` SELECT vigentes `deleted_at IS NULL`, idle se `max(created_at) <= now - idleMs` ⇒ `messages: []`, senão `ORDER BY created_at DESC LIMIT window` e inverter para cronológica; `number_from` vazio → `loadActive` undefined / `append` fail-closed
- [x] T022 [US2] Exportar `createConversationStore` em `packages/db/src/index.ts`
- [x] T023 [US2] Confirmar `SELECT enable_tenant_isolation('messages')` e `conversations` já na 0007 — **não** desligar RLS; isolation test usa papel de aplicação (`conectarComoAplicacao`), não superuser

**Checkpoint**: Constitution IV no histórico; HTTP `app:` ≠ Studio `wa:`

---

## Phase 5: User Story 3 — Depois de 2 horas, não aplicar o contexto antigo (Priority: P1)

**Goal**: `now - última mensagem > 7_200_000 ms` ⇒ `idle: true`, `history` vazio, stub **não** ancora. Dentro de 2 h, anáfora da US1 vale. Recomeço após idle volta a ancorar só no trecho novo. TTL de confirmação (5 min) **intocado**.

**Independent Test**: ancorar, `now += 2h + 1ms`, “ele” → `history.length === 0`; `now += 1h` ainda ancora. Relógio = `ctx.now`, sem `sleep`.

### Tests for User Story 3

- [x] T024 [P] [US3] Em `packages/agent/src/process-message.test.ts`: após âncora, `now` + `2 * 60 * 60 * 1000 + 1` → stub recebe `history` vazio e **não** devolve o `customerId` antigo
- [x] T025 [P] [US3] Em `packages/db/src/conversation-repository.test.ts`: `loadActive` com `now` além de 2 h ⇒ `idle === true` e `messages === []`; mensagens **permanecem** na tabela (idle não apaga)
- [x] T026 [US3] Em `packages/agent/src/process-message.test.ts`: idle cortou → novo turno identifica o cliente de novo → terceiro turno com pronome ancora **só** o recomeço (history sem o trecho ocioso)
- [x] T027 [US3] Em `packages/agent/src/process-message.test.ts`: confirmação pendente + `now` + 2 h **não** estende `expiresAt`; “sim” depois de 5 min ainda é `expired` (`CONFIRMATION_TTL_MS`); idle não chama `loadActive` no ramo `tratarConfirmacao`

### Implementation for User Story 3

- [x] T028 [US3] Garantir defaults `idleMs = 7_200_000` em `InMemoryConversationStore` e `createConversationStore`; `processMessage` **não** passa mensagens ociosas ao `decide`; **não** seta `deleted_at` no idle; **não** altera `packages/agent/src/confirmations.ts` / TTL

**Checkpoint**: RF-106 idle; confirmação continua outra máquina

---

## Phase 6: User Story 4 — Só o recorte recente vai à interpretação (Priority: P2)

**Goal**: `decide` recebe no máximo **12** mensagens da conversa vigente. Âncora que saiu das 12 não viaja. Idle já cortou ⇒ recorte pode ser 0, nunca “as 12 ociosas”.

**Independent Test**: 13 pares user/assistant (ou 13+ linhas vigentes); próxima chamada: `history.length <= 12` e a mais antiga das 13 **não** está no array.

### Tests for User Story 4

- [x] T029 [P] [US4] Em `packages/agent/src/process-message.test.ts`: 13 turnos no InMemory; 14º `decide` recebe `history.length === 12` (as mais recentes, ordem cronológica)
- [x] T030 [P] [US4] Em `packages/db/src/conversation-repository.test.ts`: `window = 12` — INSERT 13 mensagens vigentes, `loadActive` devolve 12; corpo das mais antigas **permanece** no SELECT fora da janela (ainda não é expurgo)
- [x] T031 [US4] Em `packages/agent/src/process-message.test.ts`: stub com âncora só na mensagem 1 de 13 → `history` sem ela → **não** ancora (pede de novo); MUST NOT aumentar `window` em `packages/agent/src/process-message.ts`

### Implementation for User Story 4

- [x] T032 [US4] `LIMIT 12` (ou `options.window`) em `packages/db/src/conversation-repository.ts` e no InMemory; `mastra-llm.ts` **não** concatena além do array recebido; constante documentada junto do default `window = 12` (RNF-075)

**Checkpoint**: Teto ADR-0016 no prompt

---

## Phase 7: User Story 5 — Depois de 30 dias, o texto some (Priority: P2)

**Goal**: Caso de uso `purgeConversationHistory` + fila `conversation-purge`: DELETE de `messages` com `created_at <= now - 30d`; conversa sem msg vigente → `deleted_at = now` (não DELETE da row). Venda/cadastro/`audit_logs` intactos.

**Independent Test**: gravar msgs com `createdAt` antigo, `ctx.now` + 30 d, purge → `SELECT body` vazio (linha some); `sales` da mesma empresa permanece; anáfora daquele texto impossível.

### Tests for User Story 5

> Relógio injetado; sem esperar 30 dias reais

- [x] T033 [P] [US5] Teste do caso de uso em `packages/core/src/conversations/purge-history.test.ts`: fake repo conta DELETE + close; `ctx.now` e `retentionMs = 30 * 24 * 60 * 60 * 1000`; `channel: 'job'`
- [x] T034 [P] [US5] Em `packages/db/src/conversation-repository.test.ts`: mensagens com `created_at` há 31 dias somem no DELETE; mensagem de ontem permanece; conversa órfã recebe `deleted_at`; UNIQUE 0018 permite novo upsert da mesma identidade depois
- [x] T035 [US5] Em `packages/db/src/conversation-repository.test.ts`: criar venda (ou row de negócio já usada nos testes de `db`) **antes** do purge — após o job, a venda **existe**; `audit_logs` intocado se o teste já inserir auditoria
- [x] T036 [US5] Isolamento do purge em `packages/db/src/conversation-repository.test.ts`: mensagens da loja B com 31 dias **não** são apagadas quando a corrida da A roda (`withTenant`)

### Implementation for User Story 5

- [x] T037 [US5] Implementar `purgeConversationHistory` em `packages/core/src/conversations/purge-history.ts` (`ctx.now` injetado; MUST NOT `new Date()`); exportar em `packages/core/src/index.ts`
- [x] T038 [US5] Implementar `deleteMessagesOlderThan` (DELETE, não `body = ''`) e `closeConversationsWithoutMessages` (`UPDATE deleted_at`, **não** `DELETE FROM conversations` — FK `confirmations` RESTRICT) em `packages/db/src/conversation-repository.ts` (ou módulo irmão no mesmo arquivo)
- [x] T039 [US5] Acrescentar fila `conversation-purge` em `apps/worker/src/queues.ts` (kebab-case, sem `:`); consumidor em `apps/worker/src/consumers/conversation-purge.ts` no molde de `charge-overdue` (payload irrelevante, chama o caso de uso, `removeOnFail: false`); registrar em `apps/worker/src/consumers/index.ts`; teste `apps/worker/src/consumers/conversation-purge.test.ts`
- [x] T040 [US5] Estender `ConsumerDeps` em `apps/worker/src/consumers/types.ts` e `apps/worker/src/composition.ts` para injetar o repositório de purge **sem** o worker importar regra além do caso de uso

**Checkpoint**: RNF-035 verificável; negócio intacto

---

## Phase 8: User Story 6 — O fio sobrevive ao reinício (Priority: P2)

**Goal**: `buildAgentDeps` injeta `createConversationStore`; nova instância do store ainda vê o fio ativo; mesmo `channel`+interlocutor compartilha; outro peer não herda. HTTP `app` e Studio `wa` **não** cruzam (FR-011 / research §3).

**Independent Test**: `append` → `createConversationStore` novo → `loadActive` acha (idle < 2 h); dois peers `wa:` isolados; composition **não** usa só InMemory quando o harness sobe.

### Tests for User Story 6

- [x] T041 [P] [US6] Round-trip + “reinício” (segunda instância) em `packages/db/src/conversation-repository.test.ts`
- [x] T042 [P] [US6] Em `packages/agent/src/process-message.test.ts` (ou db): mesmo `wa:{companyId}:{peer}` em duas chamadas `processMessage` ancora; outro `peer` **não** herda
- [x] T043 [US6] Teste de composição: `buildAgentDeps()` devolve runtime com `conversations` **não** só `InMemoryConversationStore` quando o harness sobe — `apps/api/src/composition.test.ts`

### Implementation for User Story 6

- [x] T044 [US6] Injetar `createConversationStore(sql)` em `createAgentRuntime({ conversations })` a partir de `buildAgentDeps` em `apps/api/src/composition.ts` (**único** import de `db` no app para este store; `agent` ↛ `db`)
- [x] T045 [US6] Confirmar que `POST /agent/messages` (`channel: 'app'`) e Studio (`channel: 'whatsapp'`) **não** passam a compartilhar row — nenhuma mudança em `apps/api/src/routes/agent.ts` / `packages/agent/src/studio/relay-agent.ts` para unificar chave

**Checkpoint**: RF-105 entre deploys na **mesma** identidade

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Ledger, docs permanentes, fronteiras, quickstart

- [x] T046 [P] Marcar NR-062 ✅ no mesmo PR em `docs/processo/task-ledger.md` (e CSV se o `ledger:check` exigir)
- [x] T047 [P] Atualizar `packages/agent/README.md`: tabelas nossas, 12 msgs / 2 h / 30 d **entregues**; `InMemoryConversationStore` = teste; Memory Mastra continua fora
- [x] T048 [P] Atualizar `docs/arquitetura/integracoes/mastra.md` seção Memória: NR-062 feita; sem `@mastra/memory`
- [x] T049 [P] Alinhar prosa `peer` vs coluna `number_from` em `docs/arquitetura/esquema-postgresql.md` (Assistente) e índice 0019
- [x] T050 [P] Atualizar nota de `conversations` / `messages` em `packages/db/src/privacy-repository.ts` (deixou de ser “tabela vazia / sem caso de uso”)
- [x] T051 [P] README do worker: fila `conversation-purge` em `apps/worker/README.md`
- [x] T052 Rodar `pnpm boundaries` (`agent` ↛ `db`/`domain`; stores só em `apps/api/src/composition.ts` e worker composition)
- [x] T053 Rodar `pnpm --filter @na-regua/agent test`, `pnpm --filter @na-regua/core exec vitest run src/conversations`, `pnpm --filter @na-regua/db exec vitest run src/conversation-repository.test.ts` (com `DATABASE_URL`)
- [x] T054 Executar checklist de `specs/005-contexto-conversa-isolado/quickstart.md` (anáfora stub; **não** cruzar HTTP `app` com Studio `wa`; idle/30 d só com relógio injetado)
- [x] T055 [P] Confirmar que Memory Mastra / RAG / Meta / tools novas / unificação de harness **não** entraram; confirmação TTL 5 min inalterado — grep: sem `@mastra/memory` no package.json; `CONFIRMATION_TTL_MS = 5 * 60_000`; HTTP `app:` vs Studio `wa:` seguem distintos

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: começa já
- **Foundational (2)**: depois do Setup — **BLOCKS** US1–US6
- **US1 (3)**: depois da Phase 2 — MVP anáfora (in-memory + stub)
- **US2 (4)**: depois da Phase 2 — store Postgres + RLS; na prática depois da US1 (laço estável)
- **US3 (5)**: idle; testes de laço (T024/T026) após US1; testes db (T025) após US2
- **US4 (6)**: teto 12; laço após US1; db após US2
- **US5 (7)**: expurgo; depois da US2 (tem `messages` reais)
- **US6 (8)**: composition + reinício; depois da US2
- **Polish (9)**: depois das stories desejadas (DoD = US1–US6)

### User Story Dependencies

| Story                      | Depende de            | Notas                                       |
| -------------------------- | --------------------- | ------------------------------------------- |
| US1 Anáfora no fio ativo   | Phase 2               | MVP; stub `LlmPort`; FakeLlm ignora history |
| US2 Isolamento RLS         | Phase 2 + laço US1    | P1; constitution IV                         |
| US3 Idle 2 h               | US1 (laço) + US2 (db) | P1; TTL confirmação intocado                |
| US4 Janela 12              | US1 + US2             | P2; RNF-075                                 |
| US5 Expurgo 30 d           | US2                   | P2; RNF-035; worker                         |
| US6 Reinício / composition | US2                   | P2; mesma identidade, não HTTP×Studio       |

### Parallel Opportunities

- T001 ∥ T002
- T013 ∥ T014 (testes US1)
- T018 ∥ T019 (testes US2 db ∥ laço, se a porta já compilou)
- T024 ∥ T025 (idle laço ∥ idle db)
- T029 ∥ T030 (janela laço ∥ janela db)
- T033 ∥ T034 (use case ∥ SQL)
- T041 ∥ T042 (reinício db ∥ peer distinto)
- T046 ∥ T047 ∥ T048 ∥ T049 ∥ T050 ∥ T051 ∥ T055 (docs)
- Depois da Phase 2, com duas pessoas: A fecha US1, B escreve testes US2 no repositório

---

## Parallel Example: Setup

```bash
Task: "0019_conversation_messages_idx.sql em packages/db/src/migrations/"
Task: "porta ConversationStore em packages/core/src/ports/conversations.ts"
```

## Parallel Example: User Story 1 tests

```bash
Task: "stub LlmPort ancora ele em process-message.test.ts"
Task: "primeira mensagem sem history em process-message.test.ts"
```

## Parallel Example: User Story 2 tests

```bash
Task: "RLS loadActive/append em conversation-repository.test.ts"
Task: "dois companyId no laço em process-message.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup (índice + porta)
2. Phase 2 Foundational (identity helper, in-memory, `processMessage` + `history`)
3. Phase 3 US1
4. **STOP** — validar anáfora com stub (ainda volátil)

### Incremental Delivery (DoD do merge)

1. US2 store Postgres + RLS
2. US3 idle 2 h
3. US4 teto 12
4. US5 expurgo + fila
5. US6 composition + reinício
6. Polish: ledger ✅, docs, boundaries, quickstart

### Suggested MVP scope

**US1 só** para o primeiro demo do `history` no laço. **DoD de merge** = US1 + US2 + US3 (P1) + US4 + US5 + US6 + Polish.

---

## Notes

- T005: `confirmation-repository.ts` ausente nesta branch (NR-061 nao mesclada); helper de identidade fica para conversation-repository (US2).
- [P] = arquivos diferentes, sem depender de tarefa incompleta
- Testes **primeiro** nas stories (devem falhar até a impl)
- Relógio sempre `ctx.now` / `turn.at` — proibido `sleep` de 2 h ou 30 d
- `agent` não importa `db`; HITL/Memory Mastra não entram
- Commit por tarefa ou grupo lógico; rebase da `main`, nunca merge da `main` na branch

---

## Phase 10: Convergence

- [x] T056 Fazer `listTenantIds` em `apps/worker/src/composition.ts` enumerar empresas no papel da aplicacao **sem** `BYPASSRLS` e **sem** `SELECT` cru em `withPlatformScope` — essa consulta lanca `app.company_id nao esta definido` (`packages/db/src/cadastro-de-conta.test.ts`). Usar funcao `SECURITY DEFINER` so de ids (molde `auth_cnpj_taken`) ou equivalente ja usado em varredura de plataforma. Teste com `conectarComoAplicacao`: a corrida lista A e B; expurgo da A nao toca mensagens da B. Nao desligar RLS. per FR-013 / US5 / plan: purge job / Constitution IV (partial)
