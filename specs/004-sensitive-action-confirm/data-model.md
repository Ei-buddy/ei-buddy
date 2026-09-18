# Data Model: Confirmação de ação sensível (NR-061)

**Date**: 2026-09-17  
**Spec**: [spec.md](./spec.md)

Nesta fatia **não há tabela nova**. Há **índices** na identidade da conversa e na abertura da pendência. Entidades abaixo são o recorte persistido + o runtime que já existe.

---

## ConversationIdentity (stub)

Row em `conversations`. Só o bastante para a FK de `confirmations`. **Sem** `messages`.

| Campo        | Coluna SQL    | Regras                                                                |
| ------------ | ------------- | --------------------------------------------------------------------- |
| id           | `id` uuid PK  | gerado no insert                                                      |
| companyId    | `company_id`  | NOT NULL; RLS                                                         |
| channel      | `channel`     | `'whatsapp'` \| `'app'` (CHECK também aceita `'web'`; não usado aqui) |
| interlocutor | `number_from` | NOT NULL neste recorte: peer (WA) ou `userId` (app/HTTP)              |
| deletedAt    | `deleted_at`  | nulo = vigente; upsert só considera vigente                           |

**Identidade lógica** = `(companyId, channel, number_from)` única entre vigentes.

**Não é** memória de conversa (NR-062). Não há `idle`, janela de 12 msgs, nem expurgo.

---

## PendingConfirmation

Row em `confirmations` + projeção no runtime (`ConfirmationStore`).

| Campo           | Coluna / origem   | Regras                                                        |
| --------------- | ----------------- | ------------------------------------------------------------- |
| id              | `id`              | uuid; vira `confirmationId` no `AgentReply`                   |
| companyId       | `company_id`      | na assinatura da porta **e** na linha; nunca do body HTTP     |
| conversationId  | `conversation_id` | FK para o stub; o runtime continua expondo `conversationKey`  |
| conversationKey | em `payload`      | `app:company:user` ou `wa:company:peer` — chave do laço atual |
| toolId          | `action`          | id da tool do catálogo (`create_sale`, …)                     |
| args            | `payload.args`    | já validados pelo Zod de `contracts`                          |
| summary         | `payload.summary` | texto que o lojista leu                                       |
| expiresAt       | `expires_at`      | `ctx.now + 5 min`                                             |
| resolvedAt      | `resolved_at`     | nulo = aberta                                                 |
| decision        | `decision`        | nulo \| `accepted` \| `rejected` \| `expired`                 |

**Aberta**: `resolved_at IS NULL`. No máximo **uma** aberta por `conversation_id`.

`getOpen` devolve também a **expirada ainda não resolvida** — o laço marca `expired` (igual ao in-memory hoje). Não esconder no SELECT por `expires_at`, senão o texto de “expirou” some.

---

## State transitions

```text
(nenhuma aberta)
    │  mutatesValue + put
    ▼
aberta ──sim no prazo──► accepted ──► execute catálogo → core
    │
    ├──não / ambíguo / put novo na mesma conversa──► rejected (zero efeito)
    │
    └──agora >= expiresAt──► expired (zero efeito; pedido novo reprocessa)
```

- `accepted` / `rejected` / `expired` são **terminais**. Linha permanece (FR-011).
- `put` com outra proposta na mesma identidade: a aberta anterior → `rejected` **na mesma transação**, depois insert da nova.
- Segundo `sim` depois de `accepted`: `getOpen` vazio → laço trata como mensagem nova (não duplica). Idempotência da venda continua `agent:${requestId}` em `core`.

---

## ConfirmationStore (porta)

| Operação  | Entrada                                          | Saída                                       |
| --------- | ------------------------------------------------ | ------------------------------------------- |
| `put`     | `PendingConfirmation` (com `companyId`)          | void; encerra aberta anterior da identidade |
| `getOpen` | `companyId`, `conversationKey`, `now`            | pendência ou `undefined`                    |
| `resolve` | `companyId`, `id`, `accepted\|rejected\|expired` | void; no-op se já resolvida ou outra loja   |

Toda operação: `withTenant(sql, companyId, …)`. Recurso de outra loja = `undefined` / no-op, nunca o payload.

---

## AgentReply (reuso, sem mudança)

Já definido na NR-060. `kind: 'confirmation'` + `confirmationId` + texto da proposta. Harness HTTP e Studio **não** ganham campo novo.

---

## IncomingMessage / chave (reuso)

| Ingresso               | channel    | conversationKey              |
| ---------------------- | ---------- | ---------------------------- |
| `POST /agent/messages` | `app`      | `app:${companyId}:${userId}` |
| Studio relé            | `whatsapp` | `wa:${companyId}:${peer}`    |

As duas **não** compartilham pendência (ver [research §4](./research.md)).

---

## Validation rules (resumo)

- TTL: 5 minutos a partir de `put`, medido com `ctx.now`.
- Args: já parseados antes do `put`; o store **não** revalida Zod (quem reexecuta no `sim` é o catálogo com os args guardados).
- Isolamento: `companyId` do `ExecutionContext`; chave com outro UUID de empresa não vaza linha (RLS + `withTenant`).
- `decision` CHECK: só os três valores ou NULL.
- `number_from` vazio no stub → recusa o `put` (fail-closed; não cria conversa ambígua).
