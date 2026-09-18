-- ---------------------------------------------------------------------------
-- Produto: controle de estoque e localizacao — NR-115, RF-022
-- ---------------------------------------------------------------------------
--
-- `tracks_stock = false` significa "sem controle de estoque": a consulta devolve
-- ausencia de saldo, nao zero. `location` guarda onde o produto fica na loja.
--
-- Default `true` preserva o comportamento de todo catalogo existente: quem ja
-- controlava estoque continua controlando ate alguem marcar o contrario.

ALTER TABLE products
  ADD COLUMN tracks_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN location text;

ALTER TABLE products
  ADD CONSTRAINT products_location_tamanho
    CHECK (location IS NULL OR char_length(location) <= 200);

COMMENT ON COLUMN products.tracks_stock IS
  'Quando false, o produto nao tem controle de estoque — consulta devolve ausencia de saldo, nao zero.';
COMMENT ON COLUMN products.location IS
  'Localizacao na loja (corredor, prateleira) — RF-022.';
