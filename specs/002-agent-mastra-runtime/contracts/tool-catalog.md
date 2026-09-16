# Contract: Catálogo de tools do assistente

**Feature**: NR-060 · **Package**: `@na-regua/agent`  
**Regra de ouro**: inputSchema de cada tool = schema Zod exportado por `@na-regua/contracts` (ou objeto vazio strict quando não há input). Proibido segundo conjunto de campos.

## Laço

```
LLM (FakeLlm | Mastra) escolhe tool + args
  → parseToolArgs(contracts)
  → se mutatesValue: PendingConfirmation (não executa)
  → senão / após "sim": tool.execute → core
  → formatReply → AgentReply.text
```

Nas tools registradas no `Agent` Mastra, `execute` é **identidade** (devolve args). Efeito só no catálogo.

## Tools (alvo NR-060)

### Leituras

| id                 | input (contracts)           | core                  | mutates                      |
| ------------------ | --------------------------- | --------------------- | ---------------------------- |
| `list_sales`       | `saleHistoryInputSchema`    | `listSales`           | não                          |
| `list_receivables` | `{}` strict                 | `listReceivables`     | não                          |
| `search_products`  | `catalogInputSchema`        | `searchProducts`      | não                          |
| `period_summary`   | `dreInputSchema`            | `buildDre`            | não                          |
| `revenue_by_month` | `revenueByMonthInputSchema` | `buildRevenueByMonth` | não (opcional; não é RF-108) |

### Mutações / envio

| id                | input (contracts)                                               | core                 | mutates |
| ----------------- | --------------------------------------------------------------- | -------------------- | ------- |
| `create_customer` | `createCustomerInputSchema`                                     | `registerCustomer`   | sim     |
| `create_sale`     | `createSaleInputSchema`                                         | `registerSale`       | sim     |
| `send_charge`     | schema novo mínimo em contracts (customerId ou telefone tipado) | `sendCustomerCharge` | sim     |

### Recusas (side-effect = nenhum)

| id                       | input                         | comportamento             |
| ------------------------ | ----------------------------- | ------------------------- |
| `refuse_certificate`     | `{}` ou `{ reason: literal }` | texto fixo → app (RF-149) |
| `refuse_banking`         | idem                          | texto fixo (RF-150)       |
| `refuse_invoice_command` | idem                          | texto fixo (RF-151)       |

## Capacidades (RF-097)

`textoDasCapacidades(tools)` lista **apenas** tools do catálogo atual. Não menciona US-065–067 nem roadmap.

## Confirmação

Qualquer `mutatesValue: true` gera proposta via `formatProposal`. TTL 5 minutos. Ambiguidade = rejeição.

## Proibições

- Calcular dinheiro no LLM ou no formatador além de formatar centavos já calculados por `core`/`domain`.
- `requireApproval` / Memory / Workflow / RAG do Mastra.
- Tool que leia Postgres direto ou importe `db`/`domain`.
