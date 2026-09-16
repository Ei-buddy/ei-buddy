# Glossário — linguagem ubíqua

Este documento é a ponte entre as duas convenções de idioma do projeto:
**documentação em PT-BR, código em inglês**.

**Regra:** um termo de negócio tem exatamente **um** identificador em inglês.
Se você precisa nomear algo que não está nesta tabela, adicione aqui no mesmo PR.
Se você encontrar dois nomes para a mesma coisa no código, é bug de nomenclatura
e deve ser corrigido.

Aplica-se a: nomes de tipo, função, arquivo, pasta, tabela, coluna, endpoint,
evento, fila e chave de tradução.

---

## Produto

| PT-BR       | Identificador    | Observações                                                                                      |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| EiBuddy     | — (marca)        | Nome comercial ([ADR-0011](../decisoes/adr/0011-eibuddy-nome-e-dominio.md)). Grafia: uma palavra |
| Site        | `eibuddy.com.br` | Domínio público. DNS e TLS na VPS ([ADR-0015](../decisoes/adr/0015-vps-docker-compose.md))       |
| Repositório | `na-regua`       | Não muda com a marca                                                                             |
| Pacote npm  | `@na-regua/*`    | Atrelado ao repositório, de propósito                                                            |

---

## Cadastros

| PT-BR                     | Código (inglês)  | Observações                                                                                                                                                 |
| ------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empresa / Loja (o tenant) | `Company`        | Unidade de isolamento multi-tenant. Nunca `Store`, `Tenant` nem `Organization` no domínio                                                                   |
| Usuário                   | `User`           | Pessoa que faz login                                                                                                                                        |
| Papel / Perfil de acesso  | `Role`           | `owner` opera a loja. `staff` é valor reservado, fora do recorte ([US-003](user-stories.md#us-003--convidar-equipe)). Também `accountant`, `platform_admin` |
| Cliente                   | `Customer`       | Cliente da loja. Nunca `Client` (reservado para clientes HTTP)                                                                                              |
| Fornecedor                | `Supplier`       |                                                                                                                                                             |
| Produto                   | `Product`        |                                                                                                                                                             |
| Variação (tamanho, cor)   | `ProductVariant` |                                                                                                                                                             |
| Código de barras          | `barcode`        | EAN/GTIN                                                                                                                                                    |
| Categoria                 | `Category`       |                                                                                                                                                             |
| Unidade de medida         | `UnitOfMeasure`  | `un`, `kg`, `m`, `cx`                                                                                                                                       |
| Estoque                   | `Inventory`      | Saldo. Movimentação é `InventoryMovement`                                                                                                                   |

## Vendas

| PT-BR              | Código (inglês)    | Observações                                                 |
| ------------------ | ------------------ | ----------------------------------------------------------- |
| Venda              | `Sale`             | Documento fechado. Nunca `Order` no MVP                     |
| Item da venda      | `SaleItem`         |                                                             |
| Carrinho           | `Cart`             | Venda ainda em montagem, antes de fechar                    |
| Desconto           | `Discount`         |                                                             |
| Acréscimo          | `Surcharge`        |                                                             |
| Devolução          | `SaleReturn`       |                                                             |
| Cancelamento       | `SaleCancellation` | Distinto de devolução: cancela antes da liquidação          |
| Forma de pagamento | `PaymentMethod`    | `debit`, `credit`, `pix`, `cash`, `wallet`                  |
| Pagamento          | `Payment`          | Um `Sale` pode ter vários (venda dividida)                  |
| Parcela            | `Installment`      |                                                             |
| Plano de parcelas  | `InstallmentPlan`  | Valor, tarifa, líquido e vencimento de cada quota           |
| Bandeira do cartão | `CardBrand`        | `visa`, `mastercard`, `elo`, `amex`, `hipercard`, `unknown` |
| Tabela de tarifas  | `CardFeeTable`     | Lookup por bandeira e número de parcelas                    |
| Totais da venda    | `SaleTotals`       | Bruto, custo, imposto, tarifa, líquido, margem              |
| Carteira / fiado   | `wallet`           | Crédito do cliente na loja                                  |
| Tarifa de cartão   | `CardFee`          | O que a adquirente retém                                    |
| Valor líquido      | `netAmount`        | Bruto − imposto − tarifa. O que de fato entra               |
| Valor bruto        | `grossAmount`      |                                                             |
| Custo              | `costAmount`       |                                                             |
| Margem em valor    | `marginAmount`     | Líquido − custo                                             |
| Margem percentual  | `marginRate`       | Sobre o bruto, em pontos por cem                            |

## Financeiro

| PT-BR                  | Código (inglês)   | Observações                              |
| ---------------------- | ----------------- | ---------------------------------------- |
| Contas a receber       | `Receivable`      |                                          |
| Contas a pagar         | `Payable`         |                                          |
| Vencimento             | `dueDate`         |                                          |
| Liquidação / baixa     | `Settlement`      | Ato de marcar como pago. Verbo: `settle` |
| Inadimplência          | `overdue`         | Estado, não entidade                     |
| Banco / conta bancária | `BankAccount`     |                                          |
| Transação bancária     | `BankTransaction` | Linha do extrato                         |
| Extrato                | `BankStatement`   |                                          |
| Conciliação bancária   | `Reconciliation`  | Verbo: `reconcile`                       |
| Plano de contas        | `ChartOfAccounts` |                                          |
| Conta contábil         | `LedgerAccount`   |                                          |
| Centro de custo        | `CostCenter`      |                                          |
| Lançamento             | `Entry`           |                                          |
| Fluxo de caixa         | `CashFlow`        |                                          |

## Fiscal

| PT-BR                | Código (inglês)   | Observações                                                                                             |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| Nota fiscal          | `Invoice`         | Genérico                                                                                                |
| NFC-e (consumidor)   | `ConsumerInvoice` | Mantém a sigla `nfce` em campos técnicos                                                                |
| NFS-e (serviço)      | `ServiceInvoice`  | Sigla `nfse` em campos técnicos                                                                         |
| Emissão              | `issue`           | `issueInvoice()`                                                                                        |
| Cancelamento de nota | `cancelInvoice`   | Prazo legal distinto do cancelamento de venda                                                           |
| Contingência         | `contingency`     | Emissão offline quando a Focus (ou o fisco atrás dela) cai. O sistema fala com a Focus, não com a SEFAZ |
| Chave de acesso      | `accessKey`       | 44 dígitos                                                                                              |
| DANFE                | `danfe`           | Representação impressa                                                                                  |
| Regime tributário    | `TaxRegime`       | `simples_nacional`, `lucro_presumido`, `lucro_real`                                                     |
| NCM                  | `ncm`             |                                                                                                         |
| CFOP                 | `cfop`            |                                                                                                         |
| CST / CSOSN          | `cst` / `csosn`   |                                                                                                         |
| Imposto              | `Tax`             |                                                                                                         |
| Alíquota             | `taxRate`         |                                                                                                         |

## Assistente / IA

| PT-BR                  | Código (inglês)       | Observações                                                                              |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| Assistente             | `Agent`               | Nunca `Bot`, `Chatbot` nem `Assistant`                                                   |
| Conversa               | `Conversation`        | Fio de mensagens com um número                                                           |
| Mensagem               | `Message`             |                                                                                          |
| Intenção               | `Intent`              |                                                                                          |
| Ferramenta (do agente) | `Tool`                | Caso de uso exposto ao agente                                                            |
| Chamada de ferramenta  | `ToolCall`            |                                                                                          |
| Confirmação            | `Confirmation`        | Aprovação explícita para ação sensível                                                   |
| Memória / contexto     | `ConversationContext` |                                                                                          |
| Modelo (LLM)           | `Model`               | inicial: `openai/gpt-4o-mini`                                                            |
| Runtime do agente      | `Mastra`              | biblioteca em `packages/agent`; [ADR-0010](../decisoes/adr/0010-mastra-e-gpt-4o-mini.md) |

## Plataforma

| PT-BR                      | Código (inglês)   | Observações                      |
| -------------------------- | ----------------- | -------------------------------- |
| Assinatura                 | `Subscription`    |                                  |
| Plano                      | `Plan`            |                                  |
| Mensalidade                | `subscriptionFee` |                                  |
| Cupom                      | `Coupon`          |                                  |
| Bloqueio por inadimplência | `suspension`      | Estado da `Subscription`         |
| Período de teste           | `trial`           |                                  |
| Agenda                     | `Schedule`        |                                  |
| Compromisso                | `Appointment`     |                                  |
| Auditoria                  | `AuditLog`        |                                  |
| Anexo                      | `Attachment`      |                                  |
| Webhook                    | `Webhook`         | Mantém em inglês também em PT-BR |
| Fila                       | `Queue`           |                                  |
| Job agendado               | `ScheduledJob`    |                                  |

---

## Convenções de nomenclatura

| Elemento                        | Convenção                           | Exemplo                                   |
| ------------------------------- | ----------------------------------- | ----------------------------------------- |
| Tipo / classe / schema Zod      | `PascalCase`                        | `SaleItem`, `CreateSaleInput`             |
| Função / variável / propriedade | `camelCase`                         | `netAmount`, `issueInvoice()`             |
| Arquivo e pasta                 | `kebab-case`                        | `sale-item.ts`, `chart-of-accounts/`      |
| Tabela e coluna no banco        | `snake_case`, tabela no **plural**  | `sale_items`, `net_amount`                |
| Variável de ambiente            | `SCREAMING_SNAKE_CASE`              | `DATABASE_URL`, `WHATSAPP_API_TOKEN`      |
| Endpoint HTTP                   | `kebab-case`, recurso no **plural** | `POST /v1/sales`, `GET /v1/bank-accounts` |
| Fila / job                      | `kebab-case`, `<domínio>-<ação>`    | `invoice-issue`, `whatsapp-send`          |
| Evento de domínio               | `PascalCase` no passado             | `SaleRegistered`, `InvoiceIssued`         |
| Constante                       | `SCREAMING_SNAKE_CASE`              | `MAX_DISCOUNT_RATE`                       |
| Booleano                        | prefixo `is` / `has` / `can`        | `isOverdue`, `hasInventory`               |

## Termos proibidos no código

Nomes que geram ambiguidade e não devem aparecer:

| Não use                                     | Use                             | Por quê                                    |
| ------------------------------------------- | ------------------------------- | ------------------------------------------ |
| `Client` para cliente da loja               | `Customer`                      | `Client` é cliente HTTP/SDK                |
| `Order`                                     | `Sale`                          | Não existe pedido separado de venda no MVP |
| `Bot`, `Chatbot`                            | `Agent`                         | O produto não é um bot de atendimento      |
| `Tenant`, `Organization`                    | `Company`                       | Um nome só para a mesma coisa              |
| `price` sem qualificador                    | `salePrice`, `costPrice`        | Ambíguo entre custo e venda                |
| `amount` sem qualificador em dinheiro       | `grossAmount`, `netAmount`, ... | Ambíguo sobre o que está incluso           |
| `date` para data com hora                   | `...At` (`createdAt`)           | `date` implica dia sem hora                |
| `data`, `info`, `manager`, `helper`, `util` | nome do que a coisa é           | Não significam nada                        |

## Regras que valem em todo o código

- **Dinheiro é sempre `Money`** (inteiro em centavos), nunca `number` com casa
  decimal. Ver [`packages/money`](../../packages/money/README.md).
- **Toda data/hora é UTC no armazenamento**, com sufixo `At` e conversão para
  `America/Sao_Paulo` só na apresentação.
- **Documento fiscal brasileiro mantém a sigla original** (`cnpj`, `cpf`, `ncm`,
  `cfop`, `nfce`) — traduzir seria pior.
- **Toda tabela de negócio tem `company_id`** — ver
  [`dados.md`](../arquitetura/dados.md#multi-tenant).
- **Nome de fila nunca usa `:`** — o BullMQ reserva o caractere como separador
  de chave no Redis e recusa o nome em tempo de execução.
