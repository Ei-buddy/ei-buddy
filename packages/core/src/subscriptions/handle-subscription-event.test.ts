import type { Subscription, SubscriptionEvent } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import type { PoliticaDeAssinatura } from './estado.js'
import { InMemorySubscriptionRepository } from './fakes.js'
import { handleSubscriptionEvent } from './handle-subscription-event.js'

const POLITICA: PoliticaDeAssinatura = {
  diasDeTeste: 14,
  diasDeAvisoDoFimDoTeste: 3,
  diasDeTolerancia: 5,
}

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const QUANDO = '2026-10-05T12:00:00.000Z'

const evento = (over: Partial<SubscriptionEvent> = {}): SubscriptionEvent => ({
  eventId: 'evt_1',
  type: 'subscription.paid',
  providerSubscriptionId: 'sub_1',
  /* O `externalReference` E o `company_id` — e assim que o aviso diz de qual
     loja ele fala, sem precisar de consulta cross-tenant. */
  externalReference: EMPRESA,
  amountCents: 8990,
  failureReason: null,
  occurredAt: QUANDO,
  ...over,
})

const assinatura = (over: Partial<Subscription> = {}): Subscription => ({
  companyId: EMPRESA,
  planCode: 'essencial',
  status: 'trial',
  trialEndsAt: '2026-10-03T23:59:59.999Z',
  currentPeriodEndsAt: null,
  couponId: null,
  restrictedAt: null,
  cancelledAt: null,
  nextDueDate: null,
  ...over,
})

const deps = (inicial?: Subscription) => {
  const subscriptions = new InMemorySubscriptionRepository()
  if (inicial) subscriptions.semear(inicial)
  return { subscriptions, politica: POLITICA }
}

describe('pagamento confirmado — RF-112, RF-118', () => {
  it('ativa a assinatura em teste', async () => {
    const d = deps(assinatura({ status: 'trial' }))

    const r = await handleSubscriptionEvent(d, evento())

    expect([r.status, r.mudou]).toEqual(['active', true])
    expect((await d.subscriptions.findByCompany(EMPRESA))?.status).toBe('active')
  })

  it('devolve o acesso de uma loja restrita, e LIMPA a marca do bloqueio', async () => {
    const d = deps(assinatura({ status: 'restricted', restrictedAt: '2026-10-04T00:00:00.000Z' }))

    const r = await handleSubscriptionEvent(d, evento())

    expect([r.status, r.mudou]).toEqual(['active', true])
    const gravada = await d.subscriptions.findByCompany(EMPRESA)
    /* RF-118: sem isto a loja volta a funcionar com a tela ainda dizendo desde
       quando esta bloqueada — para quem acabou de pagar. */
    expect(gravada?.restrictedAt).toBeNull()
  })

  it('o mesmo aviso duas vezes nao muda nada na segunda', async () => {
    const d = deps(assinatura({ status: 'trial' }))

    const primeira = await handleSubscriptionEvent(d, evento())
    const segunda = await handleSubscriptionEvent(d, evento())

    /* O provedor reentrega. A dedup por `webhook_events` evita o TRABALHO;
       isto evita o ESTRAGO — e as duas protegem coisas diferentes. */
    expect([primeira.mudou, segunda.mudou]).toEqual([true, false])
  })
})

describe('pagamento recusado — RF-113', () => {
  it('leva de ativa para vencida, e nao bloqueia', async () => {
    const d = deps(assinatura({ status: 'active', trialEndsAt: null }))

    const r = await handleSubscriptionEvent(
      d,
      evento({ type: 'subscription.payment_failed', failureReason: 'Cartao sem limite.' }),
    )

    /* Bloquear na recusa seria nao ter tolerancia: a primeira falha de cartao
       fecharia a loja. */
    expect([r.status, r.mudou]).toEqual(['overdue', true])
  })
})

describe('cancelamento', () => {
  it('encerra e grava quando', async () => {
    const d = deps(assinatura({ status: 'active', trialEndsAt: null }))

    const r = await handleSubscriptionEvent(d, evento({ type: 'subscription.cancelled' }))

    expect([r.status, r.mudou]).toEqual(['cancelled', true])
    expect((await d.subscriptions.findByCompany(EMPRESA))?.cancelledAt).toBe(QUANDO)
  })

  it('pagamento depois de encerrada NAO ressuscita', async () => {
    const d = deps(assinatura({ status: 'cancelled', trialEndsAt: null }))

    const r = await handleSubscriptionEvent(d, evento())

    /* Aviso atrasado de um ciclo antigo e coisa normal do provedor. Reativar
       por causa dele seria o lojista voltando a ser cobrado sem ter pedido. */
    expect([r.status, r.mudou]).toEqual(['cancelled', false])
  })
})

describe('avisos que nao apontam para assinatura nossa', () => {
  it('sem referencia externa, ignora sem lancar', async () => {
    const d = deps(assinatura())

    const r = await handleSubscriptionEvent(d, evento({ externalReference: null }))

    /* Lancar faria o provedor reentregar para sempre um aviso que nunca vamos
       querer. */
    expect([r.status, r.mudou]).toEqual([null, false])
  })

  it('empresa sem assinatura, ignora sem lancar', async () => {
    const d = deps()

    const r = await handleSubscriptionEvent(d, evento())

    expect([r.status, r.mudou]).toEqual([null, false])
  })

  it('nao mexe na assinatura de outra empresa', async () => {
    const d = deps(assinatura({ status: 'restricted' }))

    await handleSubscriptionEvent(
      d,
      evento({ externalReference: '33333333-3333-4333-8333-333333333333' }),
    )

    /* O aviso diz de qual loja fala; uma confusao aqui desbloquearia a loja
       errada. */
    expect((await d.subscriptions.findByCompany(EMPRESA))?.status).toBe('restricted')
  })
})
