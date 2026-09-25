import type { BankAccountOutput } from '@na-regua/contracts'
import type { BankAccountRepository } from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Contas da loja — RF-073, migration 0036.
 *
 * O saldo e calculado aqui, e nao guardado: saldo gravado e um segundo numero
 * para discordar do primeiro. E o inicial mais as baixas que citam a conta
 * (pelo nome, sem caixa) desde `opening_date` — recebimento soma, pagamento
 * subtrai, e o estorno de baixa ja vem negativo e se desfaz sozinho.
 */

type Linha = {
  id: string
  name: string
  bank: string | null
  agency: string | null
  account_number: string | null
  opening_balance_cents: string
  opening_date: string
  balance_cents: string
}

const paraSaida = (l: Linha): BankAccountOutput => ({
  id: l.id,
  name: l.name,
  bank: l.bank,
  agency: l.agency,
  accountNumber: l.account_number,
  openingBalanceCents: Number(l.opening_balance_cents),
  openingDate: l.opening_date,
  balanceCents: Number(l.balance_cents),
})

const selecionar = (tx: TransactionSql) => tx`
  SELECT b.id, b.name, b.bank, b.agency, b.account_number,
         b.opening_balance_cents::text AS opening_balance_cents,
         to_char(b.opening_date, 'YYYY-MM-DD') AS opening_date,
         (b.opening_balance_cents + COALESCE((
            SELECT SUM(CASE WHEN s.receivable_id IS NOT NULL THEN s.amount_cents
                            ELSE -s.amount_cents END)
              FROM settlements s
             WHERE lower(s.bank_account) = lower(b.name)
               AND COALESCE(s.settled_on, s.settled_at::date) >= b.opening_date
          ), 0))::text AS balance_cents
    FROM bank_accounts b
`

export function createBankAccountRepository(sql: Sql): BankAccountRepository {
  return {
    list: async (companyId) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`${selecionar(tx)} ORDER BY b.created_at, b.id`,
      )
      return linhas.map(paraSaida)
    },

    findById: async (companyId, id) => {
      const [l] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`${selecionar(tx)} WHERE b.id = ${id}`,
      )
      return l === undefined ? undefined : paraSaida(l)
    },

    insert: async (nova) => {
      const inserida = await withTenant(sql, nova.companyId, async (tx) => {
        /* ON CONFLICT no indice unico por nome: "ja existe" e resposta, nao 500. */
        const [r] = await tx<{ id: string }[]>`
          INSERT INTO bank_accounts
            (company_id, name, bank, agency, account_number, opening_balance_cents,
             opening_date, created_by, created_at)
          VALUES (${nova.companyId}, ${nova.name}, ${nova.bank}, ${nova.agency},
                  ${nova.accountNumber}, ${nova.openingBalanceCents}, ${nova.openingDate},
                  ${nova.createdBy}, ${nova.createdAt})
          ON CONFLICT (company_id, lower(name)) DO NOTHING
          RETURNING id
        `
        if (r === undefined) return undefined
        const [l] = await tx<Linha[]>`${selecionar(tx)} WHERE b.id = ${r.id}`
        return l
      })
      return inserida === undefined ? undefined : paraSaida(inserida)
    },

    remove: async (companyId, id) => {
      await withTenant(sql, companyId, (tx) => tx`DELETE FROM bank_accounts WHERE id = ${id}`)
    },
  }
}
