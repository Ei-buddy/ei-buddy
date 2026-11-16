export type CardBrand = 'visa' | 'mastercard' | 'elo' | 'amex' | 'hipercard' | 'unknown'

export type CardFeeRate = {
  readonly brand: CardBrand
  readonly installments: number
  /** Em pontos por cem: 3.49 = 3,49%. */
  readonly feeRatePercent: number
}

/**
 * Tabela configurada por empresa. Nao vem da API no fechamento da venda —
 * RNF-003, RNF-041, NR-004. Quem alimenta (lojista ou PagMaxx) e outro modulo.
 */
export type CardFeeTable = {
  /** Credito, por bandeira e numero de parcelas. */
  readonly rates: readonly CardFeeRate[]
  /** Dias ate o primeiro repasse; parcela N vence em N * settlementDays. D6 */
  readonly settlementDays?: number
  /**
   * Debito por bandeira — DEC-027. Ausente = o debito usa a taxa do credito
   * 1x, que era a regra antes de a loja poder configurar.
   */
  readonly debitRates?: readonly { readonly brand: CardBrand; readonly feeRatePercent: number }[]
  /** Dias ate o debito cair. Ausente = o mesmo prazo do credito. */
  readonly debitSettlementDays?: number
  /** Taxa do Pix, em pontos — DEC-027. Ausente = sem taxa. */
  readonly pixFeePercent?: number
}

export const DEFAULT_SETTLEMENT_DAYS = 30
export const MAX_CREDIT_INSTALLMENTS = 21
