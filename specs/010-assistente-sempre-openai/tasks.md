---
description: 'Task list for serving the assistant only through OpenAI'
---

# Tasks: Assistente servido sempre pela OpenAI

**Input**: Design documents from `/specs/010-assistente-sempre-openai/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Pedidos pela spec (US3, SC-001) e pela constitution V. Escrever o caso que falha
antes de apagar o regex e antes de trocar a composição. A CI não chama a OpenAI.

**Clarifications (2026-10-01)**: processo que serve usa só Mastra quando há
`OPENAI_API_KEY`; sem chave a API sobe e o assistente fica 503; Studio permanece;
duas cópias de tool permanecem; foto não vai ao modelo; `AGENT_PROVIDER` sai.

**Organization**: O dublê `script()`-only é pré-requisito. US3 restaura a suíte que o
dublê quebra e por isso vem antes de US1, embora as três histórias sejam P1. US2 edita
os mesmos arquivos de US1 e depende dela.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallel when different files and no incomplete prerequisite.
- **[USn]**: Maps to user stories in [spec.md](./spec.md).

## Phase 1: Setup

**Purpose**: Confirm the runtime already exists. No new dependency and no migration.

- [x] T001 Confirm `@mastra/core` is already a dependency of `packages/agent/package.json`
      and that `createMastraLlm` in `packages/agent/src/mastra-llm.ts` still calls
      `agent.generate` with `maxSteps: 1` and an `execute` that returns the tool input.
      Do not add a package, a migration, or a second provider.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: `FakeLlm.decide` reads only the `script()` map. Without a row, the decision is
`{ type: 'unknown' }`. `tools`, `today` and `history` do not select a tool. The map key stays
trim + lowercase + accent stripped. The API does not start using this class to serve messages
in this phase.

**⚠️ CRITICAL**: US1, US2 and US3 wait on this phase.

- [x] T002 Add `packages/agent/src/fake-llm.test.ts` that fails against the current recognizer:
      without `script()`, `decide` on "quanto vendi hoje?", "resumo do mes",
      "lança aluguel 1800 vence dia 10", a certificate phrase, an OFX phrase and an invoice
      phrase each returns `{ type: 'unknown' }`; `script(texto, decisao)` still returns that
      decision for the normalized key; `history` does not change the result.
- [x] T003 Delete the Portuguese recognizer from `packages/agent/src/fake-llm.ts`
      (`reconhecerConsulta`, `reconhecerMutacaoNr117`, `reconhecerRecusa` and the date/cents
      helpers) so `decide` only looks up the `script()` map and otherwise returns
      `{ type: 'unknown' }`. Keep `script()` and the existing key normalization. Update the
      file comment: this class is a test double, not a server mode.
- [x] T004 In `packages/agent/src/create-runtime.ts`, keep the default `llm: opcoes.llm ?? new FakeLlm()`
      for tests that omit `llm` (FR-005). Change the comment so it says the default is the
      test double, and that `apps/api/src/composition.ts` must not serve messages through it.

**Checkpoint**: `fake-llm.test.ts` is green. Phrase-based tests in `process-message.test.ts` are
still red until Phase 3.

---

## Phase 3: User Story 3 - O merge não chama a OpenAI (Priority: P1)

**Goal**: The agent and API suites prove confirmation and cents with `script()`, without
`OPENAI_API_KEY` and without a Portuguese phrase selecting a tool.

**Independent Test**: `pnpm --filter @na-regua/agent test` passes with no `OPENAI_API_KEY`.
A `decide` without `script()` is `{ type: 'unknown' }`. A scripted `create_payable` still
asks for confirmation and writes only on "sim", with the same cents as the use case.

### Tests for User Story 3

- [x] T005 [P] [US3] In `packages/agent/src/process-message.test.ts`, remove the
      `describe('FakeLlm')` phrase→tool cases (they now live in `fake-llm.test.ts`). For every
      remaining turn that expected a tool from Portuguese text, call `llm.script(...)` with
      that decision before `processMessage`. Confirmation, "sim", "não", TTL and cent assertions
      stay. A phrase without `script()` expects `unknown` and the capabilities text.
- [x] T006 [P] [US3] In `packages/agent/src/studio/relay-agent.test.ts`, give every `FakeLlm`
      the tool decision through `script()` before the relay turn. Do not rely on a phrase
      matching a tool. The relay still must not call OpenAI.
- [x] T007 [P] [US3] In `apps/api/src/routes/agent.test.ts`, inject `FakeLlm` via
      `createAgentRuntime({ llm })` and `script()` the decision under test. Delete any
      assertion that a bare Portuguese sentence selects a tool.
- [x] T008 [P] [US3] In `apps/api/src/e2e/agent-mutations-nr117.test.ts` and
      `apps/api/src/e2e/agent-confirmation-restart.test.ts`, remove
      `vi.stubEnv('AGENT_PROVIDER', 'fake')`. Keep the double injected, with `script()` when
      the turn needs a tool.

**Checkpoint**: `pnpm --filter @na-regua/agent test` is green with no API key. The served
process still defaults to the double until Phase 4.

---

## Phase 4: User Story 1 - Assistente local fala com a OpenAI (Priority: P1) 🎯 MVP

**Goal**: With `OPENAI_API_KEY` and the harness gate open, the served runtime is
`createMastraLlm` only. `AGENT_PROVIDER` is not an environment field.

**Independent Test**: Non-production process with a key builds the Mastra LLM. A mutating
tool still returns a confirmation and does not call `core` until "sim" (unchanged loop in
`packages/agent/src/process-message.ts` — do not edit that file in this phase).

### Tests for User Story 1

- [x] T009 [P] [US1] Update `packages/env/src/api.test.ts`: a load without agent variables
      does not expose `AGENT_PROVIDER`; `OPENAI_API_KEY` stays optional; `AGENT_MODEL`
      defaults to `openai/gpt-4o-mini`; a leftover `AGENT_PROVIDER=fake` in the env object
      does not fail parse and does not create a fake server mode.
- [x] T010 [US1] In `apps/api/src/composition.test.ts`, add a case that fails today: with
      `OPENAI_API_KEY` set, `NODE_ENV` not `production`, `buildAgentDeps` wires
      `createMastraLlm` (mock the `@na-regua/agent/mastra` import so the test does not call
      OpenAI) and does not construct `FakeLlm` for the served runtime. `production` plus
      `AGENT_HARNESS=1` plus a key also builds Mastra.

### Implementation for User Story 1

- [x] T011 [US1] Remove `AGENT_PROVIDER` from the Zod object in `packages/env/src/api.ts`
      (default was `'fake'`; the enum was `'fake' | 'mastra'`). Do not switch the schema to
      `.strict()`. Update the field comment so a missing key means the assistant is off, not
      that a recognizer is on. Leave `OPENAI_API_KEY` optional and `AGENT_MODEL` default
      `openai/gpt-4o-mini`.
- [x] T012 [US1] In `apps/api/src/composition.ts`, make `criarLlmDoAgente` return only
      `createMastraLlm({ model: env.AGENT_MODEL, apiKey: env.OPENAI_API_KEY, tools })`.
      Delete the branch that `return new FakeLlm()` when the provider is not `mastra`.
      Drop the `FakeLlm` import if nothing else in this file constructs it. Leave
      `processMessage`, the catalog, and the Mastra identity `execute` alone.

**Checkpoint**: Key present and gate open → Mastra. Loop tests from Phase 3 still pass
without a key because they inject the double.

---

## Phase 5: User Story 2 - Sem chave o ERP continua (Priority: P1)

**Goal**: Missing `OPENAI_API_KEY` does not exit the process. Assistant routes answer 503
`UNAVAILABLE`. The Studio adapter does not mount. Production without `AGENT_HARNESS=1`
stays off even when the key exists.

**Independent Test**: Boot the API with no `OPENAI_API_KEY`. A non-assistant route still
responds. `POST /agent/messages` returns 503 with `error.code` `UNAVAILABLE`.
`GET /api/agents` does not list `studio-harness`.

### Tests for User Story 2

- [x] T013 [US2] Extend `apps/api/src/composition.test.ts`: missing or blank `OPENAI_API_KEY`
      makes `motivoDoAgenteIndisponivel()` return a reason and `buildAgentDeps()` return
      `null`, and the function must not throw. `NODE_ENV=production` with the key and
      `AGENT_HARNESS` unset, empty, or `0` still returns a harness reason. Delete the cases
      that treat `AGENT_PROVIDER=fake` as a served mode, including "fake in production is
      refused even with `AGENT_HARNESS=1`".
- [x] T014 [P] [US2] In `apps/api/src/studio.test.ts`, assert that a defined unavailability
      reason (no key) does not mount the adapter: `GET /api/agents` is 404 and does not list
      `studio-harness`. Replace the message assertion that mentions
      `AGENT_PROVIDER=fake nao chama modelo nenhum`.

### Implementation for User Story 2

- [x] T015 [US2] Rewrite `motivoDoAgenteIndisponivel` in `apps/api/src/composition.ts` to the
      table in `specs/010-assistente-sempre-openai/contracts/disponibilidade-do-assistente.md`:
      production without `AGENT_HARNESS` → harness reason; missing `OPENAI_API_KEY` in any
      environment → key reason; otherwise `undefined`. Remove every branch that reads
      `env.AGENT_PROVIDER`. The reason text must not tell the operator to set
      `AGENT_PROVIDER=fake`.
- [x] T016 [US2] In `apps/api/src/index.ts`, change the warn
      `'assistente desligado — ver AGENT_PROVIDER'` so it points at the reason already logged
      (`motivo`), not at `AGENT_PROVIDER`. Keep the behavior: the route is off, the process
      stays up. In `apps/api/src/routes/agent.ts`, keep HTTP 503 and `error.code`
      `'UNAVAILABLE'` when deps are `null`; update the comment that says production stays 503
      until a fake or `AGENT_PROVIDER` mode exists.

**Checkpoint**: No key → API up, assistant 503, Studio unmounted. Key + open gate → Phase 4
still holds.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: The written decision matches the code. Historical specs under `specs/002`–
`specs/009` stay as the record of those slices; do not rewrite them.

- [x] T017 [P] Add a partial-revision note at the top of
      `docs/decisoes/adr/0010-mastra-e-gpt-4o-mini.md` dated 2026-10-01: the local `AGENT_PROVIDER=fake`
      requirement is withdrawn. Runtime, `openai/gpt-4o-mini`, and "tools + domain calculate"
      stay. Strike the consequence "Modo `AGENT_PROVIDER=fake` continua obrigatório no local"
      and the neutral bullet `` `AGENT_PROVIDER=fake|mastra` ``. Replace the index sentence
      `` `AGENT_PROVIDER=fake` no local. `` in `docs/decisoes/README.md` (DEC-007) with: the
      served assistant needs `OPENAI_API_KEY`; the test double is `script()` only.
- [x] T018 [P] Update `docs/arquitetura/integracoes/mastra.md` and `packages/agent/README.md`
      so they no longer say the process boots on `AGENT_PROVIDER=fake` or that `FakeLlm`
      recognizes "quanto vendi hoje?". State the key/no-key table and that CI uses `script()`.
      Leave the relay description: Studio does not call OpenAI; the model call is inside
      `processMessage`.
- [x] T019 [P] Remove `AGENT_PROVIDER` from `.env.example`, `.env.production.example`,
      `docs/engenharia/ambientes.md` and `docs/engenharia/setup.md`. Document `OPENAI_API_KEY`
      as optional at parse time and required only for the assistant to mount. Keep
      `AGENT_MODEL=openai/gpt-4o-mini` and `AGENT_HARNESS`.
- [x] T020 [P] Update the package header in `packages/agent/src/index.ts` that says the
      channel is `AGENT_PROVIDER=fake`. Do not remove the `FakeLlm` export.
- [x] T021 Run quickstart section 1 in `specs/010-assistente-sempre-openai/quickstart.md`
      (`pnpm --filter @na-regua/agent test`, `pnpm --filter @na-regua/env test`,
      `pnpm --filter @na-regua/api test`) with `OPENAI_API_KEY` unset. Then
      `pnpm exec prettier --write` on the files this feature touched.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. Blocks every story.
- **US3 (Phase 3)**: Depends on Phase 2. Restores `packages/agent` tests after the regex is gone.
- **US1 (Phase 4)**: Depends on Phase 2. Can start in parallel with US3 (different files) once
  T003 has landed.
- **US2 (Phase 5)**: Depends on US1. `composition.ts` and `composition.test.ts` are shared.
- **Polish (Phase 6)**: Depends on US1 and US2. T017–T020 can run together.

### User Story Dependencies

- **US3 (P1)**: After Phase 2. No dependency on US1 or US2. The suite stays red until T005–T008
  finish, which is why this story is scheduled before the served-path stories.
- **US1 (P1)**: After Phase 2. Does not require US3 to compile, but do not merge before US3 is green.
- **US2 (P1)**: After US1. Same `motivoDoAgenteIndisponivel` and the same env schema.

### Within Each User Story

- Failing test before the production edit (T002 before T003, T009–T010 before T011, T013–T014
  before T015).
- Do not change `packages/agent/src/process-message.ts`, `packages/agent/src/catalog.ts`,
  `packages/agent/src/mastra-llm.ts` execute-identity, `FakeBarcodeDecoder`, or `WHATSAPP_PROVIDER`.

### Parallel Opportunities

- T005, T006, T007 and T008 touch different test files.
- T009 (`api.test.ts`) can run beside Phase 3 tests.
- T014 (`studio.test.ts`) can run beside T013 until T015 edits `composition.ts`.
- T017, T018, T019 and T020 are documentation-only and parallel.

---

## Parallel Example: User Story 3

```bash
# After T003, these test migrations do not share files:
Task: "script() in packages/agent/src/process-message.test.ts"
Task: "script() in packages/agent/src/studio/relay-agent.test.ts"
Task: "script() in apps/api/src/routes/agent.test.ts"
Task: "drop AGENT_PROVIDER stubs in apps/api/src/e2e/agent-mutations-nr117.test.ts and agent-confirmation-restart.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 and Phase 2 (script-only double).
2. Phase 3 (US3) so the agent suite is green again.
3. Phase 4 (US1): key present → Mastra, `AGENT_PROVIDER` gone.
4. Stop and check quickstart sections 2 and 3 by hand (key off / key on). Section 3 is not CI.
5. Phase 5 (US2) and Phase 6 before merge, because a local boot without a key and the ADR
   still describing `fake` would contradict the spec.

### Incremental Delivery

1. Foundation + US3: CI no longer treats Portuguese as a tool call. Served default is still the old composition.
2. US1: the process that answers uses OpenAI.
3. US2: the process still boots without a key.
4. Polish: ADR-0010 and env docs match the code.

---

## Notes

- Do not rewrite historical specs `specs/002-agent-mastra-runtime` through
  `specs/009-conversa-agente-whatsapp`. They record the slice that shipped the regex.
- Photo stays on `FakeBarcodeDecoder`. Studio relay stays. Confirmation stays in
  `processMessage`.
- Out of scope: barcode library, sending the image to the model, `WHATSAPP_PROVIDER`,
  merging Mastra `execute` with the catalog, RAG, and the monthly AI cap.
