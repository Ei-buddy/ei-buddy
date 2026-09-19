/**
 * Regras de negocio puras: precificacao, imposto, tarifa de cartao, parcelamento.
 *
 * Sem I/O, sem framework, sem relogio, sem aleatoriedade — tudo entra por
 * parametro. Ver docs/arquitetura/principios.md#2-domain-e-puro
 */
export { applyDiscount } from './apply-discount.js'
/*
 * Exportados porque `core` precisa da tarifa POR PAGAMENTO, e nao so do total
 * da venda: o recebivel de debito guarda o valor liquido previsto (RF-063), e
 * `calculateSaleTotals` devolve a tarifa somada. `calculateInstallmentPlan`
 * cobre o credito e recusa as outras formas de proposito.
 */
export { calculateCardFeeAmount, isCardPayment } from './calculate-card-fee.js'
export { calculateChange } from './calculate-change.js'
export { calculateInstallmentPlan } from './calculate-installment-plan.js'
export { calculateSaleTotals } from './calculate-sale-totals.js'
export { calcularDre } from './dre.js'
export type { Dre, LancamentoDoPeriodo, TipoDeConta } from './dre.js'
export { DomainError } from './domain-error.js'
export {
  diasEntre,
  diasNoMes,
  estaVencida,
  faixaDeVencimento,
  ocorrenciasDaRecorrencia,
  somarDias,
} from './due-date.js'
export type { FaixaDeVencimento, Frequencia } from './due-date.js'
export { aplicarBaixa, estornarBaixa, situacaoPorValor } from './settlement.js'
export type { ResultadoDaBaixa, SituacaoDoTitulo } from './settlement.js'
export type { DomainErrorCode } from './domain-error.js'
export { DEFAULT_SETTLEMENT_DAYS, MAX_CREDIT_INSTALLMENTS } from './types/card-fee-table.js'
export type { CardBrand, CardFeeRate, CardFeeTable } from './types/card-fee-table.js'
export type { Discount, DiscountPolicy, DiscountResult } from './types/discount.js'
export type { Installment, InstallmentPlan } from './types/installment-plan.js'
export type { PaymentInput, PaymentMethod } from './types/payment-input.js'
export type { SaleItemInput } from './types/sale-item-input.js'
export type { SaleTotals } from './types/sale-totals.js'
export type { TaxRegime, TaxRules } from './types/tax-rules.js'

/* CST/CSOSN e o regime que decide qual vale — RF-003, RF-046, NR-042. */
export {
  porQueNaoCombina,
  situacaoCombinaComRegime,
  situacaoTributariaPadrao,
  usaCsosn,
} from './situacao-tributaria.js'
export type { RegimeTributario } from './situacao-tributaria.js'
