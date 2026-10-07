import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCashRegister } from './cash-register-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * O caixa no banco — NR-157. O que so o SQL garante: um caixa aberto por loja,
 * e as vendas do periodo por forma, sem estornadas e sem as de outra loja.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('caixa — NR-157', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let usuario: string
  let caixa: ReturnType<typeof createCashRegister>

  async function venda(metodo: string, cents: number, at: Date, status = 'settled') {
    await withTenant(sql, empresa, async (tx) => {
      const [s] = await tx<{ id: string }[]>`
        INSERT INTO sales (company_id, number, status, gross_amount_cents, net_amount_cents,
                           created_at, created_by, cancelled_at)
        VALUES (${empresa}, (SELECT COALESCE(MAX(number), 0) + 1 FROM sales
                             WHERE company_id = ${empresa}),
                ${status}, ${cents}, ${cents}, ${at}, ${usuario},
                ${status === 'cancelled' ? at : null})
        RETURNING id
      `
      await tx`
        INSERT INTO payments (company_id, sale_id, method, amount_cents)
        VALUES (${empresa}, ${s!.id}, ${metodo}, ${cents})
      `
    })
  }

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql
    caixa = createCashRegister(sql)

    empresa = randomUUID()
    const cnpj = cnpjDeTeste('2')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, 'Loja Caixa', ${cnpj}, ${`x@${cnpj}.local`}, '41999990000')
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

  it('abre, soma vendas por forma, movimenta e fecha', async () => {
    const abriu = new Date(Date.now() - 60 * 60_000)
    const s = await caixa.open({
      companyId: empresa,
      openingCents: 10_000,
      notes: null,
      openedBy: usuario,
      openedAt: abriu,
    })
    expect(s).not.toBe('ja_aberto')
    if (s === 'ja_aberto') return

    expect(
      await caixa.open({
        companyId: empresa,
        openingCents: 0,
        notes: null,
        openedBy: usuario,
        openedAt: new Date(),
      }),
    ).toBe('ja_aberto')

    await venda('cash', 3_000, new Date(abriu.getTime() + 60_000))
    await venda('pix', 2_000, new Date(abriu.getTime() + 120_000))
    await venda('cash', 9_999, new Date(abriu.getTime() + 180_000), 'cancelled')
    await venda('cash', 7_777, new Date(abriu.getTime() - 60_000))

    await caixa.addMovement(empresa, s.id, {
      kind: 'withdrawal',
      amountCents: 1_000,
      reason: 'Deposito',
      createdBy: usuario,
      createdAt: new Date(),
    })

    const a = await caixa.activity(empresa, s, new Date())
    expect(a.salesByMethod).toEqual([
      { method: 'cash', amountCents: 3_000 },
      { method: 'pix', amountCents: 2_000 },
    ])
    expect(a.salesCount).toBe(2)
    expect(a.movements.map((m) => m.amountCents)).toEqual([1_000])

    const fechado = await caixa.close(empresa, s.id, {
      expectedCents: 12_000,
      countedCents: 11_900,
      notes: 'faltou moeda',
      closedBy: usuario,
      closedAt: new Date(),
    })
    expect(fechado).toMatchObject({ status: 'closed', expectedCents: 12_000, countedCents: 11_900 })
    expect(await caixa.findOpen(empresa)).toBeUndefined()
    expect((await caixa.list(empresa, 10))[0]?.id).toBe(s.id)
  })
})
