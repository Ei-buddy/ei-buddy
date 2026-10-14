import { randomUUID } from 'node:crypto'
import { createPurchaseInputSchema } from '@na-regua/contracts'
import { registerPurchase, type ExecutionContext } from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createPurchaseQueries, createPurchaseUnitOfWork } from './purchase-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Entrada de mercadoria no banco — NR-158. O que so o SQL garante: estoque,
 * custo, trilha `purchase` e contas a pagar gravados juntos, e a origem da
 * linha da trilha declarada pela constraint.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('entrada de mercadoria — NR-158', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let usuario: string
  let seq = 0

  async function produto(stock: number, custo: number, tracksStock = true): Promise<string> {
    const id = randomUUID()
    seq += 1
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO products
          (id, company_id, description, internal_code, unit_of_measure,
           sale_price_cents, cost_price_cents, stock, tracks_stock)
        VALUES (${id}, ${empresa}, ${`Produto ${seq}`}, ${`C-${seq}-${id.slice(0, 6)}`},
                'un', 2000, ${custo}, ${stock}, ${tracksStock})
      `,
    )
    return id
  }

  const ctx = (): ExecutionContext => ({
    companyId: empresa,
    userId: usuario,
    role: 'owner',
    channel: 'app',
    requestId: 'req',
    now: new Date(),
  })

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresa = randomUUID()
    const cnpj = cnpjDeTeste('3')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, 'Loja Compra', ${cnpj}, ${`x@${cnpj}.local`}, '41999990000')
      `,
    )
    usuario = randomUUID()
    await withTenant(sql, empresa, async (tx) => {
      await tx`INSERT INTO users (id, name, email) VALUES (${usuario}, 'Dono', ${`d${usuario}@local`})`
      await tx`INSERT INTO company_users (company_id, user_id, role) VALUES (${empresa}, ${usuario}, 'owner')`
    })
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('grava estoque, custo medio, trilha e parcelas juntos', async () => {
    const cafe = await produto(10, 1000)
    const granel = await produto(0, 500, false)
    const deps = { uow: createPurchaseUnitOfWork(sql), ids: { next: () => randomUUID() } }

    const compra = await registerPurchase(
      deps,
      ctx(),
      createPurchaseInputSchema.parse({
        supplier: 'Distribuidora Boa',
        invoiceNumber: '555',
        items: [
          { productId: cafe, quantity: 10, unitCostCents: 1200 },
          { productId: granel, quantity: 4, unitCostCents: 700 },
        ],
        dueDate: '2026-11-10',
        installments: 2,
      }),
    )
    expect(compra.totalCents).toBe(14_800)

    const produtos = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ id: string; stock: number; cost_price_cents: string }[]>`
        SELECT id, stock, cost_price_cents FROM products
         WHERE company_id = ${empresa} AND id IN (${cafe}, ${granel})
      `,
    )
    const porId = new Map(produtos.map((p) => [p.id, p]))
    expect(porId.get(cafe)).toMatchObject({ stock: 20 })
    expect(Number(porId.get(cafe)!.cost_price_cents)).toBe(1100)
    expect(porId.get(granel)).toMatchObject({ stock: 0 })
    expect(Number(porId.get(granel)!.cost_price_cents)).toBe(700)

    const trilha = await withTenant(
      sql,
      empresa,
      (tx) => tx<
        { product_id: string; kind: string; purchase_id: string; balance_after: number }[]
      >`
        SELECT product_id, kind, purchase_id, balance_after FROM inventory_movements
         WHERE company_id = ${empresa} AND purchase_id = ${compra.id}
      `,
    )
    expect(trilha).toEqual([
      { product_id: cafe, kind: 'purchase', purchase_id: compra.id, balance_after: 20 },
    ])

    const contas = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ amount_cents: string; due_date: Date; description: string }[]>`
        SELECT amount_cents, due_date, description FROM payables
         WHERE company_id = ${empresa} AND supplier = 'Distribuidora Boa'
         ORDER BY due_date
      `,
    )
    expect(contas.map((c) => Number(c.amount_cents))).toEqual([7400, 7400])
    expect(contas[0]!.description).toBe('Compra de mercadoria NF 555')

    const lista = await createPurchaseQueries(sql).list(empresa, 10)
    expect(lista[0]).toMatchObject({ id: compra.id, installments: 2 })
    expect(lista[0]!.items).toHaveLength(2)
  })

  it('linha de compra na trilha exige a compra de origem', async () => {
    const cafe = await produto(1, 100)
    await expect(
      withTenant(
        sql,
        empresa,
        (tx) => tx`
          INSERT INTO inventory_movements
            (company_id, product_id, kind, quantity_delta, balance_after, created_by)
          VALUES (${empresa}, ${cafe}, 'purchase', 1, 2, ${usuario})
        `,
      ),
    ).rejects.toThrow(/inventory_movements_origem_declarada/)
  })
})
