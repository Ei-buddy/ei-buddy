import { calculateCardFeeAmount, isCardPayment } from './calculate-card-fee.js'
import { calculateInstallmentPlan, resolveInstallmentCount } from './calculate-installment-plan.js'
import { calculateTax } from './calculate-tax.js'
import { DomainError } from './domain-error.js'
import type { CardFeeTable } from './types/card-fee-table.js'
import type { PaymentInput } from './types/payment-input.js'
import type { SaleItemInput } from './types/sale-item-input.js'
import type { SaleTotals } from './types/sale-totals.js'
import type { TaxRules } from './types/tax-rules.js'
import { Money } from '@na-regua/money'

function assertValidItems(items: readonly SaleItemInput[]): void {
  if (items.length === 0) {
    throw new DomainError('EMPTY_ITEMS', 'A venda precisa ter pelo menos um item')
  }
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new DomainError('INVALID_QUANTITY', 'Quantidade do item deve ser um inteiro >= 1')
    }
  }
}

function sumItemField(items: readonly SaleItemInput[], field: 'unitPrice' | 'unitCost'): Money {
  return Money.sum(items.map((item) => item[field].multiply(item.quantity)))
}

/**
 * Margem sobre o bruto, em pontos por cem, truncada em 4 casas. D1
 * Zero no denominador devolve 0 — item de cobertura, venda vazia ja foi recusada.
 */
function marginRatePercent(marginAmount: Money, grossAmount: Money): number {
  if (grossAmount.isZero()) {
    return 0
  }
  const scaled = (marginAmount.cents * 1_000_000n) / grossAmount.cents
  return Number(scaled) / 10_000
}

function calculatePaymentsCardFee(
  payments: readonly PaymentInput[],
  cardFees: CardFeeTable,
  at: Date,
): Money {
  return Money.sum(
    payments.map((payment) => {
      if (!isCardPayment(payment.method)) {
        return Money.zero()
      }
      if (payment.method === 'credit') {
        return calculateInstallmentPlan(payment, cardFees, at).cardFeeAmount
      }
      const installments = resolveInstallmentCount(payment)
      return calculateCardFeeAmount(payment.amount, cardFees, payment.brand, installments)
    }),
  )
}

/**
 * Calculadora da venda. Pura: data, regras e tarifas entram por parametro.
 * RF-040, RF-041. Quem orquestra (core) chama depois NR-022.
 */
export function calculateSaleTotals(
  items: SaleItemInput[],
  payments: PaymentInput[],
  taxRules: TaxRules,
  cardFees: CardFeeTable,
  at: Date,
  /**
   * Desconto no total, ja validado contra a alcada (`applyDiscount`) — RF-031.
   * Os pagamentos fecham o bruto MENOS ele, e o imposto incide sobre o que foi
   * de fato cobrado: desconto incondicional sai da base do Simples.
   */
  discount: Money = Money.zero(),
): SaleTotals {
  assertValidItems(items)

  if (payments.length === 0) {
    throw new DomainError('EMPTY_PAYMENTS', 'A venda precisa ter pelo menos um pagamento')
  }

  const grossAmount = sumItemField(items, 'unitPrice')
  const costAmount = sumItemField(items, 'unitCost')
  const paidAmount = Money.sum(payments.map((payment) => payment.amount))

  if (discount.isNegative() || discount.compare(grossAmount) === 1) {
    throw new DomainError(
      'DISCOUNT_EXCEEDS_TOTAL',
      `Desconto de ${discount.format()} e maior que o total de ${grossAmount.format()}`,
    )
  }
  const chargedAmount = grossAmount.subtract(discount)

  if (!paidAmount.equals(chargedAmount)) {
    throw new DomainError(
      'PAYMENT_TOTAL_MISMATCH',
      discount.isZero()
        ? `A soma dos pagamentos (${paidAmount.format()}) deve ser igual ao bruto (${grossAmount.format()})`
        : `A soma dos pagamentos (${paidAmount.format()}) deve ser igual ao total com desconto (${chargedAmount.format()})`,
    )
  }

  const taxAmount = proporcional(calculateTax(items, taxRules), chargedAmount, grossAmount)
  const cardFeeAmount = calculatePaymentsCardFee(payments, cardFees, at)
  const netAmount = chargedAmount.subtract(taxAmount).subtract(cardFeeAmount)
  const marginAmount = netAmount.subtract(costAmount)

  return {
    grossAmount,
    costAmount,
    taxAmount,
    cardFeeAmount,
    netAmount,
    marginAmount,
    marginRate: marginRatePercent(marginAmount, chargedAmount),
  }
}

/**
 * `valor * parte / todo`, arredondado ao centavo mais proximo.
 *
 * O imposto e calculado item a item sobre o preco cheio; com desconto no
 * total, ele cai na mesma proporcao do que foi cobrado. Sem desconto,
 * `parte === todo` e o valor volta intacto.
 */
function proporcional(valor: Money, parte: Money, todo: Money): Money {
  if (todo.isZero() || parte.equals(todo)) return valor
  return Money.fromCents((valor.cents * parte.cents * 2n + todo.cents) / (todo.cents * 2n))
}
