import type { TransactionSql } from 'postgres'

/**
 * Imposto sobre a venda so existe com nota emitida.
 *
 * A venda grava `tax_amount_cents` quando fecha — a previsao pela regra
 * tributaria da loja. Mas o imposto sobre a venda so nasce quando a nota sai:
 * venda sem nota autorizada (ou em contingencia) nao tem imposto a abater, e
 * tira-lo do liquido fazia o painel e o DRE mostrarem menos do que a loja
 * recebeu.
 *
 * Calculado na LEITURA, e nao regravado na venda: a nota pode sair dias depois
 * do fechamento, e se for cancelada o imposto volta a nao existir. O que esta
 * gravado continua sendo a previsao, e o fragmento decide se ela vale.
 *
 * Fragmentos aninhados do postgres.js, e nao texto interpolado. Os dois esperam
 * a venda com o alias `s`.
 */
export const impostoComNota = (tx: TransactionSql) =>
  tx`(CASE WHEN EXISTS (
        SELECT 1 FROM invoices nf_imposto
        WHERE nf_imposto.sale_id = s.id
          AND nf_imposto.status IN ('authorized', 'contingency')
      ) THEN s.tax_amount_cents ELSE 0 END)`

/** O liquido da venda com o imposto so quando ha nota: o gravado devolve o
    imposto previsto e tira o que de fato vale. */
export const liquidoComNota = (tx: TransactionSql) =>
  tx`(s.net_amount_cents + s.tax_amount_cents - ${impostoComNota(tx)})`
