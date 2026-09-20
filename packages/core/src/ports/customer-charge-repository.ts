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

  /**
   * A cobranca com esta referencia, e os titulos que ela cobre.
   *
   * `undefined` quando nao existe: o provedor avisa sobre cobrancas que nao
   * sao nossas (uma feita a mao no painel dele, por exemplo), e isso nao e
   * erro.
   */
  porReferencia(
    companyId: string,
    externalReference: string,
  ): Promise<CobrancaRegistrada | undefined>

  /**
   * Marca a cobranca como paga.
   *
   * `providerEventId` entra junto, e nao por acaso: e o indice unico dele que
   * impede o mesmo aviso do provedor dar baixa duas vezes, mesmo que a caixa
   * de entrada falhe. Duas protecoes para o mesmo risco, porque o risco aqui e
   * dinheiro dado como recebido em dobro.
   */
  marcarPaga(entrada: {
    readonly companyId: string
    readonly chargeId: string
    readonly providerEventId: string
    readonly paidAt: Date
  }): Promise<void>
}

/** A cobranca como o caminho de volta precisa dela — nada alem disso. */
export type CobrancaRegistrada = {
  readonly id: string
  readonly customerId: string | null
  readonly amountCents: number
  /** `pending` e o unico que ainda aceita baixa. */
  readonly status: 'pending' | 'paid' | 'expired' | 'cancelled'
  readonly titulos: readonly {
    readonly receivableId: string
    readonly amountCents: number
  }[]
}
