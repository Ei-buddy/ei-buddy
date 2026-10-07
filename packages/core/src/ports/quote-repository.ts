import type { QuoteOutput } from '@na-regua/contracts'
import type { CompanyId, UserId } from '../context.js'

/** Portas do orcamento — NR-159. */

export type NewQuote = {
  readonly companyId: CompanyId
  readonly customerName: string | null
  readonly validUntil: string
  readonly notes: string | null
  readonly discountCents: number
  readonly totalCents: number
  readonly items: readonly {
    readonly productId: string
    readonly description: string
    readonly quantity: number
    readonly unitPriceCents: number
  }[]
  readonly createdBy: UserId
  readonly createdAt: Date
}

export type QuoteRepository = {
  /** Produtos da empresa entre os ids pedidos. Os de outra loja nao voltam. */
  findProducts(
    companyId: CompanyId,
    ids: readonly string[],
  ): Promise<readonly { id: string; description: string; isActive: boolean }[]>
  /** Grava com o proximo numero da loja. */
  create(orcamento: NewQuote): Promise<QuoteOutput>
  list(companyId: CompanyId, limite: number): Promise<readonly QuoteOutput[]>
  findById(companyId: CompanyId, id: string): Promise<QuoteOutput | null>
  saleExists(companyId: CompanyId, saleId: string): Promise<boolean>
  /** Fecha SO se ainda estiver aberto; `null` quando ja nao estava. */
  close(
    companyId: CompanyId,
    id: string,
    desfecho: { status: 'converted' | 'cancelled'; saleId: string | null; closedAt: Date },
  ): Promise<QuoteOutput | null>
}
