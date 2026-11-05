-- Orcamento com cliente cadastrado — achado do QA ("o cliente deve ser
-- obrigatorio", "ao confirmar a venda ja trazer o cliente informado no
-- orcamento").
--
-- Ate aqui o orcamento guardava so o NOME digitado. Sem o cliente de verdade,
-- a venda que nasce do orcamento pedia o cliente de novo, e o mesmo nome
-- escrito de dois jeitos virava duas pessoas.
--
-- `customer_name` continua: e o nome como estava quando o orcamento foi feito,
-- e os orcamentos antigos so tem ele. A coluna nova e opcional no banco pelo
-- mesmo motivo — o caso de uso e quem passa a exigir o cliente nos novos.
--
-- ON DELETE SET NULL, e nao RESTRICT: o cliente e apagado logicamente
-- (`deleted_at`), e uma remocao fisica nao deve ficar presa a uma proposta
-- que nao gerou nada. O nome gravado sobrevive.
ALTER TABLE quotes
  ADD COLUMN customer_id uuid REFERENCES customers (id) ON DELETE SET NULL;

CREATE INDEX quotes_por_cliente ON quotes (company_id, customer_id)
  WHERE customer_id IS NOT NULL;

COMMENT ON COLUMN quotes.customer_id IS
  'Cliente cadastrado do orcamento. Nulo nos orcamentos anteriores, que so tinham o nome.';
