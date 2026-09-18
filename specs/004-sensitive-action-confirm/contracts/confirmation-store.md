# Contract: ConfirmationStore

**Feature**: NR-061 · **Packages**: `@na-regua/core` (porta) · `@na-regua/db` (Postgres) · `@na-regua/agent` (consumidor + fake in-memory)

A porta substitui `InMemoryConfirmations` na composição da API. O contrato HTTP `POST /agent/messages` e o envelope da tool `process_message` (Studio) **não mudam** — ver [002 agent-messages](../../002-agent-mastra-runtime/contracts/agent-messages.md) e [003 studio-harness](../../003-studio-harness/contracts/studio-harness.md).

## Purpose

Guardar a proposta de ação sensível até aceite, recusa ou expiração, **sobrevivendo a reinício** do processo, isolada por loja.

## Operations

```ts
type ConfirmationDecision = 'accepted' | 'rejected' | 'expired'

type PendingConfirmation = {
  readonly id: string
  readonly companyId: string
  readonly conversationKey: string
  readonly toolId: string
  readonly args: unknown
  readonly summary: string
  readonly expiresAt: Date
}

type ConfirmationStore = {
  put(pending: PendingConfirmation): Promise<void>
  getOpen(
    companyId: string,
    conversationKey: string,
    now: Date,
  ): Promise<PendingConfirmation | undefined>
  resolve(companyId: string, id: string, decision: ConfirmationDecision): Promise<void>
}
```

`now` em `getOpen` **não** filtra expiradas: devolve a aberta mesmo com `expiresAt <= now`, para o laço emitir a mensagem de expiração.

## Invariants

| #   | Regra                                                                                          |
| --- | ---------------------------------------------------------------------------------------------- |
| 1   | `put` / `getOpen` / `resolve` rodam com tenant = `companyId` da assinatura                     |
| 2   | Loja B não obtém pendência da loja A (`undefined`, nunca payload)                              |
| 3   | `put` na mesma `conversationKey` encerra a aberta anterior como `rejected` (não executa)       |
| 4   | `resolve` em id inexistente, já resolvido ou de outra loja é no-op (não lança, não vaza)       |
| 5   | Linha resolvida permanece (`resolved_at` + `decision`); sem DELETE                             |
| 6   | Fake in-memory obedece 2–5 em processo único; **não** prova 1 nem reinício — isso é o Postgres |

## Mapping SQL

| Campo da porta     | `confirmations`                            |
| ------------------ | ------------------------------------------ |
| id                 | `id`                                       |
| companyId          | `company_id`                               |
| conversationId     | `conversation_id` (via stub; ver identity) |
| toolId             | `action`                                   |
| args, summary, key | `payload` jsonb                            |
| expiresAt          | `expires_at`                               |
| (aberta)           | `resolved_at IS NULL`                      |
| decision           | `decision`                                 |

## Ciclo no laço (sem mudança de diálogo)

1. Tool `mutatesValue` → `put` → reply `kind: confirmation`.
2. Próxima mensagem: `getOpen`.
3. `sim` no prazo → `resolve(accepted)` → `execute` catálogo → `core`.
4. `não` / ambíguo → `resolve(rejected)` → `answer` sem efeito.
5. Expirada → `resolve(expired)`; se a mensagem for pedido novo, reprocessa.

## Out of scope

- HITL Mastra (`requireToolApproval`, `approveToolCall`).
- Schema HTTP novo.
- Histórico `messages` (NR-062).
- Exportação LGPD da tabela (NR-031/086).
