---
description: 'Task list for Buddy daily WhatsApp operations (012)'
---

# Tasks: Operação diária do Buddy no WhatsApp

**Input**: Design documents from `/specs/012-buddy-operacao-whatsapp/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md),
[contracts/agent-daily-ops-tools.md](./contracts/agent-daily-ops-tools.md),
[quickstart.md](./quickstart.md)

**Tests**: Obrigatórios — PRD, constitution V e [plan.md](./plan.md) exigem TDD.
Escrever testes que falham antes do código de produção em cada história.

**Clarifications**: Q1 soft-delete cliente/produto + frase “deletado”; “apagar
venda” → `cancel_sale`; conta/contato sem remoção nesta fatia
([spec.md](./spec.md) Clarifications + [research.md](./research.md) §3–4).

**Organization**: Setup + foundation (composition/FakeLlm); histórias P1 na
ordem da spec; US4 (P2) depois; polish com roteiro manual e gates do quickstart.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallel when different files and no incomplete prerequisite
- **[USn]**: Maps to user stories in [spec.md](./spec.md)

## Path Conventions

Monorepo: `packages/{contracts,core,db,agent}`, `apps/{api,web}`, `docs/qa/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Matriz de aceite alinhada e inventário do que já existe.

- [x] T001 Align the fixture/roteiro matrix (consultas, ranking, histórico,
      cadastro incompleto, edição, compra→venda, soft-delete, cancel venda,
      confirmação/TTL, idempotência, conta restrita, número sem cadastro) with
      [spec.md](./spec.md) in `specs/012-buddy-operacao-whatsapp/quickstart.md`
- [x] T002 [P] Inventory existing tools vs contract in `packages/agent/src/catalog.ts`
      and `apps/api/src/composition.ts` (`buildAgentUseCases`) against
      `specs/012-buddy-operacao-whatsapp/contracts/agent-daily-ops-tools.md`; note
      gaps only (no new tools yet)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Slots de `AgentUseCases`, FakeLlm e tipos prontos para as tools
novas. Núcleo de produto (`updateProduct` / `deleteProduct`) entra aqui porque
bloqueia US2 e US6.

**⚠️ CRITICAL**: Complete before user-story phases.

- [x] T003 Extend `AgentUseCases` in `packages/agent/src/catalog.ts` with slots
      `rankCustomers`, `rankProducts`, `updateCustomer`, `updateProduct`,
      `deleteCustomer`, `deleteProduct` (signatures from `@na-regua/core` /
      contracts); keep existing tools intact
- [x] T004 Wire new slots in `apps/api/src/composition.ts` `buildAgentUseCases`
      to `rankCustomers` / `rankProducts` (`packages/core/src/reports/rankings.ts`),
      `updateCustomer` / `deleteCustomer`
      (`packages/core/src/registration/register-customer.ts`); stub or throw
      clearly until product writers exist for `updateProduct` / `deleteProduct`
- [x] T005 [P] Add failing core tests for `updateProduct` in
      `packages/core/src/registration/register-product.test.ts` (or new sibling):
      altera só campos pedidos; `salePriceCents < costPriceCents` recusado com o
      produto completo em memória (schema `updateProductInputSchema` é `.partial()`
      sem refine — checagem no core, ver comentário em
      `packages/contracts/src/product/product.ts`)
- [x] T006 [P] Add failing core tests for `deleteProduct` setting `deleted_at`
      (nulo = vigente) so product leaves day-to-day search but row remains in
      `packages/core/src/registration/register-product.test.ts`
- [x] T007 Implement `updateProduct` and `deleteProduct` in
      `packages/core/src/registration/register-product.ts`, persist via
      `packages/db/src/registration-repositories.ts` (`products` UPDATE /
      `deleted_at`), export from `packages/core/src/index.ts`; green T005–T006
- [x] T008 [P] Add `PATCH /produtos/:id` and logical `DELETE /produtos/:id` in
      `apps/api/src/routes/cadastro.ts` calling the new use cases; cover in
      `apps/api/src/routes/cadastro.test.ts` (or existing cadastro route tests)
- [x] T009 Wire `updateProduct` / `deleteProduct` into
      `apps/api/src/composition.ts` `buildAgentUseCases` (replace stubs from T004)
- [x] T010 [P] Extend `FakeLlm` scripting surface in `packages/agent/src/fake-llm.ts`
      / `packages/agent/src/fake-llm.test.ts` so new tool ids can be scripted like
      existing mutations (normalized keys; no production recognizer required)

**Checkpoint**: Composition exposes all new use-case slots; product edit/delete
exist in core+API; FakeLlm can script new tool ids.

---

## Phase 3: User Story 1 — Consultar a loja na conversa (Priority: P1) 🎯 MVP

**Goal**: Ranking, histórico do cliente e consultas já existentes respondem sem
confirmação, com os números da tela (FR-004–FR-009).

**Independent Test**: FakeLlm + `processMessage`: perguntas de período, ranking,
histórico, estoque, contas, carteira, agenda — zero `PendingConfirmation`;
período sem venda sem ticket inventado; ranking sem período pede clarify.

### Tests for User Story 1

- [x] T011 [P] [US1] Add failing catalog tests in `packages/agent/src/catalog.test.ts`
      for `rank_customers` / `rank_products`: `mutatesValue: false`,
      `rankingInputSchema`, `formatReply` with names/values from core output
- [x] T012 [P] [US1] Add failing `process-message.test.ts` cases: ranking with
      period → `rank_*` execute; ranking without period → clarify, no execute
- [x] T013 [P] [US1] Add failing `process-message.test.ts` cases: customer purchase
      history via `list_sales` + `customerId`; empty history phrase; period with
      sales returns qty/total/ticket; zero sales → no invented ticket medium
- [x] T014 [P] [US1] Add failing regression scripts in
      `packages/agent/src/process-message.test.ts` for existing reads
      (`list_sales` today, `period_summary`, `revenue_by_month`, `check_stock`,
      `list_payables`, `list_receivables`, `check_customer_wallet`, `day_agenda`,
      `search_products`) asserting no confirmation

### Implementation for User Story 1

- [x] T015 [US1] Implement tools `rank_customers` and `rank_products` in
      `packages/agent/src/catalog.ts` per
      `specs/012-buddy-operacao-whatsapp/contracts/agent-daily-ops-tools.md`
- [x] T016 [US1] Enrich `list_sales` description + `formatReply` in
      `packages/agent/src/catalog.ts` for customer history and empty-period /
      zero-sales ticket rules (FR-005, FR-008)
- [x] T017 [US1] Add FakeLlm scripts / roteiros in
      `packages/agent/src/process-message.test.ts` (and `fake-llm` helpers if
      needed) for US1 phrases; green T011–T014
- [x] T018 [P] [US1] Add HTTP smoke in `apps/api/src/routes/agent.test.ts` for
      ranking and history `POST /agent/messages` (stubs)

**Checkpoint**: US1 demonstrável no harness sem WhatsApp.

---

## Phase 4: User Story 2 — Cadastrar e corrigir cliente e produto (Priority: P1)

**Goal**: Cadastro completo com clarify; edição de um cliente/produto por vez;
ficha web mostra preço/custo; sem lote (FR-010–FR-017).

**Independent Test**: “adicione café” incompleto não grava; produto completo →
sim grava; preço < custo recusa; update telefone só muda telefone; update preço
produto → retorno/ficha com preço novo e custo anterior.

### Tests for User Story 2

- [x] T019 [P] [US2] Add failing catalog tests for `update_customer` /
      `update_product` (`mutatesValue: true`) in
      `packages/agent/src/catalog.test.ts`
- [x] T020 [P] [US2] Add failing `process-message.test.ts`: incomplete product
      (“adicione café”) → clarify, no pending write; complete product → confirm →
      sim; price < cost → no write
- [x] T021 [P] [US2] Add failing `process-message.test.ts`:
      `update_customer` only phone; `update_product` only `salePriceCents`;
      ambiguous name → clarify; batch price request → no multi update
- [x] T022 [P] [US2] Add failing web/API tests: `PATCH /produtos/:id` reflected in
      `apps/web/src/lib/produtos-api.ts` / `apps/web/src/components/produtos/ProdutoDetalhe.tsx`
      (or component test) showing new sale price and prior cost

### Implementation for User Story 2

- [x] T023 [US2] Implement `update_customer` and `update_product` tools in
      `packages/agent/src/catalog.ts` using `updateCustomerInputSchema` /
      `updateProductInputSchema` + entity id; proposal lists only changed fields
- [x] T024 [US2] Ensure `create_customer` / `create_product` FakeLlm + clarify
      paths cover required/optional fields and duplicate RF-010 in
      `packages/agent/src/process-message.test.ts` / `fake-llm.ts`
- [x] T025 [US2] Enable product edit on web ficha in
      `apps/web/src/components/produtos/ProdutoDetalhe.tsx` and
      `apps/web/src/lib/produtos-api.ts` (PATCH); keep unit constraints
      `description` min 2 max 200; money in cents
- [x] T026 [US2] Green T019–T022; regress `packages/agent/src/catalog.test.ts`

**Checkpoint**: Cadastro e edição alinhados à tela; ficha produto editável.

---

## Phase 5: User Story 3 — Registrar venda (“compra”) (Priority: P1)

**Goal**: “Compra” do cliente vira `create_sale` com os mesmos dados da tela
(FR-014–FR-015).

**Independent Test**: frase de compra completa → confirmação → sim cria venda;
incompleto pede itens/valores/pagamento; ambiguidade de cliente/produto pergunta.

### Tests for User Story 3

- [x] T027 [P] [US3] Add failing FakeLlm + `process-message.test.ts` cases:
      “lança a compra do João …” → tool `create_sale` (not receivable); confirm →
      `registerSale`
- [x] T028 [P] [US3] Add failing cases: incomplete sale clarify; ambiguous
      customer/product → clarify, no auto-pick

### Implementation for User Story 3

- [x] T029 [US3] Update `create_sale` tool description in
      `packages/agent/src/catalog.ts` so “compra” do cliente maps to sale; forbid
      `create_receivable` for that intent
- [x] T030 [US3] Add scripts in `packages/agent/src/fake-llm.ts` /
      `process-message.test.ts`; green T027–T028

**Checkpoint**: Intenção “compra” fecha venda no harness.

---

## Phase 6: User Story 5 — Só gravar depois do sim (Priority: P1)

**Goal**: Portão de confirmação, falha sem fingir sucesso, idempotência
(FR-018–FR-021, FR-025–FR-026) nas tools novas e nas mutações cobertas.

**Independent Test**: proposta → não / ambíguo / TTL → zero efeito; sim no prazo
→ um efeito; reentrega da mesma mensagem confirmada → um registro; falha core →
frase de falha.

### Tests for User Story 5

- [x] T031 [P] [US5] Add failing `process-message.test.ts` matrix for
      `update_product` and `mark_customer_deleted` (or `update_customer`): não,
      ambíguo, TTL expired sim → zero execute
- [x] T032 [P] [US5] Add failing case: core throws after sim → answer is failure,
      never claims success
- [x] T033 [P] [US5] Add failing idempotency case for a confirmed mutation
      redelivery (same channel message id / confirmation path) in
      `packages/agent/src/process-message.test.ts` or agent route test — second
      delivery does not create second row (RNF-043)
- [x] T034 [P] [US5] Add failing case: unrecognized intent → refuse / capabilities,
      no write (RF-097)

### Implementation for User Story 5

- [x] T035 [US5] Fix laço / tooling gaps in `packages/agent/src/process-message.ts`
      and catalog error formatting so T031–T034 pass; reuse NR-061 confirmation
      store — do not replace with Mastra HITL

**Checkpoint**: Confirmação e idempotência cobrem tools desta fatia.

---

## Phase 7: User Story 6 — Marcar como deletado (Priority: P1)

**Goal**: Soft-delete cliente/produto com frase “deletado”; “apagar venda” =
cancelamento; conta/contato recusados sem remoção (FR-022–FR-023).

**Independent Test**: apagar cliente/produto → sim → `deleted_at` set, frase
deletado, still stored; apagar venda → `cancel_sale`; apagar conta/contato →
recusa sem DELETE.

### Tests for User Story 6

- [x] T036 [P] [US6] Add failing catalog tests for `mark_customer_deleted` /
      `mark_product_deleted` (`mutatesValue: true`) in
      `packages/agent/src/catalog.test.ts`; assert no physical-delete tool exists
- [x] T037 [P] [US6] Add failing `process-message.test.ts`: soft-delete customer/
      product → confirm → sim → delete use case; failure does not say deletado
- [x] T038 [P] [US6] Add failing case: “apague a venda …” → `cancel_sale` path;
      status cancelled; row remains
- [x] T039 [P] [US6] Add failing case: “apague a conta/contato …” → refuse, no
      write

### Implementation for User Story 6

- [x] T040 [US6] Implement `mark_customer_deleted` / `mark_product_deleted` in
      `packages/agent/src/catalog.ts` calling `deleteCustomer` / `deleteProduct`;
      success phrase says deletado
- [x] T041 [US6] Map delete-sale language to `cancel_sale` via tool description +
      FakeLlm scripts in `packages/agent/src/catalog.ts` and
      `packages/agent/src/fake-llm.ts` / tests
- [x] T042 [US6] Add refuse path for conta/contato delete intents (catalog refuse
      tool or clarify text) without schema change; green T036–T039

**Checkpoint**: Soft-delete e cancelamento de venda alinhados à research.

---

## Phase 8: User Story 7 — Só a dona opera a loja (Priority: P1)

**Goal**: Owner ativo opera; número sem cadastro não lê/escreve; conta restrita
lê e não grava (FR-001–FR-003, FR-029).

**Independent Test**: peer autorizado consulta e muta; número desconhecido /
inativo / celular antigo sem dado da loja; restricted context: rank OK,
`update_product` blocked.

### Tests for User Story 7

- [x] T043 [P] [US7] Add failing `process-message.test.ts` (or whatsapp webhook
      regression) for unauthorized peer: no list/rank/update
- [x] T044 [P] [US7] Add failing case: restricted/`assertCanWrite` context —
      `rank_customers` succeeds; `update_product` / `mark_customer_deleted`
      refused with block explanation (RF-117/118)

### Implementation for User Story 7

- [x] T045 [US7] Green T043–T044 using existing `abrirCanal` / authorization in
      core; fix only gaps in agent reply text for restricted writes in
      `packages/agent/src/process-message.ts` or tool error mapping

**Checkpoint**: Identidade e conta restrita cobertos no harness.

---

## Phase 9: User Story 4 — Contas, estoque, cancelamento, agenda e cobrança (Priority: P2)

**Goal**: Fechar laço FakeLlm/process-message para mutações já no catálogo
(settle, adjust, cancel, appointment, charge) (história 4).

**Independent Test**: cada mutação → confirmação → sim chama core; cliente sem
dívida não envia cobrança; ajuste/cancel sem motivo → clarify.

### Tests for User Story 4

- [x] T046 [P] [US4] Add failing FakeLlm + `process-message.test.ts` cases for
      `create_payable`, `create_receivable`, `settle_payable`, `settle_receivable`
- [x] T047 [P] [US4] Add failing cases for `adjust_stock` (qty + reason),
      `cancel_sale` (reason), `create_appointment`, `day_agenda`
- [x] T048 [P] [US4] Add failing cases for `send_charge` with debt vs no debt

### Implementation for User Story 4

- [x] T049 [US4] Add FakeLlm scripts and green T046–T048; fix
      `formatProposal`/`formatReply` gaps only in `packages/agent/src/catalog.ts`
      if tests expose them
- [x] T050 [P] [US4] Add HTTP smoke stubs for one settle + one charge flow in
      `apps/api/src/routes/agent.test.ts`

**Checkpoint**: Operação diária de contas/estoque/agenda/cobrança no harness.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Roteiro manual, docs, gates.

- [x] T051 Create `docs/qa/buddy-roteiro-de-prompts.md` with enumerated table
      (#, Capacidade, Endpoint, Prompt, Resposta esperada, Conferir banco,
      Conferir web) — ≥1 line per capacity in [spec.md](./spec.md)
- [x] T052 [P] Update `packages/agent/README.md` with new tool ids and soft-delete
      vs cancel-sale rule
- [x] T053 [P] Link feature from ledger or module README if behavior ownership
      changed (`docs/processo/task-ledger.md` only if NR assigned)
- [x] T054 Run validation from `specs/012-buddy-operacao-whatsapp/quickstart.md`
      (contracts, catalog, core, process-message, agent routes)
- [x] T055 Run `pnpm format:check` at repo root; apply `pnpm format` if needed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: start immediately
- **Phase 2 (Foundational)**: after Setup — **blocks all stories**
- **Phases 3–8 (P1 stories)**: after Foundational; prefer US1 → US2 → US3 → US5 →
  US6 → US7 (US5 after new mutations exist; US6 needs product delete from Phase 2)
- **Phase 9 (US4 P2)**: after Foundational; can parallel with P1 if staffed, but
  FakeLlm file conflicts favor sequencing after US3
- **Phase 10 (Polish)**: after desired stories complete

### User Story Dependencies

| Story               | Depends on                | Notes                       |
| ------------------- | ------------------------- | --------------------------- |
| US1 Consultas       | Phase 2                   | MVP                         |
| US2 Cadastro/edição | Phase 2 (`updateProduct`) | Web ficha                   |
| US3 Compra→venda    | Phase 2                   | Uses existing `create_sale` |
| US5 Confirmação     | US2 tools at least        | Cross-cutting portão        |
| US6 Soft-delete     | Phase 2 `deleteProduct`   | Cancel sale mapping         |
| US7 Identidade      | Phase 2                   | Can parallel after US1      |
| US4 Contas/estoque… | Phase 2                   | P2; catalog mostly done     |

### Within Each Story

1. Failing tests first
2. Catalog / core / API / web as needed
3. FakeLlm + process-message green
4. Checkpoint before next priority

### Parallel Opportunities

- T001 ∥ T002
- T005 ∥ T006 ∥ T008 ∥ T010 (after T003–T004 started)
- Within a story: all `[P]` test tasks together
- After Phase 2: US1 and US7 can proceed in parallel if different owners;
  US2/US6 share `catalog.ts` — serialize those

---

## Parallel Example: User Story 1

```bash
# Tests in parallel:
Task: "T011 catalog rank_* mutatesValue false"
Task: "T012 process-message ranking period / clarify"
Task: "T013 process-message history + ticket rules"
Task: "T014 process-message existing reads no confirmation"

# Then implementation:
Task: "T015 implement rank_* tools in catalog.ts"
Task: "T016 enrich list_sales formatReply"
```

---

## Parallel Example: User Story 2

```bash
Task: "T019 catalog update_* tests"
Task: "T020 process-message create product incomplete/cost"
Task: "T021 process-message update fields / ambiguity"
Task: "T022 web/API PATCH produto ficha"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1–2
2. Phase 3 US1
3. **STOP** — validate consultas/ranking/histórico no harness
4. Demo sem WhatsApp

### Incremental Delivery

1. US1 consultas → demo
2. US2 edição/cadastro + ficha → demo
3. US3 compra→venda → demo
4. US5 portão → regressão
5. US6 soft-delete / cancel → demo
6. US7 identidade → demo
7. US4 contas/estoque/agenda/cobrança → demo
8. Polish + roteiro manual WhatsApp

### Parallel Team Strategy

1. Together: Phase 1–2 (product writers + composition)
2. Dev A: US1 (+ US7)
3. Dev B: US2 (+ US6 after deleteProduct)
4. Dev C: US3 + US4 FakeLlm
5. Anyone: US5 after update/mark tools land
6. Together: polish + format:check

---

## Notes

- Tools call **core**, not internal HTTP ([research.md](./research.md) §1)
- No tool may physically `DELETE` business rows
- Sale “delete” language → `cancel_sale` only
- Conta/contato delete → refuse this delivery
- `updateProductInputSchema` is partial; price≥cost enforced in **core** on full product
- Commit after each task or logical group; keep PR diffs ≤ ~400 lines when possible
- Next command: `/speckit-implement` (or implement story-by-story from MVP)
