# Contract: expurgo de conversa (30 dias)

**Feature**: NR-062 · **Packages**: `@na-regua/core` (caso de uso) · `@na-regua/db` (SQL) · `apps/worker` (fila)

## Purpose

Tirar de circulação corpos de mensagem com mais de 30 dias (RNF-035 / US-051) sem apagar efeito de negócio nem a linha de confirmação.

## Use case

```ts
type PurgeConversationHistoryDeps = {
  readonly conversations: ConversationPurgeRepository
}

type PurgeConversationHistoryResult = {
  readonly messagesDeleted: number
  readonly conversationsClosed: number
}

// ctx.now injetado; ctx.channel === 'job'
purgeConversationHistory(deps, ctx): Promise<PurgeConversationHistoryResult>
```

```ts
type ConversationPurgeRepository = {
  deleteMessagesOlderThan(now: Date, retentionMs: number): Promise<number>
  closeConversationsWithoutMessages(now: Date): Promise<number>
}
```

`retentionMs` default = `30 * 24 * 60 * 60 * 1000`.

## SQL (intenção)

1. `DELETE FROM messages WHERE deleted_at IS NULL AND created_at <= now - retention` — no `withTenant` **por empresa** na varredura, ou via sessão de job que percorre empresas sem vazar cruzado. Recurso de outra loja não aparece.
2. `UPDATE conversations SET deleted_at = now, updated_at = now WHERE deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id AND m.deleted_at IS NULL)`.

MUST NOT: `DELETE FROM conversations` (FK de `confirmations` é RESTRICT). MUST NOT: `DELETE`/`UPDATE` em `sales`, clientes, `audit_logs`.

Job de plataforma: o consumidor monta `ExecutionContext` de job; o repositório aplica retenção **dentro** de cada tenant (loop de `company_id` ou equivalente já usado em varreduras). Isolamento: teste com duas empresas — expurgo da A não toca mensagens da B.

## Fila

| Nome                 | Payload     | Falha                           |
| -------------------- | ----------- | ------------------------------- |
| `conversation-purge` | irrelevante | `removeOnFail: false` (RNF-062) |

Consumidor: chama o caso de uso; devolve contagens no `detalhes`. Idempotente: segunda corrida no mesmo `now` apaga zero.

## Fora

- Anonimização LGPD de cliente (NR-031/086).
- RAG / índice vetorial (NR-120).
- Alterar TTL de confirmação.
