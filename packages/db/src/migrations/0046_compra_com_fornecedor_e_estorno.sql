-- Entrada de mercadoria: parcelas editaveis e estorno — achados do QA ("poder
-- informar as datas dos vencimentos", "poder estornar a compra").
--
-- 1. A conta a pagar sabe de qual compra veio. Ate aqui so as parceladas se
--    ligavam a compra (por `recurrence_id = payables_group`); a de parcela
--    unica nao tinha como ser achada, e estornar a compra deixaria a conta
--    viva.
ALTER TABLE payables
  ADD COLUMN purchase_id uuid REFERENCES purchases (id) ON DELETE RESTRICT;

CREATE INDEX payables_por_compra ON payables (company_id, purchase_id)
  WHERE purchase_id IS NOT NULL;

-- Liga as contas das compras que ja existem. Parceladas pelo grupo; a de
-- parcela unica pelo que a compra grava junto: mesma loja, mesmo instante,
-- mesmo fornecedor e a descricao que `registerPurchase` escreve.
UPDATE payables p
   SET purchase_id = c.id
  FROM purchases c
 WHERE c.payables_group IS NOT NULL
   AND p.company_id = c.company_id
   AND p.recurrence_id = c.payables_group;

UPDATE payables p
   SET purchase_id = c.id
  FROM purchases c
 WHERE c.payables_group IS NULL
   AND p.purchase_id IS NULL
   AND p.company_id = c.company_id
   AND p.created_at = c.created_at
   AND p.supplier = c.supplier
   AND p.description LIKE 'Compra de mercadoria%';

-- 2. A compra pode ser estornada: o estoque volta, as contas a pagar sao
--    canceladas, e a compra fica registrada com o motivo — nao some.
ALTER TABLE purchases
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 280);

ALTER TABLE purchases ADD CONSTRAINT purchases_estorno_completo
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL));
