# Contract: POST /agent/messages

**Feature**: NR-060 · **Package**: `apps/api` + `@na-regua/contracts`  
**Schema canônico**: `agentMessageInputSchema` / `agentReplySchema` em `packages/contracts/src/agent/message.ts`

## Purpose

Harness de engenharia para exercitar `processMessage` sem WhatsApp. Mesmo contrato de mensagem que o webhook futuro deverá alimentar.

## Availability

| Ambiente                                 | Comportamento                                                   |
| ---------------------------------------- | --------------------------------------------------------------- |
| `NODE_ENV !== 'production'`              | Disponível se runtime configurado (`fake` ou `mastra`+chave)    |
| `production` + `AGENT_PROVIDER=fake`     | **503** UNAVAILABLE (já implementado)                           |
| `production` + harness sem canal produto | Tratar como indisponível ao lojista; eng. via NR-121/113 depois |
| Runtime ausente                          | **503** com motivo claro                                        |

## Auth

- Sessão autenticada da **fixture** (owner de teste criado pelo desenvolvedor).
- `companyId` / `userId` / `role` vêm do contexto de execução — **nunca** do body.
- Conta real de produto / produção não é o público deste endpoint nesta fatia.

## Request

```http
POST /agent/messages
Content-Type: application/json
Cookie: <session fixture>
```

```json
{
  "text": "quanto vendi hoje?"
}
```

| Campo | Regras                                                 |
| ----- | ------------------------------------------------------ |
| text  | string trim, min 1, max 4000; único campo; `.strict()` |

## Response 200

```json
{
  "kind": "answer",
  "text": "1 venda. Bruto R$ 49,90. …"
}
```

| kind           | Quando                                               |
| -------------- | ---------------------------------------------------- |
| `answer`       | Leitura executada ou recusa/texto final              |
| `confirmation` | Proposta pendente (`confirmationId` presente)        |
| `clarify`      | Args inválidos / desambiguação                       |
| `unknown`      | Intenção fora do catálogo → lista capacidades atuais |
| `ignored`      | (reservado)                                          |

### Ciclo de confirmação

1. Mutação/envio → `kind: confirmation` + texto da proposta.
2. Cliente envia nova mensagem `"sim"` / `"não"` / ambíguo.
3. Aceite → executa tool → `answer`. Recusa/expiração → `answer` sem efeito.

## Errors

| HTTP | code        | Motivo                                       |
| ---- | ----------- | -------------------------------------------- |
| 401  | …           | Sem sessão                                   |
| 429  | …           | Rate limit de escrita                        |
| 503  | UNAVAILABLE | Sem runtime / fake em prod / config inválida |
| 400  | VALIDATION  | Body fora do schema                          |

## Idempotency

Venda pelo agent usa `idempotencyKey` derivado de `agent:${requestId}` na composition (já esboçado). Reenvio HTTP do mesmo requestId não deve duplicar venda se o core respeitar a chave.

## Out of scope neste contrato

- Upload de certificado/OFX (recusa só por texto).
- Streaming / SSE.
- Multipart arquivo (RF-109 dívida).

Harness Studio (NR-121): rotas `/api/agents/*` do adapter Fastify — agent
`studio-harness`, tool `process_message` → o mesmo `processMessage`. Ver
[studio-harness.md](../../003-studio-harness/contracts/studio-harness.md).
Este contrato (`POST /agent/messages`, `text` só, `channel: 'app'`) **não**
muda.
