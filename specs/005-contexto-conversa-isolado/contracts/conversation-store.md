# Contract: ConversationStore

**Feature**: NR-062 · **Packages**: `@na-regua/core` (porta) · `@na-regua/db` (Postgres) · `@na-regua/agent` (consumidor + fake in-memory)

A porta acrescenta histórico ao runtime. O contrato HTTP `POST /agent/messages` e o envelope da tool `process_message` (Studio) **não mudam** — ver [002 agent-messages](../../002-agent-mastra-runtime/contracts/agent-messages.md) e [003 studio-harness](../../003-studio-harness/contracts/studio-harness.md). Identidade da row: [004 conversation-identity](../../004-sensitive-action-confirm/contracts/conversation-identity.md).

## Purpose

Persistir turnos da conversa vigente, devolver o recorte ativo (≤ 12, idle 2 h) para o `decide`, e sobreviver a reinício do processo, isolado por loja.

## Operations

```ts
type ConversationRole = 'user' | 'assistant' | 'system'

type StoredMessage = {
  readonly id: string
  readonly role: ConversationRole
  readonly body: string
  readonly toolCalls?: unknown
  readonly createdAt: Date
}

type ActiveContext = {
  readonly conversationId: string
  readonly messages: readonly StoredMessage[] // 0..12, ordem cronológica
  readonly idle: boolean
}

type AppendTurn = {
  readonly conversationKey: string
  readonly userBody: string
  readonly assistantBody: string
  readonly toolCalls?: unknown
  readonly at: Date
}

type ConversationStore = {
  loadActive(
    companyId: string,
    conversationKey: string,
    now: Date,
    options?: { readonly idleMs?: number; readonly window?: number },
  ): Promise<ActiveContext | undefined>

  append(companyId: string, turn: AppendTurn): Promise<void>
}
```

Defaults de `options`: `idleMs = 7_200_000` (2 h), `window = 12`.

`loadActive` devolve `undefined` se a identidade for inválida (`number_from` vazio) **ou** se ainda não existe row e não se deve criá-la só para ler. `append` faz upsert da identidade (mesmo algoritmo da NR-061) e insere o par user/assistant.

## Invariants

1. `companyId` na assinatura é o tenant. UUID dentro da `conversationKey` que divergir **perde** — o contexto ganha.
2. Loja B carregando a chave da loja A → `undefined`. `append` da B na chave da A não escreve na A.
3. `loadActive` **não** cria row. `append` cria se preciso.
4. Se a última mensagem vigente tiver `createdAt <= now - idleMs`, `idle === true` e `messages === []`.
5. Senão, `messages.length <= 12` (as mais recentes, ordem cronológica crescente).
6. `app:…` e `wa:…` são identidades distintas.
7. Reinício = nova instância do store contra o mesmo Postgres: `loadActive` ainda vê o que o `append` gravou, sujeito a idle/janela.
8. Falha de `append` não é a transação da venda (o caso de uso de `core` já fechou).

## Fora deste contrato

- Aceite/recusa/TTL da confirmação ([confirmation-store](../../004-sensitive-action-confirm/contracts/confirmation-store.md)).
- DELETE de 30 dias ([conversation-purge](./conversation-purge.md)).
- Formato do prompt ([llm-history](./llm-history.md)).
