import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createQuoteRepository } from './quote-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Orcamentos no banco — NR-159. O que so o SQL garante: numero por loja sem
 * repetir, itens na ordem montada com os dados atuais do produto, e fechar so
 * o que esta aberto.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('orcamentos — NR-159', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let usuario: string
  let produtoA: string
  let produtoB: string
  let repo: ReturnType<typeof createQuoteRepository>

  async function produto(nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO products
          (id, company_id, description, internal_code, unit_of_measure,
           sale_price_cents, cost_price_cents, stock)
        VALUES (${id}, ${empresa}, ${nome}, ${`Q-${id.slice(0, 8)}`}, 'un', 2000, 900, 7)
      `,
    )
    return id
  }

  const novo = (itens: string[]) => ({
    companyId: empresa,
    customerName: 'Joana',
    validUntil: '2026-10-20',
    notes: null,
    discountCents: 0,
    totalCents: 4000,
    items: itens.map((productId, i) => ({
      productId,
      description: `Item ${i + 1}`,
      quantity: 1,
      unitPriceCents: 2000,
    })),
    createdBy: usuario,
    createdAt: new Date(),
  })

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql
    repo = createQuoteRepository(sql)

    empresa = randomUUID()
    const cnpj = cnpjDeTeste('4')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, 'Loja Orcamento', ${cnpj}, ${`x@${cnpj}.local`}, '41999990000')
      `,
    )
    usuario = randomUUID()
    await withTenant(sql, empresa, async (tx) => {
      await tx`INSERT INTO users (id, name, email) VALUES (${usuario}, 'Dono', ${`d${usuario}@local`})`
      await tx`INSERT INTO company_users (company_id, user_id, role) VALUES (${empresa}, ${usuario}, 'owner')`
    })
    produtoA = await produto('Tinta')
    produtoB = await produto('Rolo')
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('numera por loja sem repetir, mesmo em paralelo', async () => {
    const feitos = await Promise.all([1, 2, 3].map(() => repo.create(novo([produtoA]))))
    expect(feitos.map((q) => q.number).sort()).toEqual([1, 2, 3])
  })

  it('itens na ordem montada, com o codigo e o saldo atuais', async () => {
    const q = await repo.create(novo([produtoB, produtoA]))
    expect(q.items.map((i) => i.description)).toEqual(['Item 1', 'Item 2'])
    expect(q.items[0]).toMatchObject({ productId: produtoB, stock: 7, costPriceCents: 900 })
    expect(q.validUntil).toBe('2026-10-20')

    const lida = await repo.findById(empresa, q.id)
    expect(lida?.items.map((i) => i.productId)).toEqual([produtoB, produtoA])
    expect(await repo.findById(empresa, 'nao-e-uuid')).toBeNull()
  })

  it('fecha so o que esta aberto, e convertido exige a venda', async () => {
    const q = await repo.create(novo([produtoA]))
    const cancelado = await repo.close(empresa, q.id, {
      status: 'cancelled',
      saleId: null,
      closedAt: new Date(),
    })
    expect(cancelado?.status).toBe('cancelled')
    expect(
      await repo.close(empresa, q.id, { status: 'cancelled', saleId: null, closedAt: new Date() }),
    ).toBeNull()

    const outro = await repo.create(novo([produtoA]))
    await expect(
      repo.close(empresa, outro.id, { status: 'converted', saleId: null, closedAt: new Date() }),
    ).rejects.toThrow(/quotes_desfecho_completo/)
  })

  it('venda inexistente ou de outra loja nao existe', async () => {
    expect(await repo.saleExists(empresa, randomUUID())).toBe(false)
    expect(await repo.saleExists(empresa, 'x')).toBe(false)
  })
})
