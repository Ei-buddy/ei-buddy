import type { QuoteOutput } from '@na-regua/contracts'
import type { QuoteRepository } from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Orcamentos no banco — NR-159.
 *
 * Toda consulta filtra `company_id` explicitamente alem da RLS: a CI roda como
 * superusuario, que ignora a politica.
 */

const numero = (v: unknown): number => Number(v)

/* Id que nao e uuid nao existe — e responder "nao encontrado" e melhor que
   deixar o Postgres recusar o texto com um 500. */
const ehUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

type LinhaOrcamento = {
  id: string
  number: number
  customer_name: string | null
  status: string
  valid_until: Date | string
  notes: string | null
  discount_cents: string | number
  total_cents: string | number
  sale_id: string | null
  created_at: Date
}

type LinhaItem = {
  quote_id: string
  product_id: string
  description: string
  quantity: number
  unit_price_cents: string | number
  internal_code: string
  cost_price_cents: string | number
  stock: number
  is_active: boolean
}

/* Coluna `date` chega como meia-noite UTC: os campos a ler sao os UTC. */
function paraDia(v: Date | string): string {
  if (typeof v === 'string') return v.slice(0, 10)
  const mes = String(v.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(v.getUTCDate()).padStart(2, '0')
  return `${v.getUTCFullYear()}-${mes}-${dia}`
}

const paraSaida = (o: LinhaOrcamento, itens: readonly LinhaItem[]): QuoteOutput => ({
  id: o.id,
  number: o.number,
  customerName: o.customer_name,
  status: o.status as QuoteOutput['status'],
  validUntil: paraDia(o.valid_until),
  notes: o.notes,
  discountCents: numero(o.discount_cents),
  totalCents: numero(o.total_cents),
  saleId: o.sale_id,
  items: itens.map((i) => ({
    productId: i.product_id,
    description: i.description,
    quantity: i.quantity,
    unitPriceCents: numero(i.unit_price_cents),
    code: i.internal_code,
    costPriceCents: numero(i.cost_price_cents),
    stock: i.stock,
    isActive: i.is_active,
  })),
  createdAt: o.created_at.toISOString(),
})

async function comItens(
  tx: TransactionSql,
  companyId: string,
  orcamentos: readonly LinhaOrcamento[],
): Promise<QuoteOutput[]> {
  if (orcamentos.length === 0) return []
  const itens = await tx<LinhaItem[]>`
    SELECT qi.quote_id, qi.product_id, qi.description, qi.quantity, qi.unit_price_cents,
           p.internal_code, p.cost_price_cents, p.stock, p.is_active
      FROM quote_items qi
      JOIN products p ON p.id = qi.product_id AND p.company_id = qi.company_id
     WHERE qi.company_id = ${companyId}
       AND qi.quote_id = ANY(${orcamentos.map((o) => o.id)})
     ORDER BY qi.position
  `
  return orcamentos.map((o) =>
    paraSaida(
      o,
      itens.filter((i) => i.quote_id === o.id),
    ),
  )
}

export function createQuoteRepository(sql: Sql): QuoteRepository {
  return {
    findProducts: (companyId, ids) =>
      withTenant(sql, companyId, async (tx) => {
        ids = ids.filter(ehUuid)
        const linhas = await tx<{ id: string; description: string; is_active: boolean }[]>`
          SELECT id, description, is_active FROM products
           WHERE company_id = ${companyId} AND deleted_at IS NULL AND id = ANY(${[...ids]})
        `
        return linhas.map((l) => ({ id: l.id, description: l.description, isActive: l.is_active }))
      }),

    create: (q) =>
      withTenant(sql, q.companyId, async (tx) => {
        /* Trava a numeracao da loja: duas gravacoes ao mesmo tempo nao podem
           pegar o mesmo numero. O indice unico e a guarda final. */
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`quotes:${q.companyId}`}))`
        const [seq] = await tx<{ proximo: number }[]>`
          SELECT COALESCE(MAX(number), 0) + 1 AS proximo FROM quotes WHERE company_id = ${q.companyId}
        `
        const [o] = await tx<LinhaOrcamento[]>`
          INSERT INTO quotes ${tx({
            company_id: q.companyId,
            number: seq!.proximo,
            customer_name: q.customerName,
            valid_until: q.validUntil,
            notes: q.notes,
            discount_cents: q.discountCents,
            total_cents: q.totalCents,
            created_at: q.createdAt,
            created_by: q.createdBy,
          })}
          RETURNING *
        `
        await tx`
          INSERT INTO quote_items ${tx(
            q.items.map((i, n) => ({
              company_id: q.companyId,
              quote_id: o!.id,
              product_id: i.productId,
              position: n + 1,
              description: i.description,
              quantity: i.quantity,
              unit_price_cents: i.unitPriceCents,
            })),
          )}
        `
        const [saida] = await comItens(tx, q.companyId, [o!])
        return saida!
      }),

    list: (companyId, limite) =>
      withTenant(sql, companyId, async (tx) => {
        const linhas = await tx<LinhaOrcamento[]>`
          SELECT * FROM quotes
           WHERE company_id = ${companyId}
           ORDER BY number DESC
           LIMIT ${limite}
        `
        return comItens(tx, companyId, linhas)
      }),

    findById: async (companyId, id) => {
      if (!ehUuid(id)) return null
      return withTenant(sql, companyId, async (tx) => {
        const linhas = await tx<LinhaOrcamento[]>`
          SELECT * FROM quotes WHERE company_id = ${companyId} AND id = ${id}
        `
        const [saida] = await comItens(tx, companyId, linhas)
        return saida ?? null
      })
    },

    saleExists: async (companyId, saleId) => {
      if (!ehUuid(saleId)) return false
      return withTenant(sql, companyId, async (tx) => {
        const linhas = await tx`
          SELECT 1 FROM sales WHERE company_id = ${companyId} AND id = ${saleId}
        `
        return linhas.length > 0
      })
    },

    close: (companyId, id, d) =>
      withTenant(sql, companyId, async (tx) => {
        const linhas = await tx<LinhaOrcamento[]>`
          UPDATE quotes
             SET status = ${d.status}, sale_id = ${d.saleId}, closed_at = ${d.closedAt}
           WHERE company_id = ${companyId} AND id = ${id} AND status = 'open'
          RETURNING *
        `
        const [saida] = await comItens(tx, companyId, linhas)
        return saida ?? null
      }),
  }
}
