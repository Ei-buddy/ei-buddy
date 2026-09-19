import {
  providerSubscriptionSchema,
  subscriptionWebhookResultSchema,
  type CreateSubscriptionRequest,
  type ProviderSubscription,
  type SubscriptionWebhookResult,
} from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Suite de contrato da porta `SubscriptionProvider`.
 *
 * Nao conhece o falso, so a porta — e a promessa de que falso e real satisfazem
 * a mesma suite. Quando o adapter Asaas entrar, ele passa por aqui ou nao e
 * substituivel.
 *
 * Fica de fora, de proposito, tudo que exige o segredo do webhook do adapter
 * e a injecao de falha do provedor. O que **nao** fica de fora e assinatura
 * invalida: isso e propriedade universal.
 */

export type ProvedorSobTeste = {
  createSubscription(request: CreateSubscriptionRequest): Promise<ProviderSubscription>
  cancelSubscription(request: {
    companyId: string
    providerSubscriptionId: string
    reason: string
    requestedAt: string
  }): Promise<void>
  readWebhook(rawBody: string, signature: string): SubscriptionWebhookResult
}

const EMPRESA = 'empresa-1'
const OUTRA_EMPRESA = 'empresa-2'
const AGORA = '2026-09-19T13:00:00.000Z'

export function pedidoDeAssinatura(
  sobrescreve: Partial<CreateSubscriptionRequest> = {},
): CreateSubscriptionRequest {
  return {
    companyId: EMPRESA,
    customerReference: 'cus_lojista_1',
    planCode: 'essencial',
    amountCents: 8900,
    firstDueDate: '2026-10-05',
    externalReference: 'assinatura-1',
    requestedAt: AGORA,
    ...sobrescreve,
  }
}

export function verificarContratoDeAssinatura(nome: string, criar: () => ProvedorSobTeste): void {
  describe(`contrato SubscriptionProvider — ${nome}`, () => {
    it('cria a recorrencia sem ativar nada', async () => {
      const provedor = criar()

      const r = await provedor.createSubscription(pedidoDeAssinatura())

      expect(() => providerSubscriptionSchema.parse(r)).not.toThrow()
      expect(r.externalReference).toBe('assinatura-1')
      expect(r.nextDueDate).toBe('2026-10-05')
      /* Criar a recorrencia NAO e o lojista ter pago. Quem ativa o acesso e o
         evento `subscription.paid` — ler o contrario aqui liberaria o sistema
         para quem so chegou na tela de pagamento. */
      expect(r.providerStatus).not.toBe('ACTIVE')
    })

    it('pedir a mesma assinatura duas vezes devolve a mesma', async () => {
      const provedor = criar()
      const pedido = pedidoDeAssinatura()

      const primeira = await provedor.createSubscription(pedido)
      const segunda = await provedor.createSubscription(pedido)

      /* Duas recorrencias para um lojista sao ele pagando em dobro todo mes. */
      expect(segunda.providerSubscriptionId).toBe(primeira.providerSubscriptionId)
    })

    it('recusa recorrencia de valor zero', async () => {
      const provedor = criar()

      /* Para liberar sem cobrar existe o periodo de teste. Uma recorrencia de
         zero seria um plano ativo que nunca gera cobranca — e ninguem
         descobriria ate o fim do mes. */
      await expect(
        provedor.createSubscription(pedidoDeAssinatura({ amountCents: 0 })),
      ).rejects.toThrow()
    })

    it('cancelar duas vezes nao e erro', async () => {
      const provedor = criar()
      const criada = await provedor.createSubscription(pedidoDeAssinatura())
      const pedido = {
        companyId: EMPRESA,
        providerSubscriptionId: criada.providerSubscriptionId,
        reason: 'Lojista encerrou',
        requestedAt: AGORA,
      }

      await provedor.cancelSubscription(pedido)

      /* Cancelar o que ja esta cancelado e sucesso: o contrario prenderia o
         lojista a uma cobranca porque a primeira tentativa falhou no meio. */
      await expect(provedor.cancelSubscription(pedido)).resolves.toBeUndefined()
    })

    it('cancelar assinatura de outra empresa nao faz nada, e nao lanca', async () => {
      const provedor = criar()
      const criada = await provedor.createSubscription(pedidoDeAssinatura())

      await expect(
        provedor.cancelSubscription({
          companyId: OUTRA_EMPRESA,
          providerSubscriptionId: criada.providerSubscriptionId,
          reason: 'Tentativa cega',
          requestedAt: AGORA,
        }),
      ).resolves.toBeUndefined()
    })

    it('recusa webhook com assinatura invalida, sem parsear o corpo', () => {
      const provedor = criar()

      const r = provedor.readWebhook('{"event":"PAYMENT_CONFIRMED"}', 'assinatura-forjada')

      expect(() => subscriptionWebhookResultSchema.parse(r)).not.toThrow()
      /* Nao e 200: responder 200 ensina o atacante que o corpo foi aceito. */
      expect(r.status).toBe('invalid_signature')
    })

    it('recusa webhook sem assinatura nenhuma', () => {
      const provedor = criar()

      expect(provedor.readWebhook('{"event":"PAYMENT_CONFIRMED"}', '').status).toBe(
        'invalid_signature',
      )
    })
  })
}
