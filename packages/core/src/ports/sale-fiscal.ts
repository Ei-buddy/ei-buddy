import type { InvoiceItem, IssueInvoiceRequest, PaymentMethod } from '@na-regua/contracts'
import type { CompanyId } from '../context.js'

/**
 * O que a venda tem para virar nota — NR-042, RF-045, RF-046.
 *
 * Existe porque a nota nao sai da venda direto: ela precisa dos campos fiscais
 * do PRODUTO (NCM, CFOP, CST/CSOSN), que ficam no cadastro e nao no item
 * vendido. O item guarda descricao e preco praticados, que podem ter mudado
 * desde entao — e a nota descreve o que foi vendido, com a classificacao que o
 * produto tem hoje.
 */

/** Um item da venda com a classificacao que o cadastro tem — ou sem ela. */
export type ItemFiscalDaVenda = {
  readonly productId: string | null
  readonly description: string
  readonly quantity: number
  readonly unitPriceCents: number
  readonly unitOfMeasure: InvoiceItem['unitOfMeasure']
  /** Nulos quando o produto ainda nao foi classificado — RF-046. */
  readonly ncm: string | null
  readonly cfop: string | null
  readonly taxSituationCode: string | null
  /**
   * NBS do produto. Preenchido, o item e SERVICO e sai na NFS-e, e nao na
   * NFC-e — DEC-031, NR-241. Ausente vale como mercadoria.
   */
  readonly nbsCode?: string | null
}

export type VendaParaNota = {
  readonly saleId: string
  readonly items: readonly ItemFiscalDaVenda[]
  readonly payments: readonly { readonly method: PaymentMethod; readonly amountCents: number }[]
  /** Nome e documento do cliente, quando a venda teve um. */
  readonly recipient: { readonly name?: string; readonly document?: string } | undefined
}

export type SaleFiscalReader = {
  /** `undefined` quando a venda nao existe nesta empresa. */
  forInvoice(companyId: CompanyId, saleId: string): Promise<VendaParaNota | undefined>
}

/**
 * Quem coloca o pedido na fila — RNF-004.
 *
 * A emissao e assincrona para a venda fechar sem esperar a SEFAZ. O caso de uso
 * so enfileira; quem fala com o provedor e o worker.
 */
export type InvoiceQueue = {
  /**
   * Idempotente por `saleId`: pedir a nota da mesma venda duas vezes nao gera
   * dois jobs. Nota duplicada e problema fiscal, e a defesa comeca aqui — antes
   * ainda do `ref` do provedor e da guarda em `db`.
   */
  enqueue(request: IssueInvoiceRequest): Promise<void>
}
