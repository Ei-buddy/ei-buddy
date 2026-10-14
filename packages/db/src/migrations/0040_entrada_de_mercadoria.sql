-- Entrada de mercadoria: compra de fornecedor — NR-158.
--
-- Uma compra faz tres coisas, e as tres entram juntas ou nao entram:
--
-- 1. soma a quantidade ao estoque, com uma linha `purchase` na trilha;
-- 2. atualiza o custo do produto pelo custo medio ponderado;
-- 3. lanca a conta a pagar ao fornecedor (uma ou varias parcelas).
--
-- A compra fica gravada com os itens, para responder "quanto paguei neste
-- produto da ultima vez?" sem depender da trilha de estoque — produto sem
-- controle de estoque tambem e comprado, e nao tem linha na trilha.

CREATE TABLE purchases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  supplier        text NOT NULL CHECK (char_length(btrim(supplier)) BETWEEN 2 AND 120),
  invoice_number  text CHECK (invoice_number IS NULL OR char_length(invoice_number) <= 60),
  notes           text CHECK (notes IS NULL OR char_length(notes) <= 500),
  total_cents     bigint NOT NULL CHECK (total_cents >= 0),
  installments    integer NOT NULL CHECK (installments BETWEEN 1 AND 12),
  -- O mesmo id agrupa as parcelas em `payables.recurrence_id`.
  payables_group  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX purchases_por_data ON purchases (company_id, created_at DESC);

SELECT enable_tenant_isolation('purchases');

CREATE TABLE purchase_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  purchase_id      uuid NOT NULL REFERENCES purchases (id) ON DELETE RESTRICT,
  product_id       uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  -- Descricao no momento da compra: o produto pode ser renomeado depois.
  description      text NOT NULL,
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_cost_cents  bigint NOT NULL CHECK (unit_cost_cents >= 0)
);

CREATE INDEX purchase_items_por_compra ON purchase_items (company_id, purchase_id);
CREATE INDEX purchase_items_por_produto ON purchase_items (company_id, product_id);

SELECT enable_tenant_isolation('purchase_items');

-- A trilha de estoque ganha a causa `purchase`, ligada a compra que a gerou.
ALTER TABLE inventory_movements
  ADD COLUMN purchase_id uuid REFERENCES purchases (id) ON DELETE RESTRICT;

ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_kind_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check
  CHECK (kind IN ('adjustment', 'sale', 'sale_cancelled', 'sale_returned', 'purchase'));

ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_origem_declarada;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_origem_declarada CHECK (
  (kind = 'adjustment' AND sale_id IS NULL AND purchase_id IS NULL AND reason IS NOT NULL)
  OR (kind = 'purchase' AND sale_id IS NULL AND purchase_id IS NOT NULL)
  OR (kind NOT IN ('adjustment', 'purchase') AND sale_id IS NOT NULL AND purchase_id IS NULL)
);

COMMENT ON TABLE purchases IS
  'Entrada de mercadoria (NR-158): compra de fornecedor que soma estoque, atualiza custo e lanca a conta a pagar.';
