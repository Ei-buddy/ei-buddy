# Contract: identidade da conversa (stub)

**Feature**: NR-061 · **Table**: `conversations` (já no baseline 0007)

A confirmação precisa de `conversation_id`. Esta fatia **só** garante a row de identidade. Não é o contrato de memória (NR-062).

## Purpose

Uma conversa vigente por `(company_id, channel, number_from)` para pendurar `confirmations`. NR-062 grava `messages` **nessa** row.

## Upsert

Dado `companyId` + `conversationKey` do laço:

| `conversationKey`          | channel    | `number_from` |
| -------------------------- | ---------- | ------------- |
| `app:{companyId}:{userId}` | `app`      | `{userId}`    |
| `wa:{companyId}:{peer}`    | `whatsapp` | `{peer}`      |

Algoritmo, **dentro** do mesmo `withTenant` do `put`:

1. `SELECT id FROM conversations WHERE company_id = $1 AND channel = $2 AND number_from = $3 AND deleted_at IS NULL`
2. Se existir, usar esse `id`
3. Senão `INSERT … RETURNING id`
4. Índice UNIQUE parcial (migration 0018) torna a corrida um retry, não duas identidades

`number_from` vazio → não inserir; `put` falha de forma fechada.

## O que este contrato proíbe

- INSERT em `messages`
- Carregar histórico para o prompt
- Idle de 2 h / expurgo de 30 dias
- Tratar HTTP `app` e Studio `wa` como a mesma row
- Aceitar `companyId` vindo do cliente (Studio request context / body)

## Relação com o laço

`chaveDaConversa` em `packages/agent` continua a fonte da string. O store Postgres **traduz** a string para o stub; o laço não passa a conhecer `conversation_id`.
