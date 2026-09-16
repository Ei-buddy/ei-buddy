# Data Model: Assistente — runtime mínimo (NR-060)

**Date**: 2026-09-16  
**Spec**: [spec.md](./spec.md)

Nesta fatia **não há migração Postgres nova**. Confirmações e (opcional) contador de IA são estado de processo. Entidades abaixo são o modelo de runtime + contratos já persistidos por `core`.

---

## Runtime (volátil)

### IncomingMessage

| Campo     | Tipo             | Regras                                   |
| --------- | ---------------- | ---------------------------------------- |
| text      | string           | 1–4000 chars (`agentMessageInputSchema`) |
| requestId | string           | do `ExecutionContext`                    |
| now       | Date             | injetado (testável)                      |
| channel   | `'app'` \| …     | harness usa `app` até WhatsApp           |
| ctx       | ExecutionContext | companyId, userId, role da **fixture**   |

### AgentReply

| Campo          | Tipo                                                              | Regras                                    |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| kind           | `answer` \| `clarify` \| `unknown` \| `confirmation` \| `ignored` |                                           |
| text           | string                                                            | resposta ao operador                      |
| confirmationId | string?                                                           | presente quando `kind === 'confirmation'` |

### PendingConfirmation

| Campo     | Tipo                                      | Regras                           |
| --------- | ----------------------------------------- | -------------------------------- |
| id        | string                                    |                                  |
| companyId | string                                    | isolamento lógico em memória     |
| toolId    | string                                    |                                  |
| args      | unknown                                   | já validados pelo schema da tool |
| summary   | string                                    | texto da proposta                |
| expiresAt | Date                                      | agora + TTL (5 min)              |
| status    | pending → accepted \| rejected \| expired |                                  |

**Transitions**: create (mutatesValue) → accept (executa tool) \| reject/ambiguous (não executa) \| expire (não executa).

### AgentTool (catálogo)

| Campo                        | Tipo                   | Regras                          |
| ---------------------------- | ---------------------- | ------------------------------- |
| id                           | string                 | estável, snake_case             |
| description                  | string                 | para o LLM                      |
| inputSchema                  | Zod                    | **mesmo** schema de `contracts` |
| mutatesValue                 | boolean                | true → confirmação              |
| execute                      | (input, ctx) → Promise | só `core`                       |
| formatProposal / formatReply | fn                     | texto humano                    |

### LlmDecision

| type      | payload                   |
| --------- | ------------------------- |
| `tool`    | name + args               |
| `text`    | text                      |
| `unknown` | — → `textoDasCapacidades` |

### AiUsageCounter (novo, in-memory ok nesta fatia)

| Campo       | Tipo    | Regras                      |
| ----------- | ------- | --------------------------- |
| companyId   | string  | chave                       |
| period      | YYYY-MM | mês civil                   |
| units       | number  | decides ou tokens estimados |
| budgetCents | number? | de env                      |

---

## Persistido (já existente — só consumo)

Usado pelas tools; sem mudança de schema obrigatória nesta fatia:

- **Company / User / Membership** — fixture de teste
- **Customer** — create + duplicidade (RF-099)
- **Product** — busca / desambiguação (RF-102)
- **Sale + items + payments + stock** — `registerSale` (RF-101, RF-136)
- **Receivable** — listagem + cobrança
- **Ledger / classified entries** — `buildDre` (RF-108)
- **Consent** (cliente) — exigido pela porta `MessageSender` na cobrança

---

## Catálogo alvo de tools

| id                       | mutatesValue | Contrato / core                | US/RF  |
| ------------------------ | :----------: | ------------------------------ | ------ |
| `list_sales`             |     não      | sale history                   | US-047 |
| `list_receivables`       |     não      | listReceivables                | US-047 |
| `search_products`        |     não      | catalog                        | RF-102 |
| `period_summary`         |     não      | `dreInputSchema` → `buildDre`  | RF-108 |
| `create_customer`        |     sim      | createCustomer                 | US-048 |
| `create_sale`            |     sim      | createSale                     | US-049 |
| `send_charge`            |     sim      | sendCustomerCharge (novo fino) | US-052 |
| `refuse_certificate`     |     não*     | texto fixo                     | RF-149 |
| `refuse_banking`         |     não*     | texto fixo                     | RF-150 |
| `refuse_invoice_command` |     não*     | texto fixo                     | RF-151 |

\*Não muta valor de negócio; não pede confirmação.

`revenue_by_month` pode permanecer no catálogo para perguntas de série mensal, mas **não** é a tool de “resumo do mês” (RF-108).

---

## Validation rules (resumo)

- Args de tool: `parseToolArgs` com schema Zod de `contracts` — falha → clarify, sem execute.
- Confirmação: só `eSim` explícito executa; ambíguo = não; expirado = mensagem de restart.
- Tenant: todo execute recebe `ctx` da sessão; tools não aceitam `companyId` no input.
- Recusas: zero side-effect (sem arquivo, sem emissão, sem import).
