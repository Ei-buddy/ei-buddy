# Implementation Plan: Cadastrar produto e lançar pagar/receber por mensagem (NR-117)

**Branch**: `feat/NR-117-cadastrar-produto-pagar-receber` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

## Summary

Completar o assistente para três mutações SHOULD do MVP: cadastro de produto,
lançamento de conta a pagar e recebível avulso. As tools e a composition já
existem; esta fatia fecha o laço conversacional (FakeLlm, `processMessage`,
confirmação NR-061, testes HTTP), o handoff pós-foto da NR-116 e a documentação
de aceite — sem tocar em baixas/estorno (NR-118).

## Technical Context

**Language/Version**: TypeScript, Node.js e pnpm workspace.

**Primary Dependencies**: Zod (`contracts`), Mastra para expor tools ao LLM,
Vitest, Fastify no harness `POST /agent/messages`.

**Storage**: PostgreSQL com RLS; produtos, `payables` e recebíveis já no schema 0909. Confirmações e mensagens (NR-061/062) sem mudança de schema.

**Testing**: Vitest em `agent` (laço + catálogo), `core` (regressão de casos de
uso), `api` (rota autenticada). CI sem OpenAI (`AGENT_PROVIDER=fake`).

**Target Platform**: API Node.js; aceite em harness de engenharia e Studio
opcional; WhatsApp produção fora (NR-113/046).

**Project Type**: Monorepo — `contracts`, `core`, `agent`, `apps/api`.

**Performance Goals**: um turno de proposta + um de confirmação; mesmos tetos
RNF-006 do runtime existente em smoke manual com Mastra real.

**Constraints**:

- Três tools: `create_product`, `create_payable`, `create_receivable` —
  `mutatesValue: true`.
- Schemas exclusivamente de `contracts`; agente não importa `db`/`domain`.
- Erros de `registerProduct` (EAN duplicado) e validação Zod surfaced ao
  lojista; sem gravação parcial.
- Preço abaixo do custo: rejeição do schema (paridade com app), não alerta
  separado — ver [research.md](./research.md#3-preço-menor-que-custo-us-069-vs-schema).
- NR-118: tools `settle_*`, `adjust_stock`, `cancel_sale` permanecem no código
  mas **fora** do DoD e do quickstart desta fatia.

**Scale/Scope**: três mutações + testes de laço; sem RAG, sem canal Meta, sem
novos casos de uso no núcleo.

## Constitution Check

_Gate inicial: PASS. Reavaliado após Phase 1: PASS._

| Princípio                        | Evidência no plano                                                                      | Resultado |
| -------------------------------- | --------------------------------------------------------------------------------------- | --------- |
| I. Um núcleo, dois canais        | `registerProduct`, `createPayable`, `createReceivable` — mesmos do HTTP cadastro/contas | PASS      |
| II. Hexágono e fronteiras        | Schemas em `contracts`; composition injeta portas; agente só orquestra                  | PASS      |
| III. Integridade financeira      | Centavos e títulos só do `core`; confirmação antes de gravar                            | PASS      |
| IV. Isolamento de tenant         | `ExecutionContext.companyId`; testes A/B no laço                                        | PASS      |
| V. Teste que prova comportamento | Matriz em [quickstart.md](./quickstart.md); FakeLlm + process-message                   | PASS      |
| Produto / MVP                    | US-069–071 SHOULD; harness engenharia; NR-118 explicitamente excluído                   | PASS      |

Não há violação a justificar.

## Project Structure

### Documentation (this feature)

```text
specs/008-cadastrar-produto-pagar-receber/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── agent-mutation-tools.md
```

### Source Code (repository root)

```text
packages/
├── contracts/src/
│   ├── product/product.ts          # createProductInputSchema (reuso)
│   └── payable/payable.ts          # createPayable/Reveivable schemas
├── core/src/
│   ├── registration/register-product.ts
│   ├── payables/create-payable.ts
│   └── receivables/create-receivable.ts
└── agent/src/
    ├── catalog.ts                  # create_product | create_payable | create_receivable
    ├── fake-llm.ts                 # + frases NR-117
    ├── process-message.ts          # confirmação + foto handoff (sem mudança estrutural)
    ├── photo-replies.ts            # textos NR-116 (reuso)
    └── *.test.ts
apps/api/src/
├── composition.ts                  # registerProduct, createPayable, createReceivable
└── routes/agent.test.ts
```

**Structure Decision**: alteração vertical mínima no `agent` (testes + FakeLlm);
núcleo e contratos só se teste de regressão expuser lacuna.

## Implementation Outline

1. **FakeLlm** — reconhecer frases para `create_product`, `create_payable`,
   `create_receivable` (espelhar padrão de `list_payables` / `create_customer`).
2. **process-message.test.ts** — US-069: proposta → `sim` / `não` / TTL;
   conflito EAN; preço abaixo do custo; turno após `TEXTO_FOTO_CADASTRO_CODIGO` com
   custo/preço e barcode nos args.
3. **process-message.test.ts** — US-070/071: lançamentos felizes, vencimento
   passado (assert via stub ou `list_payables`), dados incompletos sem
   `PendingConfirmation`.
4. **catalog.test.ts** — manter cobertura existente; adicionar só se faltar
   formato de erro ou recorrência na proposta.
5. **routes/agent.test.ts** — um POST por tool com confirmação (stubs ou DB
   fixture leve).
6. **README agent + ledger** — marcar NR-117 e linkar
   [quickstart](./quickstart.md).
7. Rodar gates do quickstart; `pnpm format:check` antes do PR.

Opcional (só se teste Mastra real perder barcode após foto): rascunho
`ProductRegistrationDraft` por `conversationKey`, espelhando `PhotoSaleDraft`.

## Complexity Tracking

Nenhuma exceção à constitution é necessária.
