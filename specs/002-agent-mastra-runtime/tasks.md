---
description: 'Task list for NR-060 agent Mastra runtime'
---

# Tasks: Assistente — runtime mínimo (NR-060)

**Input**: Design documents from `/specs/002-agent-mastra-runtime/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos onde SC/DoD e constitution V exigem prova (FakeLlm + Vitest; sem OpenAI na CI)

**Organization**: Por user story da spec (US1–US7). Código base já existe — tarefas fecham lacunas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1…US7 map to spec user stories
- Exact file paths in every task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirmar ambiente Mastra/agent e alinhar docs de harness

- [x] T001 Verify `@mastra/core` and agent package scripts resolve in `packages/agent/package.json` and workspace install
- [x] T002 [P] Document local harness env (`AGENT_PROVIDER=fake|mastra`, `AGENT_MODEL`, `AGENT_HARNESS`, `AGENT_MONTHLY_BUDGET_CENTS`) in `packages/agent/README.md` and `.env.example`
- [x] T003 [P] Cross-link feature quickstart in `packages/agent/README.md` to `specs/002-agent-mastra-runtime/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Porteiro do harness, composição, teto de IA e texto de capacidades — bloqueia todas as stories

**⚠️ CRITICAL**: No user story work until this phase completes

- [x] T004 Add optional `AGENT_HARNESS` (or equivalent) to `packages/env/src/api.ts` and cover parse/defaults in `packages/env/src/api.test.ts`
- [x] T005 Harden `motivoDoAgenteIndisponivel` / `buildAgentDeps` in `apps/api/src/composition.ts` so production never serves product channel with fake; non-prod (or harness flag) serves fixture session path
- [x] T006 Align `POST /agent/messages` gate comments and 503 behavior with FR-001b in `apps/api/src/routes/agent.ts` (session from fixture only; no `companyId` in body)
- [x] T007 [P] Extend `apps/api/src/composition.test.ts` and `apps/api/src/routes/agent.test.ts` for unavailable/fake-in-prod/harness-off cases
- [x] T008 Implement in-memory `AiUsageCounter` (companyId + YYYY-MM + units; budget from `AGENT_MONTHLY_BUDGET_CENTS`) in `packages/agent/src/ai-usage.ts`
- [x] T009 Wire usage check into `packages/agent/src/process-message.ts` so over-budget returns warned degradation and never executes mutatesValue tools
- [x] T010 Update `textoDasCapacidades` in `packages/agent/src/catalog.ts` to list only current catalog tools with no US-065–067/roadmap wording (RF-097 / clarify)

**Checkpoint**: Harness gated; budget hook ready; capabilities text honest — stories can proceed

---

## Phase 3: User Story 1 — Runtime pronto para interpretar e agir (Priority: P1) 🎯 MVP

**Goal**: Dev with fixture + FakeLlm can POST a message and get tool→core reply; unknown lists capabilities; Mastra path shares same loop

**Independent Test**: `AGENT_PROVIDER=fake`, fixture session, `quanto vendi hoje?` → answer from core; nonsense → capabilities only; optional mastra smoke outside CI

- [x] T011 [US1] Ensure `createAgentRuntime` / `buildAgentDeps` expose FakeLlm by default and Mastra via `packages/agent/src/mastra-llm.ts` without changing `POST /agent/messages` contract in `packages/contracts/src/agent/message.ts`
- [x] T012 [US1] Confirm Mastra tool `execute` remains identity-only in `packages/agent/src/mastra-llm.ts` (no core side effects inside generate)
- [x] T013 [US1] Add/extend FakeLlm read recognizer coverage for unknown→capacidades in `packages/agent/src/fake-llm.ts` and `packages/agent/src/process-message.test.ts`
- [x] T014 [US1] Add API integration smoke for `POST /agent/messages` happy/unknown paths with FakeLlm in `apps/api/src/routes/agent.test.ts`

**Checkpoint**: US1 MVP — runtime harness demonstrable without OpenAI

---

## Phase 4: User Story 2 — Consultar o negócio por mensagem (Priority: P1)

**Goal**: “quanto vendi hoje?” and “quem está me devendo?” match app use cases; stock/payables/wallet questions only list current capabilities

**Independent Test**: Same fixture data → agent totals equal `listSales` / `listReceivables`; estoque question → no invented stock tool

- [x] T015 [P] [US2] Verify `list_sales` and `list_receivables` tools in `packages/agent/src/catalog.ts` call `listSales` / `listReceivables` via `AgentUseCases` wired in `apps/api/src/composition.ts`
- [x] T016 [US2] Point FakeLlm “resumo do mes” away from being the only consult path; keep sales/receivables recognizers in `packages/agent/src/fake-llm.ts`
- [x] T017 [US2] Assert estoque/a pagar/saldo phrases resolve to `unknown` + capacidades (not NR-115 tools) in `packages/agent/src/process-message.test.ts`

**Checkpoint**: US-047 consult path solid; out-of-scope consults honest

---

## Phase 5: User Story 3 — Cadastrar cliente por mensagem (Priority: P1)

**Goal**: NL extract → confirmation → `registerCustomer`; duplicates via core; ambiguous confirm = no

**Independent Test**: scripted FakeLlm create_customer → confirmation → sim → customer; duplicate phone handled; “talvez” does not write

- [x] T018 [US3] Confirm `create_customer` tool uses `createCustomerInputSchema` and `mutatesValue: true` in `packages/agent/src/catalog.ts`
- [x] T019 [US3] Add FakeLlm `script()` fixtures for create_customer + confirmation flows in `packages/agent/src/process-message.test.ts`
- [x] T020 [US3] Cover duplicate_found reply formatting from `registerCustomer` result in `packages/agent/src/catalog.ts` / tests

**Checkpoint**: US-048 mutates only after explicit sim

---

## Phase 6: User Story 4 — Lançar venda por mensagem (Priority: P1)

**Goal**: Sale via same `registerSale`; disambiguation via `search_products`; discount/mixed/wallet rules from core; NFC-e only as sale side-effect

**Independent Test**: scripted create_sale → confirmation → sale net equals app; ambiguous product → clarify list; wallet without customer refused by core

- [x] T021 [US4] Confirm `create_sale` + `search_products` tools map to `createSaleInputSchema` / `catalogInputSchema` in `packages/agent/src/catalog.ts`
- [x] T022 [US4] Wire idempotency `agent:${requestId}` for registerSale in `apps/api/src/composition.ts` (keep if already present; add test)
- [x] T023 [US4] Add FakeLlm scripts for sale, disambiguation (`search_products` then `create_sale`), and refusal paths (fiado sem cliente) in `packages/agent/src/process-message.test.ts`
- [x] T024 [US4] Assert agent never computes money — formatters only display core cents — in `packages/agent/src/format.test.ts` / catalog formatters

**Checkpoint**: US-049 / RF-100–102 / RF-136 path proven with FakeLlm scripts

---

## Phase 7: User Story 7 — Recusar o que não entra no Zap (Priority: P1)

**Goal**: Certificate, banking import/OFX, standalone invoice commands refused with app pointer; zero side effects

**Independent Test**: Three phrases → refuse tools/text; no files stored; no Focus call

- [x] T025 [P] [US7] Add `refuse_certificate`, `refuse_banking`, `refuse_invoice_command` tools (empty/strict input, no business execute) in `packages/agent/src/catalog.ts`
- [x] T026 [P] [US7] Route FakeLlm regex/scripts for certificado/OFX/“emite a nota” to refuse tools in `packages/agent/src/fake-llm.ts`
- [x] T027 [US7] Update Mastra `INSTRUCOES` in `packages/agent/src/mastra-llm.ts` to prefer refuse tools for RF-149–151
- [x] T028 [US7] Add SC-004 tests (refuse + no side effect) in `packages/agent/src/process-message.test.ts`

**Checkpoint**: Compliance refusals testable without Meta

---

## Phase 8: User Story 5 — Enviar cobrança por mensagem (Priority: P2)

**Goal**: Charge customer with open debt via MessageSender fake; confirm send; no debt → inform

**Independent Test**: scripted send_charge → confirmation → fake send; zero debt → answer, no send

- [x] T029 [P] [US5] Add `sendChargeInputSchema` (customerId and/or phone; strict; no companyId) in `packages/contracts/src/agent/` (new module) and export from contracts index
- [x] T030 [US5] Implement `sendCustomerCharge` use case in `packages/core/src/receivables/send-customer-charge.ts` using receivables + `MessageSender` (consent required); export from `packages/core/src/index.ts`
- [x] T031 [US5] Unit-test sendCustomerCharge (debt / no debt / consent) with fake MessageSender in `packages/core/src/receivables/send-customer-charge.test.ts`
- [x] T032 [US5] Add `send_charge` tool (`mutatesValue: true`) to `packages/agent/src/catalog.ts` and extend `AgentUseCases`
- [x] T033 [US5] Wire MessageSender fake + sendCustomerCharge in `apps/api/src/composition.ts` `buildAgentDeps`
- [x] T034 [US5] FakeLlm script + processMessage confirmation tests for charge in `packages/agent/src/process-message.test.ts`

**Checkpoint**: US-052 / RF-107 works on harness with fake sender

---

## Phase 9: User Story 6 — Receber relatório por mensagem (Priority: P2)

**Goal**: “resumo do mês” → DRE axes (faturamento, custo, despesas, resultado); long text truncated; no RF-109 file/link

**Independent Test**: period_summary reply includes four axes from `buildDre`; oversized reply truncated; RF-109 debt noted in README

- [x] T035 [US6] Add `period_summary` tool using `dreInputSchema` → `buildDre` in `packages/agent/src/catalog.ts`; format faturamento/custo/despesas/resultado with truncation helper in `packages/agent/src/format.ts`
- [x] T036 [US6] Wire `buildDre` into `AgentUseCases` / `buildAgentDeps` in `apps/api/src/composition.ts`
- [x] T037 [US6] Change FakeLlm “resumo do mes” recognizer to `period_summary` (not `revenue_by_month`) in `packages/agent/src/fake-llm.ts`
- [x] T038 [US6] Tests for DRE formatting + truncation (RF-108; RF-109 not implemented) in `packages/agent/src/process-message.test.ts` / `format.test.ts`
- [x] T039 [P] [US6] Document RF-109 as explicit debt in `packages/agent/README.md` and note in `docs/processo/task-ledger.md` delivery comment / PR body

**Checkpoint**: RF-108 DoD met; RF-109 explicitly deferred

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Ledger, docs, boundaries, quickstart validation

- [x] T040 [P] Mark NR-060 ✅ and keep status notes consistent in `docs/processo/task-ledger.md` (PR)
- [x] T041 [P] Sync `docs/arquitetura/integracoes/mastra.md` with period_summary, send_charge, refuse tools, harness clarifications
- [x] T042 Run `pnpm boundaries` and fix any new agent/api import violations
- [x] T043 Run `pnpm --filter @na-regua/agent test` and `pnpm --filter api test -- agent`
- [x] T044 Execute manual checklist in `specs/002-agent-mastra-runtime/quickstart.md` with fixture + FakeLlm
- [x] T045 [P] Optional SC-006 smoke notes (mastra + key) in `packages/agent/README.md` — not CI

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: start immediately
- **Foundational (2)**: after Setup — **BLOCKS** all stories
- **US1 → US2 → US3 → US4 → US7** (P1): after Foundational; prefer this order (runtime → consult → mutate → sale → refuse)
- **US5, US6** (P2): after Foundational; can parallel after US1 if staffed (US5 needs contracts/core; US6 needs DRE wire)
- **Polish (10)**: after desired stories complete

### User Story Dependencies

| Story        | Depends on                             | Notes                                                     |
| ------------ | -------------------------------------- | --------------------------------------------------------- |
| US1 Runtime  | Phase 2                                | MVP                                                       |
| US2 Consult  | US1 (catalog + FakeLlm)                | Can tighten in parallel with US1 if catalog already wired |
| US3 Customer | Phase 2 + confirmation loop (exists)   | Independent with scripts                                  |
| US4 Sale     | US3 helpful for fixtures, not hard dep | Independent with scripts                                  |
| US7 Refuse   | Phase 2                                | Parallelizable with US3/US4 ([P] tools)                   |
| US5 Charge   | Phase 2; contracts+core first          | After or parallel to US4                                  |
| US6 Report   | Phase 2                                | Parallel to US5                                           |

### Parallel Opportunities

- T002 ∥ T003 (Setup docs)
- T025 ∥ T026 (refuse tools vs FakeLlm routes)
- T029 ∥ early US6 work on format helpers
- T040 ∥ T041 ∥ T045 (docs)
- After Phase 2: Dev A US5 (charge), Dev B US6 (DRE), Dev C US7 (refuse)

---

## Parallel Example: User Story 7

```bash
Task: "Add refuse_* tools in packages/agent/src/catalog.ts"
Task: "Route FakeLlm certificado/OFX/nota in packages/agent/src/fake-llm.ts"
```

## Parallel Example: User Stories 5 & 6

```bash
Task: "sendChargeInputSchema in packages/contracts + sendCustomerCharge in packages/core"
Task: "period_summary + buildDre wire in catalog.ts / composition.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup
2. Phase 2 Foundational (porteiro + budget + capacidades)
3. Phase 3 US1
4. **STOP** — validate quickstart rows 1–3 with FakeLlm

### Incremental Delivery (DoD)

1. US2 consult → US3 customer → US4 sale → US7 refuse (P1 complete)
2. US5 charge + US6 DRE summary (P2 / ledger DoD)
3. Polish: ledger ✅, RF-109 debt, boundaries, quickstart

### Suggested MVP scope

**US1 only** for first demo; **merge DoD** requires through US7 P1 + US5 + US6/RF-108 (per clarify).

---

## Notes

- Do not implement RF-109 file/link; only document debt (T039)
- Do not add Mastra Studio / Memory / RAG (NR-121 / 062 / 120)
- Confirmation persistence stays in-memory (NR-061)
- All mutatesValue paths need FakeLlm `script()` for CI — no sale regex in FakeLlm
- Refs: NR-060 in commits/PR footer
