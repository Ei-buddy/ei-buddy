-- Abertura e fechamento de caixa — NR-157.
--
-- O caixa e o dinheiro FISICO da gaveta. Abre com um troco inicial, recebe as
-- vendas em dinheiro, perde nas sangrias, ganha nos suprimentos, e fecha com a
-- contagem. A diferenca entre o esperado e o contado e o que o dono quer ver.
--
-- Pix, cartao e carteira nao passam pela gaveta: entram no resumo do
-- fechamento como CONFERENCIA (bate com a maquininha?), mas nao no esperado.
--
-- Um caixa aberto por loja de cada vez. O indice parcial e a guarda final: o
-- caso de uso confere antes, o banco confere de novo.

CREATE TABLE cash_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_cents   bigint NOT NULL CHECK (opening_cents >= 0),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  opened_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Fechamento: esperado e contado ficam GRAVADOS. Recalcular depois, com uma
  -- venda estornada no meio, mudaria a diferenca de um caixa ja conferido.
  expected_cents  bigint,
  counted_cents   bigint CHECK (counted_cents IS NULL OR counted_cents >= 0),
  closed_at       timestamptz,
  closed_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  notes           text CHECK (notes IS NULL OR char_length(notes) <= 500),

  CONSTRAINT cash_sessions_fechamento_completo CHECK (
    (status = 'open' AND closed_at IS NULL AND counted_cents IS NULL AND expected_cents IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL AND counted_cents IS NOT NULL
        AND expected_cents IS NOT NULL)
  )
);

CREATE UNIQUE INDEX cash_sessions_um_aberto ON cash_sessions (company_id) WHERE status = 'open';
CREATE INDEX cash_sessions_por_data ON cash_sessions (company_id, opened_at DESC);

SELECT enable_tenant_isolation('cash_sessions');

-- Sangria (tira da gaveta) e suprimento (poe na gaveta), sempre com motivo.
CREATE TABLE cash_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  session_id    uuid NOT NULL REFERENCES cash_sessions (id) ON DELETE RESTRICT,
  kind          text NOT NULL CHECK (kind IN ('withdrawal', 'deposit')),
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  reason        text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 280),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX cash_movements_por_caixa ON cash_movements (company_id, session_id);

SELECT enable_tenant_isolation('cash_movements');

COMMENT ON TABLE cash_sessions IS
  'Caixa da loja (NR-157): abertura, sangria/suprimento e fechamento com contagem.';
