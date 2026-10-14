import { gravarTrilha } from './audit-repository.js'
import type { PurchaseOutput } from '@na-regua/contracts'
import type {
  PurchaseProductSnapshot,
  PurchaseQueries,
  PurchaseTransaction,
  PurchaseUnitOfWork,
} from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Entrada de mercadoria no banco — NR-158.
 *
 * Toda consulta filtra `company_id` explicitamente alem da RLS: a CI roda como
 * superusuario, que ignora a politica, e um filtro so na RLS passaria la
 * deixando o teste de isolamento medir o vazio.
 */

const numero = (valor: unknown): number => Number(valor)

type LinhaCompra = {
  id: string
  supplier: string
  invoice_number: string | null
  notes: string | null
  total_cents: string | number
  installments: number
  created_at: Date
}

type LinhaItem = {
  purchase_id: string
  product_id: string
  description: string
  quantity: number
  unit_cost_cents: string | number
}

const paraSaida = (c: LinhaCompra, itens: readonly LinhaItem[]): PurchaseOutput => ({
  id: c.id,
  supplier: c.supplier,
  invoiceNumber: c.invoice_number,
  notes: c.notes,
  totalCents: numero(c.total_cents),
  installments: c.installments,
  items: itens.map((i) => ({
    productId: i.product_id,
    description: i.description,
    quantity: i.quantity,
    unitCostCents: numero(i.unit_cost_cents),
  })),
  createdAt: c.created_at.toISOString(),
})

function escopo(tx: TransactionSql, companyId: string): PurchaseTransaction {
  return {
    record: (entrada) => gravarTrilha(tx, entrada),

    findProduct: async (_empresa, productId) => {
      const [l] = await tx<
        {
          id: string
          description: string
          cost_price_cents: string | number
          stock: number
          tracks_stock: boolean
          is_active: boolean
        }[]
      >`
        SELECT id, description, cost_price_cents, stock, tracks_stock, is_active
          FROM products
         WHERE id = ${productId} AND company_id = ${companyId} AND deleted_at IS NULL
         FOR UPDATE
      `
      if (l === undefined) return undefined
      const snapshot: PurchaseProductSnapshot = {
        id: l.id,
        description: l.description,
        costPriceCents: numero(l.cost_price_cents),
        stockQuantity: l.tracks_stock ? l.stock : null,
        isActive: l.is_active,
      }
      return snapshot
    },

    insertPurchase: async (c) => {
      const [compra] = await tx<LinhaCompra[]>`
        INSERT INTO purchases ${tx({
          company_id: companyId,
          supplier: c.supplier,
          invoice_number: c.invoiceNumber,
          notes: c.notes,
          total_cents: c.totalCents,
          installments: c.installments,
          payables_group: c.payablesGroup,
          created_at: c.createdAt,
          created_by: c.createdBy,
        })}
        RETURNING *
      `
      const itens = await tx<LinhaItem[]>`
        INSERT INTO purchase_items ${tx(
          c.items.map((i) => ({
            company_id: companyId,
            purchase_id: compra!.id,
            product_id: i.productId,
            description: i.description,
            quantity: i.quantity,
            unit_cost_cents: i.unitCostCents,
          })),
        )}
        RETURNING *
      `
      return paraSaida(compra!, itens)
    },

    updateProduct: async (_empresa, productId, m) => {
      await tx`
        UPDATE products
           SET cost_price_cents = ${m.costPriceCents},
               stock = COALESCE(${m.stock}::integer, stock),
               updated_at = now()
         WHERE id = ${productId} AND company_id = ${companyId}
      `
    },

    insertMovement: async (m) => {
      await tx`
        INSERT INTO inventory_movements ${tx({
          company_id: companyId,
          product_id: m.productId,
          kind: 'purchase',
          quantity_delta: m.quantityDelta,
          balance_after: m.balanceAfter,
          reason: null,
          sale_id: null,
          purchase_id: m.purchaseId,
          created_by: m.createdBy,
          created_at: m.createdAt,
        })}
      `
    },

    insertPayables: async (contas) => {
      if (contas.length === 0) return 0
      const linhas = await tx`
        INSERT INTO payables ${tx(
          contas.map((c) => ({
            company_id: companyId,
            supplier: c.supplier,
            description: c.description,
            amount_cents: c.amountCents,
            due_date: c.dueDate,
            attachment_key: c.attachmentKey,
            account_id: c.accountId,
            recurrence_id: c.recurrenceId,
            occurrence_number: c.occurrenceNumber,
            occurrence_count: c.occurrenceCount,
            created_by: c.createdBy,
            created_at: c.createdAt,
            updated_at: c.createdAt,
          })),
        )}
        RETURNING id
      `
      return linhas.length
    },
  }
}

export function createPurchaseUnitOfWork(sql: Sql): PurchaseUnitOfWork {
  return {
    transaction: (companyId, fn) => withTenant(sql, companyId, (tx) => fn(escopo(tx, companyId))),
  }
}

export function createPurchaseQueries(sql: Sql): PurchaseQueries {
  return {
    list: (companyId, limite) =>
      withTenant(sql, companyId, async (tx) => {
        const compras = await tx<LinhaCompra[]>`
          SELECT * FROM purchases
           WHERE company_id = ${companyId}
           ORDER BY created_at DESC, id DESC
           LIMIT ${limite}
        `
        if (compras.length === 0) return []
        const itens = await tx<LinhaItem[]>`
          SELECT * FROM purchase_items
           WHERE company_id = ${companyId}
             AND purchase_id = ANY(${compras.map((c) => c.id)})
           ORDER BY description
        `
        return compras.map((c) =>
          paraSaida(
            c,
            itens.filter((i) => i.purchase_id === c.id),
          ),
        )
      }),
  }
}
