import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCouponRepository } from './coupon-repository.js'
import { migrate } from './migrate.js'
import { conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withPlatformScope } from './tenant.js'

/**
 * Cupons de parceiro no banco — NR-063, RF-114, RF-115.
 *
 * Sem migration: `coupons` existe desde a `0007`. O que se prova aqui e o que
 * o driver e o SQL podem errar, e nao a regra — essa ja esta em
 * `core/subscriptions/cupom.test.ts`:
 *
 *   - `numeric` e `bigint` voltam STRING, e precisam virar numero na borda;
 *   - cupom apagado responde como inexistente;
 *   - a busca e pelo codigo exato.
 *
 * Como as outras suites de `db`: pulada sem `DATABASE_URL`, executada na CI.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('cupons — NR-063', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let parceiro: string

  async function criarCupom(valores: {
    code: string
    kind: 'percent' | 'amount'
    percent?: number | null
    amountCents?: number | null
    maxRedemptions?: number | null
    apagado?: boolean
  }): Promise<void> {
    await withPlatformScope(
      sql,
      (tx) => tx`
        INSERT INTO coupons (partner_id, code, kind, percent, amount_cents,
                             max_redemptions, deleted_at)
        VALUES (
          ${parceiro}, ${valores.code}, ${valores.kind},
          ${valores.percent ?? null}, ${valores.amountCents ?? null},
          ${valores.maxRedemptions ?? null},
          ${valores.apagado === true ? new Date() : null}
        )
      `,
    )
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0007_acrescimos')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    parceiro = randomUUID()
    await withPlatformScope(
      sql,
      (tx) => tx`
        INSERT INTO partners (id, name) VALUES (${parceiro}, ${'Parceiro ' + parceiro.slice(0, 8)})
      `,
    )
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  it('percentual volta como NUMERO, e nao como a string do numeric', async () => {
    const code = `PCT${Date.now()}`
    await criarCupom({ code, kind: 'percent', percent: 10.5 })

    const c = await createCouponRepository(sql).findByCode(code)

    /* `numeric` chega string no postgres.js. Sem a conversao na borda,
       `percent + 1` concatenaria em vez de somar. */
    expect(typeof c?.percent).toBe('number')
    expect(c?.percent).toBe(10.5)
    expect(c?.amountCents).toBeNull()
  })

  it('valor fixo volta como NUMERO, e nao como a string do bigint', async () => {
    const code = `AMT${Date.now()}`
    await criarCupom({ code, kind: 'amount', amountCents: 2000 })

    const c = await createCouponRepository(sql).findByCode(code)

    expect(typeof c?.amountCents).toBe('number')
    expect(c?.amountCents).toBe(2000)
    expect(c?.percent).toBeNull()
  })

  it('a contagem de usos comeca em zero, como numero', async () => {
    const code = `CNT${Date.now()}`
    await criarCupom({ code, kind: 'percent', percent: 5, maxRedemptions: 3 })

    const c = await createCouponRepository(sql).findByCode(code)

    /* `redeemedCount >= maxRedemptions` com string do lado esquerdo compararia
       texto — e "10" seria menor que "3". */
    expect(c?.redeemedCount).toBe(0)
    expect(c?.maxRedemptions).toBe(3)
  })

  it('cupom apagado responde como inexistente', async () => {
    const code = `DEL${Date.now()}`
    await criarCupom({ code, kind: 'percent', percent: 10, apagado: true })

    /* Apagado e inexistente sao a mesma coisa para quem digitou; distinguir
       contaria que aquele codigo ja existiu um dia. */
    expect(await createCouponRepository(sql).findByCode(code)).toBeUndefined()
  })

  it('codigo que nao existe responde undefined', async () => {
    expect(await createCouponRepository(sql).findByCode('NAOEXISTE')).toBeUndefined()
  })
})
