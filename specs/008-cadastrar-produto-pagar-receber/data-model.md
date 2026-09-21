# Data Model: mutações conversacionais (NR-117)

**Date**: 2026-09-21  
**Spec**: [spec.md](./spec.md)

Nenhuma tabela nova. Reutiliza entidades já persistidas pelo aplicativo e o
fluxo de confirmação (NR-061) + histórico (NR-062).

## Product (cadastro — RF-140, RF-017–020)

Entrada canônica: `CreateProductInput` (`contracts`).

| Campo              | Obrigatório | Regras conversacionais                    |
| ------------------ | ----------- | ----------------------------------------- |
| description        | sim         | Nome comercial; mínimo 2 caracteres       |
| costPriceCents     | sim         | Centavos; agente não calcula margem       |
| salePriceCents     | sim         | ≥ custo no schema atual (recusa se menor) |
| unitOfMeasure      | sim         | Default `un` quando omitido na mensagem   |
| barcode            | opcional    | Pode vir do turno pós-foto NR-116         |
| stock, minStock    | opcional    | Default 0 no schema                       |
| category, supplier | opcional    | Texto livre como no app                   |
| campos fiscais     | opcional    | Não inferidos pelo assistente             |

**State transitions**:

```text
mensagem → (opcional) clarify por dados faltantes
        → proposta create_product (PendingConfirmation)
        → sim → registerProduct → ProductOutput
        → não / TTL → sem gravação
```

**Conflitos**: EAN duplicado → `AppError.conflict` do núcleo; foto com produto
existente → resposta determinística NR-116 sem abrir confirmação.

## Payable (conta a pagar — RF-141, RF-055–056)

Entrada: `CreatePayableInput`.

| Campo       | Obrigatório | Regras                                                       |
| ----------- | ----------- | ------------------------------------------------------------ |
| supplier    | sim         | Fornecedor (texto)                                           |
| description | sim         | Descrição do título                                          |
| amountCents | sim         | > 0                                                          |
| dueDate     | sim         | ISO date; passado entra na faixa `overdue` ao listar         |
| recurrence  | opcional    | Gera N títulos; resposta da tool informa quantidade se N > 1 |

**State transitions**: iguais ao produto, com `create_payable` e array de saída.

## Receivable avulso (RF-142, RF-065)

Entrada: `CreateReceivableInput`.

| Campo       | Obrigatório | Regras                            |
| ----------- | ----------- | --------------------------------- |
| description | sim         | Motivo do recebimento             |
| amountCents | sim         | > 0                               |
| dueDate     | sim         | ISO date                          |
| customerId  | opcional    | UUID quando o LLM resolve cliente |
| accountId   | opcional    | Plano de contas, se informado     |

**State transitions**: `create_receivable` → um `ReceivableOutput`; não criar
venda nem itens de PDV.

## PendingConfirmation (reuso NR-061)

| Campo     | Uso nesta fatia                                             |
| --------- | ----------------------------------------------------------- |
| toolId    | `create_product` \| `create_payable` \| `create_receivable` |
| args      | Payload validado pelo schema da tool                        |
| expiresAt | TTL 5 min; independente por harness `app:` vs `wa:`         |

Leituras (`list_payables`, etc.) não criam pendência.

## Conversation memory (reuso NR-062)

Histórico até 12 turnos para anáfora e para o turno após foto de cadastro; bytes
de imagem não entram no corpo — só placeholder `[foto do codigo]`.
