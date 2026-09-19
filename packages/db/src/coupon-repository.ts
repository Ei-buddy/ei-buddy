import type { Coupon, CouponKind } from '@na-regua/contracts'
import type { CouponRepository } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withPlatformScope } from './tenant.js'

/**
 * Cupons de parceiro — NR-063, RF-114, RF-115, DEC-012.
 *
 * `withPlatformScope`, e nao `withTenant`, pelo mesmo motivo da lista de
 * espera: quem digita o cupom esta no CADASTRO e ainda nao tem empresa. A
 * tabela nao tem `company_id` nem RLS, como o schema registra.
 *
 * Nenhuma migration: `coupons` existe desde a `0007`, com o CHECK que torna
 * `percent` e `amount_cents` mutuamente exclusivos e o indice unico de codigo
 * `WHERE deleted_at IS NULL`.
 */

type Linha = {
  id: string
  code: string
  kind: string
  percent: string | number | null
  amount_cents: string | number | null
  expires_at: Date | null
  revoked_at: Date | null
  discount_cycles: number | null
  max_redemptions: number | null
  redeemed_count: number | string
}

/**
 * `numeric` e `bigint` voltam como STRING no driver, e nao como numero.
 *
 * Sao os tipos que nao cabem em `number` com seguranca, e o postgres.js
 * prefere nao decidir por nos. A conversao acontece na borda, aqui — deixar a
 * string vazar faria `percent * 1` funcionar e `percent + 1` concatenar.
 */
const numero = (v: string | number | null): number | null =>
  v === null ? null : typeof v === 'number' ? v : Number(v)

const paraSaida = (l: Linha): Coupon => ({
  id: l.id,
  code: l.code,
  kind: l.kind as CouponKind,
  percent: numero(l.percent),
  amountCents: numero(l.amount_cents),
  expiresAt: l.expires_at === null ? null : l.expires_at.toISOString(),
  revokedAt: l.revoked_at === null ? null : l.revoked_at.toISOString(),
  discountCycles: l.discount_cycles,
  maxRedemptions: l.max_redemptions,
  redeemedCount: Number(l.redeemed_count),
})

export function createCouponRepository(sql: Sql): CouponRepository {
  return {
    findByCode: async (code) => {
      const [linha] = await withPlatformScope(
        sql,
        (tx) => tx<Linha[]>`
          SELECT id, code, kind, percent, amount_cents, expires_at, revoked_at,
                 discount_cycles, max_redemptions, redeemed_count
            FROM coupons
           WHERE code = ${code}
             AND deleted_at IS NULL
        `,
      )
      return linha === undefined ? undefined : paraSaida(linha)
    },
  }
}
