-- CSOSN com a origem da mercadoria na frente — achado do QA: "CSOSN tem que
-- ter 4 digitos". Os sistemas de gestao gravam 0102 (origem 0, nacional, +
-- CSOSN 102), e e assim que o contador passa o codigo. O emissor separa os
-- dois campos (`separarOrigem` em contracts); com 2 ou 3 digitos a origem
-- continua 0, como era.
--
-- O nome da restricao e o que o Postgres deu a CHECK da coluna na 0002.
ALTER TABLE products DROP CONSTRAINT products_tax_situation_code_check;
ALTER TABLE products ADD CONSTRAINT products_tax_situation_code_check
  CHECK (tax_situation_code IS NULL OR tax_situation_code ~ '^[0-9]{2,4}$');

COMMENT ON COLUMN products.tax_situation_code IS
  'CST (2 digitos, regime normal), CSOSN (3, Simples) ou origem + CSOSN (4, ex.: 0102) — RF-046.';
