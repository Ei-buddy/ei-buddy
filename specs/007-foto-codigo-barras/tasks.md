---
description: 'Task list for NR-116 barcode photo in the conversational agent'
---

# Tasks: Foto do código de barras por mensagem (NR-116)

**Input**: Design documents from `/specs/007-foto-codigo-barras/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md) and
[contracts/agent-barcode-photo.md](./contracts/agent-barcode-photo.md).

**Tests**: Required by FR-013 and constitution V. Write each behavior test
before the corresponding implementation and make it fail first.

**Clarifications (2026-09-18)**: photo-only asks for payment (no confirmation
yet); payment in the same or next message proposes `create_sale`; any other
next message drops the photo item. Spec wins over older plan/quickstart
wording.

**Organization**: shared message schema, decoder port and photo gate are
foundational; each P1 story then fills one route (sale, refusal, register).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel without touching the same files or incomplete
  prerequisite.
- **[USn]**: Maps a task to the numbered user story in
  [spec.md](./spec.md).

## Phase 1: Setup

**Purpose**: establish a reproducible baseline for the feature.

- [x] T001 Align the NR-116 fixture matrix (readable barcode of company A,
      unreadable/zero codes, two codes, unknown barcode, register intent,
      photo-only, photo+payment, next-message payment, next-message not
      payment, tenant B) with the spec clarifications in
      `specs/007-foto-codigo-barras/quickstart.md`.
- [x] T002 Verify the baseline command paths and existing test ownership in
      `packages/contracts/src/agent/message.test.ts`,
      `packages/core/src/registration/registration.test.ts`,
      `packages/agent/src/catalog.test.ts`,
      `packages/agent/src/process-message.test.ts` and
      `apps/api/src/routes/agent.test.ts`.

---

## Phase 2: Foundational

**Purpose**: accept a photo on the existing message loop, decode it behind a
port, and look up the product **before** the LLM. No sale, refusal copy or
register route yet.

**⚠️ CRITICAL**: Complete this phase before user-story routing.

- [x] T003 Extend `agentMessageInputSchema` in
      `packages/contracts/src/agent/message.ts` so the body is strict
      `{ text?: string, image?: { mimeType, dataBase64 } }` with refine “text
      não vazio OU image presente”; `text` trim max 4000 and may be empty only
      with image; `mimeType` is `image/jpeg` | `image/png` | `image/webp`;
      prove accept/reject cases in
      `packages/contracts/src/agent/message.test.ts`.
- [x] T004 [P] Declare `BarcodeDecoder` (`decode({ mimeType, bytes }) → { codes:
string[] }`) and `IncomingMessage.image` in
      `packages/agent/src/types.ts`; implement `FakeBarcodeDecoder` (fixture
      map → 0, 1 or many codes) in `packages/agent/src/barcode-decoder.ts`;
      inject it on `createAgentRuntime` in
      `packages/agent/src/create-runtime.ts` and export from
      `packages/agent/src/index.ts`. Missing decoder + image MUST fail closed
      as zero codes.
- [x] T005 Add `findProductByBarcode` to `AgentUseCases` in
      `packages/agent/src/catalog.ts` (no `companyId` argument; context only)
      and wire the existing `core` function through
      `apps/api/src/composition.ts` without importing `db` from the agent.
- [x] T006 In `packages/agent/src/process-message.ts`, when `image` is
      present: decode then, if exactly one code, call `findProductByBarcode`;
      skip `llm.decide` for the photo gate; persist
      `[foto do codigo]` (plus the code when read) in conversation history
      — never image bytes — via the existing append in
      `packages/agent/src/conversations.ts`. Without image, keep the current
      loop.
- [x] T007 Forward `image` as bytes (not base64) from
      `apps/api/src/routes/agent.ts` into `IncomingMessage`; keep
      `companyId` out of the body.

**Checkpoint**: HTTP/harness can send a photo; decoder + lookup run before the
LLM; bytes never hit history. Routes still unspecified until US1–US3.

---

## Phase 3: User Story 1 - Vender a partir da foto (Priority: P1) 🎯 MVP

**Goal**: a readable photo of an existing product becomes a sale item (qty 1,
`unitPriceCents` copied from `salePriceCents`). Missing payment → `clarify`.
Payment in this or the next message → `create_sale` confirmation. Any other
next message drops the item.

**Independent Test**: FakeLlm unused for the photo gate. Send photo-only →
ask payment, no `confirmationId`. Send photo+`no pix` or photo then `pix` →
confirmation of that product; `sim` records; `não` does not. Next message
“quanto vendi hoje?” after the payment question attends the query and does
not confirm the old sale.

### Tests for User Story 1

- [x] T008 [P] [US1] Add failing `processMessage` cases in
      `packages/agent/src/process-message.test.ts` for: photo-only (clarify
      payment, no confirmation); same-message payment; next-message payment
      reused without resending the photo; next-message that is not payment
      drops the item; `sim` after confirmation calls `registerSale` with
      `quantity` 1 and `unitPriceCents` equal to `salePriceCents`; tenant B
      does not see company A's product.
- [x] T009 [P] [US1] Add a failing HTTP case in
      `apps/api/src/routes/agent.test.ts` for `POST /agent/messages` with
      `image` + payment text that returns `kind: confirmation`.

### Implementation for User Story 1

- [x] T010 [US1] Hold a one-turn photo sale draft (product id, barcode, table
      price) outside `confirmations` — not image bytes — in
      `packages/agent/src/process-message.ts` (or a small helper beside it);
      bind it only when the following message is an unequivocal
      `paymentMethodSchema` value; otherwise drop it and run the normal loop.
- [x] T011 [US1] When payment is known, build `CreateSaleInput` with one item
      (`quantity` 1, `unitPriceCents` copied from the product) and one
      payment (`amountCents` equal to that line price) and reuse the existing
      `create_sale` confirmation path in `packages/agent/src/catalog.ts` /
      `packages/agent/src/process-message.ts`. Do not invent customer, Pix or
      discount; do not skip confirmation; do not add a new mutating tool.
- [x] T012 [US1] Make the US1 HTTP harness case in
      `apps/api/src/routes/agent.test.ts` pass with the fake decoder fixture.

**Checkpoint**: photo of a known product can be sold with confirmation; photo
alone never records a sale.

---

## Phase 4: User Story 2 - Recusar foto ilegível ou código sem produto (Priority: P1)

**Goal**: unreadable photos, unsupported MIME, empty/corrupt bytes, multiple
codes, and a read code with no product (and no register intent) refuse in
text, with no ad-hoc item and no “want to register?” prompt, and with zero
writes.

**Independent Test**: send an unreadable fixture and an unknown barcode
without cadastro text; replies match
[contracts/agent-barcode-photo.md](./contracts/agent-barcode-photo.md);
`registerSale` / `registerProduct` are not called; stock and catalog unchanged.

### Tests for User Story 2

- [x] T013 [P] [US2] Add failing refusal cases in
      `packages/agent/src/process-message.test.ts` for zero codes / invalid
      MIME / empty bytes (ilegível), two or more codes (um produto por vez),
      and unknown barcode without register intent (por texto, without `avulso`
      and without asking to cadastrar).
- [x] T014 [P] [US2] Add a failing isolation case: company B sending A's
      barcode is treated as unknown product in
      `packages/agent/src/process-message.test.ts` (reuse
      `findProductByBarcode` semantics already in
      `packages/core/src/registration/registration.test.ts`).

### Implementation for User Story 2

- [x] T015 [US2] Implement the stable refusal copies from
      `specs/007-foto-codigo-barras/contracts/agent-barcode-photo.md` in
      `packages/agent/src/process-message.ts` (kind `answer`, no
      `PendingConfirmation`, no `create_sale`). Multiple images in one payload
      use the same “um produto por vez” refusal (FR-011).
- [x] T016 [US2] Prove refusals leave catalog, stock and confirmations
      untouched in `packages/agent/src/process-message.test.ts`.

**Checkpoint**: error paths of US-068 / RF-139 are independently testable and
do not leak into sale or register.

---

## Phase 5: User Story 3 - Foto com pedido explícito de cadastro (Priority: P1)

**Goal**: photo + explicit register intent (`cadastr…`) is not a sale. The
read barcode is returned for later text registration (NR-117). Existing
product is announced; nothing is duplicated or invented.

**Independent Test**: photo + “cadastra este” with a read code → `answer`
containing the barcode, no `confirmationId`, no `registerSale`. Repeat with
an already-registered barcode → existing product named, still no sale.

### Tests for User Story 3

- [x] T017 [P] [US3] Add failing cases in
      `packages/agent/src/process-message.test.ts` for explicit register
      intent with a new barcode (code in the reply, no sale) and with an
      existing product (aviso do existente, no duplicate, no sale). Ambiguous
      text without `cadastr` MUST still follow the sale route from US1.

### Implementation for User Story 3

- [x] T018 [US3] Route explicit register intent after a successful decode in
      `packages/agent/src/process-message.ts` before the sale draft; include
      the barcode in the answer; do not call `registerProduct` or invent
      name/cost/price (NR-117). Photo without text remains sale-in-potential
      (FR-012).
- [x] T019 [US3] Cover register-intent HTTP smoke in
      `apps/api/src/routes/agent.test.ts` (answer with barcode, no
      confirmation).

**Checkpoint**: RF-138 routing is done without executing US-069.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: documentation, ledger, privacy of the image, and repo gates.

- [x] T020 [P] Document photo-before-LLM, fake decoder, and the sale/refuse/
      register table in `packages/agent/README.md`.
- [x] T021 [P] Mark NR-116 in progress/done with `Refs: NR-116` guidance in
      `docs/processo/task-ledger.md` (same PR as the code).
- [x] T022 Assert conversation `messages.body` and structured logs never
      contain `dataBase64` or raw bytes in
      `packages/agent/src/process-message.test.ts` (FR-009, RNF-034).
- [x] T023 Keep Studio text-only working after the schema change in
      `packages/agent/src/studio/relay-agent.ts` and
      `apps/api/src/studio.test.ts`; forward `image` only if the same
      `agentMessageInputSchema` already received it — no Studio UI work.
- [x] T024 If a decoder/env flag is introduced, add it to
      `docs/engenharia/ambientes.md` and `.env.example`; otherwise skip with
      a note in the PR that CI uses only `FakeBarcodeDecoder`.
- [x] T025 Run the verification commands in
      `specs/007-foto-codigo-barras/quickstart.md`: targeted package tests,
      `pnpm format:check`, `pnpm boundaries`, `pnpm typecheck`, root
      `pnpm test` and `pnpm build`.

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 (baseline)
  → Phase 2 (schema + decoder + photo gate + HTTP)
  → US1 sale from photo (MVP)
  → US2 refusals ─┐
  → US3 register ─┴→ Phase 6 (docs, ledger, gates)
```

### User Story Dependencies

- **US1 (P1)**: depends on T003–T007; suggested MVP.
- **US2 (P1)**: depends on T003–T007; can start after Phase 2 even if US1
  confirmation path is unfinished, but shares `process-message.ts`.
- **US3 (P1)**: depends on T003–T007; register intent must be checked
  **before** the US1 sale draft (T018 vs T010/T011).
- **Phase 6**: requires the intended stories.

### Within Each User Story

- Tests MUST be written and FAIL before implementation.
- Photo gate (Phase 2) before any route.
- Sale draft (US1) is not a `PendingConfirmation` until payment is known.
- Register route (US3) must not fall through to `create_sale`.

### Parallel Opportunities

- T004 can start beside T003 once the schema shape is agreed.
- T008 and T009 can proceed in parallel.
- T013 and T014 can proceed in parallel.
- After Phase 2, a second contributor can own US2/US3 files other than
  `process-message.ts`; that file is the serialization point.
- T020 and T021 can proceed in parallel once behavior is stable; T025 is last.

---

## Parallel Example: User Story 1

```bash
# After Phase 2, launch failing tests together:
Task: "T008 processMessage photo-only / next-turn payment / drop item"
Task: "T009 HTTP image + payment → confirmation"

# Then implement sequentially (same process-message.ts):
Task: "T010 one-turn sale draft"
Task: "T011 create_sale confirmation reuse"
Task: "T012 HTTP case green"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete T001–T007.
2. Complete T008–T012 (photo → payment question → confirmation → sim).
3. Stop and validate the US1 independent test.
4. Do not claim refusals or register routing until US2/US3 pass.

### Incremental Delivery

1. Photo accepted and decoded in the existing loop.
2. Known product can be sold without typing the barcode.
3. Unreadable / unknown codes refuse safely.
4. Explicit cadastro is not a silent sale; barcode is handed to NR-117.

## Format Validation

All 25 tasks use the required checkbox, sequential `T###` identifier and an
exact file path. Every user-story task is labeled `[US1]`, `[US2]` or
`[US3]`; only tasks that can safely proceed in parallel carry `[P]`.
