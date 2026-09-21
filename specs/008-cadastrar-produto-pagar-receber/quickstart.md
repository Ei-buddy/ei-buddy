# Quickstart: validar NR-117

**Goal**: comprovar cadastro de produto, lançamento de conta a pagar e recebível
avulso pelo laço conversacional, com confirmação e mesmos casos de uso do app.

**Rastreio**: cenários P1 em [spec.md](./spec.md) (US-069–071, RF-140–142, FR-012,
SC-001–008). Esta matriz é o conjunto mínimo reproduzível com `AGENT_PROVIDER=fake`
e stubs na CI; paridade persistida opcional conforme seção Postgres abaixo.

## Prerequisites

- Repositório instalado e Postgres do Compose em execução:
  [setup](../../docs/engenharia/setup.md).
- Branch `feat/NR-117-cadastrar-produto-pagar-receber`.
- `AGENT_PROVIDER=fake` e sessão fixture para `POST /agent/messages`.
- Migrations aplicadas (cadastro, payables, receivables já no baseline 0909).

## Decisões de clarificação (2026-09-21)

| Tópico                               | Decisão                                                 | Efeito na validação                                                                                                    |
| ------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Preço de venda &lt; custo (1A)       | Recusa no `createProductInputSchema` / POST `/produtos` | Sem `PendingConfirmation` com valores inválidos; `registerProduct` não é chamado                                       |
| Conta com vencimento no passado (2A) | Título nasce `status: open`                             | Aparece na faixa **vencidas** (`list_payables` / visão do app), não como status `overdue` persistido                   |
| EAN duplicado (3A)                   | Avisar e não duplicar                                   | `AppError.conflict` do núcleo; sem segundo produto; **sem** atalho conversacional de “reutilizar” o cadastro existente |
| Paridade SC (10B)                    | Stubs/FakeLlm obrigatórios na CI                        | 1–2 testes API + Postgres opcionais quando `DATABASE_URL` estiver definido                                             |

## Matriz mínima (FakeLlm / stubs)

Use `ctx.now` fixo ao validar vencimentos. Cada linha cobre um cenário P1 ou edge
case obrigatório de [spec.md](./spec.md).

| Cenário               | Mensagem exemplo (ajuste à fixture)                                    | Esperado (spec / RF)                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Produto feliz         | `cadastra camiseta M custo 20 vende 49,90` → `sim`                     | Proposta `create_product` (RF-103); após `sim`, `registerProduct` com descrição, custo e preço; resposta cita cadastro (ex. código interno) — US-069 · SC-001 |
| Preço abaixo do custo | custo 50, venda 10 (mesmos campos obrigatórios)                        | Validação Zod recusa antes de gravar; mensagem clara; **sem** proposta com valores inválidos — FR-004 · SC-002 implícito                                      |
| EAN duplicado         | cadastro com `barcode` já usado na empresa → `sim`                     | Conflito de `registerProduct`; aviso do existente; zero segundo produto; sem “reutilizar” no chat — FR-003 · SC-002                                           |
| Conta a pagar         | `lança aluguel 1800 vence dia 10` → `sim`                              | Proposta `create_payable`; título com fornecedor, descrição, valor e vencimento — US-070 · SC-003                                                             |
| Vencimento passado    | vencimento anterior a `ctx.now` → `sim`                                | Título `status: open`; consulta de vencimentos inclui faixa **vencidas** — FR-006 · SC-003                                                                    |
| Recebível avulso      | `a receber 500 do João na sexta, aluguel vitrine` → `sim`              | Proposta `create_receivable`; mesmo caso de uso da US-031 — US-071 · SC-004                                                                                   |
| Dados incompletos     | `lança conta a pagar` sem valor; ou cadastro sem custo/preço após foto | `clarify` / pedido de campo; **sem** `confirmationId`; assistente não inventa valor, data, fornecedor, cliente nem descrição — FR-008 · SC-005                |
| Recusa / TTL          | proposta → `não` ou esperar 5 min (RF-104)                             | Zero efeito em catálogo e títulos — FR-009 · SC-006                                                                                                           |
| Foto → cadastro       | foto + “cadastra” (NR-116) → turno com nome, custo, preço → `sim`      | Produto criado com `barcode` do turno anterior; se faltar custo ou preço, pede o que falta e não grava incompleto — US-069 cenário 4                          |
| Isolamento tenant A/B | mesma frase de mutação em empresa A e B                                | B não vê nem altera produto/título de A; IDs alheios tratados como inexistentes — FR-010 · SC-007                                                             |

### Cenários complementares (FR-012 / edge cases)

Validar no laço (`process-message.test.ts`) e, quando aplicável, no FakeLlm:

| Cenário                 | Gatilho exemplo                                                | Esperado                                                                                    |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Venda ≠ recebível       | frase de venda de produtos                                     | Fluxo `create_sale`, **não** `create_receivable` — US-071 cenário 2 · SC-004                |
| Cliente ambíguo         | dois clientes homônimos para recebível                         | Lista ou `clarify`; **sem** `create_receivable` com `customerId` errado — US-071 cenário 4  |
| Recorrência a pagar     | repetição suportada pelo app (ex. mensal) → `sim`              | N títulos pelo `createPayable`; resposta declara quantidade se N &gt; 1 — US-070 cenário 4  |
| Confirmação não cruzada | pendência `create_product` + mensagem de conta a pagar + `sim` | Não baixa conta nem reutiliza proposta de produto — edge spec                               |
| Falha após `sim`        | stub/`core` rejeita em `execute`                               | Mensagem de erro clara; sem gravação parcial nem segunda confirmação automática — edge spec |
| Papel sem escrita       | contexto read-only (`assertCanWrite` falha)                    | Mesma recusa do núcleo; zero gravação nas três mutações — edge spec                         |

Campos opcionais de produto (estoque, categoria, fiscal etc.) seguem defaults do app;
o assistente não infere NCM/CFOP/CST sem pedido explícito — edge spec.

## Validação automatizada (gates)

```bash
pnpm --filter @na-regua/core test -- src/registration/register-product.ts src/payables/payables.test.ts src/receivables
pnpm --filter @na-regua/agent test -- src/catalog.test.ts src/process-message.test.ts
pnpm --filter @na-regua/api test -- src/routes/agent.test.ts src/composition.test.ts
pnpm format:check
pnpm boundaries
pnpm typecheck
```

### Integração Postgres (opcional, recomendado — 10B)

Com `DATABASE_URL` apontando para o Compose local:

1. **Produto (SC-001)**: após `sim` em cadastro por mensagem, `GET /produtos` (ou query direta)
   mostra descrição, custo e preço iguais aos informados na conversa.
2. **Conta a pagar (SC-003)**: após `sim` com vencimento no passado, `list_payables` / visão do
   app inclui o título na faixa **vencidas** (`status` persistido `open`).

Implementação: 1–2 casos em `apps/api/src/routes/agent.test.ts` com `skipIf(!process.env.DATABASE_URL)`
ou arquivo `agent-mutations.integration.test.ts` na mesma pasta.

### Responsabilidade dos testes

| Arquivo                                                                        | Responsabilidade NR-117                                    |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `packages/agent/src/catalog.test.ts`                                           | Schemas, `mutatesValue`, formatação, wire para `core`      |
| `packages/agent/src/process-message.test.ts`                                   | Laço: matriz mínima + cenários complementares acima        |
| `packages/agent/src/fake-llm.ts`                                               | Frases scriptáveis para as três tools                      |
| `apps/api/src/routes/agent.test.ts`                                            | POST autenticado com confirmação (produto, pagar, receber) |
| `apps/api/src/routes/agent.test.ts` (ou `agent-mutations.integration.test.ts`) | 1–2 casos com Postgres quando `DATABASE_URL` definido      |
| `packages/core/...`                                                            | Regressão dos casos de uso (não duplicar regra no agente)  |

NR-118 (`settle_*`, `adjust_stock`, `cancel_sale`): **não** entram nos gates
deste quickstart.

## Smoke manual (opcional)

1. API em não-produção, `AGENT_PROVIDER=fake`, usuário fixture.
2. Cadastro:

```http
POST /agent/messages
{ "text": "cadastra camiseta M, custo 20 reais, vende 49,90" }
```

Responda `sim` na proposta; confira produto no painel web.

3. Conta a pagar e recebível: frases da matriz; confirme cada uma.
4. Studio (NR-121): opcional — mesmo `processMessage` com preset `wa:`.

## Documentação no merge

- Atualizar `packages/agent/README.md` (seção NR-117).
- `docs/processo/task-ledger.md`: NR-117 ✅ com `Refs: NR-117` no PR.
