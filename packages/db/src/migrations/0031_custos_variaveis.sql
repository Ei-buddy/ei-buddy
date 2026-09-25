-- Custos variaveis: percentual sobre o preco de venda — Topico 6 do TXT.
--
-- Tarifa do cartao, imposto, custo operacional, comissao: gastos que crescem
-- com a venda, e por isso sao percentual do preco, e nao valor fixo. Sao da
-- EMPRESA, e nao do produto: todo item vendido paga a mesma tarifa e a mesma
-- comissao, e a tela de produto mostra quanto eles levam de cada venda.
--
-- `rate_bps` em centesimos de ponto percentual (350 = 3,50%), inteiro pelo
-- mesmo motivo que dinheiro e centavos (RNF-044): percentual em ponto
-- flutuante acumula erro na soma de varios custos.

CREATE TABLE variable_costs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies (id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  rate_bps    integer NOT NULL CHECK (rate_bps BETWEEN 1 AND 10000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX variable_costs_por_empresa ON variable_costs (company_id, created_at);

SELECT enable_tenant_isolation('variable_costs');

COMMENT ON TABLE variable_costs IS
  'Custo que acompanha a venda, em percentual do preco (tarifa do cartao, imposto, comissao). Da empresa, vale para todo produto.';
