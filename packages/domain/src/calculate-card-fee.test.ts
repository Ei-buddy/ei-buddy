import { describe, expect, it } from 'vitest'
import {
  calculateCardFeeAmount,
  calculateDebitFeeAmount,
  calculatePixFeeAmount,
  lookupCardFeeRate,
} from './calculate-card-fee.js'
import { DomainError } from './domain-error.js'
import type { CardFeeTable } from './types/card-fee-table.js'
import { Money } from '@na-regua/money'

const table: CardFeeTable = {
  rates: [
    { brand: 'visa', installments: 1, feeRatePercent: 2 },
    { brand: 'visa', installments: 3, feeRatePercent: 3 },
    { brand: 'mastercard', installments: 3, feeRatePercent: 5 },
    { brand: 'unknown', installments: 1, feeRatePercent: 4 },
  ],
}

describe('lookupCardFeeRate — D5', () => {
  it('acerta a tarifa da bandeira e do numero de parcelas', () => {
    expect(lookupCardFeeRate(table, 'visa', 3).feeRatePercent).toBe(3)
  })

  it('bandeira ausente usa a entrada unknown', () => {
    expect(lookupCardFeeRate(table, undefined, 1).feeRatePercent).toBe(4)
  })

  it('bandeira desconhecida sem entrada unknown usa a pior taxa daquele parcelamento', () => {
    expect(lookupCardFeeRate(table, 'elo', 3).feeRatePercent).toBe(5)
  })

  it('entrada unknown ausente para aquele parcelamento tambem usa a pior taxa', () => {
    expect(lookupCardFeeRate(table, 'unknown', 3).feeRatePercent).toBe(5)
  })

  it('recusa quando nao ha tarifa para o numero de parcelas', () => {
    expect(() => lookupCardFeeRate(table, 'visa', 12)).toThrow(DomainError)
    try {
      lookupCardFeeRate(table, 'visa', 12)
    } catch (error) {
      expect(error).toMatchObject({ code: 'CARD_FEE_NOT_FOUND' })
    }
  })
})

describe('calculateCardFeeAmount', () => {
  it('aplica o percentual sobre o valor', () => {
    const fee = calculateCardFeeAmount(Money.parse('100.00'), table, 'visa', 1)
    expect(fee.toDecimalString()).toBe('2.00')
  })
})

describe('taxas de debito e Pix configuradas pela loja — DEC-027', () => {
  const tabela = {
    rates: [{ brand: 'unknown' as const, installments: 1, feeRatePercent: 3 }],
    debitRates: [
      { brand: 'unknown' as const, feeRatePercent: 1.5 },
      { brand: 'elo' as const, feeRatePercent: 2 },
    ],
    pixFeePercent: 0.99,
  }

  it('debito usa a tabela de debito, com a bandeira quando houver', () => {
    expect(calculateDebitFeeAmount(Money.fromCents(10_000n), tabela, 'visa').cents).toBe(150n)
    expect(calculateDebitFeeAmount(Money.fromCents(10_000n), tabela, 'elo').cents).toBe(200n)
    expect(calculateDebitFeeAmount(Money.fromCents(10_000n), tabela, undefined).cents).toBe(150n)
  })

  it('sem tabela de debito, usa o credito 1x — a regra de antes', () => {
    const antiga = { rates: tabela.rates }
    expect(calculateDebitFeeAmount(Money.fromCents(10_000n), antiga, 'visa').cents).toBe(300n)
  })

  it('Pix com taxa configurada; sem ela, zero', () => {
    expect(calculatePixFeeAmount(Money.fromCents(10_000n), tabela).cents).toBe(99n)
    expect(calculatePixFeeAmount(Money.fromCents(10_000n), { rates: [] }).cents).toBe(0n)
  })
})
