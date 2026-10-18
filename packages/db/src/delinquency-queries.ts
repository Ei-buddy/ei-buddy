import type { DelinquentCustomer } from '@na-regua/contracts'
import type { DelinquencyQueries } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Inadimplentes — RF-071, US-034.
 *
 * Vencido = em aberto (ou parcial) com vencimento ANTES de hoje no fuso da loja.
 * O que falta pagar e `amount - settled`, para a parcial contar so o resto.
 * Parcela de cartao fica de fora pela descricao (`Cartao de ...`, o prefixo de
 * `register-sale`): quem deve ali e a adquirente, nao o cliente.
 */
type Linha = {
  customer_id: string
  name: string
  phone: string | null
  overdue_cents: string
  oldest_due_on: string
  days_overdue: number
  receivables_count: string
}

export function createDelinquencyQueries(sql: Sql, timeZone: string): DelinquencyQueries {
  return {
    list: async (companyId): Promise<readonly DelinquentCustomer[]> => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          WITH hoje AS (SELECT (now() AT TIME ZONE ${timeZone})::date AS d)
          SELECT r.customer_id, c.name, c.phone,
                 SUM(r.amount_cents - r.settled_amount_cents)::text AS overdue_cents,
                 to_char(MIN(r.due_date), 'YYYY-MM-DD') AS oldest_due_on,
                 ((SELECT d FROM hoje) - MIN(r.due_date))::int AS days_overdue,
                 COUNT(*)::text AS receivables_count
            FROM receivables r
            JOIN customers c ON c.id = r.customer_id
           WHERE r.customer_id IS NOT NULL
             AND r.status IN ('open', 'partially_settled')
             AND r.due_date < (SELECT d FROM hoje)
             AND r.description NOT LIKE 'Cartao de %'
             AND c.deleted_at IS NULL
           GROUP BY r.customer_id, c.name, c.phone
          HAVING SUM(r.amount_cents - r.settled_amount_cents) > 0
           ORDER BY SUM(r.amount_cents - r.settled_amount_cents) DESC, r.customer_id
           LIMIT 500
        `,
      )
      return linhas.map((l) => ({
        customerId: l.customer_id,
        name: l.name,
        phone: l.phone,
        overdueCents: Number(l.overdue_cents),
        oldestDueOn: l.oldest_due_on,
        daysOverdue: Number(l.days_overdue),
        receivablesCount: Number(l.receivables_count),
      }))
    },
  }
}
