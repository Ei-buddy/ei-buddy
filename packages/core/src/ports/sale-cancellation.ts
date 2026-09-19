import type { CompanyId, UserId } from '../context.js'
import type { TransactionalAuditTrail } from './audit-trail.js'

/**
 * Portas do cancelamento de venda — RF-043, US-021.
 *
 * Porta SEPARADA da escrita da venda (`sale-writers.ts`), e nao mais metodos
 * dentro de `SaleTransaction`: aquele escopo existe para GRAVAR uma venda, e
 * quem cancela nao grava nenhuma. Junta-las obrigaria todo implementador de
 * venda a saber estornar, e o teste de venda a montar um mundo que ele nao
 * usa.
 *
 * A fronteira de transacao continua sendo o caso de uso
 * ([principio 6](../../../../docs/arquitetura/principios.md)): estoque,
 * recebivel, carteira e status voltam juntos ou nao voltam.
 */

/**
 * O estado da venda que decide se o cancelamento pode correr.
 *
 * Os tres ultimos campos existem para o caso de uso RECUSAR, e nao para ele
 * calcular: sao as tres perguntas que a US-021 faz antes de estornar qualquer
 * coisa.
 */
export type SaleToCancel = {
  readonly id: string
  readonly status: 'open' | 'settled' | 'cancelled' | 'returned'
  readonly customerId: string | null
  /** O que volta para a prateleira. */
  readonly items: readonly { readonly productId: string; readonly quantity: number }[]
  /**
   * Nota emitida trava o cancelamento aqui — RF-050 pede o pedido a Focus
   * ANTES do estorno, e essa parte ainda nao existe. Estornar assim mesmo
   * deixaria a nota valida na SEFAZ e o estoque de volta na loja.
   */
  readonly hasIssuedInvoice: boolean
  /**
   * Quanto ja foi baixado dos recebiveis desta venda.
   *
   * Maior que zero trava: dinheiro que ja entrou no caixa nao pode sumir por
   * um cancelamento em cascata. Quem quer desfazer estorna a baixa primeiro,
   * de propria conta.
   */
  readonly settledCents: number
  /** Parte paga em carteira (fiado), para devolver ao saldo do cliente. */
  readonly walletCents: number
}

export type SaleCancellationTransaction = TransactionalAuditTrail & {
  findSale(saleId: string): Promise<SaleToCancel | undefined>

  /**
   * Devolve os itens ao estoque, como movimento `sale_cancelled`.
   *
   * Movimento, e nao UPDATE no saldo: a trilha de estoque e somente-insercao
   * (RF-123), e um saldo que muda sem linha e exatamente o que ela existe para
   * impedir.
   */
  restoreStock(
    itens: readonly { readonly productId: string; readonly quantity: number }[],
    origem: { readonly saleId: string; readonly createdBy: UserId; readonly createdAt: Date },
  ): Promise<void>

  /** Cancela os recebiveis abertos da venda. Nenhum tem baixa — o caso de uso ja conferiu. */
  cancelReceivables(saleId: string): Promise<void>

  /** Devolve ao cliente o que foi lancado em carteira por esta venda. */
  decreaseWalletBalance(customerId: string, amountCents: number): Promise<void>

  /** Marca a venda como cancelada. Cancela, nunca apaga — RNF-040. */
  markCancelled(
    saleId: string,
    dados: { readonly reason: string; readonly by: UserId; readonly at: Date },
  ): Promise<void>
}

export type SaleCancellationUnitOfWork = {
  transaction<T>(
    companyId: CompanyId,
    fn: (tx: SaleCancellationTransaction) => Promise<T>,
  ): Promise<T>
}
