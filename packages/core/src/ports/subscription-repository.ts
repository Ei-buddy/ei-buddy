import type { Subscription, SubscriptionStatus } from '@na-regua/contracts'

/**
 * A assinatura no nosso banco — NR-063, RF-110 a RF-118.
 *
 * **Esta e a fonte da verdade sobre o acesso do lojista**, e nao o provedor.
 * O `SubscriptionProvider` sabe de recorrencia e cobranca; quem responde "esta
 * loja pode lancar hoje?" e esta tabela. Duas fontes de verdade para essa
 * pergunta divergiriam, e a divergencia apareceria como loja travada em dia ou
 * loja liberada sem pagar.
 *
 * Uma assinatura por empresa — a `UNIQUE (company_id)` do schema. Por isso
 * nada aqui recebe um `subscriptionId`: a empresa JA e a chave.
 */
export type SubscriptionRepository = {
  /** `undefined` quando a empresa ainda nao tem assinatura — estado normal. */
  findByCompany(companyId: string): Promise<Subscription | undefined>

  /**
   * Cria a assinatura em periodo de teste — RF-110.
   *
   * **Idempotente**: chamar de novo para a mesma empresa devolve a que ja
   * existe, sem criar uma segunda nem estender o prazo. O cadastro pode ser
   * repetido (uma retentativa de rede, um job que reprocessa), e cada
   * repeticao renovando o teste seria teste infinito de graca.
   */
  startTrial(entry: {
    readonly companyId: string
    readonly planCode: string
    /** Instante em que o teste acaba. */
    readonly trialEndsAt: Date
    readonly createdAt: Date
  }): Promise<Subscription>

  /**
   * Grava o estado que a maquina de estados decidiu.
   *
   * Recebe o estado JA decidido, e nao o evento: quem decide e `avancar`, em
   * `subscriptions/estado.ts`, que e puro e testado. Deixar o repositorio
   * decidir espalharia a regra por SQL, onde ela deixa de ser testavel em
   * milissegundos.
   *
   * `restrictedAt` e `cancelledAt` vao juntos e podem ser `null`: voltar de
   * `restricted` para `active` (RF-118) tem de LIMPAR a marca do bloqueio, e
   * nao so trocar o status — senao a tela continuaria dizendo desde quando a
   * loja esta bloqueada.
   */
  updateStatus(entry: {
    readonly companyId: string
    readonly status: SubscriptionStatus
    readonly restrictedAt: Date | null
    readonly cancelledAt: Date | null
    readonly updatedAt: Date
  }): Promise<void>
}
