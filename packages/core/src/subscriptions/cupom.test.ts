import type { Coupon } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import type { CouponRepository } from '../ports/coupon-repository.js'
import { avaliarCupom } from './cupom.js'
import { previewCoupon } from './preview-coupon.js'

const AGORA = new Date('2026-09-19T13:00:00.000Z')
const PRECO = 8990

const cupom = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'cup_1',
  code: 'PARCEIRO10',
  kind: 'percent',
  percent: 10,
  amountCents: null,
  expiresAt: null,
  revokedAt: null,
  discountCycles: null,
  maxRedemptions: null,
  redeemedCount: 0,
  ...over,
})

describe('a conta do desconto', () => {
  it('percentual sai por Money, e nao por aritmetica de ponto flutuante', () => {
    const r = avaliarCupom(cupom(), PRECO, AGORA)

    if (r.status !== 'applied') throw new Error('esperava aplicado')
    /* 10% de R$ 89,90 = R$ 8,99. Com `preco * taxa / 100` isso vira
       8,989999999 e o centavo se perde em algum arredondamento adiante. */
    expect([r.discountCents, r.finalCents]).toEqual([899, 8091])
  })

  it('valor fixo desconta o valor fixo', () => {
    const r = avaliarCupom(
      cupom({ kind: 'amount', percent: null, amountCents: 2000 }),
      PRECO,
      AGORA,
    )

    if (r.status !== 'applied') throw new Error('esperava aplicado')
    expect([r.discountCents, r.finalCents]).toEqual([2000, 6990])
  })

  it('cupom maior que a mensalidade vira ciclo gratuito, e nao recusa', () => {
    const r = avaliarCupom(
      cupom({ kind: 'amount', percent: null, amountCents: 50000 }),
      PRECO,
      AGORA,
    )

    if (r.status !== 'applied') throw new Error('esperava aplicado')
    /* Recusar seria o parceiro descobrindo pelo lojista que a promocao dele
       nao funciona. O piso e zero, e ninguem paga para assinar. */
    expect([r.discountCents, r.finalCents]).toEqual([PRECO, 0])
  })

  it('100% tambem zera, sem passar do preco', () => {
    const r = avaliarCupom(cupom({ percent: 100 }), PRECO, AGORA)

    if (r.status !== 'applied') throw new Error('esperava aplicado')
    expect(r.finalCents).toBe(0)
  })

  it('carrega em quantos ciclos o desconto vale', () => {
    const r = avaliarCupom(cupom({ discountCycles: 1 }), PRECO, AGORA)

    if (r.status !== 'applied') throw new Error('esperava aplicado')
    /* Nulo = todos os ciclos; 1 = so o primeiro. A tela precisa dizer qual dos
       dois, ou o lojista assina esperando desconto para sempre. */
    expect(r.cycles).toBe(1)
  })
})

describe('as recusas, e a ordem delas — RF-115', () => {
  it('revogado', () => {
    const r = avaliarCupom(cupom({ revokedAt: '2026-08-01T00:00:00.000Z' }), PRECO, AGORA)
    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.rejection.code).toBe('revoked')
  })

  it('vencido', () => {
    const r = avaliarCupom(cupom({ expiresAt: '2026-08-31T23:59:59.000Z' }), PRECO, AGORA)
    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.rejection.code).toBe('expired')
  })

  it('o instante do vencimento ja esta vencido', () => {
    /* `<=` e nao `<`: um cupom que vale "ate as 23:59:59" nao vale as
       23:59:59,000 em ponto. A fronteira tem de ser uma so, ou dois lugares
       do sistema discordam sobre o mesmo segundo. */
    const r = avaliarCupom(cupom({ expiresAt: AGORA.toISOString() }), PRECO, AGORA)
    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.rejection.code).toBe('expired')
  })

  it('esgotado', () => {
    const r = avaliarCupom(cupom({ maxRedemptions: 50, redeemedCount: 50 }), PRECO, AGORA)
    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.rejection.code).toBe('exhausted')
  })

  it('sem cota definida nunca esgota', () => {
    const r = avaliarCupom(cupom({ maxRedemptions: null, redeemedCount: 9999 }), PRECO, AGORA)
    expect(r.status).toBe('applied')
  })

  it('revogado E vencido E esgotado responde REVOGADO', () => {
    /*
     * A ordem e da recusa mais definitiva para a mais circunstancial.
     * Invertida, um cupom revogado no mes passado diria "esgotado", e o
     * lojista ligaria para o parceiro pedindo mais cotas de um codigo morto.
     */
    const r = avaliarCupom(
      cupom({
        revokedAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2026-08-31T00:00:00.000Z',
        maxRedemptions: 1,
        redeemedCount: 1,
      }),
      PRECO,
      AGORA,
    )
    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.rejection.code).toBe('revoked')
  })

  it('vencido E esgotado responde VENCIDO', () => {
    const r = avaliarCupom(
      cupom({ expiresAt: '2026-08-31T00:00:00.000Z', maxRedemptions: 1, redeemedCount: 1 }),
      PRECO,
      AGORA,
    )
    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.rejection.code).toBe('expired')
  })
})

const repositorio = (cupons: readonly Coupon[]): CouponRepository => ({
  findByCode: async (code) => cupons.find((c) => c.code === code),
})

describe('previa do cupom — RF-114', () => {
  it('normaliza caixa e espaco antes de procurar', async () => {
    const deps = { coupons: repositorio([cupom()]), precoDoPlanoCents: PRECO }

    const r = await previewCoupon(deps, { code: '  parceiro10 ', agora: AGORA })

    /* Normalizar aqui, e nao na tela, para que web, mobile e assistente nao
       tenham tres ideias de que "parceiro10 " e. */
    expect(r.status).toBe('applied')
  })

  it('codigo que nao existe recusa com not_found', async () => {
    const deps = { coupons: repositorio([]), precoDoPlanoCents: PRECO }

    const r = await previewCoupon(deps, { code: 'NAOEXISTE', agora: AGORA })

    if (r.status !== 'rejected') throw new Error('esperava recusa')
    expect(r.rejection.code).toBe('not_found')
  })

  it('a previa NAO consome cota', async () => {
    const usado = cupom({ maxRedemptions: 1, redeemedCount: 0 })
    const deps = { coupons: repositorio([usado]), precoDoPlanoCents: PRECO }

    await previewCoupon(deps, { code: 'PARCEIRO10', agora: AGORA })
    const segunda = await previewCoupon(deps, { code: 'PARCEIRO10', agora: AGORA })

    /* Previa que consome cota e o lojista digitando o codigo para ver o preco
       e perdendo o cupom sem assinar. */
    expect(segunda.status).toBe('applied')
    expect(usado.redeemedCount).toBe(0)
  })
})
