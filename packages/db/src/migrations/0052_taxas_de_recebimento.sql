-- Taxas de recebimento configuradas pela loja — DEC-027 (NR-223).
--
-- Ate aqui a taxa do cartao era uma tabela fixa no codigo (credito 3% a
-- vista, 5% em 2x, +1,5 ponto por parcela; debito igual ao credito a vista;
-- Pix sem taxa), igual para todas as lojas. Agora cada loja grava a sua:
-- Pix, debito, credito por numero de parcelas, excecao por bandeira e o prazo
-- de recebimento do debito e do credito. A venda le esta linha ao registrar e
-- grava a taxa calculada nela mesma (`receivables.card_fee_cents`); mudar a
-- taxa depois nao refaz venda antiga.
--
-- Uma linha por loja. Sem linha, vale a tabela padrao do codigo
-- (`TAXAS_PADRAO`): a mesma de antes, para nenhuma loja mudar sozinha.
--
-- Antecipacao: por enquanto so o espaco para parametrizar (decisao de 15/11).
-- Nenhuma conta usa esses dois campos ainda.
CREATE TABLE payment_fee_settings (
  company_id              uuid PRIMARY KEY REFERENCES companies (id) ON DELETE RESTRICT,

  pix_fee_percent         numeric(5,2) NOT NULL CHECK (pix_fee_percent BETWEEN 0 AND 30),
  debit_fee_percent       numeric(5,2) NOT NULL CHECK (debit_fee_percent BETWEEN 0 AND 30),
  -- Lista de percentuais: a posicao 0 e o credito a vista, a 1 e 2x, ate 12x.
  credit_fee_percents     jsonb NOT NULL CHECK (
    jsonb_typeof(credit_fee_percents) = 'array'
    AND jsonb_array_length(credit_fee_percents) BETWEEN 1 AND 12
  ),
  -- Excecoes por bandeira: [{brand, method, installments, feePercent}].
  brand_overrides         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(brand_overrides) = 'array'
    AND jsonb_array_length(brand_overrides) <= 120
  ),
  debit_settlement_days   integer NOT NULL CHECK (debit_settlement_days BETWEEN 0 AND 60),
  credit_settlement_days  integer NOT NULL CHECK (credit_settlement_days BETWEEN 0 AND 60),

  anticipation_enabled    boolean NOT NULL DEFAULT false,
  anticipation_monthly_rate_percent numeric(5,2) CHECK (
    anticipation_monthly_rate_percent IS NULL
    OR anticipation_monthly_rate_percent BETWEEN 0 AND 30
  ),

  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES users (id) ON DELETE SET NULL
);

SELECT enable_tenant_isolation('payment_fee_settings');

COMMENT ON TABLE payment_fee_settings IS
  'Taxas de recebimento da loja (DEC-027, NR-223): Pix, debito, credito por parcela, bandeira e prazos.';
