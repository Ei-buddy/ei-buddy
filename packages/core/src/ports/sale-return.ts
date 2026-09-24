import type { CompanyId, UserId } from '../context.js'
import type { TransactionalAuditTrail } from './audit-trail.js'

/**
 * Devolucao parcial — RF-044, NR-122.
 *
 * Porta irma de `SaleCancellationUnitOfWork`: mesma transacao, mesmas recusas,
 * mas trabalha por ITEM e por VALOR em vez de desfazer a venda inteira.
 */

export type LinhaDevolvivel = {
  readonly saleItemId: string
  readonly productId: string
  readonly quantity: number
  /** Ja devolvido em devolucoes anteriores. */
  readonly returnedQuantity: number
  /** O que foi cobrado pela linha, ja com o desconto do item. */
  readonly totalCents: number
}

export type RecebivelDaVenda = {
  readonly id: string
  readonly description: string
  readonly amountCents: number
  readonly netAmountCents: number
  readonly status: 'open' | 'partially_settled' | 'settled' | 'cancelled'
  readonly dueDate: string
}

export type SaleToReturn = {
  readonly id: string
  readonly status: 'open' | 'settled' | 'cancelled' | 'returned'
  readonly customerId: string | null
  readonly lines: readonly LinhaDevolvivel[]
  readonly receivables: readonly RecebivelDaVenda[]
  readonly hasIssuedInvoice: boolean
  /** Baixas (settlements) ja lancadas contra recebiveis desta venda. */
  readonly settledCents: number
}

export type SaleReturnTransaction = TransactionalAuditTrail & {
  findSale(saleId: string): Promise<SaleToReturn | undefined>

  restoreStock(
    itens: readonly { readonly productId: string; readonly quantity: number }[],
    origem: { readonly saleId: string; readonly createdBy: UserId; readonly createdAt: Date },
  ): Promise<void>

  markLinesReturned(
    linhas: readonly { readonly saleItemId: string; readonly quantity: number }[],
  ): Promise<void>

  /** Reduz o recebivel ao novo valor. Liquidado continua liquidado, com o valor novo. */
  reduceReceivable(
    receivableId: string,
    novo: { readonly amountCents: number; readonly netAmountCents: number },
  ): Promise<void>

  /** O recebivel inteiro foi devolvido. */
  cancelReceivable(receivableId: string): Promise<void>

  decreaseWalletBalance(customerId: string, amountCents: number): Promise<void>

  /** Soma ao valor devolvido da venda; `returned` quando nao sobrou item. */
  addReturnedAmount(saleId: string, amountCents: number, fullyReturned: boolean): Promise<void>
}

export type SaleReturnUnitOfWork = {
  transaction<T>(companyId: CompanyId, fn: (tx: SaleReturnTransaction) => Promise<T>): Promise<T>
}
