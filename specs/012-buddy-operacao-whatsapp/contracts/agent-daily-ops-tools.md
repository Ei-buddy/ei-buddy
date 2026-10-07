# Contract: tools da operação diária do Buddy

**Feature**: 012-buddy-operacao-whatsapp  
**Package**: `@na-regua/agent`  
**Norma**: inputs de `@na-regua/contracts`. Mutação só após confirmação
(NR-061). Execução chama `core` com `ExecutionContext`. Agente não importa
`db` nem `domain`. Sem tool cujo efeito remova linha do banco.

## Comportamento comum

```text
LLM decide tool + args (Zod)
  → mutatesValue? PendingConfirmation
  → sim no TTL → tool.execute → core
  → não / ambíguo / expirado → zero efeito
  → leitura → execute imediato; frase com fatos do retorno
```

| Regra             | Contrato                                                         |
| ----------------- | ---------------------------------------------------------------- |
| Tenant            | `companyId` só do contexto                                       |
| Dinheiro / totais | Vêm do núcleo; agente não calcula ticket/ranking                 |
| Conta restrita    | `assertCanWrite` no core; leitura OK                             |
| Falha             | `AppError` → frase de falha; sem afirmar sucesso                 |
| Idempotência      | Reentrega da mensagem já confirmada não duplica efeito (RNF-043) |

## Tools novas ou reorientadas

### Leituras

| Tool id                  | Input (contracts)                         | Core            | Confirmação |
| ------------------------ | ----------------------------------------- | --------------- | ----------- |
| `rank_customers`         | `rankingInputSchema`                      | `rankCustomers` | Não         |
| `rank_products`          | `rankingInputSchema`                      | `rankProducts`  | Não         |
| `list_sales` (histórico) | `saleHistoryInputSchema` com `customerId` | `listSales`     | Não         |

`list_sales` já existe; esta fatia exige descrição/`formatReply` que cubram
“compras do cliente” e período sem venda sem inventar ticket médio.

Período obrigatório no ranking: se a frase não trouxer período, o LLM pede
clarificação (`clarify`) — não assume “este mês”.

### Mutações de edição

| Tool id           | Input                                       | Core                          | `mutatesValue` |
| ----------------- | ------------------------------------------- | ----------------------------- | -------------- |
| `update_customer` | `updateCustomerInputSchema` + id do cliente | `updateCustomer`              | true           |
| `update_product`  | `updateProductInputSchema` + id do produto  | `updateProduct` (a construir) | true           |

Proposta lista só campos que mudam. Sucesso: frase com valores retornados;
ficha web reflete o mesmo.

### Soft-delete / cancelamento por “apagar”

| Tool id                   | Input                   | Core                          | Frase de sucesso          |
| ------------------------- | ----------------------- | ----------------------------- | ------------------------- |
| `mark_customer_deleted`   | id do cliente           | `deleteCustomer`              | Diz que foi **deletado**  |
| `mark_product_deleted`    | id do produto           | `deleteProduct` (a construir) | Diz que foi **deletado**  |
| `cancel_sale` (já existe) | `cancelSaleInputSchema` | `cancelSale`                  | Diz que foi **cancelada** |

Pedido em linguagem “apague / delete a venda X” → o modelo escolhe
`cancel_sale`, não uma tool de remoção.

**Proibido no catálogo**: qualquer tool `delete_*` com SQL `DELETE`, ou tool
cujo sucesso remova a linha.

### Mutações já no catálogo (aceitáveis nesta entrega)

Manter e cobrir no laço / roteiro: `create_customer`, `create_product`,
`create_sale` (incl. intenção “compra”), `create_payable`,
`create_receivable`, `settle_*`, `adjust_stock`, `create_appointment`,
`send_charge`.

### Recusas já no catálogo

`refuse_certificate`, `refuse_banking`, `refuse_invoice_command` — sem
escrita.

## HTTP de paridade (núcleo compartilhado)

Não são contratos do agente; documentam o espelho da tela para o
planejamento:

| Ação                | Rota existente ou a criar                    |
| ------------------- | -------------------------------------------- |
| Editar cliente      | `PATCH /clientes/:id`                        |
| Soft-delete cliente | `DELETE /clientes/:id` (lógico)              |
| Editar produto      | `PATCH /produtos/:id` (**criar**)            |
| Soft-delete produto | `DELETE /produtos/:id` lógico (**criar**)    |
| Ranking             | `GET /relatorios/ranking/clientes\|produtos` |
| Histórico           | `GET /sales?customerId=`                     |
| Cancelar venda      | `POST /sales/:id/cancelar`                   |

## Testes de contrato

1. Args inválidos não criam `PendingConfirmation`.
2. `update_*` e `mark_*_deleted` são `mutatesValue: true`; rankings não.
3. Após soft-delete de cliente/produto, listagens do dia a dia não incluem o
   registro; leitura por id / histórico ainda encontra o registro com
   `deletedAt` (ou equivalente).
4. “Apagar venda” confirmado → status `cancelled`; linha permanece.
5. Nenhuma tool do catálogo executa `DELETE` físico em tabela de negócio.
6. Tenant A não altera B.
7. Conta restrita: ranking OK; `update_product` recusado pelo core.
