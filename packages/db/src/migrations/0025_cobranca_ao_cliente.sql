-- Cobranca a distancia, rastreavel ate a baixa — RF-068, NR-044.
--
-- ## O defeito
--
-- `sendCustomerCharge` ja cria o link de pagamento e o manda ao cliente. O que
-- nao existia era o caminho de volta: o `externalReference` enviado ao provedor
-- era o `requestId` da requisicao, e NADA no banco ligava aquele identificador
-- aos titulos que a cobranca cobriu.
--
-- Consequencia: o cliente paga, o aviso chega, e nenhum recebivel baixa. Pior,
-- silenciosamente — o dinheiro entra na conta do lojista e o sistema continua
-- dizendo que ele tem a receber.
--
-- ## Por que uma tabela nova, e nao `payments`
--
-- `payments.sale_id` e `NOT NULL`: aquela tabela e o pagamento DE UMA VENDA.
-- Uma cobranca a distancia cobre titulos em aberto que podem vir de vendas
-- diferentes, ou de recebivel avulso (RF-065) que nem venda tem. Enfiar isso
-- em `payments` exigiria afrouxar a FK que hoje garante que todo pagamento
-- pertence a uma venda — e essa garantia paga mais do que a economia de uma
-- tabela.
--
-- ## Duas tabelas, porque a relacao e N:N de verdade
--
-- Uma cobranca cobre varios titulos (e o caso comum: tres contas vencidas num
-- link so). E um titulo pode aparecer em mais de uma cobranca ao longo do
-- tempo, quando a primeira expira sem pagamento e o lojista cobra de novo.
-- Guardar `charge_id` em `receivables` perderia a segunda metade.

CREATE TABLE customer_charges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  -- Nulo em cobranca sem cliente identificado. A cobranca a distancia sempre
  -- tem um, mas a coluna nao e quem garante isso — o caso de uso e.
  customer_id         uuid REFERENCES customers (id) ON DELETE RESTRICT,

  -- O que foi enviado ao provedor, e por onde o aviso volta a nos achar.
  external_reference  text NOT NULL,

  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),

  provider_link_id    text,
  checkout_url        text,
  provider_status     text,
  -- Unico parcial: o mesmo aviso do provedor nao pode dar baixa duas vezes.
  provider_event_id   text,

  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  paid_at             timestamptz,

  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Comeca por `company_id` — a guarda de `schema.test.ts` exige, e a consulta
-- do webhook filtra por empresa antes de qualquer coisa.
CREATE UNIQUE INDEX customer_charges_referencia_unica
  ON customer_charges (company_id, external_reference)
  WHERE deleted_at IS NULL;

-- Comeca por company_id, como toda tabela de negocio (guarda de schema.test).
-- A unicidade por EMPRESA basta: o id de evento do provedor vale dentro de uma
-- conta, e um mesmo aviso nunca chega para duas lojas.
CREATE UNIQUE INDEX customer_charges_provider_event_idx
  ON customer_charges (company_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

COMMENT ON TABLE customer_charges IS
  'Cobranca a distancia (RF-068): o link enviado ao cliente e o caminho de volta do aviso ate os titulos.';

SELECT enable_tenant_isolation('customer_charges');

CREATE TABLE customer_charge_receivables (
  -- `id` proprio, e nao so a chave composta: a exportacao LGPD pagina por
  -- `ORDER BY t.id` em toda tabela de negocio (privacy-repository.ts). Sem
  -- ele, esta seria a unica tabela com caminho de leitura proprio — e a CI
  -- avisou exatamente isso.
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  charge_id     uuid NOT NULL REFERENCES customer_charges (id) ON DELETE RESTRICT,
  receivable_id uuid NOT NULL REFERENCES receivables (id) ON DELETE RESTRICT,

  -- Quanto desta cobranca corresponde a ESTE titulo. Guardado, e nao deduzido
  -- do saldo na hora da baixa: entre enviar a cobranca e o cliente pagar, o
  -- lojista pode ter recebido parte em dinheiro — e a baixa tem de valer o que
  -- foi cobrado, nao o que sobrou depois.
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A ligacao continua unica: um titulo entra uma vez por cobranca. O que mudou
-- foi deixar de ser a CHAVE PRIMARIA, nao deixar de valer.
--
-- Comeca por company_id porque toda consulta filtra por empresa sob RLS, e um
-- indice sem ela na frente quase nunca e usado. Aqui a coluna e redundante
-- para a unicidade (charge_id ja pertence a uma empresa) e necessaria para o
-- indice servir.
CREATE UNIQUE INDEX customer_charge_receivables_unica
  ON customer_charge_receivables (company_id, charge_id, receivable_id);

CREATE INDEX customer_charge_receivables_company_idx
  ON customer_charge_receivables (company_id, receivable_id);

COMMENT ON TABLE customer_charge_receivables IS
  'Quais titulos uma cobranca a distancia cobre, e com quanto de cada — RF-068.';

SELECT enable_tenant_isolation('customer_charge_receivables');
