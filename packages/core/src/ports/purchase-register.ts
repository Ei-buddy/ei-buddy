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
  readonly createdBy: UserId
  readonly createdAt: Date
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
}

export type PurchaseUnitOfWork = {
  transaction<T>(companyId: CompanyId, fn: (tx: PurchaseTransaction) => Promise<T>): Promise<T>
}

export type PurchaseQueries = {
  list(companyId: CompanyId, limite: number): Promise<readonly PurchaseOutput[]>
}
