# Implementation Plan: Operação diária do Buddy no WhatsApp

**Branch**: `012-buddy-operacao-whatsapp` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-buddy-operacao-whatsapp/spec.md`

**Note**: o setup Spec Kit reportou `BRANCH=012-buddy-operacao-whatsapp`. O
checkout atual do repo pode estar em outra branch; a pasta da feature é a
fonte de verdade (`.specify/feature.json`).

## Summary

Fechar a operação diária da dona no WhatsApp: o Buddy consulta (incluindo
ranking e histórico), cadastra, edita um cliente/produto por vez, lança venda
(também quando ela diz “compra”), baixa, ajusta estoque, cancela venda,
marca cliente/produto como deletado (frase “deletado”, sem remoção física),
agenda e cobra — sempre pelos **mesmos casos de uso da tela**, com confirmação
antes de mutar. Grande parte já está no catálogo; o gap é tools + laço para
edição/ranking/histórico/soft-delete, **`updateProduct`/`deleteProduct` no
núcleo e na ficha web**, mapeamento “apagar venda” → `cancel_sale`, e o
roteiro manual de prompts.

Abordagem: TDD no laço FakeLlm / `processMessage`; composition injeta casos
de uso existentes ou novos; sem tool de `DELETE` físico
([research.md](./research.md)).

## Technical Context

**Language/Version**: TypeScript, Node.js, pnpm workspaces.

**Primary Dependencies**: Zod (`@na-regua/contracts`), Mastra tools no
adapter LLM, Vitest, Fastify (`apps/api`), core use cases.

**Storage**: PostgreSQL + RLS; `customers.deleted_at` / `products.deleted_at`
existentes; vendas sem soft-delete (cancelamento). Confirmações NR-061
inalteradas em schema.

**Testing**: Vitest em `contracts`, `core`, `agent`, `api`. CI com
`AGENT_PROVIDER=fake`. Integração Postgres onde soft-delete/update produto
exigir. Roteiro manual separado.

**Target Platform**: API Node; canal WhatsApp já integrado; harness
`POST /agent/messages` + Studio.

**Project Type**: Monorepo — `contracts`, `core`, `db`, `agent`, `apps/api`,
`apps/web` (ficha produto).

**Performance Goals**: RNF-006 — consulta ≤ 5 s; após sim ≤ 8 s no uso
normal.

**Constraints**:

- Tools → `core` via composition; não HTTP interno; não `db`/`domain` no
  agente.
- Mutação: `mutatesValue` + confirmação 5 min; ambíguo/expirado = zero efeito.
- Sem tool que remova registro guardado.
- “Apagar venda” = `cancel_sale` (constitution III / RNF-040).
- Soft-delete com frase “deletado” = cliente e produto.
- Edição: um registro por vez; preço ≥ custo no schema.
- Conta restrita: lê, não grava (`assertCanWrite`).
- TDD obrigatório por comportamento novo.

**Scale/Scope**: ~6 tools novas/reorientadas + `updateProduct`/`deleteProduct`

- ficha web + cobertura de laço das mutações já existentes + roteiro QA.
  Devolução parcial, preço em lote, soft-delete de conta/contato fora.

## Constitution Check

_Gate inicial: PASS (com interpretação de FR-022 para vendas — research §3).
Reavaliado após Phase 1: PASS._

| Princípio                        | Evidência no plano                                                                                                | Resultado |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------- |
| I. Um núcleo, dois canais        | Tools chamam `updateCustomer`, `rankCustomers`, `cancelSale`, etc.; produto ganha o mesmo `updateProduct` da tela | PASS      |
| II. Hexágono e fronteiras        | Schemas em `contracts`; composition injeta portas; agente só orquestra                                            | PASS      |
| III. Integridade financeira      | Centavos no schema; venda não apagada — só cancelada; Money no core                                               | PASS      |
| IV. Isolamento de tenant         | `ExecutionContext.companyId`; testes A/B no laço                                                                  | PASS      |
| V. Teste que prova comportamento | Matriz [quickstart.md](./quickstart.md); FakeLlm + core                                                           | PASS      |
| Produto / confirmação            | Consulta livre; mutação com sim; roteiro manual no aceite                                                         | PASS      |

Não há violação a justificar em Complexity Tracking. A tensão “deletar venda”
da spec foi resolvida em research alinhada à constitution (cancelamento).

## Project Structure

### Documentation (this feature)

```text
specs/012-buddy-operacao-whatsapp/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── agent-daily-ops-tools.md
├── checklists/
│   └── requirements.md
└── spec.md
```

### Source Code (repository root)

```text
packages/
├── contracts/src/
│   ├── customer/customer.ts       # updateCustomerInputSchema (reuso)
│   ├── product/product.ts         # updateProductInputSchema (reuso)
│   ├── report/report.ts           # rankingInputSchema (reuso)
│   └── sale/sale.ts               # saleHistoryInputSchema + customerId
├── core/src/
│   ├── registration/register-customer.ts  # updateCustomer, deleteCustomer
│   ├── registration/register-product.ts   # + updateProduct, deleteProduct
│   ├── reports/rankings.ts
│   └── sales/cancel-sale.ts / list-sales.ts
├── db/src/
│   └── registration-repositories.ts      # update produto + setDeletedAt produto
└── agent/src/
    ├── catalog.ts                 # tools novas + formatReply histórico
    ├── fake-llm.ts                # scripts dos roteiros
    ├── process-message.ts         # sem mudança estrutural esperada
    └── *.test.ts
apps/api/src/
├── composition.ts                 # buildAgentUseCases slots novos
└── routes/
    ├── cadastro.ts                # PATCH/DELETE produtos
    └── agent.ts                   # regressão harness
apps/web/src/
└── … ficha produto                # edição preço/custo/descrição
docs/qa/
└── buddy-roteiro-de-prompts.md    # aceite manual
```

**Structure Decision**: extensão vertical do agente + fecho do cadastro de
produto (core/API/web) para paridade de canal. Sem pacote novo.

## Implementation Outline

1. **Research fechada** — [research.md](./research.md) (tools→core; soft-delete
   vs cancel venda; build `updateProduct`).
2. **Contracts/tests** — schemas já existem; acrescentar só se faltar id nos
   inputs das tools de update/delete.
3. **Core/db TDD** — `updateProduct`, `deleteProduct`; regressão cliente.
4. **API** — `PATCH`/`DELETE` lógico produtos; composition dos slots do agente.
5. **Web** — ficha produto editável nos campos desta fatia.
6. **Agent catalog** — `rank_*`, `update_*`, `mark_*_deleted`; enriquecer
   `list_sales` / `create_sale` (“compra”); FakeLlm.
7. **process-message + agent routes** — matriz do quickstart.
8. **Roteiro** — `docs/qa/buddy-roteiro-de-prompts.md`.
9. **`pnpm format:check`** antes de PR.

## Complexity Tracking

> Nenhuma violação de constitution a justificar.
