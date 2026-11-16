import { describe, expect, it } from 'vitest'
import {
  brandFeeOverrideSchema,
  feePercentSchema,
  MAX_PARCELAS_DA_TABELA,
  paymentFeeSettingsInputSchema,
  paymentFeeSettingsOutputSchema,
} from './fee-settings.js'

/** Taxas de recebimento da loja — DEC-027 (NR-223). */

const VALIDA = {
  pixFeePercent: 0.99,
  debitFeePercent: 1.49,
  creditFeePercents: [2.99, 4.5],
  debitSettlementDays: 1,
  creditSettlementDays: 30,
  anticipation: { enabled: false, monthlyRatePercent: null },
}

describe('feePercentSchema', () => {
  it('aceita de 0 a 30% com ate duas casas', () => {
    for (const v of [0, 0.99, 2.5, 19.5, 30])
      expect(feePercentSchema.safeParse(v).success, `${v}`).toBe(true)
  })

  it('recusa negativa, acima de 30% e tres casas', () => {
    for (const v of [-0.01, 30.01, 1.999])
      expect(feePercentSchema.safeParse(v).success, `${v}`).toBe(false)
  })
})

describe('brandFeeOverrideSchema', () => {
  it('credito parcelado por bandeira', () => {
    expect(
      brandFeeOverrideSchema.safeParse({
        brand: 'amex',
        method: 'credit',
        installments: 6,
        feePercent: 9,
      }).success,
    ).toBe(true)
  })

  it('debito so em 1x; bandeira "unknown" nao e excecao', () => {
    expect(
      brandFeeOverrideSchema.safeParse({
        brand: 'visa',
        method: 'debit',
        installments: 2,
        feePercent: 2,
      }).success,
    ).toBe(false)
    expect(
      brandFeeOverrideSchema.safeParse({
        brand: 'unknown',
        method: 'credit',
        installments: 1,
        feePercent: 2,
      }).success,
    ).toBe(false)
  })
})

describe('paymentFeeSettingsInputSchema', () => {
  it('sem excecoes de bandeira, a lista vem vazia', () => {
    const r = paymentFeeSettingsInputSchema.parse(VALIDA)
    expect(r.brandOverrides).toEqual([])
  })

  it('credito: pelo menos o 1x e no maximo 12x', () => {
    expect(
      paymentFeeSettingsInputSchema.safeParse({ ...VALIDA, creditFeePercents: [] }).success,
    ).toBe(false)
    const treze = Array.from({ length: MAX_PARCELAS_DA_TABELA + 1 }, () => 3)
    expect(
      paymentFeeSettingsInputSchema.safeParse({ ...VALIDA, creditFeePercents: treze }).success,
    ).toBe(false)
  })

  it('prazo de repasse inteiro, de 0 a 60 dias', () => {
    expect(
      paymentFeeSettingsInputSchema.safeParse({ ...VALIDA, debitSettlementDays: 1.5 }).success,
    ).toBe(false)
    expect(
      paymentFeeSettingsInputSchema.safeParse({ ...VALIDA, creditSettlementDays: 61 }).success,
    ).toBe(false)
    expect(
      paymentFeeSettingsInputSchema.safeParse({ ...VALIDA, debitSettlementDays: 0 }).success,
    ).toBe(true)
  })

  it('recusa a mesma bandeira e parcela duas vezes', () => {
    const o = { brand: 'elo', method: 'credit', installments: 2, feePercent: 5 }
    const r = paymentFeeSettingsInputSchema.safeParse({
      ...VALIDA,
      brandOverrides: [o, { ...o, feePercent: 6 }],
    })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toEqual(['brandOverrides'])
  })

  it('campo a mais e recusado (nada de gravar o que a tela inventou)', () => {
    expect(paymentFeeSettingsInputSchema.safeParse({ ...VALIDA, isDefault: true }).success).toBe(
      false,
    )
  })
})

describe('paymentFeeSettingsOutputSchema', () => {
  it('a padrao sai com isDefault e sem data', () => {
    expect(
      paymentFeeSettingsOutputSchema.parse({
        ...VALIDA,
        brandOverrides: [],
        isDefault: true,
        updatedAt: null,
      }),
    ).toMatchObject({ isDefault: true, updatedAt: null })
  })
})
