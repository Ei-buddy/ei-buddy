import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createRestockQueries } from './restock-queries.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Candidatos a reposicao — achado do QA. O que so o banco prova: o vendido e
 * da janela, sem venda cancelada e sem o que voltou na devolucao, e o produto
 * negativo ou abaixo do minimo entra mesmo sem venda.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('reposicao — candidatos', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let numero = 1

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresa = randomUUID()
    const cnpj = cnpjDeTeste('7')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, ${'Loja da Reposicao'}, ${cnpj}, ${'r@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  async function produto(nome: string, stock: number, minStock = 0): Promise<string> {
    const [p] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO products
          (company_id, description, internal_code, unit_of_measure, sale_price_cents, stock, min_stock)
        VALUES (${empresa}, ${nome}, ${'R-' + nome}, 'un', 1000, ${stock}, ${minStock})
        RETURNING id
      `,
    )
    return p!.id
  }

  async function venda(
    produtoId: string,
    quantidade: number,
    dia: string,
    opcoes: { status?: string; devolvido?: number } = {},
  ) {
    await withTenant(sql, empresa, async (tx) => {
      const [s] = await tx<{ id: string }[]>`
        INSERT INTO sales
          (company_id, number, status, gross_amount_cents, discount_cents, net_amount_cents,
           created_at, cancelled_at)
        VALUES (${empresa}, ${numero++}, ${opcoes.status ?? 'settled'}, 1000, 0, 1000, ${dia},
                ${opcoes.status === 'cancelled' ? dia : null})
        RETURNING id
      `
      await tx`
        INSERT INTO sale_items
          (company_id, sale_id, product_id, description, unit_of_measure, quantity,
           returned_quantity, unit_price_cents, total_cents)
        VALUES (${empresa}, ${s!.id}, ${produtoId}, 'item', 'un', ${quantidade},
                ${opcoes.devolvido ?? 0}, 1000, ${quantidade * 1000})
      `
    })
  }

  it('soma o vendido da janela, sem cancelada e sem devolvido', async () => {
    const arroz = await produto('Arroz', 2)
    await venda(arroz, 10, '2026-10-01T15:00:00Z')
    await venda(arroz, 5, '2026-10-02T15:00:00Z', { devolvido: 2 })
    await venda(arroz, 99, '2026-10-03T15:00:00Z', { status: 'cancelled' })
    /* Antes da janela: fora. */
    await venda(arroz, 50, '2026-01-10T15:00:00Z')

    const sem = await produto('Sem venda nem minimo', 5)
    const negativo = await produto('Negativo', -4)
    const abaixo = await produto('Abaixo do minimo', 1, 6)

    const r = await createRestockQueries(sql).candidates(empresa, '2026-05-05')
    const porId = new Map(r.map((c) => [c.productId, c]))

    expect(porId.get(arroz)?.vendido).toBe(13)
    expect(porId.has(sem)).toBe(false)
    expect(porId.get(negativo)).toMatchObject({ stock: -4, vendido: 0 })
    expect(porId.get(abaixo)).toMatchObject({ stock: 1, minStock: 6 })
  })
})
