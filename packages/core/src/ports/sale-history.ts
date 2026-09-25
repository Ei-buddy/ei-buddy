import type { PaymentMethod } from '@na-regua/contracts'
import type { CompanyId } from '../context.js'

/**
 * Porta do historico de vendas — NR-027, US-021.
 *
 * A tela de vendas mostrava `lib/mock-data`: o lojista fechava uma venda e ela
 * nao aparecia no historico, porque o historico era o de outra pessoa. Faltava
 * o caminho de LEITURA — `POST /sales` era a unica rota que existia.
 *
 * ## Por que a leitura tem porta propria
 *
 * A venda ja tem `UnitOfWork`, que e ESCRITA transacional. Historico e leitura
 * fora de transacao, com filtro e paginacao — declarar os dois na mesma porta
 * obrigaria quem implementa a escrita a implementar consulta, e quem implementa
 * consulta a abrir transacao.
 */

/** Um item da venda, como estava no momento em que ela foi fechada. */
export type ItemDoHistorico = {
  readonly productId: string | null
  readonly description: string
  readonly quantity: number
  /** Ja devolvido — RF-044. */
  readonly returnedQuantity: number
  readonly unitPriceCents: number
  readonly totalCents: number
}

export type PagamentoDoHistorico = {
  readonly method: PaymentMethod
  readonly amountCents: number
  readonly installments: number | null
}

export type VendaDoHistorico = {
  readonly id: string
  /** Sequencial por empresa — e o numero que o lojista fala ao telefone. */
  readonly number: number
  /** Instante do fechamento, em ISO. */
  readonly soldAt: string
  readonly customerId: string | null
  /** `null` na venda de balcao sem identificacao — RF-033. */
  readonly customerName: string | null
  readonly status: 'open' | 'settled' | 'cancelled' | 'returned'
  readonly grossAmountCents: number
  readonly discountCents: number
  readonly netAmountCents: number
  readonly taxAmountCents: number
  readonly cardFeeAmountCents: number
  /** Ja devolvido ao cliente, cumulativo — RF-044. */
  readonly returnedAmountCents: number
  readonly items: readonly ItemDoHistorico[]
  readonly payments: readonly PagamentoDoHistorico[]
  /** Numero da nota, quando houve emissao. */
  readonly invoiceNumber: number | null
  readonly invoiceAccessKey: string | null
}

export type FiltroDoHistorico = {
  /** AAAA-MM-DD, inclusive nas duas pontas, no fuso de exibicao. */
  readonly from?: string
  readonly to?: string
  /** Numero da venda, nome do cliente ou descricao de item. */
  readonly termo?: string
  /** So as vendas deste cliente — RF-011. */
  readonly customerId?: string
  readonly offset: number
  readonly limite: number
}

export type SaleHistoryRepository = {
  /**
   * A pagina e o total que casa com o filtro, numa chamada so.
   *
   * O total e o complemento da pagina: sem ele, uma pagina cheia e
   * indistinguivel do fim do historico e o lojista para de procurar achando
   * que acabou.
   */
  list(
    companyId: CompanyId,
    filtro: FiltroDoHistorico,
  ): Promise<{
    readonly vendas: readonly VendaDoHistorico[]
    readonly total: number
    /**
     * Os totais do FILTRO, e nao da pagina — e na mesma varredura.
     *
     * Vem daqui e nao de `core` porque somar em memoria exigiria trazer todas
     * as vendas do periodo para exibir tres numeros. E vem na mesma chamada
     * porque e o complemento da pagina: em duas leituras, uma venda nova entre
     * elas faria o total do topo discordar da lista logo abaixo.
     */
    readonly resumo: {
      readonly salesCount: number
      readonly grossCents: number
      readonly netCents: number
      readonly cardFeeCents: number
    }
  }>

  /** Uma venda inteira. `undefined` quando nao existe OU e de outra empresa. */
  findById(companyId: CompanyId, saleId: string): Promise<VendaDoHistorico | undefined>
}
