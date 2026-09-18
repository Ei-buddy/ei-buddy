# Data Model: Contexto de conversa isolado por empresa (NR-062)

**Date**: 2026-09-17  
**Spec**: [spec.md](./spec.md)

Esta fatia **não** cria tabela nova. Usa `conversations` + `messages` (0007) e o UNIQUE de identidade (0018). Entidades abaixo são o modelo do histórico; a pendência de confirmação continua a da [NR-061](../004-sensitive-action-confirm/data-model.md).

---

## Conversation (identidade — reuso)

Row vigente de `conversations`. Dono do fio e da pendência.

| Campo       | Tipo / origem                     | Regras                                                             |
| ----------- | --------------------------------- | ------------------------------------------------------------------ |
| id          | uuid PK                           | gerado                                                             |
| company_id  | uuid NOT NULL                     | tenant; RLS                                                        |
| channel     | `whatsapp` \| `app` (\| `web`)    | harness HTTP = `app`; Studio = `whatsapp`. Não cruzar              |
| number_from | text NOT NULL na prática do store | interlocutor: `userId` (`app`) ou peer (`wa`). Vazio → fail-closed |
| deleted_at  | timestamptz                       | nulo = vigente. Expurgada/órfã marca aqui; UNIQUE ignora essas     |
| created_at  | timestamptz                       |                                                                    |
| updated_at  | timestamptz                       | tocar no append                                                    |

**Identidade lógica** = `(company_id, channel, number_from)` entre vigentes. Upsert: ver [conversation-identity 004](../004-sensitive-action-confirm/contracts/conversation-identity.md).

**Não é** Memory Mastra, nem perfil de preferências.

---

## Message (turno)

Linha de `messages`.

| Campo           | Tipo                              | Regras                                                                                         |
| --------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| id              | uuid PK                           |                                                                                                |
| company_id      | uuid NOT NULL                     | mesmo tenant da conversa                                                                       |
| conversation_id | uuid NOT NULL                     | → `conversations`; `ON DELETE RESTRICT`                                                        |
| role            | `user` \| `assistant` \| `system` | nesta fatia gravamos `user` + `assistant`; `system` reservado, não é preenchido pelo laço      |
| body            | text NOT NULL                     | texto visível; MUST NOT ir para log                                                            |
| tool_calls      | jsonb nullable                    | ids já resolvidos naquele turno (`customerId` / `saleId` / `productId` quando a tool os tiver) |
| deleted_at      | timestamptz                       | nulo = vigente. Expurgo de 30 d **apaga** a linha (DELETE), não só marca                       |
| created_at      | timestamptz                       | relógio do `ctx.now` no insert (testável)                                                      |

**Validation**:

- `body` trim; teto alinhado a `agentMessageInputSchema` (1–4000) no user; resposta do assistente pode ir até o teto de mensagem do canal (4096) já existente.
- `ignored` (peer desconhecido) → zero insert.
- Isolamento: insert/select sempre com `company_id` da sessão + `withTenant`.

---

## ActiveContext (derivado — não é tabela)

O que o `decide` pode ver **neste** turno.

| Campo           | Tipo       | Regras                                                     |
| --------------- | ---------- | ---------------------------------------------------------- |
| conversationId  | uuid       | da row vigente; ausente se o fio ainda não existe          |
| messages        | lista ≤ 12 | vazia se idle (> 2 h desde o último `created_at` vigente)  |
| idle            | boolean    | `true` ⇒ `messages = []` mesmo que o banco tenha histórico |
| conversationKey | string     | `chaveDaConversa`                                          |

**Transições de contexto ativo**:

```text
sem mensagens          → inativo (lista vazia)
última msg ≤ 2 h       → ativo (janela 12)
última msg > 2 h       → inativo (lista vazia; row permanece)
após expurgo 30 d      → sem corpos; órfã ganha deleted_at
```

Idle **não** resolve confirmação e **não** altera `expires_at`.

---

## ConversationTurn (ciclo do laço)

Um `processMessage` bem-sucedido (não `ignored`).

| Campo     | Tipo          | Regras                                          |
| --------- | ------------- | ----------------------------------------------- |
| user      | Message       | `role=user`, body = `input.text`                |
| assistant | Message       | `role=assistant`, body = `AgentReply.text`      |
| historyIn | ActiveContext | o que foi para o `decide` (vazio no ramo `sim`) |

Ordem: carregar ActiveContext → (se sem pendência) `decide` → produzir reply → persistir o par.

---

## PurgeBatch (job)

| Campo               | Tipo    | Regras                                                       |
| ------------------- | ------- | ------------------------------------------------------------ |
| now                 | Date    | `ctx.now` / `deps.now()` — nunca `new Date()` no caso de uso |
| retentionMs         | 30 dias | constante da ADR                                             |
| messagesDeleted     | number  | linhas `messages` removidas                                  |
| conversationsClosed | number  | rows com `deleted_at` preenchido nesta corrida               |

Efeito de negócio (Sale, Customer, audit) **fora** deste lote.

---

## Relacionamentos

```text
Company 1 ──* Conversation (RLS)
Conversation 1 ──* Message
Conversation 1 ──* Confirmation   (NR-061; esta fatia não escreve)
Message.tool_calls  ─  âncoras daquele turno (opcional)
```

---

## Validation rules (resumo)

- Identidade: fail-closed se `number_from` vazio; HTTP e Studio não cruzam.
- Janela: `LIMIT 12` depois do corte de idle; nunca alargar.
- Idle: `now - lastCreatedAt > 2h` ⇒ ActiveContext vazio.
- Expurgo: DELETE messages ≥ 30 d; conversa sem msg vigente → `deleted_at`.
- Tenant: outra loja = ausência.
- Relógio: 100% injetado.
