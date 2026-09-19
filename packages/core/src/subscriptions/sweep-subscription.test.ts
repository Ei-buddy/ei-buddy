import type { Subscription } from '@na-regua/contracts'
import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '../context.js'
import type { PoliticaDeAssinatura } from './estado.js'
import { InMemorySubscriptionRepository } from './fakes.js'
import { sweepSubscription } from './sweep-subscription.js'

/* Fixture, nao politica do produto: a QST-002 segue aberta. */
const POLITICA: PoliticaDeAssinatura = {
  diasDeTeste: 14,
  diasDeAvisoDoFimDoTeste: 3,
  diasDeTolerancia: 5,
}

const EMPRESA = '11111111-1111-4111-8111-111111111111'

const contexto = (hoje: string): ExecutionContext =>
  ({
    companyId: EMPRESA,
    userId: 'job',
    role: 'owner',
    channel: 'job',
    requestId: 'subscription-sweep',
    now: new Date(`${hoje}T09:00:00.000Z`),
  }) as ExecutionContext

const assinatura = (over: Partial<Subscription>): Subscription => ({
  companyId: EMPRESA,
  planCode: 'essencial',
  status: 'trial',
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  couponId: null,
  restrictedAt: null,
  cancelledAt: null,
  nextDueDate: null,
  ...over,
})

const comAssinatura = (over: Partial<Subscription>) => {
  const subscriptions = new InMemorySubscriptionRepository()
  subscriptions.semear(assinatura(over))
  return { subscriptions, politica: POLITICA }
}

describe('fim do periodo de teste — RF-117', () => {
  it('restringe quando o teste venceu sem plano', async () => {
    const deps = comAssinatura({ status: 'trial', trialEndsAt: '2026-10-03T23:59:59.999Z' })

    const r = await sweepSubscription(deps, contexto('2026-10-04'))

    expect([r.status, r.mudou]).toEqual(['restricted', true])
    const gravada = await deps.subscriptions.findByCompany(EMPRESA)
    expect(gravada?.status).toBe('restricted')
    /* A tela precisa dizer desde quando, e e a varredura que sabe o momento. */
    expect(gravada?.restrictedAt).not.toBeNull()
  })

  it('o ultimo dia do teste ainda escreve', async () => {
    const deps = comAssinatura({ status: 'trial', trialEndsAt: '2026-10-03T23:59:59.999Z' })

    const r = await sweepSubscription(deps, contexto('2026-10-03'))

    expect(r.mudou).toBe(false)
    expect((await deps.subscriptions.findByCompany(EMPRESA))?.status).toBe('trial')
  })
})

describe('fim da tolerancia — RF-116, RF-117', () => {
  it('a loja vencida continua escrevendo durante a tolerancia', async () => {
    const deps = comAssinatura({ status: 'overdue', nextDueDate: '2026-10-05' })

    const r = await sweepSubscription(deps, contexto('2026-10-10'))

    /* Bloquear no vencimento seria nao ter tolerancia nenhuma. */
    expect([r.status, r.mudou]).toEqual(['overdue', false])
  })

  it('restringe no dia seguinte ao fim da tolerancia', async () => {
    const deps = comAssinatura({ status: 'overdue', nextDueDate: '2026-10-05' })

    const r = await sweepSubscription(deps, contexto('2026-10-11'))

    expect([r.status, r.mudou]).toEqual(['restricted', true])
  })
})

describe('a varredura e repetivel', () => {
  it('rodar de novo no mesmo dia nao muda nada', async () => {
    const deps = comAssinatura({ status: 'trial', trialEndsAt: '2026-10-03T23:59:59.999Z' })

    const primeira = await sweepSubscription(deps, contexto('2026-10-04'))
    const segunda = await sweepSubscription(deps, contexto('2026-10-04'))

    /* Varredura que nao suporta repeticao e varredura que ninguem pode
       reexecutar depois de uma falha no meio do laco. */
    expect([primeira.mudou, segunda.mudou]).toEqual([true, false])
  })

  it('nao mexe em ativa, restrita nem encerrada', async () => {
    for (const status of ['active', 'restricted', 'cancelled'] as const) {
      const deps = comAssinatura({ status, nextDueDate: '2026-01-01' })
      const r = await sweepSubscription(deps, contexto('2027-01-01'))
      expect([status, r.mudou]).toEqual([status, false])
    }
  })

  it('empresa sem assinatura nao e erro', async () => {
    const deps = { subscriptions: new InMemorySubscriptionRepository(), politica: POLITICA }

    const r = await sweepSubscription(deps, contexto('2026-10-04'))

    /* E o caso de todas as empresas anteriores a assinatura existir; uma
       excecao aqui derrubaria a varredura inteira na primeira delas. */
    expect([r.status, r.mudou]).toEqual([null, false])
  })
})

describe('aviso do fim do teste — RF-111', () => {
  it('avisa durante a janela, sem mudar o estado', async () => {
    const deps = comAssinatura({ status: 'trial', trialEndsAt: '2026-10-03T23:59:59.999Z' })

    const r = await sweepSubscription(deps, contexto('2026-10-01'))

    expect([r.mudou, r.avisarDoFimDoTeste]).toEqual([false, true])
  })

  it('nao avisa cedo demais', async () => {
    const deps = comAssinatura({ status: 'trial', trialEndsAt: '2026-10-03T23:59:59.999Z' })

    expect((await sweepSubscription(deps, contexto('2026-09-29'))).avisarDoFimDoTeste).toBe(false)
  })

  it('no dia em que restringe, NAO avisa que esta acabando', async () => {
    const deps = comAssinatura({ status: 'trial', trialEndsAt: '2026-10-03T23:59:59.999Z' })

    const r = await sweepSubscription(deps, contexto('2026-10-04'))

    /* A mensagem passou a ser outra — "acabou", nao "esta acabando". Mandar as
       duas no mesmo dia e o lojista recebendo um aviso que ja nao vale. */
    expect([r.status, r.avisarDoFimDoTeste]).toEqual(['restricted', false])
  })
})
