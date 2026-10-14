import type { CashMovementOutput, CashSessionOutput, CashSummary } from '@na-regua/contracts'
import type { CashRegister } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

/** O caixa da loja — NR-157, migration 0039. */

type LinhaSessao = {
  id: string
  status: 'open' | 'closed'
  opening_cents: string
  opened_at: Date
  closed_at: Date | null
  expected_cents: string | null
  counted_cents: string | null
  notes: string | null
}

const numeroOuNulo = (v: string | null) => (v === null ? null : Number(v))

const paraSessao = (l: LinhaSessao): CashSessionOutput => ({
  id: l.id,
  status: l.status,
  openingCents: Number(l.opening_cents),
  openedAt: l.opened_at.toISOString(),
  closedAt: l.closed_at?.toISOString() ?? null,
  expectedCents: numeroOuNulo(l.expected_cents),
  countedCents: numeroOuNulo(l.counted_cents),
  notes: l.notes,
})

type LinhaMovimento = {
  id: string
  kind: 'withdrawal' | 'deposit'
  amount_cents: string
  reason: string
  created_at: Date
}

const paraMovimento = (l: LinhaMovimento): CashMovementOutput => ({
  id: l.id,
  kind: l.kind,
  amountCents: Number(l.amount_cents),
  reason: l.reason,
  createdAt: l.created_at.toISOString(),
})

export function createCashRegister(sql: Sql): CashRegister {
  return {
    findOpen: async (companyId) => {
      const [l] = await withTenant(
        sql,
        companyId,
        (tx) =>
          tx<
            LinhaSessao[]
          >`SELECT * FROM cash_sessions WHERE company_id = ${companyId} AND status = 'open'`,
      )
      return l === undefined ? undefined : paraSessao(l)
    },

    /* ON CONFLICT no indice parcial: "ja tem um aberto" e resposta, nao 500. */
    open: async (a) => {
      const [l] = await withTenant(
        sql,
        a.companyId,
        (tx) => tx<LinhaSessao[]>`
          INSERT INTO cash_sessions (company_id, opening_cents, notes, opened_by, opened_at)
          VALUES (${a.companyId}, ${a.openingCents}, ${a.notes}, ${a.openedBy}, ${a.openedAt})
          ON CONFLICT (company_id) WHERE status = 'open' DO NOTHING
          RETURNING *
        `,
      )
      return l === undefined ? 'ja_aberto' : paraSessao(l)
    },

    addMovement: async (companyId, sessionId, m) => {
      const [l] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaMovimento[]>`
          INSERT INTO cash_movements
            (company_id, session_id, kind, amount_cents, reason, created_by, created_at)
          VALUES (${companyId}, ${sessionId}, ${m.kind}, ${m.amountCents}, ${m.reason},
                  ${m.createdBy}, ${m.createdAt})
          RETURNING id, kind, amount_cents, reason, created_at
        `,
      )
      return paraMovimento(l!)
    },

    /*
     * Vendas do periodo do caixa, por forma. Os pagamentos ja estao gravados
     * sem o troco (ver `descontarTroco`), entao o dinheiro aqui e o que ficou
     * na gaveta. Estornada e devolvida inteira saem: o dinheiro voltou.
     */
    activity: async (companyId, session, ate) =>
      withTenant(sql, companyId, async (tx) => {
        const movimentos = await tx<LinhaMovimento[]>`
          SELECT id, kind, amount_cents, reason, created_at
            FROM cash_movements WHERE company_id = ${companyId} AND session_id = ${session.id}
           ORDER BY created_at
        `
        const formas = await tx<{ method: string; amount_cents: string }[]>`
          SELECT p.method, SUM(p.amount_cents)::text AS amount_cents
            FROM payments p
            JOIN sales s ON s.id = p.sale_id
           WHERE s.company_id = ${companyId}
             AND s.created_at >= ${session.openedAt}
             AND s.created_at <= ${ate}
             AND s.status NOT IN ('cancelled', 'returned')
           GROUP BY p.method
           ORDER BY p.method
        `
        const [contagem] = await tx<{ total: string }[]>`
          SELECT count(*)::text AS total FROM sales s
           WHERE s.company_id = ${companyId}
             AND s.created_at >= ${session.openedAt}
             AND s.created_at <= ${ate}
             AND s.status NOT IN ('cancelled', 'returned')
        `
        return {
          movements: movimentos.map(paraMovimento),
          salesByMethod: formas.map((f) => ({
            method: f.method as CashSummary['salesByMethod'][number]['method'],
            amountCents: Number(f.amount_cents),
          })),
          salesCount: Number(contagem?.total ?? 0),
        }
      }),

    close: async (companyId, sessionId, f) => {
      const [l] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaSessao[]>`
          UPDATE cash_sessions
             SET status = 'closed', expected_cents = ${f.expectedCents},
                 counted_cents = ${f.countedCents}, closed_by = ${f.closedBy},
                 closed_at = ${f.closedAt}, notes = COALESCE(${f.notes}, notes)
           WHERE company_id = ${companyId} AND id = ${sessionId} AND status = 'open'
          RETURNING *
        `,
      )
      if (l === undefined) throw new Error(`caixa ${sessionId} nao esta aberto`)
      return paraSessao(l)
    },

    list: async (companyId, limite) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaSessao[]>`
          SELECT * FROM cash_sessions WHERE company_id = ${companyId}
           ORDER BY opened_at DESC LIMIT ${limite}
        `,
      )
      return linhas.map(paraSessao)
    },
  }
}
