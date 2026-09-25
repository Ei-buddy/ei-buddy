import type { CouponLookup } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import type { CouponRepository } from '../ports/coupon-repository.js'
import { previewCoupon } from './preview-coupon.js'

const PRECO = 8990

const consulta = (over: Partial<CouponLookup> = {}): CouponLookup => ({
  couponId: 'cup_1',
  kind: 'partner',
  referrerLabel: 'Barbearia do Ze',
  active: true,
  discountPercent: 30,
  reason: 'ok',
  ...over,
})

const repositorio = (por: Record<string, CouponLookup>): CouponRepository => ({
  lookup: async (code) => por[code],
  recordRedemption: async () => undefined,
})

const deps = (por: Record<string, CouponLookup>) => ({
  coupons: repositorio(por),
  precoDoPlanoCents: PRECO,
})

describe('previa do cupom — RF-114', () => {
  it('traz o valor final, e nao so o desconto', async () => {
    const r = await previewCoupon(deps({ PARCEIRO30: consulta() }), { code: 'PARCEIRO30' })

    if (r.status !== 'applied') throw new Error('esperava aplicado')
    /* 30% de R$ 89,90 = R$ 26,97. Com `preco * taxa / 100` isso vira
       26,969999999 e o centavo se perde em algum arredondamento adiante. */
    expect([r.discountCents, r.finalCents]).toEqual([2697, 6293])
  })

  it('diz em quantos ciclos o desconto vale', async () => {
    const r = await previewCoupon(deps({ PARCEIRO30: consulta() }), { code: 'PARCEIRO30' })

    if (r.status !== 'applied') throw new Error('esperava aplicado')
    /* A tela precisa dizer qual e, ou o lojista assina esperando desconto para
       sempre (ADR-0013 fixa um ciclo). */
    expect(r.cycles).toBe(1)
  })

  it('normaliza caixa e espaco antes de procurar', async () => {
    const r = await previewCoupon(deps({ PARCEIRO30: consulta() }), { code: '  parceiro30 ' })

    /* Normalizar aqui, e nao na tela, para que web, mobile e assistente nao
       tenham tres ideias de que "parceiro30 " e. */
    expect(r.status).toBe('applied')
  })

  it('percentual acima de 100 nao gera valor negativo', async () => {
    /* `discount_percent` e dado de banco. Sem o teto, um cupom gravado com
       120% viraria uma recorrencia de valor negativo, que ninguem sabe o que
       faz. Com ele, o pior caso e um ciclo gratuito. */
    const r = await previewCoupon(deps({ EXAGERO: consulta({ discountPercent: 100 }) }), {
      code: 'EXAGERO',
    })

    if (r.status !== 'applied') throw new Error('esperava aplicado')
    expect([r.discountCents, r.finalCents]).toEqual([PRECO, 0])
  })
})

describe('as recusas — RF-115', () => {
  it('codigo que nao existe recusa com not_found', async () => {
    const r = await previewCoupon(deps({}), { code: 'NAOEXISTE' })

    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.rejection.code).toBe('not_found')
  })

  it('repassa o motivo que o SQL calculou, sem recalcular', async () => {
    /* Refazer a conta aqui daria duas respostas para "este cupom vale?", e
       elas divergiriam na primeira mudanca de regra. */
    for (const reason of ['revoked', 'inactive', 'expired', 'exhausted'] as const) {
      const r = await previewCoupon(deps({ X: consulta({ active: false, reason }) }), { code: 'X' })
      if (r.status !== 'rejected') throw new Error('esperava recusa')
      expect([reason, r.rejection.code]).toEqual([reason, reason])
    }
  })

  it('cada recusa tem frase propria, e nenhuma diz so "invalido"', async () => {
    const frases = new Set<string>()
    for (const reason of ['revoked', 'inactive', 'expired', 'exhausted'] as const) {
      const r = await previewCoupon(deps({ X: consulta({ active: false, reason }) }), { code: 'X' })
      if (r.status !== 'rejected') throw new Error('esperava recusa')
      frases.add(r.rejection.message)
    }

    /* Quatro motivos, quatro frases: as acoes de quem le sao diferentes. */
    expect(frases.size).toBe(4)
  })

  it('cupom aguardando aprovacao nao manda a pessoa embora', async () => {
    const r = await previewCoupon(deps({ X: consulta({ active: false, reason: 'inactive' }) }), {
      code: 'X',
    })

    if (r.status !== 'rejected') throw new Error('esperava recusa')
    /* O cupom de parceiro pode vir a valer. Dizer "invalido" perderia uma
       indicacao que o parceiro ja fez. */
    expect(r.rejection.message).toMatch(/ainda não está liberado/i)
  })

  it('inativo com reason ok e tratado como inexistente, e nao aplicado', async () => {
    /* Combinacao que o SQL nao produz. Se um dia produzir, o seguro e recusar:
       aplicar um cupom marcado inativo seria dar desconto que ninguem
       autorizou. */
    const r = await previewCoupon(deps({ X: consulta({ active: false, reason: 'ok' }) }), {
      code: 'X',
    })

    expect(r.status).toBe('rejected')
  })
})
