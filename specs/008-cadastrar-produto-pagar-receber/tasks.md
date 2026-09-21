---
description: 'Task list for NR-117 product, payable and receivable mutations in the agent'
---

# Tasks: Cadastrar produto e lançar pagar/receber por mensagem (NR-117)

**Input**: Design documents from `/specs/008-cadastrar-produto-pagar-receber/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/agent-mutation-tools.md](./contracts/agent-mutation-tools.md)

**Tests**: Required by spec FR-012 and constitution V. Add failing tests in
`process-message.test.ts` / `agent.test.ts` before fixing the laço; `catalog.test.ts`
already covers tool wiring — extend only for gaps.

**Clarifications (2026-09-21)**: preço abaixo do custo → recusa no schema (1A);
vencida = faixa `overdue` (2A); EAN duplicado → avisar, sem reutilizar no chat
(3A); SC com 1–2 testes API+Postgres no quickstart (10B).

**Organization**: Foundational FakeLlm + audit of existing tools; each P1 user story
closes the conversational loop for one mutation; polish runs quickstart gates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallel when different files and no incomplete prerequisite.
- **[USn]**: Maps to user stories in [spec.md](./spec.md) (US1 = produto, US2 = pagar, US3 = receber).

## Phase 1: Setup

**Purpose**: Reproducible baseline and ownership map.

- [x] T001 Align the NR-117 fixture matrix (produto feliz, preço abaixo do custo, EAN
      duplicado, conta a pagar, vencimento passado, recebível avulso, dados incompletos,
      recusa/TTL, foto→cadastro, tenant A/B) with [spec.md](./spec.md) in
      `specs/008-cadastrar-produto-pagar-receber/quickstart.md`
- [x] T002 Verify existing tool unit coverage and composition wiring in
      `packages/agent/src/catalog.test.ts` (describe `create_product` / `create_payable` /
      `create_receivable`), `apps/api/src/composition.ts` and
      `packages/core/src/registration/register-product.ts`,
      `packages/core/src/payables/create-payable.ts`,
      `packages/core/src/receivables/create-receivable.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Harness can invoke the three mutations via FakeLlm; tools match contract.
No new schemas or core cases of use in this phase.

**⚠️ CRITICAL**: Complete before user-story laço work.

- [x] T003 Audit `create_product`, `create_payable` and `create_receivable` in
      `packages/agent/src/catalog.ts` against
      `specs/008-cadastrar-produto-pagar-receber/contracts/agent-mutation-tools.md`
      (`mutatesValue: true`, `createProductInputSchema` / `createPayableInputSchema` /
      `createReceivableInputSchema`, `registerProduct` / `createPayable` /
      `createReceivable` on `AgentUseCases`); fix only mismatches
- [x] T004 [P] Extend `FakeLlm.decide` in `packages/agent/src/fake-llm.ts` with scripted
      recognition for `create_product`, `create_payable` and `create_receivable` (phrases
      from `quickstart.md`; args must pass Zod on the tool schema)
- [x] T005 [P] Add or extend `describe('mutations NR-117')` in
      `packages/agent/src/catalog.test.ts` so `mutatesValue` flags for the three tools
      match [data-model.md](./data-model.md) and NR-118 tools are not required for green
      CI in this feature

**Checkpoint**: FakeLlm routes to the three tools; catalog contract unchanged or corrected.

---

## Phase 3: User Story 1 — Cadastrar produto (Priority: P1) 🎯 MVP

**Goal**: Lojista cadastra produto por texto (e código após foto NR-116) com confirmação;
mesmo `registerProduct` do app.

**Independent Test**: `processMessage` com FakeLlm: proposta `create_product` → `sim`
grava; `não`/TTL não grava; EAN duplicado e preço abaixo do custo sem gravação.

### Tests for User Story 1

- [x] T006 [P] [US1] Add failing cases in `packages/agent/src/process-message.test.ts`:
      cadastro completo → confirmação → `sim` chama `registerProduct`; `não` e TTL não
      chamam `registerProduct`
- [x] T007 [P] [US1] Add failing case: `parseToolArgs` / tool execution with
      `salePriceCents` menor que `costPriceCents` (refine do `createProductInputSchema`
      em `packages/contracts/src/product/product.ts`) — nenhuma pendência nem gravação
- [x] T008 [P] [US1] Add failing case: `registerProduct` lança conflito de EAN (stub
      `AppError.conflict`) — resposta clara e zero gravação
- [x] T009 [P] [US1] Add failing case: após resposta
      `TEXTO_FOTO_CADASTRO_CODIGO` (NR-116), turno seguinte com descrição, custo, preço e
      `barcode` nos args de `create_product` → confirmação → `sim`

### Implementation for User Story 1

- [x] T010 [US1] In `packages/agent/src/process-message.ts`, surface `AppError` de
      `registerProduct` e falhas Zod de `create_product` como `answer`/`clarify` sem
      efeito parcial (alinhado a `create_customer`) — **ja coberto** por
      `parseToolArgs` + `executar`/`responderErro` (sem diff)
- [x] T011 [US1] If T009 still fails: add optional `ProductRegistrationDraft` keyed by
      `conversationKey` in `packages/agent/src/process-message.ts` (mesmo padrão de
      `PhotoSaleDraft` em `packages/agent/src/photo-sale-draft.ts`) para preservar
      `barcode` entre turnos; MUST NOT persistir bytes de imagem — **nao necessario**
      (T009 verde com barcode nos args do harness; laço generico ja cobre Zod/AppError)
- [x] T012 [US1] Green all US1 tests in `packages/agent/src/process-message.test.ts` and
      regress `packages/agent/src/catalog.test.ts`
- [x] T012a [P] [US1] Add failing HTTP case in `apps/api/src/routes/agent.test.ts`:
      `POST /agent/messages` cadastro de produto → `kind: confirmation` para
      `create_product` (stub deps); green with T012

**Checkpoint**: US-069 / RF-140 demonstrável no harness sem WhatsApp.

---

## Phase 4: User Story 2 — Lançar conta a pagar (Priority: P1)

**Goal**: Conta a pagar por mensagem com confirmação; não inventar valor nem vencimento.

**Independent Test**: FakeLlm `create_payable` → `sim` chama `createPayable`; mensagem
incompleta não cria `PendingConfirmation`; vencimento passado grava título aberto.

### Tests for User Story 2

- [x] T013 [P] [US2] Add failing `process-message.test.ts` cases: proposta → `sim` /
      `não` / TTL; `dueDate` no passado com `status: open` e assert na faixa vencidas
      (`list_payables` stub ou resposta formatada); recorrência com N títulos e
      `formatReply` mencionando quantidade
- [x] T014 [P] [US2] Add failing case: pedido sem `amountCents` ou `dueDate` →
      `clarify` ou `answer` pedindo dado — sem `confirmationId`
- [x] T015 [P] [US2] Add failing HTTP case in `apps/api/src/routes/agent.test.ts`:
      `POST /agent/messages` com texto de aluguel → `kind: confirmation` para
      `create_payable` (stub deps)

### Implementation for User Story 2

- [x] T016 [US2] Green US2 tests; adjust `formatReply` em `create_payable` em
      `packages/agent/src/catalog.ts` only if recorrência com mais de um título não estiver legível na
      proposta/resposta

**Checkpoint**: US-070 / RF-141 no laço conversacional.

---

## Phase 5: User Story 3 — Lançar recebimento avulso (Priority: P1)

**Goal**: Recebível fora de venda com confirmação; não confundir com `create_sale`.

**Independent Test**: FakeLlm `create_receivable` → `sim` chama `createReceivable`;
frase de venda de produto continua em `create_sale`.

### Tests for User Story 3

- [x] T017 [P] [US3] Add failing `process-message.test.ts` cases: recebível avulso
      confirmado; dados incompletos sem pendência; frase de venda não mapeia para
      `create_receivable` no FakeLlm; dois clientes homônimos → `clarify`/lista sem
      `create_receivable` com `customerId` errado
- [x] T018 [P] [US3] Add failing HTTP case in `apps/api/src/routes/agent.test.ts` para
      `create_receivable` com confirmação

### Implementation for User Story 3

- [x] T019 [US3] Green US3 tests; tighten `create_receivable` description em
      `packages/agent/src/catalog.ts` se o LLM real confundir com venda (texto only)

**Checkpoint**: US-071 / RF-142 no laço conversacional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Docs, ledger, repo gates; tenant isolation across mutations.

- [x] T020 [P] Add cross-mutation test in `packages/agent/src/process-message.test.ts`:
      empresa A não executa `registerProduct`/`createPayable`/`createReceivable` com
      contexto da empresa B (isolamento RF-010 / SC-007)
- [x] T020a [P] Add test in `packages/agent/src/process-message.test.ts`: pendência
      `create_product` + mensagem de conta a pagar → `sim` não baixa conta nem reutiliza
      proposta de produto (edge confirmação não cruzada)
- [x] T020b [P] Add test in `packages/agent/src/process-message.test.ts`: papel sem
      `assertCanWrite` (ex. contexto read-only) → recusa do núcleo, zero gravação nas
      três mutações (pelo menos um caso representativo)
- [x] T020c [P] Add test in `packages/agent/src/process-message.test.ts`: stub rejeita
      em `execute` após `sim` → mensagem de erro clara; sem segunda confirmação automática
- [x] T020d [P] Add 1–2 integration tests in `apps/api/src/routes/agent.test.ts` (ou arquivo
      dedicado com `DATABASE_URL`) que persistem produto e/ou payable após confirmação
      real — ver matriz Postgres em `quickstart.md` (SC-001 / SC-003)
- [x] T021 [P] Update `packages/agent/README.md` with NR-117 section (três tools,
      confirmação, handoff foto, link para
      `specs/008-cadastrar-produto-pagar-receber/quickstart.md`); NR-118 tools fora do
      aceite
- [x] T022 Mark NR-117 ✅ in `docs/processo/task-ledger.md` in the same PR as
      implementation (footer `Refs: NR-117`)
- [x] T023 Run full gate list in
      `specs/008-cadastrar-produto-pagar-receber/quickstart.md` (`pnpm format:check`,
      `pnpm boundaries`, `pnpm typecheck`, agent + api tests)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2** → **Phases 3–5** (US1–US3 may run in parallel after Phase 2)
- **Phase 6** after Phases 3–5 (or after MVP Phase 3 only for minimal merge)

### User Story Dependencies

- **US1 (produto)**: Independent after Phase 2; MVP scope.
- **US2 (pagar)**: Independent after Phase 2; shares only generic confirmation laço.
- **US3 (receber)**: Independent after Phase 2; must not break `create_sale` (US1 da NR-060).

### Parallel Opportunities

- T004 + T005 in parallel after T003.
- Within US1: T006–T009 in parallel before T010–T012.
- US2 (T013–T016) and US3 (T017–T019) in parallel with each other after Phase 2.
- T020 + T021 in parallel before T022–T023.

### Parallel Example: User Story 2 + 3

```bash
# After Phase 2, two developers:
# Dev A: T013–T016 (process-message + agent.test payable)
# Dev B: T017–T019 (process-message + agent.test receivable)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 → Phase 2 → Phase 3 (T006–T012)
2. Run `pnpm --filter @na-regua/agent test -- src/process-message.test.ts`
3. Stop for review; US2/US3 can follow in same PR or stacked

### Incremental Delivery

1. Foundation (FakeLlm + audit)
2. Produto → contas a pagar → recebível avulso
3. Polish + ledger

---

## Notes

- Do **not** implement NR-118 (`settle_*`, `adjust_stock`, `cancel_sale`) acceptance in
  this task list.
- Preço abaixo do custo: schema recusa (research.md §3) — não relaxar só no agente.
- `pnpm format:check` before PR per workspace rules.
