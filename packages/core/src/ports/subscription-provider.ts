import type {
  CreateSubscriptionRequest,
  ProviderSubscription,
  SubscriptionWebhookResult,
} from '@na-regua/contracts'

/**
 * Porta da assinatura do SaaS — a NOSSA mensalidade. RF-110 a RF-118, NR-063.
 *
 * Declarada aqui, implementada por `billing` — a seta aponta para dentro. Como
 * em `PaymentGateway` e `InvoiceIssuer`, nenhum tipo dela mora em `core`: a
 * regra `adapter-nao-importa-core` proibe `packages/billing` de importar
 * `core`, entao o vocabulario vem de `contracts` e o adapter satisfaz a porta
 * estruturalmente.
 *
 * ## O que esta porta NAO faz
 *
 * Ela nao decide estado. Quem move a assinatura entre `trial`, `active`,
 * `overdue`, `restricted` e `cancelled` e o caso de uso, em `core`, porque
 * isso e regra de negocio nossa — inclusive o prazo de tolerancia, que e
 * decisao de produto e nao configuracao do provedor. O adapter so sabe pedir
 * uma recorrencia, cancela-la, e ler o que o provedor avisou.
 *
 * Por isso tambem nao ha `getSubscription` aqui: a verdade sobre o estado esta
 * na NOSSA tabela. Perguntar ao provedor "esta ativa?" convidaria duas fontes
 * de verdade a divergir, e a que manda no acesso do lojista tem de ser uma so.
 *
 * ## O cupom nao atravessa
 *
 * O desconto e aplicado ANTES, e o que vai no pedido e o valor final
 * (`amountCents`). RF-114 exige mostrar o valor final antes de confirmar: se o
 * provedor recalculasse, a tela prometeria um numero e a fatura traria outro.
 */
export type SubscriptionProvider = {
  /**
   * Cria a recorrencia mensal — RF-112.
   *
   * Idempotente por `externalReference`: pedir a assinatura da mesma empresa
   * duas vezes devolve a mesma. Duas recorrencias para um lojista e ele sendo
   * cobrado em dobro todo mes, e descobrindo isso no extrato.
   *
   * **Criar a recorrencia nao e o lojista ter pago.** Quem ativa o acesso e o
   * evento `subscription.paid`, nunca esta chamada.
   */
  createSubscription(request: CreateSubscriptionRequest): Promise<ProviderSubscription>

  /**
   * Encerra a recorrencia — US-058.
   *
   * Sem resultado de negocio: cancelar o que ja esta cancelado e sucesso, e
   * nao erro. O contrario deixaria o lojista preso a uma cobranca porque um
   * cancelamento anterior falhou pela metade.
   */
  cancelSubscription(request: {
    readonly companyId: string
    readonly providerSubscriptionId: string
    readonly reason: string
    readonly requestedAt: string
  }): Promise<void>

  /**
   * Le um aviso do provedor.
   *
   * Recebe o **corpo bruto**: o HMAC e calculado sobre os bytes que chegaram, e
   * reserializar depois de `JSON.parse` muda os bytes — RNF-028. Sincrona de
   * proposito, pelo mesmo motivo do gateway: e HMAC local, sem I/O, e uma
   * `Promise` aqui convidaria a enfiar chamada de rede no meio da validacao de
   * assinatura.
   */
  readWebhook(rawBody: string, signature: string): SubscriptionWebhookResult
}
