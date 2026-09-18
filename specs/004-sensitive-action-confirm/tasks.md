---
description: 'Task list for NR-061 persistent sensitive-action confirmation'
---

# Tasks: Confirmação de ação sensível, com expiração (NR-061)

**Input**: Design documents from `/specs/004-sensitive-action-confirm/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos — constitution V, FR-017 e `plan.md` (Vitest; Postgres real em `db`; sem OpenAI na CI). RNF-006 (≤ 8 s após o “sim”) é smoke manual já medido na NR-121, não tarefa de CI.

**Organization**: Por user story da spec (US1–US5). O laço NR-060 já existe — tarefas movem a porta, persistem e provam isolamento.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem depender de tarefa incompleta)
- **[Story]**: US1…US5 mapeiam as jornadas da spec
- Todo item tem caminho de arquivo

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Índices no catálogo já existente — sem lógica de laço ainda

- [x] T001 Criar `packages/db/src/migrations/0018_confirmations_identity.sql` com: UNIQUE `(company_id, channel, number_from)` em `conversations` WHERE `deleted_at IS NULL`; UNIQUE `(conversation_id)` em `confirmations` WHERE `resolved_at IS NULL`. Sem colunas novas; sem `messages`; sem `created_at` em `confirmations`
- [x] T002 [P] Declarar a porta `ConfirmationStore` / `PendingConfirmation` / `ConfirmationDecision` em `packages/core/src/ports/confirmations.ts` conforme `specs/004-sensitive-action-confirm/contracts/confirmation-store.md` (`companyId` na pendência; `getOpen(companyId, conversationKey, now)` **não** filtra `expiresAt`; `resolve(companyId, id, decision)` no-op se outra loja ou já resolvida)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Porta no núcleo, fake in-memory alinhado, laço passando `companyId` — **bloqueia** todas as stories. Store Postgres entra na US2.

**⚠️ CRITICAL**: Nenhuma user story começa antes deste checkpoint

- [x] T003 Reexportar `ConfirmationStore`, `PendingConfirmation` e `ConfirmationDecision` em `packages/core/src/index.ts` (bloco de portas)
- [x] T004 Em `packages/agent/src/types.ts`, importar/reexportar a porta de `@na-regua/core`; remover o tipo duplicado; `AgentRuntime.confirmations` usa a porta de `core`
- [x] T005 Atualizar `InMemoryConfirmations` e `novaConfirmacao` em `packages/agent/src/confirmations.ts`: `PendingConfirmation.companyId` obrigatório; `getOpen(companyId, conversationKey, now)` casa os dois; `put` substitui a aberta da mesma chave; `resolve` aceita `companyId` (in-memory pode apagar — FR-011 é o Postgres)
- [x] T006 Em `packages/agent/src/process-message.ts`: `getOpen(ctx.companyId, conversationKey, ctx.now)`; `novaConfirmacao` inclui `companyId: ctx.companyId`; `resolve(ctx.companyId, id, decision)` nos três desfechos
- [x] T007 Em `packages/agent/src/create-runtime.ts`: opção `confirmations?: ConfirmationStore`; default `new InMemoryConfirmations()` (testes unitários inalterados na composição)
- [x] T008 Reexportar tipos de `core` em `packages/agent/src/index.ts` (manter `InMemoryConfirmations` / `novaConfirmacao` para testes)
- [x] T009 Ajustar chamadas da porta em `packages/agent/src/process-message.test.ts` e `packages/agent/src/create-runtime.test.ts` até `pnpm --filter @na-regua/agent test` verde **sem** Postgres (laço NR-060 continua)

**Checkpoint**: Porta única; laço compila com `companyId`; in-memory ainda é o default dos testes — stories podem começar

---

## Phase 3: User Story 1 — Resumir e só executar depois do “sim” (Priority: P1) 🎯 MVP

**Goal**: Mutação (cadastro, venda, cobrança) devolve resumo e **não** grava; “sim” no prazo executa o mesmo caso de uso do app; “não” cancela. Comportamento NR-060 preservado na porta nova.

**Independent Test**: `create_sale` / `create_customer` → `kind: confirmation` e zero efeito; `sim` → um efeito; `não` → zero efeito. FakeLlm, sem OpenAI.

### Tests for User Story 1

> Já existem em `process-message.test.ts` — **devem continuar falhando** se T006/T005 quebrarem o laço. Acrescentar só o que a porta nova exige.

- [x] T010 [P] [US1] Garantir (ou acrescentar) em `packages/agent/src/process-message.test.ts`: `put` da proposta carrega `companyId` do `ExecutionContext`; `getOpen` com outro `companyId` **não** devolve a pendência (mesmo `conversationKey`)
- [x] T011 [P] [US1] Regressão HTTP em `apps/api/src/routes/agent.test.ts`: mutação → `confirmation` → `sim` grava; sem `sim` não grava (runtime in-memory injetado, contrato `POST /agent/messages` inalterado)

### Implementation for User Story 1

- [x] T012 [US1] Confirmar que `packages/agent/src/process-message.ts` não executa catálogo antes do `eSim` e que recusa explícita (`eNao`) chama `resolve(..., 'rejected')` sem `execute`
- [x] T013 [US1] Confirmar que `formatProposal` continua sendo o texto do `kind: confirmation` (FR-014: resumo cabe detalhe futuro; **não** implementar cancelamento de venda)

**Checkpoint**: MVP do diálogo — portão RF-103 no laço novo, ainda volátil

---

## Phase 4: User Story 2 — Pendência que não some no reinício (Priority: P1)

**Goal**: Store Postgres (`confirmations` + stub `conversations`); `buildAgentDeps` injeta; nova instância do store ainda vê a aberta; “sim” no prazo após “reinício” executa uma vez. HTTP `app:` e Studio `wa:` **não** cruzam chave ([research §4](./research.md)).

**Independent Test**: `put` → `createConfirmationStore` novo no mesmo Postgres → `getOpen` acha; `expiresAt` passado + `sim` = expired / zero efeito. Relógio injetado, sem `sleep` de 5 min.

### Tests for User Story 2

> Escrever primeiro; devem **falhar** até o repositório existir

- [x] T014 [P] [US2] Teste round-trip + “reinício” (segunda instância de `createConfirmationStore`) em `packages/db/src/confirmation-repository.test.ts` — padrão `describe.skipIf(!DATABASE_URL)` / `test-support.ts` como `packages/db/src/appointments.test.ts`
- [x] T015 [P] [US2] Teste: `getOpen` devolve pendência **expirada ainda aberta** (`expiresAt <= now`, `resolved_at` nulo) — **não** esconder no SELECT por `expires_at` — em `packages/db/src/confirmation-repository.test.ts`
- [x] T016 [US2] Teste: `put` na mesma `conversationKey` encerra a anterior com `decision = 'rejected'` e `resolved_at` preenchido (**sem DELETE**; UNIQUE aberta por `conversation_id`) em `packages/db/src/confirmation-repository.test.ts`
- [x] T017 [US2] Teste: `app:{companyId}:{userId}` e `wa:{companyId}:{peer}` são identidades distintas (duas abertas possíveis) em `packages/db/src/confirmation-repository.test.ts` — **não** unificar HTTP×Studio

### Implementation for User Story 2

- [x] T018 [US2] Implementar `createConfirmationStore(sql)` em `packages/db/src/confirmation-repository.ts`: todo método em `withTenant(sql, companyId, …)`; upsert do stub `conversations` (`channel` + `number_from` NOT NULL) conforme `specs/004-sensitive-action-confirm/contracts/conversation-identity.md`; `payload` jsonb `{ toolId, args, summary, conversationKey }`; `action` = `toolId`; `number_from` vazio → fail-closed no `put`
- [x] T019 [US2] Exportar `createConfirmationStore` em `packages/db/src/index.ts`
- [x] T020 [US2] Injetar o store Postgres em `createAgentRuntime({ confirmations })` a partir de `buildAgentDeps` em `apps/api/src/composition.ts` (**único** import de `db` no app; `agent` ↛ `db`)
- [x] T021 [US2] Teste de composição: `buildAgentDeps()` devolve runtime cujo `confirmations` **não** é `InMemoryConfirmations` quando o harness sobe — `apps/api/src/composition.test.ts`

**Checkpoint**: Reinício do processo não apaga pendência válida; chaves `app:` e `wa:` isoladas

---

## Phase 5: User Story 3 — Expirar e tratar ambiguidade como “não” (Priority: P1)

**Goal**: Ambiguidade e expiração **persistem** como `rejected` / `expired` (linha permanece). Pedido novo após expirar reprocessa. TTL 5 min (`CONFIRMATION_TTL_MS`), relógio = `ctx.now`.

**Independent Test**: `talvez` → `rejected`, zero efeito, `getOpen` vazio; `now` +5 min + `sim` → `expired`, zero efeito; expirada + consulta/pedido novo não executa a ação velha.

### Tests for User Story 3

- [x] T022 [P] [US3] Regressão laço em `packages/agent/src/process-message.test.ts`: ambíguo (`talvez depois`) → `resolve(..., 'rejected')`; expirado + `sim` → `expired`; expirado + pedido novo (`quanto vendi hoje?` / texto longo) reprocessa — já parcialmente coberto; garantir `companyId` nas chamadas
- [x] T023 [US3] Teste Postgres: após `resolve(..., 'expired'|'rejected')` a linha existe com `decision` e `resolved_at`; segundo `resolve` é no-op — `packages/db/src/confirmation-repository.test.ts`
- [x] T024 [US3] Teste: mensagem vazia / só ruído com aberta → recusa (ambígua) em `packages/agent/src/process-message.test.ts`

### Implementation for User Story 3

- [x] T025 [US3] Garantir em `packages/db/src/confirmation-repository.ts` que `resolve` preenche `resolved_at` + `decision` (`accepted` \| `rejected` \| `expired`) e **não** dá DELETE (FR-011; CHECK da 0007)
- [x] T026 [US3] Em `packages/agent/src/process-message.ts`, manter: expirada + sim/não/não-pedido-novo → texto de expiração; `pareceIntencaoNova` → `resolve(expired)` e reentra no laço. TTL default `CONFIRMATION_TTL_MS = 5 * 60_000`

**Checkpoint**: RF-104 no store durável; viés “ambíguo = não”

---

## Phase 6: User Story 4 — Consultar sem atrito (Priority: P2)

**Goal**: Leitura (`list_sales`, recebíveis, resumo) **não** pede confirmação. Expirar uma mutação **não** bloqueia a consulta seguinte.

**Independent Test**: `quanto vendi hoje?` → `answer` sem `kind: confirmation`; após TTL de um cadastro pendente, a mesma consulta responde.

### Tests for User Story 4

- [x] T027 [P] [US4] Regressão em `packages/agent/src/process-message.test.ts`: consulta conhecida sem `put` / sem `confirmation`
- [x] T028 [US4] Teste: aberta expirada + `quanto vendi hoje?` → `answer` de leitura (não tenta executar a mutação velha) em `packages/agent/src/process-message.test.ts`

### Implementation for User Story 4

- [x] T029 [US4] Confirmar em `packages/agent/src/catalog.ts` que tools de leitura têm `mutatesValue: false` (`list_sales`, `list_receivables`, `period_summary`, `search_products`, recusas); nenhuma mudança de catálogo nesta fatia

**Checkpoint**: Consultar livre (FR-002)

---

## Phase 7: User Story 5 — Uma loja não confirma a de outra (Priority: P2)

**Goal**: RLS + `withTenant`: loja B não lê, não confirma e não resolve pendência da loja A (ausência, nunca o payload).

**Independent Test**: duas empresas no Postgres; `getOpen`/`resolve` da B na chave/id da A = `undefined` / no-op; `sim` na B não dispara `execute` da A.

### Tests for User Story 5

> Escrever primeiro contra o store real

- [x] T030 [P] [US5] Isolamento em `packages/db/src/confirmation-repository.test.ts`: `getOpen(empresaB, chaveDaA, now)` → `undefined`; `resolve(empresaB, idDaA, 'accepted')` não marca a linha da A
- [x] T031 [US5] Teste de laço com dois runtimes / dois `companyId` (InMemory ou store) em `packages/agent/src/process-message.test.ts`: `sim` da B não incrementa `registerSale` da A

### Implementation for User Story 5

- [x] T032 [US5] Revisar `packages/db/src/confirmation-repository.ts`: nenhum método consulta sem `withTenant`; `companyId` da assinatura é o tenant (não o UUID embutido na `conversationKey` se divergir — o contexto ganha)
- [x] T033 [US5] Confirmar `SELECT enable_tenant_isolation('confirmations')` e `conversations` já na 0007 — **não** desligar RLS; isolation test usa papel de aplicação (`conectarComoAplicacao`), não superuser

**Checkpoint**: Constitution IV no store novo

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Ledger, docs permanentes, fronteiras, quickstart

- [x] T034 [P] Marcar NR-061 ✅ no mesmo PR em `docs/processo/task-ledger.md` (e CSV se o `ledger:check` exigir)
- [x] T035 [P] Atualizar `packages/agent/README.md`: máquina na tabela `confirmations`; `InMemoryConfirmations` = teste; HITL Mastra continua fora
- [x] T036 [P] Atualizar `docs/arquitetura/integracoes/mastra.md`: tirar “hoje in-memory, NR-061”; store Postgres + stub de conversa; sem `requireToolApproval`
- [x] T037 [P] Alinhar prosa `peer` vs coluna `number_from` em `docs/arquitetura/esquema-postgresql.md` na seção Assistente (migration 0007 / 0018)
- [x] T038 [P] Nota na spec 003 / README Studio: confirmação persistente, chaves `app:` ≠ `wa:` — `packages/agent/README.md` e/ou `specs/003-studio-harness/data-model.md`
- [x] T039 Rodar `pnpm boundaries` (`agent` ↛ `db`/`domain`; `createConfirmationStore` só em `apps/api/src/composition.ts`)
- [x] T040 Rodar `pnpm --filter @na-regua/agent test` e `pnpm --filter @na-regua/db exec vitest run src/confirmation-repository.test.ts` (com `DATABASE_URL`)
- [x] T041 Executar checklist de `specs/004-sensitive-action-confirm/quickstart.md` (HTTP: proposta → restart API → `sim`; **não** cruzar `sim` HTTP com proposta Studio)
- [x] T042 [P] Confirmar que NR-062 / Memory Mastra / Meta / tools novas **não** entraram; `messages` continua vazia neste PR

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: começa já
- **Foundational (2)**: depois do Setup — **BLOCKS** US1–US5
- **US1 (3)**: depois da Phase 2 — MVP do diálogo (ainda in-memory nos testes de agent)
- **US2 (4)**: depois da Phase 2 — persistência; na prática depois da US1 (laço estável)
- **US3 (5)**: depois da US2 para decisão na linha; testes de laço (T022/T024) podem começar com a US1
- **US4 (6)**: depois da US1; T028 depois da US3 (expirar então consultar)
- **US5 (7)**: depois da US2 (store real)
- **Polish (8)**: depois das stories desejadas (DoD = US1–US5)

### User Story Dependencies

| Story                     | Depende de             | Notas                               |
| ------------------------- | ---------------------- | ----------------------------------- |
| US1 Portão sim/não        | Phase 2                | MVP; FakeLlm                        |
| US2 Reinício / Postgres   | Phase 2 + laço da US1  | Gap que a NR-061 existe para fechar |
| US3 TTL / ambíguo durável | US2 (linha) + US1 laço | FR-011                              |
| US4 Consulta livre        | US1                    | P2; T028 espera expirar             |
| US5 Isolamento RLS        | US2                    | P2; constitution IV                 |

### Parallel Opportunities

- T001 ∥ T002
- T010 ∥ T011 (testes US1)
- T014 ∥ T015 (testes US2)
- T022 ∥ T024 (testes US3 de laço, se a porta já compilou)
- T027 ∥ T030 (US4 laço ∥ US5 db, depois da US2)
- T034 ∥ T035 ∥ T036 ∥ T037 ∥ T038 ∥ T042 (docs)
- Depois da Phase 2, com duas pessoas: A fecha US1, B escreve testes US2 no repositório

---

## Parallel Example: Setup

```bash
Task: "0018_confirmations_identity.sql em packages/db/src/migrations/"
Task: "porta ConfirmationStore em packages/core/src/ports/confirmations.ts"
```

## Parallel Example: User Story 2 tests

```bash
Task: "round-trip + reinício em confirmation-repository.test.ts"
Task: "getOpen devolve expirada aberta em confirmation-repository.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup (migration + porta)
2. Phase 2 Foundational (tipos, in-memory, `processMessage` + `companyId`)
3. Phase 3 US1
4. **STOP** — validar `process-message.test.ts` confirmação (ainda volátil)

### Incremental Delivery (DoD do merge)

1. US2 store Postgres + composition + restart
2. US3 decisão persistida + ambíguo/TTL
3. US4 consulta livre
4. US5 RLS duas lojas
5. Polish: ledger ✅, docs, boundaries, quickstart (restart HTTP)

### Suggested MVP scope

**US1 só** para o primeiro demo do laço na porta nova. **DoD de merge** = US1 + US2 + US3 + US5 (FR-017) + US4 (barato, regressão) + Polish.

---

## Notes

- Não usar HITL Mastra (`requireToolApproval` / `approveToolCall`)
- Não gravar `messages` (NR-062)
- Não unificar chave HTTP `app:` com Studio `wa:` (ADR-0016; research §4)
- Não tratar “sim” no chat como 2FA (ADR-0002)
- Não adicionar tools (estoque, baixas, cancelar venda — NR-115–118)
- `agent` não importa `db`; só `apps/api/src/composition.ts` instancia o store
- Relógio injetável (`ctx.now`); sem `sleep` de 5 minutos na CI
- Isolation test: papel de aplicação, não superuser
- Refs: NR-061 no rodapé do commit / PR
