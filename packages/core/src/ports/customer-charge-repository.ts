/**
 * Cobranca a distancia, do lado do nosso banco — RF-068, NR-044.
 *
 * ## O caminho de volta
 *
 * O link de pagamento sai com um `externalReference`, e e por ele que o aviso
 * do provedor volta a nos achar. Sem esta porta, aquele identificador nao
 * levava a lugar nenhum: o cliente pagava, o aviso chegava, e nenhum recebivel
 * baixava — silenciosamente, com o dinheiro na conta do lojista e o sistema
 * dizendo que ele tem a receber.
 *
 * Guardar quais titulos a cobranca cobriu, e com quanto de cada, e o que
 * transforma "o cliente pagou" em "estes tres titulos foram quitados".
 */
export type CustomerChargeRepository = {
  /**
   * Registra a cobranca enviada.
   *
   * **Idempotente por `externalReference`**, pela mesma razao que o link e:
   * reenviar o mesmo pedido reaproveita o link em vez de criar um segundo para
   * a mesma divida, e o registro tem de acompanhar essa decisao — dois
   * registros para um link fariam a baixa acontecer duas vezes.
   *
   * Gravar e um efeito colateral do envio, e nao o envio. Se falhar, quem
   * chama decide: a cobranca ja foi para o cliente, e o lojista nao pode ser
   * punido por um problema nosso de escrita.
   */
  registrar(entrada: {
    readonly companyId: string
    readonly customerId: string
    readonly externalReference: string
    readonly amountCents: number
    readonly providerLinkId: string
    readonly checkoutUrl: string
    /** Os titulos cobertos, com quanto desta cobranca cabe a cada um. */
    readonly titulos: readonly {
      readonly receivableId: string
      readonly amountCents: number
    }[]
    readonly createdAt: Date
  }): Promise<void>
}
