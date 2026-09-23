---
description: 'Task list for NR-046 WhatsApp conversation with the assistant'
---

# Tasks: Conversar com o assistente pelo WhatsApp (NR-046)

**Input**: Design documents from `/specs/009-conversa-agente-whatsapp/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/webhook-whatsapp.md](./contracts/webhook-whatsapp.md), [quickstart.md](./quickstart.md)

**Tests**: Exigidos pela constitution V e pela matriz da seção 2 de [quickstart.md](./quickstart.md). Escrever o teste falhando antes da implementação. A CI não chama a Meta; o chip é o passo manual da seção 3.

**Organization**: A rota nasce na fundação (503). US1 é a conversa quando o celular já casa. US2 trava quem não é dona ativa. US3 faz o nono dígito. US4 prova a primeira empresa. Polimento não marca o ledger como feito só com a suíte falsa.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode correr em paralelo (arquivos diferentes, sem dependência incompleta).
- **[USn]**: História em [spec.md](./spec.md). Setup, fundação e polimento não levam história.

## Phase 1: Setup

**Purpose**: Variáveis da linha de teste existem no schema e na documentação, sem valor real.

- [x] T001 [P] Add optional `WHATSAPP_PROVIDER` (`fake` \| `meta`, default `fake`), `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_SECRET` and `WHATSAPP_VERIFY_TOKEN` to `packages/env/src/api.ts`. Missing values MUST NOT crash API boot. Do not put a real token, App Secret or Phone Number ID in the schema, tests or fixtures.
- [x] T002 [P] Document the same five variables with empty values in `.env.example` and `docs/engenharia/ambientes.md`. State that `WHATSAPP_WEBHOOK_SECRET` is the App Secret for HMAC, not the access token, and that the WhatsApp Business account ID is not a variable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: A URL do webhook existe, recusa configuração incompleta e não troca o remetente falso do restante do sistema.

**⚠️ CRITICAL**: Nenhuma história começa antes desta fase.

- [x] T003 Create `apps/api/src/routes/whatsapp-webhook.ts` with a raw-body JSON parser (same scope pattern as `apps/api/src/routes/webhooks.ts`) and register `GET /webhooks/whatsapp` plus `POST /webhooks/whatsapp`. When `WHATSAPP_PROVIDER` is not `meta` or any of token, phone number id, webhook secret or verify token is absent, both verbs respond 503 `{ error: { code: 'UNAVAILABLE' } }` and do not call the assistant.
- [x] T004 In `apps/api/src/composition.ts`, build webhook deps: `criarRemetenteMeta` only for this route, and an agent `PeerDirectory.resolve` that calls `abrirCanal` from `packages/core/src/agent/abrir-canal.ts` and returns `{ companyId, userId, role: 'owner' }` or `null`. Keep `createFakeMessageSender()` inside `buildAgentUseCases`. Do not change `apps/worker/src/composition.ts` or `apps/worker/src/consumers/whatsapp-send.ts`. Do not attach this directory to the Studio fixture runtime.
- [x] T005 Register the WhatsApp webhook from `apps/api/src/index.ts` next to `registerWebhookRoutes`, with no session plugin on that scope.

**Checkpoint**: `GET` and `POST` respond 503 without Meta credentials. Harness `POST /agent/messages` and the worker sender stay fake.

---

## Phase 3: User Story 1 — Conversar com o assistente (Priority: P1) 🎯 MVP

**Goal**: Dona cujo celular já casa com o cadastro escreve e recebe a resposta do mesmo `processMessage` na conversa.

**Independent Test**: `POST` com corpo gravado e remetente falso envia uma resposta ao `from` original; o mesmo id não envia de novo; `GET` devolve o challenge em texto puro.

### Tests for User Story 1

- [x] T006 [P] [US1] Add failing cases in `apps/api/src/routes/whatsapp-webhook.test.ts` for `GET /webhooks/whatsapp`: matching verify token returns 200 with the raw `hub.challenge` and `Content-Type` text (não devolver JSON no sucesso); wrong token, wrong `hub.mode` or empty token returns 403 with an empty body.
- [x] T007 [US1] Add failing cases in `apps/api/src/routes/whatsapp-webhook.test.ts` for `POST /webhooks/whatsapp`: invalid or missing `X-Hub-Signature-256` returns 401 and does not call `processMessage`; a delivery receipt returns 200 and does not call `processMessage`; an authorized text calls `processMessage` with `channel: 'whatsapp'` and sends `sendText` once with `to` equal to the inbound `from` (não o celular canônico), `consent.basis = service_reply`, `consent.inboundAt` from the inbound timestamp, and `idempotencyKey` equal to the Meta message id; a second POST with the same id returns 200 with no second `processMessage` and no second send; authorized empty text sends one fixed sentence asking for text and does not call the model.

### Implementation for User Story 1

- [x] T008 [US1] Implement `GET /webhooks/whatsapp` in `apps/api/src/routes/whatsapp-webhook.ts` via `responderVerificacao` from `packages/whatsapp/src/meta-sender.ts`.
- [x] T009 [US1] Implement the authorized `POST` path in `apps/api/src/routes/whatsapp-webhook.ts`: `readInbound` on the raw body; on `accepted` and `abrirCanal` status `autorizado`, `webhook_events` `registrar` with `provider = meta` and `event_id` = Meta message id **before** `processMessage`; payload MUST be `{ "kind": "text" | "empty" }` plus the id, sem corpo da mensagem e sem telefone completo; `registrar` false returns 200 without a second turn; visible reply kinds `answer`, `clarify`, `unknown` and `confirmation` call `sendText`; `ignored` and empty assistant text do not send. Log `requestId`, `companyId` and `userId` only — never the full phone or the message text. A `sendText` rejection `outside_service_window` still returns HTTP 200 and does not add a template send.
- [x] T010 [US1] Make T006 and T007 pass in `apps/api/src/routes/whatsapp-webhook.test.ts`. No test may call `graph.facebook.com`.

**Checkpoint**: Conversa demonstrável com celular que já casa (11 dígitos ou `55` + 11). Sem o nono dígito ainda.

---

## Phase 4: User Story 2 — Só cadastro ativo entra (Priority: P1)

**Goal**: Número sem vínculo, pessoa inativa, vínculo inativo ou papel que não é dona não consulta, não grava e não recebe texto.

**Independent Test**: Esses POSTs respondem 200, não chamam `processMessage`, não inserem `webhook_events` e não chamam `sendText`. A função SQL não devolve linha para inativo.

### Tests for User Story 2

- [x] T011 [P] [US2] Add failing cases in `apps/api/src/routes/whatsapp-webhook.test.ts`: unknown phone, and authorized-looking signature with `abrirCanal` status `silencio`, return 200 with zero sends, zero `processMessage` calls and zero inbox inserts — including when the body has no text. The response body MUST NOT say whether the number exists.
- [x] T012 [P] [US2] Add a Postgres test in `packages/db/src/peer-directory-repository.test.ts` that `channel_owner_by_phone` returns no row when `users.is_active` is false, when `company_users.is_active` is false, or when `company_users.role` is not `owner`. Do not edit `packages/db/src/migrations/0028_vinculo_do_canal.sql`.

### Implementation for User Story 2

- [x] T013 [US2] In `apps/api/src/routes/whatsapp-webhook.ts`, keep the silence branch as HTTP 200 with no `webhook_events` insert and no `sendText` (Número sem vínculo, inativo ou não-dona: não grava, não chama o assistente, não envia). If T012 fails, fix only by a new migration — never by altering 0028.

**Checkpoint**: Sondagem não revela cadastro. Dona ativa da US1 continua respondendo.

---

## Phase 5: User Story 3 — Reconhecer o celular com ou sem o 9 (Priority: P1)

**Goal**: `4188888888` e `41988888888` são a mesma dona. Fixo não ganha 9. DDD 55 não é país.

**Independent Test**: `normalizarTelefoneDoCanal` / `abrirCanal` acham o cadastro `41988888888` a partir de `554188888888` e de `4188888888`. `4133334444` permanece `4133334444`. `5599998888` não perde o DDD.

### Tests for User Story 3

- [x] T014 [P] [US3] Add failing cases in `packages/core/src/agent/abrir-canal.test.ts`: `554188888888` and `4188888888` both query canonical `41988888888` first and legacy `4188888888` second; `+55 (41) 98888-8888` canonicalizes to `41988888888`; `4133334444` stays `4133334444` with no second key (assinante começa com 2–5); `5599998888` is not stripped as country code (dez dígitos começando com `55` são DDD 55, não país) and, because the subscriber starts with 9, the canonical key is `559999998888` with legacy `5599998888`. Quote in the test names: "O `9` entra depois do DDD só no nacional de 10 dígitos cujo primeiro dígito do assinante é 6, 7, 8 ou 9."

### Implementation for User Story 3

- [x] T015 [US3] Implement the equivalent keys in `packages/core/src/agent/normalizar` path inside `packages/core/src/agent/abrir-canal.ts`. `abrirCanal` MUST try the canonical key first and stop at the first `porTelefone` hit. Do not put this rule in `packages/whatsapp` or in `channel_owner_by_phone`.
- [x] T016 [US3] Add a case in `apps/api/src/routes/whatsapp-webhook.test.ts`: inbound `from` `554188888888` authorizes the owner stored as `41988888888`, and `sendText.to` remains `554188888888`.

**Checkpoint**: O par com e sem o 9 autoriza a mesma dona. Um DDD diferente não autoriza.

---

## Phase 6: User Story 4 — A conversa obedece a empresa dela (Priority: P2)

**Goal**: Duas empresas da mesma dona: o WhatsApp opera só a primeira em ordem de vínculo.

**Independent Test**: `porTelefone` devolve o `company_id` de menor `created_at`; empate no mesmo instante devolve o menor `company_id`. O turno usa esse `companyId`, nunca um id vindo do corpo.

### Tests for User Story 4

- [ ] T017 [P] [US4] Extend `packages/db/src/peer-directory-repository.test.ts`: two active owner memberships for the same phone return the earlier `company_users.created_at`; when `created_at` ties, return the smaller `company_id`. Constraint already in SQL: `ORDER BY cu.created_at, cu.company_id LIMIT 1`. No new migration if this passes.
- [x] T018 [P] [US4] Add a case in `apps/api/src/routes/whatsapp-webhook.test.ts`: the `ExecutionContext` passed into `processMessage` has `companyId` and `userId` from `abrirCanal`, `role: 'owner'`, `channel: 'whatsapp'`, and ignores any company id present in the Meta payload.

**Checkpoint**: Segunda empresa não entra no contexto. US1–US3 continuam verdes.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentação alinhada ao que a suíte prova, sem declarar o chip como feito.

- [x] T019 [P] Update `packages/whatsapp/README.md` and `docs/arquitetura/integracoes/meta-cloud-api.md`: webhook `GET`/`POST /webhooks/whatsapp` is the live path when `WHATSAPP_PROVIDER=meta`; local and CI stay `fake`; customer charge and templates stay out of this slice.
- [x] T020 [P] In `docs/processo/task-ledger.md`, point NR-046 at `specs/009-conversa-agente-whatsapp/quickstart.md`. Leave the status ⬜ until quickstart section 3 has been run. Do not mark ✅ from the fake suite alone.
- [x] T021 Run the section 2 commands from `specs/009-conversa-agente-whatsapp/quickstart.md` (`pnpm --filter @na-regua/core test`, `pnpm --filter @na-regua/api test`, `pnpm --filter @na-regua/whatsapp test`) plus `pnpm format:check` and `pnpm boundaries`.
- [ ] T022 Execute quickstart section 3 against +1 555 155-0338 with secrets only in the local `.env`. Record pass or fail in the PR. Do not commit the access token, App Secret or verify token.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2** → histórias. US1 bloqueia o teste de rota de US2, US3 (T016) e US4 (T018).
- **Phase 7** depois das histórias que entrarem no PR. O MVP pode polir só US1, mas T020 não marca ✅.

### User Story Dependencies

- **US1 (P1)**: Depois da Phase 2. Não depende do nono dígito se o teste usa celular que já casa.
- **US2 (P1)**: Depois da Phase 2 para o teste SQL (T012). O comportamento da rota (T011, T013) depende de T009.
- **US3 (P1)**: T014 e T015 só tocam `packages/core` e podem correr em paralelo com a US1. T016 depende de T009 e T015.
- **US4 (P2)**: T017 pode correr depois de T012 (mesmo arquivo de teste SQL). T018 depende de T009.

### Within Each User Story

- Testes falham antes da implementação.
- US1: contrato HTTP antes do `sendText`.
- US3: regra em `core` antes do caso na rota.

### Parallel Opportunities

- T001 e T002 em paralelo.
- T006 e T007 em paralelo.
- T011 e T012 em paralelo (rota de teste vs Postgres).
- T014 em paralelo com T006–T009 (arquivos diferentes), desde que T016 espere os dois.
- T019 e T020 em paralelo, depois da suíte que o PR inclui.

### Parallel Example: User Story 1

```bash
# Depois da Phase 2:
# T006 depois T007, no mesmo apps/api/src/routes/whatsapp-webhook.test.ts
# Em paralelo, outro desenvolvedor: T014 em packages/core/src/agent/abrir-canal.test.ts
```

### Parallel Example: User Story 3 enquanto a rota anda

```bash
# Dev A: T006–T010 (apps/api)
# Dev B: T014–T015 (packages/core/src/agent/abrir-canal.ts)
# T016 só quando os dois terminarem
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 e Phase 2.
2. Phase 3 (T006–T010).
3. Parar: dona com celular já normalizado recebe resposta no teste com corpo gravado.
4. O aceite no chip brasileiro ainda precisa da Phase 5 (nono dígito) antes da seção 3 do quickstart.

### Incremental Delivery

1. Fundação (503, remetente falso preservado).
2. US1 conversa com número que já casa.
3. US2 silêncio.
4. US3 nono dígito — aí o quickstart manual faz sentido.
5. US4 primeira empresa.
6. Polimento sem marcar NR-046 ✅.

### Parallel Team Strategy

1. Os dois fecham Phase 1 e Phase 2.
2. Um fica em `apps/api` (US1, depois US2 e T016/T018). O outro fica em `packages/core` (US3) e no teste Postgres (T012, T017).

---

## Notes

- Sem migration nova enquanto `0028_vinculo_do_canal.sql` e `webhook_events` cobrirem as provas.
- `sendCustomerCharge` e a fila `whatsapp-send` continuam no remetente falso.
- Segredos só no `.env` local. O id da conta WhatsApp Business não entra no código.
- `pnpm format:check` antes do PR.
