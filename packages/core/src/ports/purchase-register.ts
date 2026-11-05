import type { PurchaseOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'
import type { TransactionalAuditTrail } from './audit-trail.js'
import type { NewPayable } from './payable-repository.js'

/**
 * Portas da entrada de mercadoria — NR-158.
 *
 * Uma transacao so para estoque, custo e conta a pagar: estoque somado sem a
 * conta lancada e mercadoria de graca no caixa; conta lancada sem o estoque e
 * pagar pelo que nao entrou.
 */

export type PurchaseProductSnapshot = {
  readonly id: string
  readonly description: string
  readonly costPriceCents: number
  /** `null` = produto sem controle de estoque. NAO e zero. */
  readonly stockQuantity: number | null
  readonly isActive: boolean
}

export type NewPurchase = {
  readonly companyId: CompanyId
  readonly supplier: string
  /** O fornecedor do cadastro (NR-191), quando a compra foi lancada por ele. */
  readonly supplierId: string | null
  readonly invoiceNumber: string | null
  readonly notes: string | null
  readonly totalCents: number
  readonly installments: number
  readonly payablesGroup: string | null
  readonly items: readonly {
    readonly productId: string
    readonly description: string
    readonly quantity: number
    readonly unitCostCents: number
  }[]
  readonly createdBy: UserId
  readonly createdAt: Date
}

export type NewPurchaseMovement = {
  readonly companyId: CompanyId
  readonly productId: string
  readonly purchaseId: string
  readonly quantityDelta: number
  readonly balanceAfter: number
  /** "Estorno da compra" no estorno; nulo na entrada. */
  readonly reason?: string | null
  readonly createdBy: UserId
  readonly createdAt: Date
}

/** A conta a pagar de uma compra, no que o estorno precisa saber. */
export type ContaDaCompra = {
  readonly id: string
  readonly status: 'open' | 'partially_settled' | 'settled' | 'cancelled'
  readonly settledAmountCents: number
}

export type PurchaseTransaction = TransactionalAuditTrail & {
  /** Le e trava o produto: entre ler o saldo e grava-lo cabe uma venda. */
  findProduct(companyId: CompanyId, productId: string): Promise<PurchaseProductSnapshot | undefined>
  insertPurchase(compra: NewPurchase): Promise<PurchaseOutput>
  /** `stock: null` deixa o saldo como esta (produto sem controle). */
  updateProduct(
    companyId: CompanyId,
    productId: string,
    mudancas: { readonly stock: number | null; readonly costPriceCents: number },
  ): Promise<void>
  insertMovement(movimento: NewPurchaseMovement): Promise<void>
  insertPayables(contas: readonly NewPayable[]): Promise<number>
  /** O fornecedor do cadastro, desta loja e nao excluido — NR-191. */
  findSupplier(
    companyId: CompanyId,
    supplierId: string,
  ): Promise<{ readonly id: string; readonly isActive: boolean } | undefined>
  /** Le e trava a compra — dois estornos ao mesmo tempo nao devolvem o estoque duas vezes. */
  findPurchase(companyId: CompanyId, purchaseId: string): Promise<PurchaseOutput | undefined>
  payablesOfPurchase(companyId: CompanyId, purchaseId: string): Promise<readonly ContaDaCompra[]>
  cancelPayables(
    companyId: CompanyId,
    ids: readonly string[],
    cancelledBy: UserId,
    cancelledAt: Date,
  ): Promise<void>
  markPurchaseCancelled(
    companyId: CompanyId,
    purchaseId: string,
    cancelledBy: UserId,
    cancelledAt: Date,
    reason: string,
  ): Promise<PurchaseOutput>
}

export type PurchaseUnitOfWork = {
  transaction<T>(companyId: CompanyId, fn: (tx: PurchaseTransaction) => Promise<T>): Promise<T>
}

export type PurchaseQueries = {
  list(companyId: CompanyId, limite: number): Promise<readonly PurchaseOutput[]>
}
