# Esquema PostgreSQL

Catálogo físico do recorte com `company_integrations` (Focus + Asaas),
fotografado em 2026-09-09 e adotado como domínio pelo baseline
([ADR-0006](../decisoes/adr/0006-catalogo-0909-mais-plataforma.md)).

**O SQL deste arquivo não é migration.** Quem roda é
`packages/db/src/migrations/` (`0001_tenant_isolation.sql` em diante, história
nova). Identidade Better Auth, sessão, cofre fiscal (`company_fiscal_credentials`)
e extrato bancário **não** estão neste snapshot e entram como acréscimo no
baseline — lista em [`dados.md`](dados.md#multi-tenant).

O SQL documental está em [`db_0909.sql`](db_0909.sql). Não aplicar com
`pnpm db:migrate`.

As **regras** (o que não gravar, convenções, estados da venda, retenção) ficam
em [`dados.md`](dados.md).

30 tabelas. Sem PagMaxx. Sem tabela de Split
([DEC-018](../decisoes/README.md#dec-018) — `payments_wallet_id` já está em
`company_integrations`). Fiscal e pagamentos moram num satélite 1:0..1
(`company_integrations`): a linha só existe quando há emissão ou KYC. Vendor
(Asaas, Focus) não entra no nome de tabela nem de coluna — só slug
`fiscal_provider` / `payments_provider`.

---

## Convenções que este schema obedece

Detalhe e motivo em [`dados.md`](dados.md#convenções-de-schema). Em resumo:

| Elemento      | Aqui                                                                              |
| ------------- | --------------------------------------------------------------------------------- |
| PK            | `id uuid`, salvo satélite cuja PK é a FK (`company_id` em `company_integrations`) |
| Tenant        | `company_id uuid NOT NULL` nas tabelas de negócio                                 |
| Dinheiro      | `bigint` em centavos                                                              |
| Percentual    | `numeric(7, 4)`                                                                   |
| Data/hora     | `timestamptz` UTC, sufixo `_at`                                                   |
| Data sem hora | `date` — vencimento e competência                                                 |
| Enum          | `text` + `CHECK` — nunca `enum` nativo                                            |
| Exclusão      | `deleted_at` em toda tabela com `created_at` ou `updated_at` (nulo = vigente)     |
| Índice        | começa por `company_id`                                                           |

**Exceções de tenant:** `companies` (a PK _é_ o tenant); `users.company_id`
nulo até `/app/empresa`; `partners` e `coupons` são da plataforma, sem
`company_id` e sem RLS; `webhook_events.company_id` nulo no insert (inbox ainda
sem tenant).

---

## Mapa

```mermaid
erDiagram
    COMPANIES ||--o{ USERS : "company_id"
    COMPANIES ||--o| COMPANY_INTEGRATIONS : "se fiscal ou KYC"
    COMPANIES ||--o{ CUSTOMERS : "tem"
    COMPANIES ||--o{ PRODUCTS : "tem"
    COMPANIES ||--o{ SALES : "tem"
    COMPANIES ||--o| SUBSCRIPTIONS : "assina"
    COMPANIES ||--o{ LEDGER_ACCOUNTS : "plano"
    COMPANIES ||--o{ APPOINTMENTS : "agenda"
    COMPANIES ||--o{ CRM_CARDS : "quadro"
    COMPANIES ||--o{ SUPPORT_TICKETS : "chamados"
    COMPANIES ||--o{ CONVERSATIONS : "assistente"
    COMPANIES ||--o{ AUDIT_LOGS : "registra"
    COMPANIES ||--o{ PAYABLES : "a pagar"
    COMPANIES ||--o{ WEBHOOK_EVENTS : "depois do match"

    CUSTOMERS ||--o{ SALES : "compra em"
    CUSTOMERS ||--o{ RECEIVABLES : "deve"
    CUSTOMERS ||--o{ APPOINTMENTS : "marca"
    CUSTOMERS ||--o{ CRM_CARDS : "opcional"

    PRODUCTS ||--o{ SALE_ITEMS : "vendido em"
    PRODUCTS ||--o{ INVENTORY_MOVEMENTS : "movimentado por"

    SALES ||--|{ SALE_ITEMS : "contem"
    SALES ||--|{ PAYMENTS : "quitada por"
    SALES ||--o| INVOICES : "nota"
    SALES ||--o{ INVENTORY_MOVEMENTS : "movimenta"
    SALES ||--o{ RECEIVABLES : "gera"

    PAYMENTS ||--o{ RECEIVABLES : "origem"

    LEDGER_ACCOUNTS ||--o{ RECEIVABLES : "classifica"
    LEDGER_ACCOUNTS ||--o{ PAYABLES : "classifica"
    RECEIVABLES ||--o{ SETTLEMENTS : "baixa"
    PAYABLES ||--o{ SETTLEMENTS : "baixa"
    PAYABLES ||--o{ PAYABLES : "template"

    SUPPORT_TICKETS ||--|{ TICKET_MESSAGES : "contem"
    ATTACHMENTS ||--o{ TICKET_MESSAGES : "anexo"

    CONVERSATIONS ||--|{ MESSAGES : "contem"
    CONVERSATIONS ||--o{ CONFIRMATIONS : "acao sensivel"

    PARTNERS ||--o{ COUPONS : "emite"
    COUPONS ||--o{ SUBSCRIPTIONS : "desconto"
    SUBSCRIPTIONS ||--o{ SUBSCRIPTION_CYCLES : "ciclos"
```

| Grupo                  | Tabelas                                                                     | RLS                            |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------ |
| Empresa e acesso       | `companies`, `users`, `company_integrations`                                | sim (`companies` pela PK)      |
| Cadastros e estoque    | `customers`, `products`, `inventory_movements`                              | sim                            |
| Venda e nota           | `sales`, `sale_items`, `payments`, `invoices`                               | sim                            |
| Financeiro             | `ledger_accounts`, `receivables`, `payables`, `settlements`                 | sim                            |
| Agenda / CRM / suporte | `appointments`, `crm_cards`, `support_tickets`, `ticket_messages`           | sim                            |
| Assistente             | `conversations`, `messages`, `confirmations`                                | sim                            |
| Assinatura SaaS        | `subscriptions`, `subscription_cycles`, `partners`, `coupons`               | `partners` e `coupons` **não** |
| Plataforma             | `attachments`, `idempotency_keys`, `outbox`, `audit_logs`, `webhook_events` | `webhook_events` **não**       |

---

## Empresa e acesso

### `companies`

Cadastro visível e regime. Sem colunas de provedor. RLS: `id = app.company_id`.

| Coluna                   | Tipo                   | Notas                                                            |
| ------------------------ | ---------------------- | ---------------------------------------------------------------- |
| `id`                     | `uuid` PK              | UUIDv7                                                           |
| `legal_name`             | `text NOT NULL`        |                                                                  |
| `trade_name`             | `text`                 |                                                                  |
| `cnpj`                   | `text NOT NULL`        | único enquanto `deleted_at` é nulo                               |
| `email`                  | `text NOT NULL`        |                                                                  |
| `phone`                  | `text NOT NULL`        |                                                                  |
| `state_registration`     | `text`                 |                                                                  |
| `municipal_registration` | `text`                 |                                                                  |
| `street`                 | `text NOT NULL`        |                                                                  |
| `street_number`          | `text NOT NULL`        |                                                                  |
| `complement`             | `text`                 |                                                                  |
| `neighborhood`           | `text NOT NULL`        |                                                                  |
| `postal_code`            | `text NOT NULL`        |                                                                  |
| `city`                   | `text NOT NULL`        |                                                                  |
| `state`                  | `text NOT NULL`        |                                                                  |
| `city_ibge_code`         | `text`                 | CEP, não digitado                                                |
| `tax_regime`             | `text NOT NULL`        | `mei` \| `simples_nacional` \| `lucro_presumido` \| `lucro_real` |
| `opted_reforma_hibrida`  | `boolean NOT NULL`     | default `false`                                                  |
| `tax_rate`               | `numeric(7, 4)`        | alíquota do cálculo da venda; o provedor fiscal **não** recebe   |
| `whatsapp_linked_at`     | `timestamptz`          |                                                                  |
| `deleted_at`             | `timestamptz`          | nulo = vigente                                                   |
| `created_at`             | `timestamptz NOT NULL` | default `now()`                                                  |
| `updated_at`             | `timestamptz NOT NULL` | default `now()`                                                  |

### `users`

Um usuário, uma empresa neste recorte.
`company_id` nulo só entre o cadastro da conta e `/app/empresa`. Insert/attach
nessa janela passam por funções `SECURITY DEFINER` — RLS em `users` exige
tenant.

| Coluna          | Tipo                   | Notas                                  |
| --------------- | ---------------------- | -------------------------------------- |
| `id`            | `uuid` PK              |                                        |
| `company_id`    | `uuid` → `companies`   | nulo até a empresa existir             |
| `name`          | `text NOT NULL`        |                                        |
| `email`         | `text NOT NULL`        | único enquanto `deleted_at` é nulo     |
| `phone`         | `text NOT NULL`        |                                        |
| `password_hash` | `text NOT NULL`        |                                        |
| `role`          | `text NOT NULL`        | `owner` \| `staff` \| `platform_admin` |
| `deleted_at`    | `timestamptz`          | nulo = vigente                         |
| `created_at`    | `timestamptz NOT NULL` |                                        |
| `updated_at`    | `timestamptz NOT NULL` |                                        |

Índice: `users_company_id_idx (company_id)`.

### `company_integrations`

Satélite 1:0..1. Linha **só** quando a empresa inicia fiscal (A1/CSC/flags) **ou**
KYC de pagamentos. Cadastro da loja no ERP **não** cria esta linha. Colunas
`fiscal_*` e `payments_*` separam capacidade, não vendor. `fiscal_certificate_status`
nulo = fiscal não iniciado; `missing` = fiscal ligado sem A1.

| Coluna                                    | Tipo                    | Notas                                                            |
| ----------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| `company_id`                              | `uuid` PK → `companies` |                                                                  |
| `fiscal_provider`                         | `text`                  | slug, ex. `focusnfe`; nulo = fiscal não iniciado                 |
| `fiscal_company_id`                       | `text`                  | id do emitente no provedor fiscal                                |
| `fiscal_token_secret_ref`                 | `text`                  | cofre — nunca o token                                            |
| `fiscal_nfce_enabled`                     | `boolean`               | nulo = fiscal não configurado                                    |
| `fiscal_nfse_enabled`                     | `boolean`               | nulo = fiscal não configurado                                    |
| `fiscal_certificate_status`               | `text`                  | `missing` \| `valid` \| `expired` \| `rejected` (ou nulo)        |
| `fiscal_certificate_expires_at`           | `timestamptz`           |                                                                  |
| `fiscal_has_nfce_csc`                     | `boolean`               | CSC encaminhado; **não** o valor                                 |
| `payments_provider`                       | `text`                  | slug, ex. `asaas`                                                |
| `payments_onboarding_status`              | `text`                  | `not_started` \| `pending` \| `approved` \| `rejected` (ou nulo) |
| `payments_account_id`                     | `text`                  | unique parcial (`WHERE IS NOT NULL`)                             |
| `payments_wallet_id`                      | `text`                  | destinatário de split, se DEC-018 fechar com split               |
| `payments_api_key_secret_ref`             | `text`                  | cofre                                                            |
| `payments_webhook_auth_secret_ref`        | `text`                  | cofre                                                            |
| `payments_estimated_monthly_income_cents` | `bigint`                | renda informada na criação da subconta                           |
| `billing_customer_id`                     | `text`                  | cliente da mensalidade SaaS na conta-pai                         |
| `deleted_at`                              | `timestamptz`           | nulo = vigente                                                   |
| `updated_at`                              | `timestamptz NOT NULL`  |                                                                  |

---

## Cadastros e estoque

### `customers`

Documento, telefone e e-mail opcionais (balcão). Endereço no mesmo registro,
nullable: o PDV não exige CEP para vender. Se houver rua, os campos-núcleo do
endereço vêm todos juntos (CHECK).

| Coluna                  | Tipo                   | Notas                                                                                       |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| `id`                    | `uuid` PK              |                                                                                             |
| `company_id`            | `uuid NOT NULL`        | → `companies`                                                                               |
| `name`                  | `text NOT NULL`        |                                                                                             |
| `document`              | `text`                 |                                                                                             |
| `phone`                 | `text`                 |                                                                                             |
| `email`                 | `text`                 |                                                                                             |
| `notes`                 | `text`                 |                                                                                             |
| `wallet_limit_cents`    | `bigint NOT NULL`      | default `0`                                                                                 |
| `wallet_balance_cents`  | `bigint NOT NULL`      | default `0`                                                                                 |
| `collection_consent_at` | `timestamptz`          | consentimento de cobrança                                                                   |
| `payments_customer_id`  | `text`                 | id no provedor de pagamentos; unique `(company_id, payments_customer_id)` quando preenchido |
| `street`                | `text`                 | tomador/destinatário                                                                        |
| `street_number`         | `text`                 |                                                                                             |
| `complement`            | `text`                 |                                                                                             |
| `neighborhood`          | `text`                 |                                                                                             |
| `postal_code`           | `text`                 |                                                                                             |
| `city`                  | `text`                 |                                                                                             |
| `state`                 | `text`                 |                                                                                             |
| `city_ibge_code`        | `text`                 | CEP, não digitado                                                                           |
| `deleted_at`            | `timestamptz`          | nulo = visível na lista; venda antiga continua apontando o uuid                             |
| `created_at`            | `timestamptz NOT NULL` |                                                                                             |
| `updated_at`            | `timestamptz NOT NULL` |                                                                                             |

Índices: `(company_id, created_at DESC) WHERE deleted_at IS NULL`; `(company_id, document) WHERE document IS NOT NULL AND deleted_at IS NULL`;
`(company_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL`; unique `(company_id, payments_customer_id) WHERE payments_customer_id IS NOT NULL`.

### `products`

Saldo na coluna `stock`. Sem tabelas `categories` / `suppliers` — são `text`.

| Coluna                           | Tipo                   | Notas                               |
| -------------------------------- | ---------------------- | ----------------------------------- |
| `id`                             | `uuid` PK              |                                     |
| `company_id`                     | `uuid NOT NULL`        | → `companies`                       |
| `kind`                           | `text NOT NULL`        | `product` \| `service`              |
| `description`                    | `text NOT NULL`        |                                     |
| `barcode`                        | `text`                 | único por empresa quando preenchido |
| `unit_of_measure`                | `text NOT NULL`        |                                     |
| `sale_price_cents`               | `bigint NOT NULL`      |                                     |
| `cost_price_cents`               | `bigint NOT NULL`      |                                     |
| `stock`                          | `integer NOT NULL`     | default `0`                         |
| `min_stock`                      | `integer NOT NULL`     | default `0`                         |
| `tax_rate`                       | `numeric(7, 4)`        |                                     |
| `category`                       | `text`                 |                                     |
| `supplier`                       | `text`                 |                                     |
| `ncm`                            | `text`                 | NFC-e; null em serviço              |
| `codigo_tributacao_nacional_iss` | `text`                 | NFS-e; null em mercadoria           |
| `codigo_nbs`                     | `text`                 | NFS-e; null em mercadoria           |
| `deleted_at`                     | `timestamptz`          | nulo = visível na lista             |
| `created_at`                     | `timestamptz NOT NULL` |                                     |
| `updated_at`                     | `timestamptz NOT NULL` |                                     |

Checagem fiscal: produto não leva código de serviço; serviço não leva `ncm`.

Índices: `(company_id, created_at DESC) WHERE deleted_at IS NULL`; `UNIQUE (company_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL`.

### `inventory_movements`

Histórico de saldo. `products.stock` continua a fonte da verdade na tela;
cada movimento grava o snapshot **na mesma transação** que atualiza o produto.

`stock_after = stock_before + quantity_delta` (CHECK). Delta positivo entra
(compra / ajuste); negativo sai (venda / ajuste). `sale_id` e `purchase_id`
não convivem na mesma linha (ajuste: os dois nulos).

`purchase_id` ainda **não** tem FK: tabela `purchases` está fora do recorte A–J.

| Coluna           | Tipo                   | Notas                                              |
| ---------------- | ---------------------- | -------------------------------------------------- |
| `id`             | `uuid` PK              |                                                    |
| `company_id`     | `uuid NOT NULL`        | → `companies`                                      |
| `product_id`     | `uuid NOT NULL`        | → `products`                                       |
| `quantity_delta` | `integer NOT NULL`     | + entra, − sai                                     |
| `stock_before`   | `integer NOT NULL`     | saldo imediatamente **antes** do movimento         |
| `stock_after`    | `integer NOT NULL`     | saldo **depois** (`stock_before + quantity_delta`) |
| `reason`         | `text NOT NULL`        |                                                    |
| `sale_id`        | `uuid`                 | → `sales` (depois da criação); baixa de venda      |
| `purchase_id`    | `uuid`                 | entrada por compra; sem FK até existir `purchases` |
| `deleted_at`     | `timestamptz`          | nulo = vigente                                     |
| `created_at`     | `timestamptz NOT NULL` | sem `updated_at`                                   |

Índice: `(company_id, created_at DESC)`.

---

## Venda e nota

### `sales`

A tela **compõe** estados das tabelas ligadas — pagamento e nota têm ciclos
independentes. Ver [`dados.md`](dados.md#estados-da-venda). Nunca `DELETE`
físico; `deleted_at` marca arquivo.

| Coluna                  | Tipo                   | Notas                                            |
| ----------------------- | ---------------------- | ------------------------------------------------ |
| `id`                    | `uuid` PK              |                                                  |
| `company_id`            | `uuid NOT NULL`        | → `companies`                                    |
| `customer_id`           | `uuid`                 | → `customers`                                    |
| `number`                | `integer NOT NULL`     | `UNIQUE (company_id, number)` — MAX+1 na TX      |
| `status`                | `text NOT NULL`        | `open` \| `settled` \| `cancelled` \| `returned` |
| `gross_amount_cents`    | `bigint NOT NULL`      |                                                  |
| `discount_cents`        | `bigint NOT NULL`      | default `0`                                      |
| `tax_amount_cents`      | `bigint NOT NULL`      |                                                  |
| `card_fee_amount_cents` | `bigint NOT NULL`      |                                                  |
| `net_amount_cents`      | `bigint NOT NULL`      |                                                  |
| `notes`                 | `text`                 |                                                  |
| `deleted_at`            | `timestamptz`          | nulo = vigente                                   |
| `created_at`            | `timestamptz NOT NULL` |                                                  |
| `updated_at`            | `timestamptz NOT NULL` |                                                  |

Índice: `(company_id, created_at DESC)`.

### `sale_items`

Snapshot fiscal no fechamento. Só preenche o que o item usa (produto vs serviço).

| Coluna                           | Tipo               | Notas         |
| -------------------------------- | ------------------ | ------------- |
| `id`                             | `uuid` PK          |               |
| `company_id`                     | `uuid NOT NULL`    | → `companies` |
| `sale_id`                        | `uuid NOT NULL`    | → `sales`     |
| `product_id`                     | `uuid NOT NULL`    | → `products`  |
| `quantity`                       | `integer NOT NULL` |               |
| `unit_price_cents`               | `bigint NOT NULL`  |               |
| `discount_cents`                 | `bigint NOT NULL`  | default `0`   |
| `ncm`                            | `text`             |               |
| `codigo_tributacao_nacional_iss` | `text`             |               |
| `codigo_nbs`                     | `text`             |               |

Índice: `(company_id, sale_id)`. Sem `created_at` (logo sem `deleted_at`).

### `payments`

Dinheiro, maquininha e fiado deixam as colunas de provedor nulas. Pix/boleto/link/cartão
online preenchem `provider_*` e artefatos (QR, boleto, checkout). `method` é o domínio;
não há `billing_type` de vendor.

| Coluna                 | Tipo                   | Notas                                                          |
| ---------------------- | ---------------------- | -------------------------------------------------------------- |
| `id`                   | `uuid` PK              |                                                                |
| `company_id`           | `uuid NOT NULL`        | → `companies`                                                  |
| `sale_id`              | `uuid NOT NULL`        | → `sales`                                                      |
| `method`               | `text NOT NULL`        | `cash` \| `pix` \| `boleto` \| `debit` \| `credit` \| `wallet` |
| `amount_cents`         | `bigint NOT NULL`      |                                                                |
| `installments`         | `integer`              |                                                                |
| `brand`                | `text`                 |                                                                |
| `provider_payment_id`  | `text`                 | unique parcial                                                 |
| `provider_status`      | `text`                 |                                                                |
| `provider_event_id`    | `text`                 | unique parcial                                                 |
| `checkout_url`         | `text`                 |                                                                |
| `pix_payload`          | `text`                 |                                                                |
| `bank_slip_url`        | `text`                 |                                                                |
| `identification_field` | `text`                 | linha digitável                                                |
| `due_date`             | `date`                 |                                                                |
| `card_token_ref`       | `text`                 | referência no cofre; não o PAN                                 |
| `deleted_at`           | `timestamptz`          | nulo = vigente                                                 |
| `created_at`           | `timestamptz NOT NULL` |                                                                |

Índice: `(company_id, sale_id)`.

### `invoices`

Espelho da nota no provedor fiscal. Linha **só** quando há emissão. `kind` só `nfce` \| `nfse`. Sem
colunas de NF-e modelo 55.

| Coluna                 | Tipo                   | Notas                                                                      |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `id`                   | `uuid` PK              |                                                                            |
| `company_id`           | `uuid NOT NULL`        | → `companies`                                                              |
| `sale_id`              | `uuid NOT NULL`        | → `sales`                                                                  |
| `kind`                 | `text NOT NULL`        | `nfce` \| `nfse`                                                           |
| `status`               | `text NOT NULL`        | `processing` \| `authorized` \| `rejected` \| `contingency` \| `cancelled` |
| `provider_ref`         | `text NOT NULL`        | `UNIQUE (company_id, provider_ref)`                                        |
| `provider_status_code` | `text`                 |                                                                            |
| `provider_message`     | `text`                 |                                                                            |
| `provider_payload`     | `jsonb`                |                                                                            |
| `number`               | `text`                 | NFS-e; NFC-e também pode preencher                                         |
| `xml_path`             | `text`                 | object storage                                                             |
| `danfe_url`            | `text`                 |                                                                            |
| `access_key`           | `text`                 | NFC-e                                                                      |
| `series`               | `text`                 | NFC-e                                                                      |
| `qr_code`              | `text`                 | NFC-e                                                                      |
| `deleted_at`           | `timestamptz`          | nulo = vigente                                                             |
| `created_at`           | `timestamptz NOT NULL` |                                                                            |
| `updated_at`           | `timestamptz NOT NULL` |                                                                            |

Índice: `(company_id, sale_id)`.

---

## Financeiro

`overdue` é regra em `domain` (RF-056), não coluna. Conta bancária da baixa
(RF-059) fica de fora ([DEC-005](../decisoes/README.md#dec-005)).

### `ledger_accounts`

| Coluna       | Tipo                   | Notas                                                                     |
| ------------ | ---------------------- | ------------------------------------------------------------------------- |
| `id`         | `uuid` PK              |                                                                           |
| `company_id` | `uuid NOT NULL`        | → `companies`                                                             |
| `code`       | `text NOT NULL`        | `UNIQUE (company_id, code)`                                               |
| `name`       | `text NOT NULL`        |                                                                           |
| `kind`       | `text NOT NULL`        | `revenue` \| `deduction` \| `cost` \| `expense` \| `asset` \| `liability` |
| `is_system`  | `boolean NOT NULL`     | default `false`                                                           |
| `deleted_at` | `timestamptz`          | nulo = vigente                                                            |
| `created_at` | `timestamptz NOT NULL` |                                                                           |
| `updated_at` | `timestamptz NOT NULL` |                                                                           |

### `receivables`

| Coluna                    | Tipo                   | Notas               |
| ------------------------- | ---------------------- | ------------------- |
| `id`                      | `uuid` PK              |                     |
| `company_id`              | `uuid NOT NULL`        | → `companies`       |
| `sale_id`                 | `uuid`                 | → `sales`           |
| `payment_id`              | `uuid`                 | → `payments`        |
| `customer_id`             | `uuid`                 | → `customers`       |
| `ledger_account_id`       | `uuid`                 | → `ledger_accounts` |
| `origin`                  | `text NOT NULL`        | `sale` \| `manual`  |
| `amount_cents`            | `bigint NOT NULL`      |                     |
| `outstanding_cents`       | `bigint NOT NULL`      |                     |
| `due_date`                | `date NOT NULL`        |                     |
| `collection_url`          | `text`                 |                     |
| `last_collection_sent_at` | `timestamptz`          |                     |
| `last_collection_channel` | `text`                 |                     |
| `deleted_at`              | `timestamptz`          | nulo = vigente      |
| `created_at`              | `timestamptz NOT NULL` |                     |
| `updated_at`              | `timestamptz NOT NULL` |                     |

Índice parcial: `(company_id, due_date) WHERE outstanding_cents > 0`.

### `payables`

Custo fixo = `is_template`. Sem tabela `suppliers`.

| Coluna              | Tipo                   | Notas                  |
| ------------------- | ---------------------- | ---------------------- |
| `id`                | `uuid` PK              |                        |
| `company_id`        | `uuid NOT NULL`        | → `companies`          |
| `ledger_account_id` | `uuid`                 | → `ledger_accounts`    |
| `template_id`       | `uuid`                 | → `payables` (auto-FK) |
| `supplier`          | `text`                 |                        |
| `description`       | `text NOT NULL`        |                        |
| `amount_cents`      | `bigint NOT NULL`      |                        |
| `outstanding_cents` | `bigint NOT NULL`      |                        |
| `due_date`          | `date NOT NULL`        |                        |
| `is_template`       | `boolean NOT NULL`     | default `false`        |
| `deleted_at`        | `timestamptz`          | nulo = vigente         |
| `created_at`        | `timestamptz NOT NULL` |                        |
| `updated_at`        | `timestamptz NOT NULL` |                        |

Índice parcial: `(company_id, due_date) WHERE outstanding_cents > 0 AND is_template = false`.

### `settlements`

Uma baixa aponta para **exatamente um** alvo: recebível **ou** pagável.

| Coluna          | Tipo                   | Notas           |
| --------------- | ---------------------- | --------------- |
| `id`            | `uuid` PK              |                 |
| `company_id`    | `uuid NOT NULL`        | → `companies`   |
| `receivable_id` | `uuid`                 | → `receivables` |
| `payable_id`    | `uuid`                 | → `payables`    |
| `amount_cents`  | `bigint NOT NULL`      |                 |
| `settled_at`    | `timestamptz NOT NULL` |                 |
| `reversed_at`   | `timestamptz`          |                 |
| `deleted_at`    | `timestamptz`          | nulo = vigente  |
| `created_at`    | `timestamptz NOT NULL` |                 |

Índice: `(company_id, created_at DESC)`.

---

## Agenda, CRM e suporte

### `appointments`

| Coluna             | Tipo                   | Notas          |
| ------------------ | ---------------------- | -------------- |
| `id`               | `uuid` PK              |                |
| `company_id`       | `uuid NOT NULL`        | → `companies`  |
| `customer_id`      | `uuid`                 | → `customers`  |
| `title`            | `text NOT NULL`        |                |
| `starts_at`        | `timestamptz NOT NULL` |                |
| `reminder_minutes` | `integer`              |                |
| `cancelled_at`     | `timestamptz`          |                |
| `reminder_sent_at` | `timestamptz`          |                |
| `deleted_at`       | `timestamptz`          | nulo = vigente |
| `created_at`       | `timestamptz NOT NULL` |                |
| `updated_at`       | `timestamptz NOT NULL` |                |

Índice: `(company_id, starts_at)`.

### `crm_cards`

Comentários em `jsonb` — sem tabela `crm_comments`.

| Coluna         | Tipo                   | Notas                                  |
| -------------- | ---------------------- | -------------------------------------- |
| `id`           | `uuid` PK              |                                        |
| `company_id`   | `uuid NOT NULL`        | → `companies`                          |
| `customer_id`  | `uuid`                 | → `customers`                          |
| `title`        | `text NOT NULL`        |                                        |
| `board_column` | `text NOT NULL`        | `afazer` \| `andamento` \| `concluido` |
| `comments`     | `jsonb NOT NULL`       | default `[]`                           |
| `deleted_at`   | `timestamptz`          | nulo = vigente                         |
| `created_at`   | `timestamptz NOT NULL` |                                        |
| `updated_at`   | `timestamptz NOT NULL` |                                        |

Índice: `(company_id, board_column)`.

### `support_tickets`

| Coluna       | Tipo                   | Notas                           |
| ------------ | ---------------------- | ------------------------------- |
| `id`         | `uuid` PK              |                                 |
| `company_id` | `uuid NOT NULL`        | → `companies`                   |
| `protocol`   | `text NOT NULL`        | `UNIQUE (company_id, protocol)` |
| `category`   | `text NOT NULL`        |                                 |
| `subject`    | `text NOT NULL`        |                                 |
| `status`     | `text NOT NULL`        | `open` \| `waiting` \| `closed` |
| `deleted_at` | `timestamptz`          | nulo = vigente                  |
| `created_at` | `timestamptz NOT NULL` |                                 |
| `updated_at` | `timestamptz NOT NULL` |                                 |

### `ticket_messages`

FK de `attachment_id` é adicionada depois de criar `attachments`.

| Coluna          | Tipo                   | Notas                                  |
| --------------- | ---------------------- | -------------------------------------- |
| `id`            | `uuid` PK              |                                        |
| `company_id`    | `uuid NOT NULL`        | → `companies`                          |
| `ticket_id`     | `uuid NOT NULL`        | → `support_tickets`                    |
| `author_role`   | `text NOT NULL`        | `owner` \| `staff` \| `platform_admin` |
| `body`          | `text NOT NULL`        |                                        |
| `attachment_id` | `uuid`                 | → `attachments`                        |
| `read_at`       | `timestamptz`          |                                        |
| `deleted_at`    | `timestamptz`          | nulo = vigente                         |
| `created_at`    | `timestamptz NOT NULL` |                                        |

Índice: `(company_id, ticket_id)`.

---

## Assistente

### `conversations`

| Coluna        | Tipo                   | Notas                                                                                                                                                                                     |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `uuid` PK              |                                                                                                                                                                                           |
| `company_id`  | `uuid NOT NULL`        | → `companies`                                                                                                                                                                             |
| `channel`     | `text NOT NULL`        | `whatsapp`                                                                                                                                                                                | `web` | `app` |
| `number_from` | `text`                 | interlocutor (0007). Na prosa do assistente isso é o `peer`; a coluna **não** se chama `peer`. Chave lógica `wa:{companyId}:{peer}` / `app:{companyId}:{userId}`; vazio recusado no store |
| `deleted_at`  | `timestamptz`          | nulo = vigente                                                                                                                                                                            |
| `created_at`  | `timestamptz NOT NULL` |                                                                                                                                                                                           |
| `updated_at`  | `timestamptz NOT NULL` |                                                                                                                                                                                           |

Índices: `(company_id, created_at DESC)`; UNIQUE parcial
`conversations_identidade_unica` em `(company_id, channel, number_from)
WHERE deleted_at IS NULL` (0019 NR-062; `IF NOT EXISTS`).
Único parcial de confirmação aberta: `confirmations_uma_aberta_por_conversa`
(0021 NR-061). HTTP `app` e Studio `whatsapp` são identidades distintas.

### `messages`

`tool_calls` em jsonb — sem tabela `tool_calls`.

| Coluna            | Tipo                   | Notas                             |
| ----------------- | ---------------------- | --------------------------------- |
| `id`              | `uuid` PK              |                                   |
| `company_id`      | `uuid NOT NULL`        | → `companies`                     |
| `conversation_id` | `uuid NOT NULL`        | → `conversations`                 |
| `role`            | `text NOT NULL`        | `user` \| `assistant` \| `system` |
| `body`            | `text NOT NULL`        |                                   |
| `tool_calls`      | `jsonb`                |                                   |
| `deleted_at`      | `timestamptz`          | nulo = vigente                    |
| `created_at`      | `timestamptz NOT NULL` |                                   |

Índices: `(company_id, conversation_id)` (`messages_company_conversation_idx`);
`messages_por_conversa` em `(company_id, conversation_id, created_at DESC)
WHERE deleted_at IS NULL` (0019).

### `confirmations`

Ação sensível do agente, com expiração.

| Coluna            | Tipo                   | Notas                                             |
| ----------------- | ---------------------- | ------------------------------------------------- |
| `id`              | `uuid` PK              |                                                   |
| `company_id`      | `uuid NOT NULL`        | → `companies`                                     |
| `conversation_id` | `uuid NOT NULL`        | → `conversations`                                 |
| `action`          | `text NOT NULL`        |                                                   |
| `payload`         | `jsonb`                |                                                   |
| `expires_at`      | `timestamptz NOT NULL` |                                                   |
| `resolved_at`     | `timestamptz`          |                                                   |
| `decision`        | `text`                 | `accepted` \| `rejected` \| `expired` (ou `NULL`) |

Índice: `(company_id, expires_at)`. Sem `created_at` (logo sem `deleted_at`).
Único parcial (0021): `(company_id, conversation_id)` WHERE `resolved_at IS NULL`
— uma aberta por conversa; a linha resolvida permanece (não há DELETE).

---

## Assinatura SaaS

Cobrança na **conta-pai** Asaas. Parceiro e cupom são da plataforma, sem tenant.
Não é o `partner` de split PagMaxx/Asaas ([DEC-018](../decisoes/README.md#dec-018)).

### `partners`

Quem emite o cupom (Clube X, Associação Comercial). **Sem** `company_id` e **sem** RLS. Um parceiro emite vários cupons.

| Coluna       | Tipo                   | Notas                              |
| ------------ | ---------------------- | ---------------------------------- |
| `id`         | `uuid` PK              |                                    |
| `name`       | `text NOT NULL`        | único enquanto `deleted_at` é nulo |
| `deleted_at` | `timestamptz`          | nulo = vigente                     |
| `created_at` | `timestamptz NOT NULL` |                                    |
| `updated_at` | `timestamptz NOT NULL` |                                    |

### `coupons`

**Sem** `company_id` e **sem** RLS.

| Coluna            | Tipo                   | Notas                                                                 |
| ----------------- | ---------------------- | --------------------------------------------------------------------- |
| `id`              | `uuid` PK              |                                                                       |
| `partner_id`      | `uuid NOT NULL`        | → `partners`                                                          |
| `code`            | `text NOT NULL`        | único enquanto `deleted_at` é nulo — o que o lojista digita no signup |
| `kind`            | `text NOT NULL`        | `percent` \| `amount`                                                 |
| `percent`         | `numeric(7, 4)`        | obrigatório se `kind = percent`                                       |
| `amount_cents`    | `bigint`               | obrigatório se `kind = amount`                                        |
| `expires_at`      | `timestamptz`          | nulo = sem validade de calendário                                     |
| `revoked_at`      | `timestamptz`          | nulo = vigente; preenchido = código morto sem apagar a linha          |
| `discount_cycles` | `integer`              | nulo = todos os ciclos; `1` = só o primeiro; `≥ 1` se preenchido      |
| `max_redemptions` | `integer`              |                                                                       |
| `redeemed_count`  | `integer NOT NULL`     | default `0`                                                           |
| `deleted_at`      | `timestamptz`          | nulo = vigente                                                        |
| `created_at`      | `timestamptz NOT NULL` |                                                                       |
| `updated_at`      | `timestamptz NOT NULL` |                                                                       |

`kind` e valor são mutuamente exclusivos (CHECK). `discount_cycles` nulo ou `≥ 1` (CHECK).

Cupom aceito na aplicação (não é CHECK com `now()`): `revoked_at` nulo, `expires_at` nulo ou futuro, e cota (`max_redemptions`) ainda disponível.

Índice: `(partner_id)`.

### `subscriptions`

Uma assinatura por empresa. `plan_code` em texto — sem tabela `plans`.

| Coluna                     | Tipo                   | Notas                                                           |
| -------------------------- | ---------------------- | --------------------------------------------------------------- |
| `id`                       | `uuid` PK              |                                                                 |
| `company_id`               | `uuid NOT NULL`        | → `companies`, `UNIQUE`                                         |
| `plan_code`                | `text NOT NULL`        |                                                                 |
| `status`                   | `text NOT NULL`        | `trial` \| `active` \| `overdue` \| `restricted` \| `cancelled` |
| `trial_ends_at`            | `timestamptz`          |                                                                 |
| `current_period_ends_at`   | `timestamptz`          |                                                                 |
| `coupon_id`                | `uuid`                 | → `coupons`                                                     |
| `restricted_at`            | `timestamptz`          |                                                                 |
| `cancelled_at`             | `timestamptz`          |                                                                 |
| `provider_subscription_id` | `text`                 | unique parcial; nulo até o billing gravar a recorrência         |
| `provider_status`          | `text`                 |                                                                 |
| `provider_event_id`        | `text`                 |                                                                 |
| `next_due_date`            | `date`                 |                                                                 |
| `deleted_at`               | `timestamptz`          | nulo = vigente                                                  |
| `created_at`               | `timestamptz NOT NULL` |                                                                 |
| `updated_at`               | `timestamptz NOT NULL` |                                                                 |

### `subscription_cycles`

Cada ciclo da mensalidade SaaS (1:N com `subscriptions`). Não é a nota fiscal
(`invoices`) nem o pagamento da loja (`payments`).

| Coluna                | Tipo                   | Notas                                         |
| --------------------- | ---------------------- | --------------------------------------------- |
| `id`                  | `uuid` PK              |                                               |
| `company_id`          | `uuid NOT NULL`        | → `companies`                                 |
| `subscription_id`     | `uuid NOT NULL`        | → `subscriptions`                             |
| `amount_cents`        | `bigint NOT NULL`      |                                               |
| `due_date`            | `date NOT NULL`        |                                               |
| `status`              | `text NOT NULL`        | `pending` \| `paid` \| `failed` \| `refunded` |
| `provider_payment_id` | `text`                 |                                               |
| `paid_at`             | `timestamptz`          |                                               |
| `deleted_at`          | `timestamptz`          | nulo = vigente                                |
| `created_at`          | `timestamptz NOT NULL` |                                               |

Índice: `(company_id, due_date)`.

---

## Plataforma

### `attachments`

| Coluna         | Tipo                   | Notas          |
| -------------- | ---------------------- | -------------- |
| `id`           | `uuid` PK              |                |
| `company_id`   | `uuid NOT NULL`        | → `companies`  |
| `storage_path` | `text NOT NULL`        | object storage |
| `content_type` | `text NOT NULL`        |                |
| `byte_size`    | `integer NOT NULL`     |                |
| `entity_type`  | `text NOT NULL`        |                |
| `entity_id`    | `uuid NOT NULL`        |                |
| `deleted_at`   | `timestamptz`          | nulo = vigente |
| `created_at`   | `timestamptz NOT NULL` |                |

Índice: `(company_id, entity_type, entity_id)`.

### `idempotency_keys`

| Coluna         | Tipo                   | Notas                      |
| -------------- | ---------------------- | -------------------------- |
| `id`           | `uuid` PK              |                            |
| `company_id`   | `uuid NOT NULL`        | → `companies`              |
| `key`          | `text NOT NULL`        | `UNIQUE (company_id, key)` |
| `request_hash` | `text NOT NULL`        |                            |
| `response`     | `jsonb`                |                            |
| `deleted_at`   | `timestamptz`          | nulo = vigente             |
| `created_at`   | `timestamptz NOT NULL` |                            |

### `outbox`

Efeito externo (Focus, Asaas, mensagem) sai da transação de negócio por aqui.

| Coluna         | Tipo                   | Notas           |
| -------------- | ---------------------- | --------------- |
| `id`           | `uuid` PK              |                 |
| `company_id`   | `uuid NOT NULL`        | → `companies`   |
| `topic`        | `text NOT NULL`        |                 |
| `payload`      | `jsonb NOT NULL`       |                 |
| `deleted_at`   | `timestamptz`          | nulo = vigente  |
| `created_at`   | `timestamptz NOT NULL` |                 |
| `published_at` | `timestamptz`          | nulo = pendente |

Índice parcial: `(company_id, created_at) WHERE published_at IS NULL`.

### `audit_logs`

Somente-inserção (RF-124): `naregua_app` não tem `UPDATE`/`DELETE`. Nunca
`DELETE` em auditoria. Sem `created_at` (usa `occurred_at`); sem `deleted_at`.

| Coluna          | Tipo                   | Notas                                 |
| --------------- | ---------------------- | ------------------------------------- |
| `id`            | `uuid` PK              |                                       |
| `company_id`    | `uuid NOT NULL`        | → `companies`                         |
| `occurred_at`   | `timestamptz NOT NULL` | default `now()`                       |
| `actor_user_id` | `uuid`                 | → `users`                             |
| `channel`       | `text NOT NULL`        | `app` \| `whatsapp` \| `api` \| `job` |
| `request_id`    | `text`                 | correlaciona com o log (RNF-058)      |
| `entity_type`   | `text NOT NULL`        |                                       |
| `entity_id`     | `uuid NOT NULL`        |                                       |
| `action`        | `text NOT NULL`        |                                       |
| `before`        | `jsonb`                | sem dado pessoal (RNF-034)            |
| `after`         | `jsonb`                |                                       |

Índice: `(company_id, occurred_at DESC)`.

### `webhook_events`

Inbox dos provedores. `company_id` preenchido **depois** de casar o evento. Sem
RLS no insert — a API ainda não tem tenant. Sem `created_at` (usa `received_at`);
sem `deleted_at`.

| Coluna         | Tipo                   | Notas                          |
| -------------- | ---------------------- | ------------------------------ |
| `id`           | `uuid` PK              |                                |
| `provider`     | `text NOT NULL`        |                                |
| `event_id`     | `text NOT NULL`        | `UNIQUE (provider, event_id)`  |
| `company_id`   | `uuid`                 | → `companies`, depois do match |
| `payload`      | `jsonb NOT NULL`       |                                |
| `received_at`  | `timestamptz NOT NULL` |                                |
| `processed_at` | `timestamptz`          |                                |

---

## RLS

Papel da aplicação: `naregua_app` (`NOSUPERUSER`, sem `BYPASSRLS`). Superuser
do container (`naregua`) ignora RLS — a API não o usa.
[ADR-0001](../decisoes/adr/0001-rls-por-linha.md).

Em toda tabela de negócio listada no mapa (exceto `partners`, `coupons` e
`webhook_events`):

```sql
ALTER TABLE … ENABLE ROW LEVEL SECURITY;
ALTER TABLE … FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON …
  USING (company_id = current_setting('app.company_id')::uuid)
  WITH CHECK (company_id = current_setting('app.company_id')::uuid);
```

`companies` usa `id` no lugar de `company_id`. Consulta sem `app.company_id`
**falha** (RF-121). `FORCE` impede o dono da tabela de ignorar a política.

---

## Funções `SECURITY DEFINER`

Jornada A: a conta existe antes da empresa. RLS em `users` exige tenant; estas
funções rodam com o dono da tabela. `PUBLIC` não executa — só `naregua_app`.

| Função                                         | Uso                                                    |
| ---------------------------------------------- | ------------------------------------------------------ |
| `find_login_by_email(email)`                   | login ainda sem tenant; ignora `deleted_at` preenchido |
| `register_owner(id, name, email, phone, hash)` | cria `users` com `role = owner` e sem empresa          |
| `attach_user_company(user_id, company_id)`     | preenche `company_id` só se ainda for nulo             |

---

## O que este schema não tem

Fundido de propósito ou fora do recorte — lista e motivo em
[`dados.md`](dados.md#agrupamento-por-módulo-dono). Em uma linha: sem
`company_users`, sem `plans`/`categories`/`suppliers` como tabela, sem Split,
sem PagMaxx, sem cofre de PFX no Postgres.

---

## Documentos relacionados

- [Dados](dados.md) — regras, multi-tenant, convenções, estados da venda
- [`packages/db`](../../packages/db/README.md) — migrations, papéis, testes de isolamento
- [ADR-0001](../decisoes/adr/0001-rls-por-linha.md) — RLS por linha
- um usuário, uma empresa neste recorte
