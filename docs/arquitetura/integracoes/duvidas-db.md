# Dúvidas do banco de dados

Perguntas sobre o **schema PostgreSQL** do recorte A–J (cadastro, venda, nota,
financeiro, CRM, assistente, assinatura e plataforma — inclusive
`company_integrations`).

Origem: lista informal (`questionamentos_db.txt`). O texto de origem vinha sem
interrogação, pontuação e acentuação na maior parte das linhas; as perguntas
abaixo foram **normalizadas** para PT-BR. O sentido foi preservado.

Respostas descrevem o que o banco **já materializa hoje**. Pedidos de mudança
(colunas novas, restringir regime, incluir forma de pagamento) estão marcados
como **pedido** e contrastados com o schema atual — não foram aplicados neste
documento.

Catálogo físico: `[esquema-postgresql.md](../esquema-postgresql.md)`. Regras:
`[dados.md](../dados.md)`. SQL: `[packages/db](../../../packages/db)`.

---

## `companies`

### Por que há os campos `state_registration` e `municipal_registration`?

São a **inscrição estadual (IE)** e a **inscrição municipal (IM)** da loja.

A Focus recebe `inscricao_estadual` e `inscricao_municipal`. Sem eles a NFS-e
Nacional (e, em alguns casos, a NFC-e) não fecha. A IM pode ser omitida na DPS
se o município **não** cadastrou o emitente no Ambiente Nacional — por isso os
dois campos são opcionais no Postgres.

Não são dados da Focus: o lojista informa (ou a consulta de CNPJ sugere). A
Focus só ecoa o que enviamos.

### O que é o campo `neighborhood`?

**Bairro** do endereço da empresa (`street`, `street_number`, `complement`,
`neighborhood`, `postal_code`, `city`, `state`). Obrigatório.

Vai para a Focus no endereço do emitente e para o Asaas como `province` ao
abrir a subconta.

### O que é o campo `whatsapp_linked_at`?

Data/hora em que a **empresa** vinculou o WhatsApp Cloud API
([ADR-0014](../../decisoes/adr/0014-meta-cloud-api.md)). Nulo = assistente e
cobrança por WhatsApp ainda não têm canal da loja.

Não acho extremamente necessário, mas seria bom para termos o controle de quem já está com o WhatsApp "ativado", ou seja, que já enviou pelo menos uma mensagem ao agente.

### O campo `city_ibge_code` deverá ser preenchido automaticamente com base no CEP?

**Sim — e já está desenhado assim.** Não é digitado. Sai da consulta de CEP da
Focus (`GET /v2/ceps`) a partir de `postal_code` e vira
`codigo_municipio_emissora` na NFS-e Nacional.

A tela preenche município/UF; o código IBGE é derivado. Se o CEP não resolver,
o cadastro não deve inventar o código.

#### Código IBGE

O código IBGE é um número gerado pelo Instituto Brasileiro de Geografia e Estatística para identificar de forma única cada município do Brasil. Ele possui 7 dígitos, sendo que os dois primeiros representam o estado, os quatro seguintes identificam o município dentro do estado, e o último é um dígito verificador usado para validação
. Esse código é utilizado em notas fiscais, repasse de verbas públicas e pesquisas estatísticas, garantindo precisão mesmo quando cidades têm nomes iguais

### `tax_regime` só serão aceitos MEI e Simples Nacional? `opted_reforma_hibrida` sempre `false`, pois não aceitaremos Simples que optou pelo regime híbrido?

Há dois recortes distintos.

| Camada              | Hoje                                                                                                        | Pedido da lista                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Emissão** (Focus) | Só `mei` ou `simples_nacional` **e** `opted_reforma_hibrida = false` ([`focusnfe.md`](focusnfe.md), RF-146) | Alinhado com o que já vale para nota                     |
| **Cadastro / ERP**  | Aceita também `lucro_presumido` e `lucro_real`; híbrido pode ser `true`                                     | Recusar esses regimes e travar híbrido sempre em `false` |

O CHECK atual é `mei` `simples_nacional` `lucro_presumido`
`lucro_real`. Quem não é elegível **grava a empresa, vende e usa o financeiro**;
só a fila fiscal e o A1 são recusados (US-002, US-074).

Travar o cadastro em só MEI/Simples sem Híbrido é **mais restrito** que DEC-017:
a loja Lucro Presumido deixaria de existir no ERP. Isso mudaria RF-003, o CHECK
e o formulário de `/app/empresa`. Até lá, `opted_reforma_hibrida` continua
autodeclaração com default `false` — não “sempre false” no banco.

++Eu entendo que as empresas que poderão utilizar a **emissão de notas** devem ser MEI ou Simples Nacional que não optarem pelo sistema híbrido, mas as demais não poderão utilizar o aplicativo sem a emissão de notas? Dessa forma elas poderão utilizar o restante, como CRM, gestão financeira, pagamento e etc. (Decisão de negócio)++

---

## `users`

### Por que essa tabela foi pensada apartada de `companies`?

Porque **pessoa ≠ loja**.

- `companies` é o tenant (CNPJ, regime, endereço fiscal).
- `users` é quem faz login (nome, e-mail, senha, papel).

Um usuário pertence a **uma** empresa (`users.company_id`).
Não há `company_users`. `company_id` fica nulo só entre o signup e
`/app/empresa` (jornada A): a conta existe antes do CNPJ.

Staff futuro é **outro** `users` com o mesmo `company_id` e `role = staff`.
Quem tem dois CNPJs tem duas contas.

Fundir as duas tabelas impediria staff, login antes da empresa, e misturaria
senha com inscrição estadual.

++Entendo que isso poderia causar uma dor de cabeça caso, no futuro, um CPF pudesse ter N CNPJs, ou ainda, um CNPJ pudesse ter N CPF, seja mais de um dono ou funcionários. (Decisão de negócio)++

### Para que servirá o campo `role`?

Papel de acesso: `owner` `staff` `platform_admin`.

| Papel            | Quem                  | Tenant                |
| ---------------- | --------------------- | --------------------- |
| `owner`          | Lojista dono da conta | `company_id` da loja  |
| `staff` (futuro) | Balcão (roadmap)      | Mesma empresa do dono |
| `platform_admin` | Operação EiBuddy      | Não é tenant          |

### Com `companies` e `users`, o que o usuário informa para fazer login?

**E-mail e senha** da pessoa e seu user_id estará vinculado ao company_id

---

## `company_integrations`

### Em que momento essa tabela será preenchida?

Satélite **1:0..1**. A linha **só existe** quando a empresa inicia o fiscal
(A1/CSC/flags) **ou** o KYC de pagamentos.

Cadastro da empresa no ERP **não** cria esta linha. Quem só registra dinheiro
e maquininha pode nunca preencher `payments_*`. Inelegível para nota pode nunca
preencher `fiscal_*`.

Aprovação de pagamentos (`payments_onboarding_status = approved`) vem depois,
quando o lojista enviar documentos no PSP e for aprovado.

### Para que serve cada campo?

| Coluna                                    | Para quê                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `company_id`                              | PK = a empresa. Um satélite por loja                                                                                              |
| `fiscal_provider`                         | Slug do emissor (`focusnfe`, …). Nulo = fiscal não iniciado                                                                       |
| `fiscal_company_id`                       | Id do emitente no provedor fiscal                                                                                                 |
| `fiscal_token_secret_ref`                 | Ponteiro no cofre do token de emitente. **Nunca** o token em claro                                                                |
| `fiscal_nfce_enabled`                     | Loja pediu NFC-e e é elegível                                                                                                     |
| `fiscal_nfse_enabled`                     | Loja pediu NFS-e Nacional e é elegível                                                                                            |
| `fiscal_certificate_status`               | Nulo = fiscal não iniciado; `missing` = ligado sem A1                                                                             |
| `fiscal_certificate_expires_at`           | Validade do A1 (parse na borda, sem guardar o PFX)                                                                                |
| `fiscal_has_nfce_csc`                     | CSC foi encaminhado. **Não** guarda o valor do CSC                                                                                |
| `payments_provider`                       | Slug do PSP (`asaas`, …)                                                                                                          |
| `payments_onboarding_status`              | `not_started` … `approved` / `rejected`                                                                                           |
| `payments_account_id`                     | Id da **subconta** da loja                                                                                                        |
| `payments_wallet_id`                      | Carteira da subconta. Só entra em split se [DEC-018](../../decisoes/README.md#dec-018) fechar; já gravamos para não migrar depois |
| `payments_api_key_secret_ref`             | Ponteiro no cofre da chave da subconta                                                                                            |
| `payments_webhook_auth_secret_ref`        | Ponteiro no cofre do `authToken` do webhook. Não é a chave da API                                                                 |
| `billing_customer_id`                     | Cliente do lojista na **conta-pai** — mensalidade SaaS, não a venda da loja                                                       |
| `payments_estimated_monthly_income_cents` | Renda pedida no início do KYC, em centavos                                                                                        |
| `updated_at`                              | Última sincronização                                                                                                              |

Não confundir `payments_wallet_id` da subconta com o **saldo do cliente** (`customers.wallet_*`). São coisas diferentes.

Detalhe da integração: `[focusnfe.md](focusnfe.md)`, `[fluxo-focus.md](fluxo-focus.md)`,
`[asaas.md](asaas.md)`, `[fluxo-asaas.md](fluxo-asaas.md)`.

---

## `customers`

### O que é o campo `document`?

CPF ou CNPJ do **cliente da loja**. Opcional: venda de balcão não pode travar
sem CPF (US-005). Quando informado, valida e vai para a nota (tomador) e para o
Asaas (`cpfCnpj`).

Índice `(company_id, document)` só nas linhas preenchidas e não arquivadas
(`deleted_at IS NULL`).

`payments_customer_id` é o id no PSP, preenchido na **primeira cobrança online**
daquele cliente. Venda só em dinheiro/maquininha/fiado deixa nulo. `deleted_at`
oculta da lista; pedido LGPD **anonimiza** (RF-127), não apaga.

### O que é o campo `notes`?

Observação livre do lojista sobre o cliente (até 500 caracteres no contrato).
Não vai para Focus nem Asaas. Exemplos: “só retira terça”, “não fiar”.

### Para que servem os campos `wallet`?

`wallet_limit_cents` = teto do **fiado** (crediário informal da loja).
`wallet_balance_cents` = quanto o cliente **deve ou tem de saldo** (positivo = dívida).

Venda com `payments.method = wallet` aumenta o saldo e abre um recebível
(US-007, RF-013).

Default `0`: sem fiado liberado até o lojista configurar o limite.

### Para que serve o campo `collection_consent_at`?

Consentimento LGPD para **cobrar / mensagens** (WhatsApp). Nulo = sem aceite;
a API recusa envio (RF-016, RF-070, US-008).

Preenchido quando o cliente aceita; opt-out zera ou registra a recusa e para
os envios. Cobrança de recebível já liquidado também é bloqueada.

Pensando no futuro em notificar o cliente de dividas e etc.

### O campo `phone` esperará o DDD? Ele é necessário para o cliente receber mensagens via WhatsApp.

**Sim.** O contrato guarda só dígitos: DDD + 8 (fixo) ou 9 (celular) — 10 ou
11 dígitos. Máscara na tela; no banco, `11987654321`.

Esse número **é** o destino de WhatsApp e de cobrança (RF-015). Sem telefone o
cliente cadastra (nome basta no balcão se o fluxo permitir), mas **não** recebe mensagem.

---

## `customers` — endereço

### Por que o endereço ficou em `customers`?

Nem todo cliente precisa de endereço (balcão: nome + telefone). Os campos
(`street` … `city_ibge_code`) são **nullable**. A NFS-e Nacional admite DPS sem
tomador completo; o PDV não pede CEP para vender pão.

Quando o cliente é tomador/destinatário da nota, preenche o mesmo formato da
empresa. CHECK impede endereço pela metade: ou o núcleo está todo nulo, ou
rua, número, bairro, CEP, cidade e UF vêm juntos.

---

## `inventory_movements`

### ***inventory_movements

inserir a coluna estoqueanterior

inserir a coluna estoqueatual

inserir a coluna compra_id

Pois o estoque pode ser incrementado através de uma compra ou decrementado através de uma venda

O campo estoqueanterior deverá ser o quanto tinha antes da movimentação, o estoqueatual deverá ser o valor após a movimentação, ou seja estoqueanterior (mais ou menos) quantity_delta será o estoqueatual

## Executado, novo resultado:

```sql
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  product_id uuid NOT NULL REFERENCES products (id),
  quantity_delta integer NOT NULL,
  stock_before integer NOT NULL,
  stock_after integer NOT NULL,
  reason text NOT NULL,
  sale_id uuid,
  purchase_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_stock_snapshot_check
    CHECK (stock_after = stock_before + quantity_delta),
  CONSTRAINT inventory_movements_origin_exclusive_check
    CHECK (sale_id IS NULL OR purchase_id IS NULL)
);

CREATE INDEX inventory_movements_company_created_idx
  ON inventory_movements (company_id, created_at DESC);

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_sale_id_fkey
  FOREIGN KEY (sale_id) REFERENCES sales (id);
```

| Coluna           | Tipo                   | Notas                                              |
| ---------------- | ---------------------- | -------------------------------------------------- |
| `id`             | `uuid` PK              |                                                    |
| `company_id`     | `uuid NOT NULL`        | → `companies`                                      |
| `product_id`     | `uuid NOT NULL`        | → `products`                                       |
| `quantity_delta` | `integer NOT NULL`     | + entra, − sai                                     |
| `stock_before`   | `integer NOT NULL`     | saldo imediatamente **antes** do movimento         |
| `stock_after`    | `integer NOT NULL`     | saldo **depois** (`stock_before + quantity_delta`) |
| `reason`         | `text NOT NULL`        |                                                    |
| `sale_id`        | `uuid`                 | → `sales`; baixa de venda                          |
| `purchase_id`    | `uuid`                 | entrada por compra; sem FK até existir `purchases` |
| `deleted_at`     | `timestamptz`          | nulo = vigente                                     |
| `created_at`     | `timestamptz NOT NULL` | sem `updated_at`                                   |

- Venda: `quantity_delta` negativo, `sale_id` preenchido, `purchase_id` nulo.
- Compra: `quantity_delta` positivo, `purchase_id` preenchido, `sale_id` nulo.
- Ajuste: os dois ids nulos; `reason` explica.

---

## `payments`

### Incluir `crediário` em `method`?

No glossário, **crediário / fiado da loja já é** `wallet`: não passa pelo
Asaas, exige cliente identificado, abre recebível em aberto e mexer no saldo
`customers.wallet_*`.

| O lojista chama                        | No banco                                          |
| -------------------------------------- | ------------------------------------------------- |
| Dinheiro                               | `cash`                                            |
| Pix / boleto / link                    | `pix` / `boleto` (preenche `payments.provider_*`) |
| Débito / crédito na maquininha         | `debit` / `credit` (só registro)                  |
| Cartão **online**                      | `credit` + colunas de provedor em `payments`      |
| Fiado / caderninho / crediário da loja | `wallet`                                          |

---

## `payments` (colunas de provedor)

### Quando serão preenchidas?

Na cobrança **online**: Pix, boleto, link ou cartão no PSP, **depois** da venda
gravada. Dinheiro, maquininha e `wallet` deixam `provider_*` nulos.

Campos úteis: `provider_payment_id`, QR (`pix_payload`), PDF / linha digitável
do boleto, `checkout_url`, evento que liquidou. PAN do cartão nunca entra;
token vai ao cofre (`card_token_ref`). `method` é o domínio — sem `billing_type`
de vendor.

---

## `invoices`

### Essa tabela será preenchida quando houver emissão de notas? Lembrando que numa mesma venda poderá haver serviços e produtos.

++Não tinha pensado que haveriam casos assim, vou pesquisar uma melhor forma de adequar o banco. O que recomenda? (Decisão técnica)++

---

---

---

## `payables`

### O que é o campo `template_id` e o `is_template`?

Custo **recorrente** (aluguel, energia) sem uma tabela extra de “modelos”.

| Campo         | Significado                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `is_template` | `true` = **molde**, não uma conta que vence. Não entra na lista “a pagar” (índice parcial ignora) |
| `template_id` | Na ocorrência gerada, aponta para o molde (`payables` → `payables`). Nulo = lançamento avulso     |

Fluxo (RF-057, RF-058): o lojista cadastra “Aluguel R$ 2.000, todo dia 10”
(`is_template = true`). O job materializa as competências como linhas
`is_template = false` com `template_id` = o molde. Alterar uma ocorrência não
mexe nas outras; encerrar o molde preserva as já pagas.

`supplier` é texto, sem tabela de fornecedores. Anexo da conta, se houver, vai
em `attachments` (`entity_type` / `entity_id`).

## **Exemplo**

O lojista cadastra “Aluguel R$ 2.000, todo dia 10”. Isso **não** é uma conta a pagar; é o molde:

| `id` | `description` | `amount_cents` | `due_date`             | `is_template` | `template_id` |
| ---- | ------------- | -------------- | ---------------------- | ------------- | ------------- |
| `A`  | Aluguel       | 200000         | 10 (dia de referência) | `true`        | `null`        |

Um job (RF-057) materializa as competências. Cada mês vira uma linha nova, filha de `A`:

| `id` | `description` | `due_date` | `is_template` | `template_id` | `outstanding_cents` |
| ---- | ------------- | ---------- | ------------- | ------------- | ------------------- |
| `B`  | Aluguel       | 2026-09-10 | `false`       | `A`           | 200000              |
| `C`  | Aluguel       | 2026-10-10 | `false`       | `A`           | 200000              |
| `D`  | Aluguel       | 2026-11-10 | `false`       | `A`           | 200000              |

`template_id` é uma auto-FK: `payables.template_id` → `payables.id`. A ocorrência aponta para o molde na mesma tabela.

++Seria melhor transformar em duas tabelas? (Decisão técnica)++

---

### No financeiro estamos presumindo que o usuário terá apenas uma conta corrente

++Nesse momento estamos mais dando uma clareza geral de negócio, sem saldo por conta bancária e etc. mas podemos conversar mais sobre isso (Decisão de negócio)++

---

## CRM e assistente

Dois módulos, duas tabelas-núcleo, o mesmo tenant.

### CRM e agenda (jornada E)

Pendências comerciais no quadro — **não** é funil de marketing nem CRM do
cliente final.

`crm_cards`: card com `title`, cliente opcional, coluna
`afazer` `andamento` `concluido`. Comentários em `comments` jsonb (sem
tabela `crm_comments`). Arrastar o card persiste a coluna (US-069).

`appointments`: compromisso (`title`, `starts_at`), cliente opcional, lembrete
(`reminder_minutes` / `reminder_sent_at`). Agenda do **lojista**, não
autoagendamento pelo consumidor.

Suporte à parte: `support_tickets` + `ticket_messages` (jornada I, protocolo,
anexo via `attachments`).

### Assistente (jornada J)

Agora com a decisão do framework do nosso agente, vou conseguir trabalhar melhor em cima disso, mas até então seria um banco de dados para armazenar conversas, comandos, tools e etc.

---

## Assinatura SaaS (`partners`, `coupons`, `subscriptions`, …)

Isto é a **mensalidade do EiBuddy**, na conta-pai do billing — não a venda da loja (`payments`). Pacote `billing`.

O lojista pode informar um código no signup. O código pertence a um **parceiro** (Clube X, Associação Comercial): um parceiro emite vários cupons ao longo do tempo.

| Tabela                | Papel                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `partners`            | Quem emite o cupom: `id`, `name` (único enquanto vigente), `deleted_at`, `created_at`, `updated_at`. Sem `company_id` e sem RLS. Não é o partner de split PagMaxx/Asaas (DEC-018)                                                                                  |
| `coupons`             | Código digitado no signup (`code` único), `partner_id` obrigatório, desconto `percent` ou `amount`, `expires_at`, `revoked_at`, `discount_cycles`, cota                                                                                                            |
| `subscriptions`       | Uma por empresa (`UNIQUE company_id`). `plan_code` em texto — sem tabela `plans`. `coupon_id` aponta para o cupom usado no cadastro. Estados: `trial` … Ids da recorrência (`provider_subscription_id`, próximo vencimento) na mesma linha quando o billing gravar |
| `subscription_cycles` | Cada ciclo: valor, vencimento, `pending` / `paid` / `failed` / `refunded`                                                                                                                                                                                          |

`discount_cycles` nulo = desconto em todos os ciclos; `1` = só o primeiro mês; `3` = três primeiros. `revoked_at` nulo = vigente; preenchido = código morto sem apagar a linha (não depende só de `expires_at`).

Cupom aceito na aplicação: `revoked_at` nulo, `expires_at` nulo ou futuro, e cota (`max_redemptions`) ainda disponível. Colunas e CHECKs: [esquema-postgresql.md](../esquema-postgresql.md).

Regras ainda abertas na [DEC-012](../../decisoes/README.md#dec-012): período grátis, cumulativo, indicação entre lojistas. Quem emite e a duração em ciclos já estão no schema.

---

## Plataforma

Infra transversal: **não é tela de PDV**. Junto com `users` / `companies`, isto
é o “como a plataforma existe”: login, tenant, fila, prova e arquivo. O lojista
não cadastra essas tabelas; o sistema as preenche.

Elas existem porque o PDV opera com rede instável, a nota e o Pix saem do
nosso processo, e várias lojas compartilham o mesmo Postgres. Sem elas a
venda duplica, o efeito externo some no meio do caminho, as lojas se misturam
e não há como provar quem fez o quê. Por isso **continuam**: cada uma fecha um
requisito MUST (RNF-043, RNF-004/RNF-046, RF-123/RF-124, RF-121/RF-122) que
não cabe em `sales` nem em coluna extra na jornada.

| Tabela             | Papel                                                                                          | Se sair                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `attachments`      | Metadado do arquivo no object storage: caminho, MIME, tamanho, `entity_type` + `entity_id`     | Chamado, pagável e exportação perdem o vínculo com o arquivo; blob sem dono                                   |
| `idempotency_keys` | Mesma chave + mesmo hash → mesma resposta. `UNIQUE (company_id, key)`                          | Reenvio do PDV vira venda duplicada (quebra RNF-043)                                                          |
| `outbox`           | Efeito externo (Focus, Asaas, WhatsApp) **sai** da transação. `published_at` nulo = pendente   | Timeout na Focus desfaz venda já fechada, ou a venda grava e a nota nunca é pedida (quebra RNF-046 / RNF-004) |
| `audit_logs`       | Quem fez o quê: ator, canal (`app`                                                             | `whatsapp`                                                                                                    |
| `webhook_events`   | Inbox Focus/Asaas. `UNIQUE (provider, event_id)`. `company_id` depois do match; insert sem RLS | Mesmo Pix liquida duas vezes, ou o aviso se perde porque ainda não sabemos a loja                             |

### `attachments` — por que existe e por que continua

O arquivo (PDF do boleto, foto do chamado, anexo da conta a pagar) **não**
mora no Postgres: vai para object storage. Esta tabela é o **bilhete**: onde
está (`storage_path`), que tipo é, o tamanho, e a **qual entidade** pertence
(`entity_type` + `entity_id`). Já é usada em `payables` e em
`ticket_messages`.

Continua porque chamado, pagável e exportação (RF-125) precisam apontar para
um arquivo sem copiar o blob para cada tabela. Sem ela, ou o binário entra no
banco (caro e inútil para consulta) ou o storage vira um depósito sem dono —
não dá para saber “essa foto é do chamado X da loja Y”. RLS em `company_id`
impede uma loja de listar o anexo da outra.

### `idempotency_keys` — por que existe e por que continua

O PDV vai reenviar: a internet cai no “salvar venda” ([RNF-051](../../produto/requisitos-nao-funcionais.md)).
[RNF-043](../../produto/requisitos-nao-funcionais.md) exige que escrita com
valor seja idempotente. A tabela guarda a chave da requisição, o hash do
corpo e a resposta já dada. Mesma chave + mesmo hash → devolve a mesma
resposta, sem criar outra venda. `UNIQUE (company_id, key)` isola o caderninho
por loja.

A idempotência **não** cabe num `UNIQUE` em `sales`: o
reenvio precisa devolver o resultado original (inclusive erro já respondido),
não só “bloquear o segundo insert”. Sem a tabela, o segundo toque no caixa
duplica estoque, recebível e dinheiro. É princípio 7 de
[principios.md](../principios.md).

### `outbox` — por que existe e por que continua

Focus, Asaas e WhatsApp **não** entram na transação da venda
([dados.md](../dados.md#transações)). O caso de uso grava venda + estoque +
recebível + um recado na `outbox`; o worker lê `published_at IS NULL` e
publica. Só então marca `published_at`.

Misturar HTTP externo na transação produz um dos dois desastres: timeout na Focus faz _rollback_ de uma venda que o lojista já
viu como fechada, ou a venda commita e o pedido de nota nunca sai. A fila
é o que [RNF-004](../../produto/requisitos-nao-funcionais.md) (emissão
assíncrona) e [RNF-046](../../produto/requisitos-nao-funcionais.md)
(atomicidade do caso de uso) exigem juntos. Sem outbox não há como o worker
reprocessar (RF-130) nem ver o que ficou pendente.

### `audit_logs` — por que existe e por que continua

Toda alteração de dado de negócio deixa autor, canal, data e valores
antes/depois ([RF-123](../../produto/requisitos-funcionais.md), US-061).
Canal é de primeira classe (`app`, `whatsapp`, `api`, `job`) para responder
“essa venda saiu pelo WhatsApp às 14h32, confirmada pelo dono” — não
“sistema”. `naregua_app` não tem `UPDATE`/`DELETE` (RF-124, RNF-047).

O motivo da trilha é **resolver divergência** entre lojista e
funcionário. Auditoria que se edita ou se apaga não é prova. Não dá para
espalhar `created_by` em cada tabela e chamar isso de trilha: falta canal,
`request_id` (RNF-058), o estado anterior e a garantia de imutabilidade no
banco. Retenção ≥ 5 anos ([dados.md](../dados.md#auditoria)).

### `webhook_events` — por que existe e por que continua

Os provedores avisam depois: nota autorizada, Pix liquidado. O recado
**chega antes** de sabermos a loja — por isso o insert **não** exige
`company_id` nem RLS. Guardamos o envelope, casamos com a loja, preenchemos
`company_id` e processamos. `UNIQUE (provider, event_id)` descarta o mesmo
aviso reenviado pelo provedor.

O provedor **reenvia** e o worker **reprocessa**. Sem inbox
deduplicada, o mesmo `PAYMENT_RECEIVED` baixa o recebível duas vezes. Sem
insert sem tenant, o aviso se perde na porta: a API ainda não tem
`app.company_id` quando o POST chega ([ADR-0001](../../decisoes/adr/0001-rls-por-linha.md)
não se aplica no insert). Consulta depois do match já é por loja.

### Isolamento (RLS)

RLS por `company_id` em quase tudo ([ADR-0001](../../decisoes/adr/0001-rls-por-linha.md)).
Exceções: `partners` e `coupons` (plataforma; o cupom não é de uma loja) e o
insert de `webhook_events` (o aviso chega antes de sabermos a loja). Consulta
sem `app.company_id` **falha** (RF-121) — falhar é melhor que devolver tudo
misturado (RF-122).

---

## Documentos relacionados

- `[esquema-postgresql.md](../esquema-postgresql.md)` — colunas, CHECKs, índices, RLS
- `[dados.md](../dados.md)` — regras, o que não gravar, estados da venda
- `[focusnfe.md](focusnfe.md)` / `[asaas.md](asaas.md)` — o que mandamos e o que persistimos
- `[escopo-mvp.md](../../produto/escopo-mvp.md)` — jornadas A–J
- [`focusnfe.md`](focusnfe.md) — quem emite nota
- [DEC-005](../../decisoes/README.md#dec-005) — bancos / Open Finance (fora)
- um usuário, uma empresa neste recorte
