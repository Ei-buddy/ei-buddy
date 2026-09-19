import type { CouponLookup, CouponReferrerKind, CouponRejectionCode } from '@na-regua/contracts'
import type { CouponRepository } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withPlatformScope } from './tenant.js'

/**
 * Cupons — NR-063, RF-114, RF-115, ADR-0013.
 *
 * **Chama `coupon_lookup`, e nunca a tabela.** `coupons` tem RLS forcada sem
 * politica permissiva (migration 0014): um `SELECT` direto daqui nao devolve
 * linha nenhuma pelo papel da aplicacao — e falha em silencio, devolvendo
 * vazio como se o cupom nao existisse. A funcao e `SECURITY DEFINER` com
 * retorno minimo, que e o que torna a consulta publica por codigo aceitavel.
 *
 * `withPlatformScope` e nao `withTenant` pelo mesmo motivo da lista de espera:
 * quem digita o cupom esta no cadastro e ainda nao tem empresa.
 */

type Linha = {
  coupon_id: string
  kind: string
  referrer_label: string | null
  active: boolean
  discount_percent: string | number
  reason: string
}

const paraSaida = (l: Linha): CouponLookup => ({
  couponId: l.coupon_id,
  kind: l.kind as CouponReferrerKind,
  /* A funcao faz `COALESCE(p.name, oc.trade_name, oc.legal_name)`, e as tres
     podem ser nulas numa linha orfa. O contrato exige texto, entao o fallback
     acontece aqui — a tela diria "indicado por null". */
  referrerLabel: l.referrer_label ?? 'Parceiro',
  active: l.active,
  /* `numeric` volta STRING no driver: e o tipo que nao cabe em `number` com
     seguranca, e o postgres.js prefere nao decidir por nos. Sem a conversao,
     `percentage("30")` receberia texto. */
  discountPercent: Number(l.discount_percent),
  reason: l.reason as 'ok' | CouponRejectionCode,
})

export function createCouponRepository(sql: Sql): CouponRepository {
  return {
    lookup: async (code) => {
      const [linha] = await withPlatformScope(
        sql,
        (tx) => tx<Linha[]>`SELECT * FROM coupon_lookup(${code})`,
      )
      return linha === undefined ? undefined : paraSaida(linha)
    },
  }
}
