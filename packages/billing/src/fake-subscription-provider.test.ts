import { describe, expect, it } from 'vitest'
import { centavosDeDecimal, createFakeSubscriptionProvider } from './fake-subscription-provider.js'
import {
  pedidoDeAssinatura,
  verificarContratoDeAssinatura,
} from './subscription-provider-contract.js'

verificarContratoDeAssinatura('falso', () => createFakeSubscriptionProvider())

const AGORA = '2026-09-19T13:00:00.000Z'

describe('armadilhas do provedor que o falso reproduz', () => {
  it('o valor chega decimal, e as vezes string, na mesma API', () => {
    /* 129.9 * 100 da 12989.999... em ponto flutuante: truncar cobraria um
       centavo a menos todo mes. */
    expect(centavosDeDecimal(129.9)).toBe(12990)
    expect(centavosDeDecimal('100.00')).toBe(10000)
    expect(centavosDeDecimal(undefined)).toBe(0)
  })

  it('traduz o aviso de pagamento para o nosso vocabulario', () => {
    const provedor = createFakeSubscriptionProvider()
    const corpo = provedor.corpoDeWebhook({
      eventId: 'evt_1',
      event: 'PAYMENT_CONFIRMED',
      providerSubscriptionId: 'sub_000001',
      externalReference: 'assinatura-1',
      value: 89,
      occurredAt: AGORA,
    })

    const r = provedor.readWebhook(corpo, provedor.assinar(corpo))

    if (r.status !== 'accepted') throw new Error('esperava aceito')
    expect(r.event.type).toBe('subscription.paid')
    expect(r.event.amountCents).toBe(8900)
  })

  it('o mesmo evento reentregue traz o MESMO eventId', () => {
    const provedor = createFakeSubscriptionProvider()
    const corpo = provedor.corpoDeWebhook({
      eventId: 'evt_1',
      event: 'PAYMENT_CONFIRMED',
      providerSubscriptionId: 'sub_000001',
      externalReference: 'assinatura-1',
      value: 89,
      occurredAt: AGORA,
    })

    const primeira = provedor.readWebhook(corpo, provedor.assinar(corpo))
    const segunda = provedor.readWebhook(corpo, provedor.assinar(corpo))

    if (primeira.status !== 'accepted' || segunda.status !== 'accepted') {
      throw new Error('esperava os dois aceitos')
    }
    /* Quem nao guardar este id vai ativar a assinatura duas vezes — e, em
       cobranca, dar duas baixas no mesmo ciclo. */
    expect(segunda.event.eventId).toBe(primeira.event.eventId)
  })

  it('evento sem externalReference chega como nulo, e nao como a string vazia', () => {
    const provedor = createFakeSubscriptionProvider()
    const corpo = provedor.corpoDeWebhook({
      eventId: 'evt_2',
      event: 'PAYMENT_OVERDUE',
      providerSubscriptionId: 'sub_000001',
      externalReference: null,
      value: '89.00',
      failureReason: 'Cartao sem limite.',
      occurredAt: AGORA,
    })

    const r = provedor.readWebhook(corpo, provedor.assinar(corpo))

    if (r.status !== 'accepted') throw new Error('esperava aceito')
    /* Nao da para adivinhar de quem e. String vazia passaria por um id. */
    expect(r.event.externalReference).toBeNull()
    expect(r.event.type).toBe('subscription.payment_failed')
    /* RF-113: a tela precisa dizer o motivo, nao "pagamento recusado". */
    expect(r.event.failureReason).toBe('Cartao sem limite.')
  })

  it('evento que nao nos interessa e ignorado, e nao tratado como erro', () => {
    const provedor = createFakeSubscriptionProvider()
    const corpo = provedor.corpoDeWebhook({
      eventId: 'evt_3',
      event: 'PAYMENT_UPDATED',
      providerSubscriptionId: 'sub_000001',
      value: 89,
      occurredAt: AGORA,
    })

    /* 4xx aqui faria o provedor reentregar para sempre um evento que nunca
       vamos querer. */
    expect(provedor.readWebhook(corpo, provedor.assinar(corpo)).status).toBe('ignored')
  })

  it('falha de infraestrutura LANCA, porque e job para retentar', async () => {
    const provedor = createFakeSubscriptionProvider({ falhaDeInfraestrutura: 'provedor fora' })

    await expect(provedor.createSubscription(pedidoDeAssinatura())).rejects.toThrow(/provedor fora/)
  })
})
