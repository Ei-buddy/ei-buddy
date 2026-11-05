# Quickstart: Operação diária do Buddy no WhatsApp

**Feature**: 012-buddy-operacao-whatsapp  
**Spec**: [spec.md](./spec.md) · **Contracts**: [agent-daily-ops-tools.md](./contracts/agent-daily-ops-tools.md)

Guia de validação. Não substitui o roteiro manual em
`docs/qa/buddy-roteiro-de-prompts.md` (aceite humano WhatsApp + web + banco).

## Prerequisites

- Node + pnpm do monorepo
- `AGENT_PROVIDER=fake` na CI / local para o laço sem OpenAI
- Postgres quando o teste for integração de `core`/`db` (update/delete produto,
  soft-delete)

## Fixture matrix (T001 — alinhada à spec)

| Capacidade                                   | Frase / fluxo                              | Tool esperada                         | Confirmação | Conferir                        |
| -------------------------------------------- | ------------------------------------------ | ------------------------------------- | ----------- | ------------------------------- |
| Vendas do período                            | “quanto vendi hoje?”                       | `list_sales`                          | Não         | qty/total/ticket = tela         |
| Período sem venda                            | ticket médio vazio                         | `list_sales`                          | Não         | sem ticket inventado            |
| Resumo / faturamento                         | “resumo do mês” / faturamento              | `period_summary` / `revenue_by_month` | Não         | DRE / meses                     |
| Ranking                                      | “ranking de clientes/produtos …” + período | `rank_customers` / `rank_products`    | Não         | nomes/valores                   |
| Ranking sem período                          | ranking sem datas                          | clarify                               | —           | sem execute                     |
| Histórico do cliente                         | “compras do João”                          | `list_sales` + `customerId`           | Não         | ordem decrescente               |
| Estoque / contas / carteira / agenda / busca | frases NR-115+                             | tools de leitura existentes           | Não         | paridade tela                   |
| Produto incompleto                           | “adicione café”                            | clarify                               | —           | zero gravação                   |
| Cadastro produto                             | completo → sim                             | `create_product`                      | Sim         | web + banco                     |
| Preço < custo                                | cadastro/edição                            | recusa schema/core                    | —           | zero gravação                   |
| Editar cliente                               | só telefone → sim                          | `update_customer`                     | Sim         | demais campos iguais            |
| Editar produto                               | só preço → sim                             | `update_product`                      | Sim         | ficha: preço novo, custo antigo |
| Compra → venda                               | “compra do João …” → sim                   | `create_sale`                         | Sim         | venda, não recebível            |
| Soft-delete cliente/produto                  | “apague …” → sim                           | `mark_*_deleted`                      | Sim         | `deleted_at`; frase deletado    |
| Apagar venda                                 | “apague a venda …” → sim                   | `cancel_sale`                         | Sim         | status cancelada                |
| Apagar conta/contato                         | pedido de apagar                           | recusa                                | —           | sem remoção                     |
| Confirmação                                  | não / ambíguo / TTL                        | —                                     | —           | zero efeito                     |
| Idempotência                                 | reentrega pós-sim                          | —                                     | —           | um registro                     |
| Conta restrita                               | consulta + mutação                         | leitura ok / escrita recusada         | —           | RF-117                          |
| Número sem cadastro                          | peer inválido                              | —                                     | —           | sem dado da loja                |

## Inventory vs contract (T002)

Estado **antes** desta implementação (catálogo atual):

| Contrato 012                                     | No catálogo hoje?                         |
| ------------------------------------------------ | ----------------------------------------- |
| `rank_customers` / `rank_products`               | Não                                       |
| `update_customer` / `update_product`             | Não                                       |
| `mark_customer_deleted` / `mark_product_deleted` | Não                                       |
| `list_sales` histórico por cliente               | Tool existe; falta UX/formatReply         |
| `create_sale` (“compra”)                         | Tool existe; falta mapeamento de intenção |
| Soft-delete produto no core/API                  | Não (só coluna)                           |
| Mutações settle/adjust/cancel/agenda/charge      | Sim (laço FakeLlm incompleto)             |
| Tool de `DELETE` físico                          | Ausente (correto)                         |

## Automated gates (ordem sugerida)

### 1. Contratos e catálogo

```bash
pnpm --filter @na-regua/contracts test
pnpm --filter @na-regua/agent exec vitest run src/catalog.test.ts
```

Esperado: schemas `updateProduct` / ranking ok; tools novas com
`mutatesValue` correto; ausência de tool de remoção física.

### 2. Núcleo — produto e cliente

```bash
pnpm --filter @na-regua/core test
```

Esperado (quando implementado):

- `updateProduct` altera só campos pedidos; preço < custo recusado
- `deleteProduct` seta `deleted_at`; produto some da busca vigente
- `updateCustomer` / `deleteCustomer` regressão verde

### 3. Laço conversacional (FakeLlm)

```bash
pnpm --filter @na-regua/agent exec vitest run src/process-message.test.ts
```

Roteiros mínimos a cobrir:

| #   | Frase / fluxo                     | Esperado                                            |
| --- | --------------------------------- | --------------------------------------------------- |
| 1   | “quanto vendi hoje?”              | `list_sales`; números do stub/core; sem confirmação |
| 2   | período sem venda + ticket        | sem ticket inventado                                |
| 3   | ranking com período               | `rank_*`; nomes/valores do core                     |
| 4   | ranking sem período               | clarify; sem execute                                |
| 5   | histórico do cliente              | `list_sales` + `customerId`                         |
| 6   | “adicione café” incompleto        | clarify; zero gravação                              |
| 7   | produto completo → sim            | `create_product`; efeito único                      |
| 8   | preço < custo                     | recusa; zero gravação                               |
| 9   | editar telefone do cliente → sim  | só telefone muda                                    |
| 10  | editar preço do produto → sim     | ficha/retorno com preço novo e custo antigo         |
| 11  | “compra do João …” completa → sim | `create_sale`                                       |
| 12  | “apague o cliente X” → sim        | marca deletado; frase “deletado”                    |
| 13  | “apague a venda Y” → sim          | `cancel_sale`; status cancelada                     |
| 14  | sim após TTL                      | zero efeito                                         |
| 15  | reentrega da mesma gravação       | um registro                                         |
| 16  | conta restrita + mutação          | recusa escrita; leitura ok                          |

### 4. HTTP agent

```bash
pnpm --filter @na-regua/api exec vitest run src/routes/agent.test.ts
```

Esperado: um POST por tool nova com confirmação (stubs ou fixture).

### 5. Formatação

```bash
pnpm format:check
```

## Manual roteiro (aceite da spec)

Arquivo: `docs/qa/buddy-roteiro-de-prompts.md` (criar na implementação).

| Coluna            | Conteúdo                                      |
| ----------------- | --------------------------------------------- |
| #                 | Ordem                                         |
| Capacidade        | Ex.: ranking, editar produto, marcar deletado |
| Endpoint          | Método e caminho da tela                      |
| Prompt            | Mensagem no WhatsApp                          |
| Resposta esperada | Comportamento, não frase idêntica             |
| Conferir no banco | `deleted_at` / status / campos                |
| Conferir na web   | Lista / ficha / histórico                     |

Rodar uma passagem completa: conversa → banco → web.

## Definition of done (merge)

- [x] Gates 1–5 verdes (suítes alvo da feature; `format:check` na raiz pode ainda falhar em arquivos fora desta fatia)
- [x] Ficha de produto na web reflete edição por conversa
- [x] Soft-delete cliente/produto sem `DELETE` físico
- [x] “Apagar venda” = cancelamento; linha permanece
- [x] Roteiro manual enumerado com ≥ 1 linha por capacidade da spec
- [x] Constitution I–V sem violação (tools → core; TDD)
