---
description: 'Task list for NR-115 conversational read-only queries'
---

# Tasks: Consultar estoque, pagar e fiado por mensagem (NR-115)

**Input**: Design documents from
`/specs/006-consultar-estoque-pagar-fiado/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md) and
[contracts/agent-query-tools.md](./contracts/agent-query-tools.md).

**Tests**: Required by FR-015 and constitution V. Write each behavior test
before the corresponding implementation and make it fail first.

**Organization**: tasks are grouped by user story. The shared catalog and
composition contract are foundational; each P1 story then remains testable by
itself with the FakeLlm harness.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel without touching the same files or incomplete
  prerequisite.
- **[USn]**: Maps a task to the numbered user story in
  [spec.md](./spec.md).

## Phase 1: Setup

**Purpose**: establish a reproducible baseline for the feature.

- [x] T001 Record the NR-115 fixture matrix (controlled/untracked/missing
      product; dated/empty payables; debtor/zero/homonymous customers; two
      tenants) in `specs/006-consultar-estoque-pagar-fiado/quickstart.md`.
- [x] T002 Verify the baseline command paths and existing test ownership in
      `packages/agent/src/catalog.test.ts`, `packages/agent/src/process-message.test.ts`,
      `packages/core/src/inventory/inventory.test.ts`,
      `packages/core/src/payables/payables.test.ts`,
      `packages/core/src/registration/registration.test.ts` and
      `apps/api/src/routes/agent.test.ts`.

---

## Phase 2: Foundational

**Purpose**: define the shared, typed read-tool boundary before any user-story
tool is added.

**⚠️ CRITICAL**: Complete this phase before integrating a tool in the agent.

- [x] T003 Add exported Zod schemas for non-empty product/customer query input
      and strict empty payables input in `packages/contracts/src/inventory/movement.ts`,
      `packages/contracts/src/customer/customer.ts`, and their package exports,
      following `specs/006-consultar-estoque-pagar-fiado/contracts/agent-query-tools.md`.
- [x] T004 Extend `AgentUseCases` and the shared tool-definition seams in
      `packages/agent/src/catalog.ts` for typed, read-only query dependencies;
      preserve `mutatesValue: false` and do not add a `companyId` tool argument.
- [x] T005 Wire only the new `core` dependencies through
      `apps/api/src/composition.ts` and prove the composition remains within
      allowed boundaries in `apps/api/src/composition.test.ts`.

**Checkpoint**: typed catalog seam and API composition are ready; no tool
accesses `db` or `domain` directly.

---

## Phase 3: User Story 1 - Consultar estoque sem sair da conversa (Priority: P1) 🎯 MVP

**Goal**: return the app-equivalent stock, price and location for exactly one
product, while preserving “sem controle de estoque” as distinct from zero.

**Independent Test**: with a fixture product, send a single stock message
through FakeLlm and compare the reply to `checkStock`; repeat with untracked,
missing and ambiguous queries.

### Tests for User Story 1

- [x] T006 [P] [US1] Add failing core and repository tests for controlled
      stock, `stock = 0`, and “sem controle de estoque” (the `stock` field is
      absent rather than zero) plus optional location in
      `packages/core/src/inventory/inventory.test.ts` and
      `packages/db/src/estoque.test.ts`.
- [x] T007 [P] [US1] Add failing `check_stock` catalog and
      `processMessage` tests for found, missing and ambiguous product text in
      `packages/agent/src/catalog.test.ts` and
      `packages/agent/src/process-message.test.ts`.

### Implementation for User Story 1

- [x] T008 [US1] Add the inventory migration and adapter mapping needed to
      persist `tracksStock` and `location` in `packages/db/src/migrations/` and
      `packages/db/src/inventory-repository.ts`, so controlled zero is not
      conflated with untracked stock.
- [x] T009 [US1] Reuse `searchProducts` then `checkStock` in
      `packages/core/src/registration/register-product.ts` and
      `packages/core/src/inventory/check-stock.ts`; permit final lookup only for
      one candidate and return absence/alternatives otherwise.
- [x] T010 [US1] Register `check_stock` in `packages/agent/src/catalog.ts`
      from the contracts schema; format name, price, location and either numeric
      stock or explicit “sem controle de estoque”, without calculating money.
- [x] T011 [US1] Recognize deterministic stock phrases and preserve
      ambiguity/absence behavior in `packages/agent/src/fake-llm.ts` and verify
      the harness path in `apps/api/src/routes/agent.test.ts`.

**Checkpoint**: one stock query is independently usable, produces no
confirmation or write, and no product is selected silently.

---

## Phase 4: User Story 2 - Ver contas a pagar por vencimento (Priority: P1)

**Goal**: return current payables grouped as overdue, today, week and month,
with correct totals and explicit empty state.

**Independent Test**: seed titles in each required date group, send a payables
query through FakeLlm, and compare its formatted values with `listPayables`.

### Tests for User Story 2

- [x] T012 [P] [US2] Add failing cases for overdue/today/week/month totals,
      overdue emphasis, empty response and the “later” total in
      `packages/core/src/payables/payables.test.ts` and
      `packages/agent/src/catalog.test.ts`.
- [x] T013 [P] [US2] Add a failing conversational read-only test asserting no
      pending confirmation and no title mutation in
      `packages/agent/src/process-message.test.ts`.

### Implementation for User Story 2

- [x] T014 [US2] Register `list_payables` with strict empty input in
      `packages/agent/src/catalog.ts`, calling `listPayables` with `ctx.now` and
      formatting overdue, today, week and month totals; if `later` has entries,
      show its total separately as “depois deste mês”.
- [x] T015 [US2] Add deterministic payables intent recognition in
      `packages/agent/src/fake-llm.ts` and route-level coverage in
      `apps/api/src/routes/agent.test.ts`.

**Checkpoint**: payables response is independently correct, declares empty
state, and remains a no-write read operation.

---

## Phase 5: User Story 3 - Consultar o fiado de um cliente (Priority: P1)

**Goal**: return the correct wallet balance only after safe customer
resolution, including explicit zero and human choice for homonyms.

**Independent Test**: send wallet queries for one debtor, one zero-balance
customer, a missing customer and homonyms; compare single matches to the
customer's persisted `walletBalanceCents`.

### Tests for User Story 3

- [x] T016 [P] [US3] Add failing tenant-scoped customer resolution tests for
      zero, one and multiple bounded name matches in
      `packages/core/src/registration/registration.test.ts` and
      `packages/db/src/clientes.test.ts`.
- [x] T017 [P] [US3] Add failing `check_customer_wallet` tests for debtor,
      zero, missing and ambiguous customer replies in
      `packages/agent/src/catalog.test.ts` and
      `packages/agent/src/process-message.test.ts`.

### Implementation for User Story 3

- [x] T018 [US3] Add a bounded, tenant-scoped customer-by-query use case and
      repository port/adapter in `packages/core/src/registration/register-customer.ts`
      and `packages/db/src/registration-repositories.ts`; return distinguishable
      alternatives and never select multiple candidates automatically.
- [x] T019 [US3] Register `check_customer_wallet` in
      `packages/agent/src/catalog.ts` with the contracts schema; format persisted
      cent values and state explicit zero debt without calculating a balance.
- [x] T020 [US3] Add deterministic fiado intent recognition in
      `packages/agent/src/fake-llm.ts`, compose the use case in
      `apps/api/src/composition.ts`, and prove API-harness behavior in
      `apps/api/src/routes/agent.test.ts`.

**Checkpoint**: wallet lookup is independently usable; homonyms expose no
chosen balance and other tenants remain absent.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: prove the full feature, protect tenant boundaries and update its
delivery record.

- [x] T021 [P] Add cross-tool tests that each query has `mutatesValue: false`,
      creates no confirmation and produces no inventory/title/wallet write in
      `packages/agent/src/catalog.test.ts` and
      `packages/agent/src/process-message.test.ts`.
- [x] T022 [P] Add PostgreSQL/RLS cross-tenant coverage for stock, payables
      and customer resolution in `packages/db/src/estoque.test.ts`,
      `packages/db/src/custos-fixos.test.ts` and `packages/db/src/clientes.test.ts`,
      asserting foreign data is absent.
- [x] T023 Update the feature coverage and quickstart commands in
      `packages/agent/README.md` and
      `specs/006-consultar-estoque-pagar-fiado/quickstart.md`.
- [x] T024 Update NR-115 to ✅ with the delivered PR reference in
      `docs/processo/task-ledger.md`.
- [x] T025 Run the end-to-end verification commands from
      `specs/006-consultar-estoque-pagar-fiado/quickstart.md`: targeted package
      tests, `pnpm format:check`, `pnpm boundaries`, `pnpm typecheck`, root
      `pnpm test` and the relevant build.

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 (baseline)
  → Phase 2 (typed catalog + composition)
  → US1 stock (MVP)
  → US2 payables ─┐
  → US3 wallet   ─┴→ Phase 6 (cross-cutting verification)
```

### User Story Dependencies

- **US1 (P1)**: depends on T003–T005; is the suggested MVP.
- **US2 (P1)**: depends on T003–T005, but not on US1 after the shared catalog
  seam is complete.
- **US3 (P1)**: depends on T003–T005, but not on US1/US2; it adds its own
  customer-resolution port.
- **Phase 6**: requires all intended stories.

### Parallel Opportunities

- T006 and T007 can proceed in parallel.
- T012 and T013 can proceed in parallel.
- T016 and T017 can proceed in parallel.
- Once Phase 2 is complete, US2 and US3 may be developed in parallel with
  US1 if separate contributors avoid shared `catalog.ts`, `fake-llm.ts` and
  API test files.
- T021–T024 can begin after implementations stabilize; T025 is last.

## Implementation Strategy

### MVP First

1. Complete T001–T005.
2. Complete T006–T011 for stock.
3. Run the US1 independent test and its targeted package tests.
4. Demo only the stock query; do not claim payables or fiado until their
   phases pass.

### Incremental Delivery

1. Add stock query with inventory semantics intact.
2. Add payables grouping by reusing `listPayables`.
3. Add safe customer resolution and wallet result.
4. Finish RLS/no-write tests, documentation, ledger and full gates.

## Format Validation

All 25 tasks use the required checkbox, sequential `T###` identifier and an
exact file path. Every user-story task is labeled `[US1]`, `[US2]` or `[US3]`;
only tasks that can safely proceed in parallel carry `[P]`.
