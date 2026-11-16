import { randomUUID } from 'node:crypto'
import type { PaymentFeeSettingsInput } from '@na-regua/contracts'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createPaymentFeeSettingsRepository } from './payment-fee-settings-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Taxas de recebimento no banco — DEC-027 (NR-223). O que so o SQL garante:
 * uma linha por loja (gravar de novo atualiza), os limites e o isolamento.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

const TAXAS: PaymentFeeSettingsInput = {
  pixFeePercent: 0.99,
  debitFeePercent: 1.49,
  creditFeePercents: [2.99, 4.5, 5.25],
  brandOverrides: [{ brand: 'amex', method: 'credit', installments: 1, feePercent: 3.99 }],
  debitSettlementDays: 1,
  creditSettlementDays: 30,
  anticipation: { enabled: true, monthlyRatePercent: 1.79 },
}

describe.skipIf(!DATABASE_URL)('taxas de recebimento — NR-223', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let lojaA: string
  let lojaB: string

  async function loja(digito: string): Promise<string> {
    const id = randomUUID()
    const cnpj = cnpjDeTeste(digito)
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${'Loja ' + digito}, ${cnpj}, ${'t@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
    return id
  }

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql
    lojaA = await loja('5')
    lojaB = await loja('6')
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  it('loja sem configuracao nao tem linha', async () => {
    const repo = createPaymentFeeSettingsRepository(sql)
    expect(await repo.find(lojaB)).toBeUndefined()
  })

  it('grava e le de volta com os numeros (e nao texto do numeric)', async () => {
    const repo = createPaymentFeeSettingsRepository(sql)
    const at = new Date('2026-11-16T13:00:00.000Z')
    const gravada = await repo.save(lojaA, TAXAS, null as never, at)
    expect(gravada).toEqual({ ...TAXAS, updatedAt: at.toISOString() })
    expect(await repo.find(lojaA)).toEqual(gravada)
  })

  it('gravar de novo atualiza a mesma linha', async () => {
    const repo = createPaymentFeeSettingsRepository(sql)
    const at = new Date('2026-11-16T14:00:00.000Z')
    await repo.save(
      lojaA,
      {
        ...TAXAS,
        pixFeePercent: 0,
        brandOverrides: [],
        anticipation: { enabled: false, monthlyRatePercent: null },
      },
      null as never,
      at,
    )
    const lida = await repo.find(lojaA)
    expect(lida).toMatchObject({
      pixFeePercent: 0,
      brandOverrides: [],
      updatedAt: at.toISOString(),
    })
    expect(lida?.anticipation).toEqual({ enabled: false, monthlyRatePercent: null })
    const [conta] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM payment_fee_settings WHERE company_id = ${lojaA}
    `
    expect(conta?.n).toBe(1)
  })

  it('o banco recusa taxa acima de 30% e lista de credito vazia', async () => {
    const repo = createPaymentFeeSettingsRepository(sql)
    await expect(
      repo.save(lojaB, { ...TAXAS, debitFeePercent: 31 }, null as never, new Date()),
    ).rejects.toThrow()
    await expect(
      repo.save(lojaB, { ...TAXAS, creditFeePercents: [] }, null as never, new Date()),
    ).rejects.toThrow()
    expect(await repo.find(lojaB)).toBeUndefined()
  })

  it('uma loja nao le nem grava a taxa da outra', async () => {
    const vistas = await withTenant(
      sql,
      lojaB,
      (tx) => tx`SELECT company_id FROM payment_fee_settings`,
    )
    expect(vistas.map((l) => l.company_id)).not.toContain(lojaA)
    await expect(
      withTenant(
        sql,
        lojaB,
        (tx) => tx`
          INSERT INTO payment_fee_settings (company_id, pix_fee_percent, debit_fee_percent,
            credit_fee_percents, debit_settlement_days, credit_settlement_days)
          VALUES (${lojaA}, 0, 0, '[1]'::jsonb, 1, 1)
        `,
      ),
    ).rejects.toThrow()
  })
})
