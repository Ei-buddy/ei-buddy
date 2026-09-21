# Contract: tools de mutação NR-117

**Feature**: NR-117  
**Package**: `@na-regua/agent`  
**Norma**: inputs das tools vêm de schemas exportados por `@na-regua/contracts`.
Efeito só após confirmação explícita (NR-061). Execução chama `core` com
`ExecutionContext`; agente não importa `db` nem `domain`.

## Comportamento comum

```text
LLM decide tool + args validados por Zod
  → se mutatesValue: PendingConfirmation (proposta legível)
  → sim dentro do TTL → tool.execute → caso de uso core
  → não / ambíguo / expirado → sem efeito
```

| Regra      | Contrato                                                           |
| ---------- | ------------------------------------------------------------------ |
| Efeito     | `mutatesValue: true` nas três tools desta fatia                    |
| Tenant     | `companyId` só do contexto; nunca argumento da tool                |
| Dinheiro   | Centavos validados no schema; formatação só na proposta/resposta   |
| Cálculo    | Margem, imposto e totais vêm do núcleo; agente não calcula         |
| Falha core | `AppError` / validação Zod viram texto claro; sem gravação parcial |
| Turno      | Uma mutação confirmada por pendência; tipos não compartilham `sim` |

## `create_product`

| Item                  | Contrato                                                         |
| --------------------- | ---------------------------------------------------------------- |
| Input                 | `CreateProductInput` (`createProductInputSchema`)                |
| Dependência `core`    | `registerProduct`                                                |
| Confirmação           | Proposta com descrição, custo e venda (e código se houver)       |
| Sucesso               | `ProductOutput`; resposta cita descrição, código interno e preço |
| EAN duplicado         | Erro de conflito do núcleo; sem segundo produto                  |
| Preço abaixo do custo | Rejeição no schema (mesmo que POST de cadastro de produto)       |
| Foto NR-116           | Código pode entrar no input no turno seguinte; sem visão no LLM  |

## `create_payable`

| Item               | Contrato                                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| Input              | `CreatePayableInput` (`createPayableInputSchema`)                              |
| Dependência `core` | `createPayable` → `readonly PayableOutput[]`                                   |
| Confirmação        | Fornecedor, descrição, valor, vencimento (e recorrência se presente)           |
| Sucesso            | Um ou N títulos; se N maior que 1, resposta declara quantidade e 1º vencimento |
| Dados faltantes    | `clarify` / texto pedindo campo; MUST NOT inventar valor ou data               |
| Vencimento passado | `status: open` persistido; faixa **vencidas** em `list_payables`               |

## `create_receivable`

| Item               | Contrato                                                |
| ------------------ | ------------------------------------------------------- |
| Input              | `CreateReceivableInput` (`createReceivableInputSchema`) |
| Dependência `core` | `createReceivable`                                      |
| Confirmação        | Descrição, valor, vencimento; cliente se informado      |
| Sucesso            | `ReceivableOutput` resumido na resposta                 |
| Venda              | MUST NOT usar esta tool; vendas usam `create_sale`      |
| Dados faltantes    | Pedir esclarecimento; sem lançamento parcial            |

## Fora deste contrato

Tools `settle_payable`, `settle_receivable`, `adjust_stock`, `cancel_sale` e
demais mutações NR-118 **não** fazem parte do aceite NR-117.

## Testes de contrato

1. Args inválidos falham antes de criar `PendingConfirmation`.
2. Três tools permanecem `mutatesValue: true`; leituras NR-115 não criam pendência.
3. `sim` em harness A não confirma proposta do harness B (`app:` ≠ `wa:`).
4. Tenant: mutação na empresa A não grava na B.
5. FakeLlm reconhece frases mínimas das três jornadas para `process-message.test`.
