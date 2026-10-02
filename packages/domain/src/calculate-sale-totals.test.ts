import { describe, expect, it } from 'vitest'
import { calculateSaleTotals } from './calculate-sale-totals.js'
import { DomainError } from './domain-error.js'
import type { CardFeeTable } from './types/card-fee-table.js'
import type { PaymentInput } from './types/payment-input.js'
import type { SaleItemInput } from './types/sale-item-input.js'
import type { TaxRules } from './types/tax-rules.js'
import { Money } from '@na-regua/money'

const at = new Date('2026-08-28T15:00:00.000Z')

const simples: TaxRules = { regime: 'simples_nacional', defaultRate: 6 }

const fees: CardFeeTable = {
  rates: [
    { brand: 'visa', installments: 1, feeRatePercent: 3 },
    { brand: 'visa', installments: 3, feeRatePercent: 3 },
    { brand: 'unknown', installments: 1, feeRatePercent: 3 },
  ],
}

function saleItem(overrides: Partial<SaleItemInput> = {}): SaleItemInput {
  return {
    productId: 'sku-1',
    quantity: 1,
    unitPrice: Money.parse('300.00'),
    unitCost: Money.parse('180.00'),
    ...overrides,
  }
}

function pay(
  method: PaymentInput['method'],
  amount: string,
  extra: Partial<PaymentInput> = {},
): PaymentInput {
  return { method, amount: Money.parse(amount), ...extra }
}

describe('calculateSaleTotals — RF-040 / US-020', () => {
  it('calcula bruto, custo, imposto, tarifa, liquido e margem', () => {
    const totals = calculateSaleTotals(
      [saleItem()],
      [pay('credit', '300.00', { installments: 3, brand: 'visa' })],
      simples,
      fees,
      at,
    )

    expect(totals.grossAmount.toDecimalString()).toBe('300.00')
    expect(totals.costAmount.toDecimalString()).toBe('180.00')
    expect(totals.taxAmount.toDecimalString()).toBe('18.00')
    expect(totals.cardFeeAmount.toDecimalString()).toBe('9.00')
    expect(totals.netAmount.toDecimalString()).toBe('273.00')
    expect(totals.marginAmount.toDecimalString()).toBe('93.00')
    expect(totals.marginRate).toBe(31)
  })

  it('usa a aliquota configurada do simples nacional', () => {
    const totals = calculateSaleTotals(
      [saleItem({ unitPrice: Money.parse('100.00'), unitCost: Money.parse('40.00') })],
      [pay('pix', '100.00')],
      simples,
      fees,
      at,
    )
    expect(totals.taxAmount.toDecimalString()).toBe('6.00')
    expect(totals.cardFeeAmount.isZero()).toBe(true)
  })

  it('debito cobra tarifa de 1x', () => {
    const totals = calculateSaleTotals(
      [saleItem({ unitPrice: Money.parse('100.00'), unitCost: Money.parse('40.00') })],
      [pay('debit', '100.00', { brand: 'visa' })],
      simples,
      fees,
      at,
    )
    expect(totals.cardFeeAmount.toDecimalString()).toBe('3.00')
  })

  it('recusa debito parcelado', () => {
    try {
      calculateSaleTotals(
        [saleItem({ unitPrice: Money.parse('100.00'), unitCost: Money.parse('40.00') })],
        [pay('debit', '100.00', { installments: 3, brand: 'visa' })],
        simples,
        fees,
        at,
      )
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_INSTALLMENTS' })
    }
  })

  it('credito sem parcelas e 1x', () => {
    const totals = calculateSaleTotals(
      [saleItem()],
      [pay('credit', '300.00', { brand: 'visa' })],
      simples,
      fees,
      at,
    )
    expect(totals.cardFeeAmount.toDecimalString()).toBe('9.00')
  })

  it('bruto zero devolve margem percentual zero', () => {
    const totals = calculateSaleTotals(
      [saleItem({ unitPrice: Money.zero(), unitCost: Money.zero() })],
      [pay('pix', '0.00')],
      simples,
      fees,
      at,
    )
    expect(totals.marginRate).toBe(0)
  })

  it('cash, pix e wallet nao geram tarifa — D9', () => {
    const items = [saleItem({ unitPrice: Money.parse('100.00'), unitCost: Money.parse('40.00') })]
    for (const method of ['cash', 'pix', 'wallet'] as const) {
      const totals = calculateSaleTotals(items, [pay(method, '100.00')], simples, fees, at)
      expect(totals.cardFeeAmount.isZero()).toBe(true)
    }
  })

  it('aceita pagamento misto desde que a soma seja o bruto', () => {
    const totals = calculateSaleTotals(
      [saleItem({ unitPrice: Money.parse('100.00'), unitCost: Money.parse('40.00') })],
      [pay('pix', '60.00'), pay('credit', '40.00', { installments: 1, brand: 'visa' })],
      simples,
      fees,
      at,
    )
    expect(totals.grossAmount.toDecimalString()).toBe('100.00')
    expect(totals.cardFeeAmount.toDecimalString()).toBe('1.20')
  })

  it('recusa lista de itens vazia', () => {
    try {
      calculateSaleTotals([], [pay('pix', '10.00')], simples, fees, at)
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'EMPTY_ITEMS' })
    }
  })

  it('recusa lista de pagamentos vazia', () => {
    try {
      calculateSaleTotals([saleItem()], [], simples, fees, at)
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'EMPTY_PAYMENTS' })
    }
  })

  it('recusa soma de pagamentos diferente do bruto', () => {
    try {
      calculateSaleTotals([saleItem()], [pay('pix', '10.00')], simples, fees, at)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError)
      expect(error).toMatchObject({ code: 'PAYMENT_TOTAL_MISMATCH' })
    }
  })

  it('recusa quantidade invalida', () => {
    try {
      calculateSaleTotals([saleItem({ quantity: 0 })], [pay('pix', '300.00')], simples, fees, at)
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_QUANTITY' })
    }
  })

  it('liquido + imposto + tarifa e sempre o bruto', () => {
    const rates: CardFeeTable = {
      rates: Array.from({ length: 12 }, (_, index) => ({
        brand: 'visa' as const,
        installments: index + 1,
        feeRatePercent: 3.49,
      })),
    }

    for (let cents = 1; cents <= 150; cents++) {
      const price = Money.fromCents(cents)
      const items = [saleItem({ unitPrice: price, unitCost: Money.zero(), quantity: 1 })]
      const payments = [pay('credit', price.toDecimalString(), { installments: 3, brand: 'visa' })]
      const totals = calculateSaleTotals(items, payments, simples, rates, at)
      expect(
        totals.netAmount.add(totals.taxAmount).add(totals.cardFeeAmount).equals(totals.grossAmount),
      ).toBe(true)
    }
  })
})

describe('desconto no total — RF-031', () => {
  it('os pagamentos fecham o total com desconto, e o bruto fica', () => {
    const totals = calculateSaleTotals(
      [saleItem()],
      [pay('cash', '270.00')],
      simples,
      fees,
      at,
      Money.parse('30.00'),
    )

    expect(totals.grossAmount.toDecimalString()).toBe('300.00')
    /* 6% sobre os 270 cobrados, e nao sobre os 300 de tabela. */
    expect(totals.taxAmount.toDecimalString()).toBe('16.20')
    expect(totals.netAmount.toDecimalString()).toBe('253.80')
  })

  it('recusa pagamento que fecha o bruto quando houve desconto', () => {
    expect(() =>
      calculateSaleTotals(
        [saleItem()],
        [pay('pix', '300.00')],
        simples,
        fees,
        at,
        Money.parse('30.00'),
      ),
    ).toThrow(/total com desconto/)
  })

  it('recusa desconto maior que a venda', () => {
    expect(() =>
      calculateSaleTotals(
        [saleItem()],
        [pay('pix', '0.00')],
        simples,
        fees,
        at,
        Money.parse('300.01'),
      ),
    ).toThrow(DomainError)
  })
})
