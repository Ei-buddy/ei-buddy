# Research: Confirmação de ação sensível, com expiração (NR-061)

**Date**: 2026-09-17  
**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Ambiguidades de produto já fecharam na spec. Aqui fecham escolhas técnicas, conferidas no schema 0909, na porta atual `ConfirmationStore`, na ADR-0010/0016 e na documentação atual do Mastra (HITL).

---

## 1. Onde a pendência mora

**Decision**: Persistir na tabela **já existente** `confirmations` (RLS, `company_id`). Sem tabela nova. Sem Redis. Sem HITL do Mastra.

**Rationale**:

- A spec fecha o gap que a NR-060 deixou explícito (`InMemoryConfirmations`). Reinício do processo da API não pode apagar o portão de RF-103.
- O catálogo 0909 já tem `confirmations` (`action`, `payload`, `expires_at`, `resolved_at`, `decision`) e `enable_tenant_isolation`. Inventar outro store seria segunda fonte de verdade.
- ADR-0010: confirmação é máquina nossa sobre essa tabela, não feature do runtime de modelo.

**Alternatives considered**:

- Continuar in-memory + sticky process — rejeitado (FR-008; deploy apaga pendência).
- Redis / store Mastra — rejeitado (isolation RLS, ADR-0001, ADR-0016).
- HITL `requireToolApproval` / `approveToolCall` — rejeitado (ADR-0010; não isola tenant; não expira em 5 min no canal; faria `execute` gravar).

---

## 2. Porta no núcleo, implementação no banco

**Decision**:

1. Mover o tipo `ConfirmationStore` / `PendingConfirmation` para `packages/core` (porta). `packages/agent` passa a importá-los de `core` — já depende de `core`.
2. `packages/db` implementa `createConfirmationStore(sql)` com `withTenant` em **todo** método. `companyId` viaja na assinatura (padrão agenda).
3. `InMemoryConfirmations` permanece em `agent` (ou `core` fake) **só** para teste unitário de `processMessage` sem Postgres.
4. `createAgentRuntime({ confirmations })` deixa de instanciar memória quando a composição injeta o store. `buildAgentDeps()` na API passa o store Postgres.
5. `packages/agent` **não** importa `db` (matriz + ADR-0016).

**Rationale**: `db` não pode importar `agent`. Hexágono: `core` declara, `db` implementa, `apps/api/composition.ts` injeta. O laço (`processMessage`) não muda de dono.

**Alternatives considered**:

- Adapter Postgres dentro de `agent` com cliente SQL injetado — rejeitado (fura a matriz; handler/agent falando com banco).
- Deixar a porta em `agent` e duplicar o tipo em `db` — rejeitado (dois contratos).
- Caso de uso `confirmSensitiveAction` em `core` — rejeitado nesta fatia (YAGNI): a máquina já vive no laço; o que faltava era o store.

---

## 3. Identidade da conversa (stub, sem memória)

**Decision**: `confirmations.conversation_id` é FK **NOT NULL**. Esta fatia faz **upsert da row de identidade** em `conversations` (`company_id` + `channel` + `number_from`) e **não** grava `messages`. NR-062 reusa a mesma row para histórico/anáfora/idle.

Mapeamento da chave já existente (`chaveDaConversa`):

| Canal do laço | `chaveDaConversa`            | `conversations.channel` | `number_from`      |
| ------------- | ---------------------------- | ----------------------- | ------------------ |
| HTTP harness  | `app:${companyId}:${userId}` | `app`                   | `userId` da sessão |
| Studio / WA   | `wa:${companyId}:${peer}`    | `whatsapp`              | peer (dígitos)     |

A coluna no SQL é `number_from` (migration 0007), não `peer` (prosa do esquema). O interlocutor **não** pode ser nulo: UNIQUE com NULL no Postgres não impede duplicata.

**Rationale**: ADR-0016 promete que confirmação e histórico compartilham a mesma row. Criar a identidade agora evita FK órfã e não entrega US-051.

**Alternatives considered**:

- Esperar NR-062 para persistir confirmação — rejeitado (ledger: NR-061 é irmã, não filha).
- Relaxar `conversation_id` para NULL — rejeitado (muda catálogo; ADR-0016).
- Coluna nova `user_id` em `conversations` — adiada (NR-062 se precisar; `number_from` cobre o stub).

---

## 4. HTTP vs Studio (FR-012 / US2.3)

**Decision**: Os harnesses compartilham o **armazenamento** (Postgres), não a **chave**. Pendência HTTP (`app:company:user`) e pendência Studio (`wa:company:peer`) são conversas distintas (ADR-0016 + FR-001: confirmação no mesmo canal do pedido).

- Reinício + “sim” no **mesmo** ingresso = DoD (FR-008).
- “Sim” no Studio **não** fecha proposta nascida no `POST /agent/messages` (e vice-versa) — igual à NR-121 (`data-model` 003).
- SC-007 = reproduzir P1 **em cada** harness, cada um na sua chave.
- US2.3 da spec lê-se: dois clientes do **mesmo** canal/identidade (dois POSTs ou dois chats Studio da mesma fixture), inclusive após restart — não misturar `app` com `wa`.

**Rationale**: Constitution e ADR-0016 prevalecem sobre cruzar canais. Unificar chave só no harness seria regra especial que some no WhatsApp real (NR-113).

**Alternatives considered**:

- Uma pendência por `companyId`+`userId` ignorando canal — rejeitado (FR-001; dono no app confirmaria pedido do Zap sem estar no fio).
- Forçar HTTP a usar `channel: 'whatsapp'` + peer do preset — rejeitado (quebra contrato NR-060: `text` só, sessão, `channel: app`).

---

## 5. Máquina de estados (não redesenhar o diálogo)

**Decision**: Reusar o laço já em `processMessage`:

- `mutatesValue` → `put` + `kind: confirmation`
- `eSim` no prazo → `resolve(accepted)` + `execute` do catálogo
- `eNao` ou ambíguo → `resolve(rejected)`, zero efeito; texto pede reenviar o pedido
- expirado → `resolve(expired)`; pedido novo reprocessa a mensagem
- `put` de uma nova proposta na **mesma** conversa encerra a aberta anterior como `rejected` (não executa; **não apaga** a linha — FR-011)
- TTL 5 min (`CONFIRMATION_TTL_MS`); relógio = `ctx.now`
- Relação com teto de IA: inalterada (não executa no escuro)

`AgentReply` / `POST /agent/messages` / tool `process_message` do Studio **não** mudam de schema.

**Rationale**: NR-061 é persistência + isolamento, não um segundo assistente. Testes de `process-message.test.ts` continuam válidos com o fake in-memory.

---

## 6. Schema: índices, não colunas de negócio novas

**Decision**: Migration `0018` (próximo número) **só** com índices de identidade/abertura. Sem `created_at` em `confirmations` (o catálogo não tem). Sem `messages`.

| Índice                                                                                    | Para quê                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| UNIQUE `(company_id, channel, number_from)` em `conversations` WHERE `deleted_at IS NULL` | upsert da identidade sem duplicar conversa |
| UNIQUE `(conversation_id)` em `confirmations` WHERE `resolved_at IS NULL`                 | no máximo uma aberta por conversa (FR-010) |

`payload` jsonb = `{ toolId, args, summary, conversationKey }` (args já validados pelo Zod de `contracts`). `action` = `toolId`.

**Rationale**: `put` concorrente sem unique vira duas abertas. Unique parcial + `resolve` da anterior no mesmo `withTenant` é o cinto.

**Alternatives considered**:

- Sem migration, SELECT+INSERT — rejeitado (corrida).
- Soft-delete da confirmação no desfecho — rejeitado (FR-011; CHECK já tem `decision`).

---

## 7. Testes que provam (constitution V)

**Decision**:

| Camada                         | O que prova                                                                                          | Banco?   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | -------- |
| `agent` unit (já existe)       | sim/não/ambíguo/TTL/pedido novo; zero efeito                                                         | não      |
| `db` integração                | put/getOpen/resolve; replace da aberta; sobrevive **nova instância** do store (reinício); RLS loja B | Postgres |
| `api` composição / agent route | `buildAgentDeps` injeta store Postgres; um ciclo HTTP confirmação→sim ainda bate no `core`           | Postgres |

CI **não** chama OpenAI. Isolation: loja B `getOpen` da chave da A = `undefined` (ausência, nunca o payload). Consulta sem `withTenant` não é o caminho do store.

**Rationale**: In-memory não prova RLS nem restart. Teste que só espia `put` chamado não prova FR-008.

---

## 8. Docs e ledger no mesmo PR

**Decision**: Atualizar `packages/agent/README.md` (máquina na tabela; in-memory = teste), `docs/arquitetura/integracoes/mastra.md` (in-memory → Postgres), `docs/arquitetura/esquema-postgresql.md` se a prosa `peer` vs `number_from` ainda divergir no trecho da identidade, ledger NR-061 → ✅. Privacy/exportação da tabela **não** é DoD (NR-031/086).

**Rationale**: DoD da constitution.
