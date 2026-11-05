---
description: 'Task list for natural WhatsApp replies — read, typing, burst, bubbles'
---

# Tasks: Resposta natural no WhatsApp

**Input**: Design documents from `/specs/011-resposta-natural-whatsapp/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Exigidos pela constitution V e pela matriz da seção 2 de [quickstart.md](./quickstart.md).
Escrever o caso que falha antes da implementação. A CI não chama `graph.facebook.com`. O chip é o
passo manual da seção 3.

**Organization**: Sinais do adapter bloqueiam a rota. US1 marca lido na chegada. US2 mostra
digitando na preparação e a frase de falha. US3 segura a pausa e junta os textos. US4 e US5 são
funções puras; a rota só as aplica depois. O `POST /agent/messages` não entra nessas funções.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallel when different files and no incomplete prerequisite.
- **[USn]**: Maps to user stories in [spec.md](./spec.md).

## Path Conventions

- `packages/whatsapp/src/` — lido, digitando, formatação e divisão
- `apps/api/src/routes/whatsapp-webhook.ts` — pausa, união e envio
- `apps/api/src/routes/agent.ts` — não formatar nem dividir

---

## Phase 1: Setup

**Purpose**: Nenhuma dependência, migration ou variável nova. A chamada Graph continua a do adapter.

- [x] T001 Confirm `packages/whatsapp/package.json` gains no dependency, `packages/db` gains no migration, and `.env.example` gains no variable. Presence uses the existing messages URL and `VERSAO_PADRAO` (`v21.0`) in `packages/whatsapp/src/meta-sender.ts`. If that version rejects `typing_indicator`, bump only `VERSAO_PADRAO`. Do not add a second Graph client.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: O remetente marca lido e mostra digitando sem lançar, e o falso registra a ordem. A porta `MessageSender` de `core` não ganha método.

**⚠️ CRITICAL**: US1 e US2 não começam antes desta fase. US4 e US5, nas funções puras, também esperam para a rota aplicar os sinais já prontos.

- [x] T002 [P] Add failing tests in `packages/whatsapp/src/meta-sender.test.ts`: `markRead` POSTs `{ messaging_product: 'whatsapp', status: 'read', message_id }` with no `to` and no `typing_indicator`; `showTyping` is that body plus `typing_indicator: { type: 'text' }`; HTTP error, timeout, and a body without success do not throw; neither call consumes the `sendText` idempotency map, so a later `sendText` with another key still sends.
- [x] T003 [P] Add failing tests in `packages/whatsapp/src/fake-sender.test.ts`: `markRead` and `showTyping` append to a log the test can read, in call order, with the message id and kind `read` or `typing`; a configured presence failure records the attempt and does not throw.
- [x] T004 Implement `markRead` and `showTyping` on `criarRemetenteMeta` in `packages/whatsapp/src/meta-sender.ts`, same URL as `sendText`, no `to`, not stored in the `enviadas` map. Swallow timeout, network failure, and provider refusal (including invalid id). Make `packages/whatsapp/src/meta-sender.test.ts` green with no call to `graph.facebook.com` outside the injected `fetch`.
- [x] T005 [P] Implement `markRead` and `showTyping` on `FakeMessageSender` in `packages/whatsapp/src/fake-sender.ts` and export any new type from `packages/whatsapp/src/index.ts`. Make `packages/whatsapp/src/fake-sender.test.ts` green.

**Checkpoint**: Falso e Meta (fetch injetado) registram lido e digitando. `sendText` segue idempotente.

---

## Phase 3: User Story 1 — Saber que a mensagem foi lida (Priority: P1) 🎯 MVP

**Goal**: Cada texto aceito da dona vinculada fica lido antes da resposta e antes de qualquer espera.

**Independent Test**: Um POST autorizado grava `markRead` daquele `providerMessageId` antes do `sendText`. Número sem vínculo não marca lido nem envia.

### Tests for User Story 1

- [x] T006 [US1] Add failing cases in `apps/api/src/routes/whatsapp-webhook.test.ts`: an authorized text records `{ kind: 'read', messageId }` for that id before `sendText`; three authorized texts with distinct ids each record their own `markRead` before their own send; whitespace-only or `text: null` still calls `markRead`, sends `FRASE_PEDIDO_DE_TEXTO_WHATSAPP`, and does not call `processMessage`; `peers.resolve` null does not call `markRead`, does not `sendText`, and does not `registrar` the inbox; a presence failure still `sendText`s the reply.

### Implementation for User Story 1

- [x] T007 [US1] In `apps/api/src/routes/whatsapp-webhook.ts`, after the peer resolves and `registrar` is not `processado`, call `markRead(inbound.providerMessageId)` before `processMessage` and before any delay. Failure must not skip the reply. Do not call `markRead` when the peer is null. Log only `requestId`, `companyId`, and `userId` — never the phone, the body, or the token. Make T006 pass.

**Checkpoint**: Lido demonstrável num turno de um texto. A pausa de 3 s ainda não existe.

---

## Phase 4: User Story 2 — Ver que o assistente está digitando (Priority: P1)

**Goal**: Digitando aparece quando a preparação começa, e some porque uma mensagem saiu — a resposta ou a frase de falha.

**Independent Test**: Antes do primeiro `sendText` de um pedido que recebe resposta, `showTyping` foi chamado com o id da mensagem dela. Se `processMessage` rejeita, sai uma frase curta e o assistente não é chamado de novo.

### Tests for User Story 2

- [x] T008 [US2] Add failing cases in `apps/api/src/routes/whatsapp-webhook.test.ts`: `showTyping` for that message id happens after `markRead` and before `sendText`; when `processMessage` rejects, one `sendText` body is exactly `Não consegui responder agora. Tente de novo em instantes.`, `showTyping` was called, `processMessage` ran once, and the inbox id is marked processed; a `showTyping` failure still sends the real reply.

### Implementation for User Story 2

- [x] T009 [US2] In `apps/api/src/routes/whatsapp-webhook.ts`, call `showTyping` with the inbound message id immediately before preparing the reply (before `processMessage` for non-empty text, and before the fixed sentence for empty text). On a thrown turn, `sendText` the failure sentence with `idempotencyKey` `${providerMessageId}:1` and `consent` `service_reply`, then `marcarProcessado`. Do not call `processMessage` again. If `showTyping` throws, continue. Make T008 pass.
- [x] T010 [US2] While that preparation is pending, re-call `showTyping` with the same id if 20_000 ms pass without an outbound message. Add an injected scheduler on `WhatsAppWebhookRouteDeps` in `apps/api/src/routes/whatsapp-webhook.ts` so `apps/api/src/routes/whatsapp-webhook.test.ts` advances time instead of sleeping. One advanced clock sees a second `showTyping` before `sendText`.

**Checkpoint**: Um texto vê lido, depois digitando, depois a resposta ou a frase de falha.

---

## Phase 5: User Story 3 — Juntar textos enviados em sequência (Priority: P1)

**Goal**: Textos com menos de 3 s entre eles viram um único `processMessage`. Texto que chega depois que a resposta começou fica para o pedido seguinte.

**Independent Test**: Dois textos do mesmo `from` e da mesma empresa, com 1 s entre eles no relógio injetado, produzem um `processMessage` com as duas linhas nessa ordem. Nenhum `showTyping` antes do fim dos 3 s. Um texto após o turno já iniciado não mistura o corpo.

### Tests for User Story 3

- [x] T011 [US3] Add failing cases in `apps/api/src/routes/whatsapp-webhook.test.ts` with an injected clock, not a real 3 s sleep. Key is `companyId` + `from`. Two texts 1 s apart, same company and same `from`: one `processMessage`; the text is the two trimmed fragments in arrival order joined by `\n`; two `markRead` calls before any `sendText`; zero `showTyping` until 3_000 ms after the second fragment. A second text only after 3_000 ms, once the first turn has started: two `processMessage` calls and the bodies are not mixed. The same `providerMessageId` redelivered during the pause: one line and one `processMessage`; the second HTTP handler waits for that same turn. A text that arrives after `processMessage` has been called does not change parts already sending and becomes the next request. `text: null` or whitespace-only does not reset the 3_000 ms and does not join the burst; `text: null` still sends `FRASE_PEDIDO_DE_TEXTO_WHATSAPP` without waiting. No peer: no `markRead`, no `showTyping`, no send. The reply `idempotencyKey` is `${idDoPrimeiroFragmento}:1`. `consent.inboundAt` is the first fragment `receivedAt`. The POST returns 200 only after that burst's turn finishes.

### Implementation for User Story 3

- [x] T012 [US3] Implement the in-memory sequencer in `apps/api/src/routes/whatsapp-webhook.ts`. One sequence per `companyId` + `from`. Fragments are non-empty trimmed texts in arrival order, without repeating `providerMessageId`. Deadline is 3_000 ms after the last fragment `receivedAt`; a new text restarts it. If a turn for that key is in progress, new texts form the next sequence and do not alter the in-flight body. Close the sequence with one `processMessage` (`channel: 'whatsapp'`, same `peer`). `markRead` stays on arrival, before the pause. `showTyping` stays when preparation starts, after the pause. Mark each id processed only after the send or the failure sentence. A redelivery of an id already in the burst waits and does not append. Keep `text: null` and whitespace off the sequence. Return 200 only after that sequence's turn ends. Make T011 pass.

**Checkpoint**: Rajada curta vira um pedido. Lido e digitando das fases anteriores continuam verdadeiros.

---

## Phase 6: User Story 4 — Ler a resposta em mensagens curtas (Priority: P2)

**Goal**: Resposta longa ou com lista sai em 2 a 5 mensagens, em limites naturais. Resposta curta continua uma. `Confirma?` com texto antes fica sozinha no último balão.

**Independent Test**: `dividirRespostaWhatsapp` cobre a tabela do [contrato](./contracts/resposta-whatsapp.md) sem rede. No webhook, uma resposta com abertura e duas linhas de lista gera pelo menos dois `sendText`, com digitando e 800 ms entre eles.

### Tests for User Story 4

- [x] T013 [P] [US4] Add failing table tests in `packages/whatsapp/src/dividir-resposta-whatsapp.test.ts`. One idea, no list, at most 280 characters → 1 part. A final `Confirma?` with text before it → the last part is exactly `Confirma?` and nothing else. A single sentence that is only `Algo. Confirma?` with no separate preceding text → 1 part. A lead sentence plus two or more list lines (`-` or numbered) → the lead in one part and the items, whole lines, in the following parts. A list alone with two or more lines → at least 2 parts, broken only between lines. A paragraph over about 400 characters → split at the end of a sentence, never between `R$` and the amount, and never mid-word. A natural split that would exceed 5 parts → merge adjacent parts down to 5 without cutting a word.

### Implementation for User Story 4

- [x] T014 [US4] Implement `dividirRespostaWhatsapp` in `packages/whatsapp/src/dividir-resposta-whatsapp.ts` and export it from `packages/whatsapp/src/index.ts`. Input is already the text to split. Output length is 1 to 5. Make T013 pass.
- [x] T015 [US4] In the send path of `apps/api/src/routes/whatsapp-webhook.ts`, send each part in order with `sendText`. `idempotencyKey` is `${idDoPrimeiroFragmento}:{índice}` starting at 1. `to` is the inbound `from`. `consent.basis` is `service_reply` and `inboundAt` is the first fragment time. Before each part after the first, call `showTyping` with the last fragment id, then wait 800 ms on the injected clock. Do not wait 800 ms before part 1. Visible kinds remain `answer`, `clarify`, `unknown`, and `confirmation` with non-empty text. `ignored` or blank text sends nothing. Extend `apps/api/src/routes/whatsapp-webhook.test.ts` so a reply with a lead line and two `- ` items produces at least two sends, whole items, at most five, with `showTyping` between them.

**Checkpoint**: Uma lista não chega num bloco só. Uma frase curta continua uma mensagem.

---

## Phase 7: User Story 5 — Ver o texto no formato do WhatsApp (Priority: P2)

**Goal**: O chat recebe negrito, lista e quebra de linha do WhatsApp. O aplicativo recebe o texto cru.

**Independent Test**: `formatarTextoWhatsApp` passa a tabela do [contrato](./contracts/resposta-whatsapp.md). `POST /agent/messages` devolve um único texto, sem essa função.

### Tests for User Story 5

- [x] T016 [P] [US5] Add failing tests in `packages/whatsapp/src/formatar-texto-whatsapp.test.ts`: `**Total**` and `__Total__` become `*Total*`; a line `# Título` becomes `*Título*`; `[boleto](https://exemplo)` becomes `boleto (https://exemplo)`; a row containing `|` becomes cells on one line separated by `—`; a line that starts with `* ` starts with `- ` instead; a well-formed `*já em negrito*` stays; `Coca*Cola` and an underscore or tilde that is not a valid pair appear literal, with U+2060 beside the marker; a triple-backtick span stays monospace; the output has no heading `#`, no `**`, and no `[rótulo](url)`.
- [x] T017 [P] [US5] Add a failing case in `apps/api/src/routes/agent.test.ts` whose runtime reply is `**Total**\n- a\n- b`. `POST /agent/messages` returns that single string, not `*Total*` and not more than one message.

### Implementation for User Story 5

- [x] T018 [US5] Implement `formatarTextoWhatsApp` in `packages/whatsapp/src/formatar-texto-whatsapp.ts` and export it from `packages/whatsapp/src/index.ts`. Make T016 pass. Do not import this function from `apps/api/src/routes/agent.ts`.
- [x] T019 [US5] In `apps/api/src/routes/whatsapp-webhook.ts`, run `formatarTextoWhatsApp` on the assistant text before `dividirRespostaWhatsapp`. Make T017 pass. Do not change `packages/agent/src/process-message.ts` or the model instructions in `packages/agent/src/mastra-llm.ts`.

**Checkpoint**: O WhatsApp não mostra markdown cru. O aplicativo continua um bloco só.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentar o limite de um processo e fechar a suíte do quickstart.

- [x] T020 [P] Document in `packages/whatsapp/README.md` that mark-read and typing are best-effort posts on the messages URL, that the 3 s burst lives in the API process (same one-process limit as the in-memory send map), and that there is no new environment variable.
- [x] T021 Re-read the new paths in `apps/api/src/routes/whatsapp-webhook.ts` and delete any log field that carries the phone, the message body, or the token. Keep `requestId`, `companyId`, and `userId`.
- [x] T022 Run `pnpm --filter @na-regua/whatsapp test` and `pnpm --filter @na-regua/api test` from the repo root. Both green, and no test calls `graph.facebook.com`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Setup. Blocks the route stories.
- **US1 (Phase 3)**: after Foundational. No other story.
- **US2 (Phase 4)**: after US1. Same route file; typing sits after read.
- **US3 (Phase 5)**: after US2. The pause must not move `showTyping` into the 3 s window.
- **US4 (Phase 6)**: `T013` can be written during US3 (other file). `T015` waits for `T012` and `T014`.
- **US5 (Phase 7)**: `T016` and `T017` can be written during US4. `T019` waits for `T015` and `T018`.
- **Polish (Phase 8)**: after the stories that will ship.

### User Story Dependencies

- **US1 (P1)**: Foundational only. MVP.
- **US2 (P1)**: US1, because both edit `apps/api/src/routes/whatsapp-webhook.ts` and typing is the next signal.
- **US3 (P1)**: US2, so the sequencer does not show typing during the pause.
- **US4 (P2)**: split function has no story dependency. The webhook loop needs US3.
- **US5 (P2)**: formatter has no story dependency. Applying it before the split needs US4.

### Within Each User Story

- Failing test first, then the code that makes it pass.
- Adapter signals before the route.
- Pure function before the webhook call site.
- `formatarTextoWhatsApp` before `dividirRespostaWhatsapp` on the text that is sent.

### Parallel Opportunities

- `T002` and `T003` together.
- `T004` and `T005` together, after their tests exist.
- `T013` while US3 is in progress.
- `T016` and `T017` together.
- `T020` alongside the last route check, different file.

---

## Parallel Example: User Story 5

```bash
# Different files, no shared prerequisite:
Task: "T016 format table in packages/whatsapp/src/formatar-texto-whatsapp.test.ts"
Task: "T017 single-body regression in apps/api/src/routes/agent.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 and Phase 2.
2. Phase 3 (lido).
3. Stop and run `pnpm --filter @na-regua/api test` for the webhook file.

### Incremental Delivery

1. US1 — lido na chegada.
2. US2 — digitando e frase de falha.
3. US3 — uma resposta para a rajada. Este é o ritmo mínimo que a spec chama de pronto.
4. US4 — vários balões.
5. US5 — formatação só no WhatsApp.
6. Phase 8 — README e a suíte do quickstart.

### Parallel Team Strategy

After Phase 2:

- One person stays on `apps/api/src/routes/whatsapp-webhook.ts` (US1 → US2 → US3 → wire US4 → wire US5).
- Another can take `T013`/`T014` and `T016`/`T018` in `packages/whatsapp` before those wire tasks.

---

## Notes

- Do not add `markRead` or `showTyping` to the `MessageSender` port in `packages/core`.
- Do not persist the burst. No new table.
- Unknown numbers stay silent: no read, no typing, no reply.
- The chip check in [quickstart.md](./quickstart.md) section 3 is manual and is not a task that flips a ledger checkbox by itself.
