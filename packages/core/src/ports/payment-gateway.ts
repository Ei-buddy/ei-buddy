import type {
  BoletoCharge,
  BoletoChargeRequest,
  CardChargeRequest,
  CardChargeResult,
  CardToken,
  CardTokenRequest,
  FeeQuoteResult,
  PaymentLink,
  PaymentLinkRequest,
  PixCharge,
  PixChargeRequest,
  RefundRequest,
  RefundResult,
  WebhookReadResult,
} from '@na-regua/contracts'

/**
 * Porta do gateway de pagamento — o dinheiro do LOJISTA. RF-034, RF-067, RF-068.
 *
 * Declarada aqui, implementada por `payments` — a seta aponta para dentro.
 * Como em `InvoiceIssuer`, nenhum tipo dela mora em `core`: a regra
 * `adapter-nao-importa-core` proibe `packages/payments` de importar `core`,
 * entao o vocabulario e de `contracts` e o adapter satisfaz a porta
 * estruturalmente.
 *
 * **Nossa mensalidade nao passa por aqui.** Assinatura do SaaS e
 * `SubscriptionProvider`, em `billing` (NR-063). Sao dois adapters para um
 * possivel mesmo fornecedor porque sao dois problemas de negocio: se um dia a
 * mensalidade migrar de provedor, o pagamento do lojista nao e afetado
 * ([pagmaxx.md](../../../../docs/arquitetura/integracoes/pagmaxx.md)).
 *
 * ## Onde esta porta se afasta do esboco do `pagmaxx.md`
 *
 * O esboco previa `fetchFeeTable(...): Promise<CardFeeTable>` e
 * `refund(paymentId, amount?: Money)`. Nenhum dos dois e implementavel:
 *
 * - `CardFeeTable` mora em `packages/domain`, e a regra da CI proibe
 *   `payments` de importar `domain`. Por isso a porta devolve `FeeQuote[]`
 *   cru e **`core` traduz** — que e tambem onde a decisao de confiar na
 *   cotacao pertence.
 * - dinheiro atravessa a porta em **centavo inteiro**, como no resto de
 *   `contracts`. `Money` continua sendo o tipo de calculo dentro de `core` e
 *   de `domain`; a conversao do decimal do provedor acontece na borda do
 *   adapter.
 */
export type PaymentGateway = {
  /**
   * Cria cobranca Pix — RF-034.
   *
   * Idempotente por `externalReference`: pedir a cobranca da mesma venda duas
   * vezes devolve a mesma, e nao duas. Duas cobrancas para uma divida e o
   * cliente pagando duas vezes.
   */
  createPixCharge(request: PixChargeRequest): Promise<PixCharge>

  /**
   * Consulta a cobranca.
   *
   * Existe porque webhook se perde: e a rede de seguranca para conciliar o que
   * o provedor sabe com o que nos sabemos. Nao substitui o webhook — sondar em
   * laco nao escala.
   */
  getPixCharge(request: {
    readonly companyId: string
    readonly chargeId: string
  }): Promise<PixCharge | undefined>

  /**
   * Cria boleto — RF-034.
   *
   * Idempotente por `externalReference`, como o Pix, e com uma recusa a mais:
   * pedir boleto para uma referencia que ja tem cobranca de OUTRO meio nao
   * devolve aquela cobranca disfarcada de boleto. Uma divida, um documento.
   *
   * Devolve a linha digitavel junto, e nao so o id: um boleto sem ela nao e
   * pagavel, e deixar isso para uma segunda chamada opcional convida a tela a
   * mostrar um campo vazio.
   */
  createBoletoCharge(request: BoletoChargeRequest): Promise<BoletoCharge>

  /**
   * Troca um cartao por um token — RF-034, RNF-022.
   *
   * **A unica chamada do sistema que recebe numero e CVV, e ela existe para
   * que eles nao sejam guardados.** O que volta e token, bandeira e os quatro
   * ultimos digitos; com isso o lojista reconhece o cartao na tela e nao
   * cobra nada fora da conta que gerou o token.
   *
   * O dado bruto nao pode chegar aqui vindo do banco, de log ou de fila: ele
   * vem da requisicao, atravessa esta chamada e morre. Guardar para "tentar de
   * novo depois" e como o numero do cartao do cliente aparece num backup.
   */
  tokenizeCard(request: CardTokenRequest): Promise<CardToken>

  /**
   * Cobra um cartao ja tokenizado — RF-034.
   *
   * Recusa e RESULTADO, como no estorno: "sem limite" e "suspeita de fraude"
   * sao respostas normais da adquirente, e quem chama precisa mostrar qual foi
   * para o lojista decidir entre outro cartao e outro meio. Excecao aqui
   * viraria "erro inesperado" na tela e deixaria um `catch` distante desfazer
   * a venda por causa de uma resposta previsivel.
   */
  createCardCharge(request: CardChargeRequest): Promise<CardChargeResult>

  /**
   * Cria link de pagamento — RF-068.
   *
   * E o encaixe mais forte com a tese do produto: a cobranca deixa de ser
   * "manda uma mensagem pedindo dinheiro" e vira "manda um link que o cliente
   * paga em dois toques, e o sistema da baixa sozinho".
   */
  createPaymentLink(request: PaymentLinkRequest): Promise<PaymentLink>

  /**
   * Estorna, total ou parcialmente — RF-067.
   *
   * Recusa e resultado, nao excecao: "prazo expirado" e "valor acima do pago"
   * sao respostas normais do provedor.
   */
  refund(request: RefundRequest): Promise<RefundResult>

  /**
   * Cota tarifas de cartao para alimentar a tabela.
   *
   * **Nao chame no fechamento da venda.** A resposta e repassada da adquirente
   * e nao tem contrato estavel; venda que depende dela fica sujeita a
   * indisponibilidade de terceiro — RNF-003, RNF-041. Isto roda periodicamente,
   * e `unavailable` e uma resposta esperada.
   */
  fetchFeeQuotes(request: {
    readonly companyId: string
    readonly requestedAt: string
  }): Promise<FeeQuoteResult>

  /**
   * Le um webhook do provedor.
   *
   * `signature` e o que veio no cabecalho de autenticacao, **cru**. O que
   * fazer com ele e do adapter, porque provedores diferentes autenticam de
   * formas diferentes: o Asaas repete um token estatico
   * (`asaas-access-token`), e outros assinam o corpo com HMAC. A porta nao
   * escolhe entre os dois — ela so promete que a requisicao foi autenticada
   * antes de virar evento (RNF-028).
   *
   * Recebe o **corpo bruto**, e nao um objeto ja parseado, porque o provedor
   * que assina o corpo assina os BYTES que chegaram: reserializar depois de
   * `JSON.parse` muda os bytes e a verificacao falha. Quem chama nao deve
   * parsear antes — e isso vale mesmo com o provedor de hoje, que nao assina
   * corpo nenhum, para que trocar de provedor nao vire trocar a rota.
   *
   * Sincrona de proposito: a conferencia e local, sem I/O. `Promise` aqui
   * convidaria a enfiar chamada de rede no meio da autenticacao.
   *
   * O resultado distingue quatro casos porque eles pedem codigos HTTP
   * diferentes — ver `WebhookReadResult`. Em especial, assinatura invalida
   * **nao** responde 200.
   */
  readWebhook(rawBody: string, signature: string): WebhookReadResult
}
