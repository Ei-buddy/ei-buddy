-- Orcamento — NR-159.
--
-- Um pedido que NAO baixa estoque nem gera financeiro: e a proposta que o
-- lojista manda ao cliente. Quando o cliente aceita, vira venda pelo PDV, e o
-- orcamento guarda a venda que nasceu dele.
--
-- Os precos ficam gravados no orcamento: o que foi prometido ao cliente nao
-- muda porque o preco de tabela mudou depois.

CREATE TABLE quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  -- Numero sequencial por loja, para o cliente citar ("o orcamento 12").
  number          integer NOT NULL CHECK (number > 0),
  customer_name   text CHECK (customer_name IS NULL OR char_length(customer_name) <= 120),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'converted', 'cancelled')),
  valid_until     date NOT NULL,
  notes           text CHECK (notes IS NULL OR char_length(notes) <= 500),
  discount_cents  bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents     bigint NOT NULL CHECK (total_cents >= 0),
  sale_id         uuid REFERENCES sales (id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  closed_at       timestamptz,

  CONSTRAINT quotes_desfecho_completo CHECK (
    (status = 'open' AND sale_id IS NULL AND closed_at IS NULL)
    OR (status = 'converted' AND sale_id IS NOT NULL AND closed_at IS NOT NULL)
    OR (status = 'cancelled' AND sale_id IS NULL AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX quotes_numero_unico ON quotes (company_id, number);
CREATE INDEX quotes_por_data ON quotes (company_id, created_at DESC);

SELECT enable_tenant_isolation('quotes');

CREATE TABLE quote_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  quote_id          uuid NOT NULL REFERENCES quotes (id) ON DELETE RESTRICT,
  product_id        uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  -- Ordem em que o lojista montou: o cliente le na mesma ordem.
  position          integer NOT NULL CHECK (position > 0),
  description       text NOT NULL,
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_price_cents  bigint NOT NULL CHECK (unit_price_cents >= 0)
);

CREATE INDEX quote_items_por_orcamento ON quote_items (company_id, quote_id, position);

SELECT enable_tenant_isolation('quote_items');

COMMENT ON TABLE quotes IS
  'Orcamento (NR-159): proposta ao cliente, sem estoque nem financeiro, que vira venda pelo PDV.';
