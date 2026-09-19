import type { Subscription } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '../context.js'
import type { PoliticaDeAssinatura } from './estado.js'
import { InMemorySubscriptionRepository } from './fakes.js'
import { getSubscription } from './get-subscription.js'
import { startTrial } from './start-trial.js'

/* Fixture, nao politica do produto: a QST-002 segue aberta. */
const POLITICA: PoliticaDeAssinatura = {
  diasDeTeste: 14,
  diasDeAvisoDoFimDoTeste: 3,
  diasDeTolerancia: 5,
}

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const CRIADA_EM = new Date('2026-09-19T14:30:00.000Z')

const contexto = (companyId = EMPRESA): ExecutionContext =>
  ({
    companyId,
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: new Date('2026-09-20T10:00:00.000Z'),
  }) as ExecutionContext

const deps = () => {
  const subscriptions = new InMemorySubscriptionRepository()
  return { subscriptions, politica: POLITICA, planoDoTeste: 'essencial' }
}

describe('inicio do periodo de teste — RF-110', () => {
  it('nasce em trial, com prazo contado da criacao da empresa', async () => {
    const d = deps()

    const a = await startTrial(d, { companyId: EMPRESA, criadaEm: CRIADA_EM })

    expect(a.status).toBe('trial')
    expect(a.planCode).toBe('essencial')
    /* 19/09 + 14 dias = 03/10. */
    expect(a.trialEndsAt?.slice(0, 10)).toBe('2026-10-03')
  })

  it('o teste acaba no FIM do ultimo dia, nao na meia-noite dele', async () => {
    const d = deps()

    const a = await startTrial(d, { companyId: EMPRESA, criadaEm: CRIADA_EM })

    /* Meia-noite faria o acesso cair na manha do dia que ainda era do
       lojista — ele leu "seu teste vai ate 03/10". */
    expect(a.trialEndsAt).toBe('2026-10-03T23:59:59.999Z')
  })

  it('chamar de novo nao cria uma segunda nem estende o prazo', async () => {
    const d = deps()

    const primeira = await startTrial(d, { companyId: EMPRESA, criadaEm: CRIADA_EM })
    const segunda = await startTrial(d, {
      companyId: EMPRESA,
      criadaEm: new Date('2026-10-01T09:00:00.000Z'),
    })

    /* Uma retentativa de cadastro renovando o teste seria teste infinito de
       graca — e o caminho para isso e so repetir o POST. */
    expect(segunda.trialEndsAt).toBe(primeira.trialEndsAt)
  })

  it('o prazo sai da politica, e nao de um numero fixo no codigo', async () => {
    const d = { ...deps(), politica: { ...POLITICA, diasDeTeste: 7 } }

    const a = await startTrial(d, { companyId: EMPRESA, criadaEm: CRIADA_EM })

    /* QST-002 ainda aberta: o dia que o produto escolher entra por aqui. */
    expect(a.trialEndsAt?.slice(0, 10)).toBe('2026-09-26')
  })
})

const assinatura = (over: Partial<Subscription>): Subscription => ({
  companyId: EMPRESA,
  planCode: 'essencial',
  status: 'active',
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  couponId: null,
  restrictedAt: null,
  cancelledAt: null,
  nextDueDate: null,
  ...over,
})

describe('consulta do estado — RF-117', () => {
  it('empresa SEM assinatura continua lancando', async () => {
    const subscriptions = new InMemorySubscriptionRepository()

    const v = await getSubscription({ subscriptions }, contexto())

    /* As empresas que existem desde antes da assinatura existir cairiam todas
       aqui. Tratar ausencia como bloqueio trancaria todas de uma vez, na
       primeira subida — e sem ninguem ter sido avisado (RF-116). */
    expect([v.assinatura, v.status, v.podeLancar]).toEqual([null, null, true])
  })

  it('trial, ativa e vencida lancam; restrita e encerrada nao', async () => {
    for (const [status, esperado] of [
      ['trial', true],
      ['active', true],
      ['overdue', true],
      ['restricted', false],
      ['cancelled', false],
    ] as const) {
      const subscriptions = new InMemorySubscriptionRepository()
      subscriptions.semear(assinatura({ status }))

      const v = await getSubscription({ subscriptions }, contexto())

      expect([status, v.podeLancar]).toEqual([status, esperado])
    }
  })

  it('nao enxerga a assinatura de outra empresa', async () => {
    const subscriptions = new InMemorySubscriptionRepository()
    subscriptions.semear(assinatura({ status: 'restricted' }))

    const v = await getSubscription(
      { subscriptions },
      contexto('33333333-3333-4333-8333-333333333333'),
    )

    /* O bloqueio de uma loja nao pode atravessar para outra — e a consulta sai
       do `ctx`, nunca do corpo da requisicao. */
    expect([v.status, v.podeLancar]).toEqual([null, true])
  })
})
