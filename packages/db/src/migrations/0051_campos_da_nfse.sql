-- Os tres campos da NFS-e — DEC-031, NR-222.
--
-- Decisao de 15/11: a emissao de NFS-e segue o padrao nacional e tem de
-- servir a qualquer municipio. Ela pede:
--   * Codigo de Tributacao Nacional (6 digitos) — no cadastro da LOJA;
--   * Aliquota do ISS — no cadastro da LOJA;
--   * NBS (9 digitos, o item do servico) — no cadastro do PRODUTO.
--
-- Todos opcionais na gravacao, como a inscricao municipal: loja que so vende
-- mercadoria nunca vai preenche-los. Quem cobra e a EMISSAO da NFS-e, na hora
-- em que fazem falta, com a mensagem certa.

ALTER TABLE companies
  ADD COLUMN national_service_code text,
  ADD COLUMN iss_rate_percent numeric(5, 2),
  ADD CONSTRAINT companies_national_service_code_formato
    CHECK (national_service_code IS NULL OR national_service_code ~ '^\d{6}$'),
  ADD CONSTRAINT companies_iss_rate_percent_faixa
    CHECK (iss_rate_percent IS NULL OR (iss_rate_percent >= 0 AND iss_rate_percent <= 5));

ALTER TABLE products
  ADD COLUMN nbs_code text,
  ADD CONSTRAINT products_nbs_code_formato
    CHECK (nbs_code IS NULL OR nbs_code ~ '^\d{9}$');

COMMENT ON COLUMN companies.national_service_code IS
  'Codigo de Tributacao Nacional da NFS-e (6 digitos) — DEC-031.';
COMMENT ON COLUMN companies.iss_rate_percent IS
  'Aliquota do ISS em pontos percentuais (2.5 = 2,5%) — DEC-031.';
COMMENT ON COLUMN products.nbs_code IS
  'NBS do servico (9 digitos), para a NFS-e — DEC-031.';
