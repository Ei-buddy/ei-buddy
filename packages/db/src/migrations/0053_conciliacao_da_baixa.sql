-- Conciliar da baixa — DEC-026 (NR-225).
--
-- Decisao de 15/11: conciliar o extrato da baixa nas contas a pagar e a
-- receber, e as baixas saem NA ORDEM DO EXTRATO. Duas colunas novas na linha
-- do extrato:
--
-- `statement_position` — a posicao da linha no arquivo importado. A fila era
-- ordenada por data e `id` (uuid aleatorio): no mesmo dia, as linhas saiam
-- embaralhadas, e "a ordem do extrato" nao existia em lugar nenhum. Nula nas
-- linhas importadas antes desta migration (no mesmo dia, ficam depois, pelo
-- `id`, como antes).
--
-- `settlement_id` — a baixa que a conciliacao lancou. E ela que o desfazer
-- estorna, e so ela: a baixa lancada a mao na tela de contas nao e da
-- conciliacao. Nula na fila, na conciliacao de titulo ja quitado (o recebivel
-- do cartao nasce liquidado) e nas conciliacoes de antes da DEC-026.
ALTER TABLE bank_transactions
  ADD COLUMN statement_position integer CHECK (statement_position IS NULL OR statement_position >= 0),
  ADD COLUMN settlement_id uuid REFERENCES settlements (id) ON DELETE RESTRICT,
  -- Baixa da conciliacao so existe em linha conciliada.
  ADD CONSTRAINT bank_transactions_baixa_so_conciliada
    CHECK (settlement_id IS NULL OR reconciled_at IS NOT NULL);

-- A fila na ordem do extrato: data do banco, a importacao, a posicao no arquivo.
DROP INDEX IF EXISTS bank_transactions_fila;
CREATE INDEX bank_transactions_fila
  ON bank_transactions (company_id, posted_on, imported_at, statement_position)
  WHERE reconciled_at IS NULL;

COMMENT ON COLUMN bank_transactions.statement_position IS
  'Posicao da linha no arquivo importado (DEC-026): a ordem do extrato no mesmo dia.';
COMMENT ON COLUMN bank_transactions.settlement_id IS
  'Baixa lancada pela conciliacao (DEC-026); o desfazer estorna esta e so esta.';
