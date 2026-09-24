-- Devolucao parcial — RF-044, NR-122.
--
-- `sale_items.returned_quantity` ja existia (0002) esperando esta regra. O que
-- faltava era o VALOR: quanto da venda voltou, para o relatorio abater sem
-- recalcular item por item — e sem reescrever `gross_amount_cents`, que e o
-- que foi cobrado naquele dia e continua sendo.
--
-- Cumulativo: duas devolucoes da mesma venda somam aqui. O motivo e quem fez
-- ficam na trilha de auditoria, uma linha por devolucao.

ALTER TABLE sales
  ADD COLUMN returned_amount_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE sales
  ADD CONSTRAINT sales_devolucao_ate_o_bruto
    CHECK (returned_amount_cents >= 0 AND returned_amount_cents <= gross_amount_cents);

COMMENT ON COLUMN sales.returned_amount_cents IS
  'Valor ja devolvido ao cliente (RF-044), cumulativo. O bruto da venda nao muda.';
