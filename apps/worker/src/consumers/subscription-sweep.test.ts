import type { Subscription } from '@na-regua/contracts'
import { InMemorySubscriptionRepository } from '@na-regua/core'
import { describe, expect, it } from 'vitest'
import { consumirVarreduraDeAssinatura } from './subscription-sweep.js'
import type { ConsumerDeps } from './types.js'

/**
 * Varredura de assinatura — RF-111, RF-117, NR-063.
 *
 * O que se prova aqui e a ORQUESTRACAO: percorrer os tenants, somar, e nao
 * varrer quando nao ha politica. A regra de quando restringir ja esta em
 * `core/subscriptions/sweep-subscription.test.ts`, e repeti-la aqui criaria
 * dois lugares para mante-la.
 */

const POLITICA = { diasDeTeste: 14, diasDeAvisoDoFimDoTeste: 3, diasDeTolerancia: 5 }
const HOJE = new Date('2026-10-04T09:00:00.000Z')

const assinatura = (companyId: string, over: Partial<Subscription> = {}): Subscription => ({
  companyId,
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

function deps(entrada: {
  tenants: readonly string[]
  assinaturas?: readonly Subscription[]
  semPolitica?: boolean
}): ConsumerDeps {
  const subscriptions = new InMemorySubscriptionRepository()
  for (const a of entrada.assinaturas ?? []) subscriptions.semear(a)

  return {
    listTenantIds: async () => entrada.tenants,
    now: () => HOJE,
    ...(entrada.semPolitica === true ? {} : { assinatura: { subscriptions, politica: POLITICA } }),
  } as unknown as ConsumerDeps
}

describe('varredura de assinatura', () => {
  it('percorre todos os tenants e conta o que restringiu', async () => {
    const d = deps({
      tenants: ['e1', 'e2', 'e3'],
      assinaturas: [
        assinatura('e1'),
        assinatura('e2'),
        /* Ja ativa: o tempo nao mexe nela. */
        assinatura('e3', { status: 'active', trialEndsAt: null }),
      ],
    })

    const r = await consumirVarreduraDeAssinatura(d)

    expect(r.outcome).toBe('swept')
    expect(r.detalhes).toMatchObject({ empresas: 3, restringidas: 2 })
  })

  it('empresa sem assinatura nao derruba o laco', async () => {
    /* E o caso de todas as empresas anteriores a assinatura existir. Uma
       excecao na primeira delas pararia a varredura das outras. */
    const d = deps({ tenants: ['e1', 'e2'], assinaturas: [assinatura('e2')] })

    const r = await consumirVarreduraDeAssinatura(d)

    expect(r.detalhes).toMatchObject({ empresas: 2, restringidas: 1 })
  })

  it('conta quem precisa ser avisado do fim do teste', async () => {
    const d = deps({
      tenants: ['e1'],
      /* Termina em 06/10, e hoje e 04 — dentro da janela de 3 dias. */
      assinaturas: [assinatura('e1', { trialEndsAt: '2026-10-06T23:59:59.999Z' })],
    })

    const r = await consumirVarreduraDeAssinatura(d)

    expect(r.detalhes).toMatchObject({ restringidas: 0, aAvisar: 1 })
  })

  it('sem politica configurada, NAO varre e diz por que', async () => {
    const d = deps({ tenants: ['e1'], semPolitica: true })

    const r = await consumirVarreduraDeAssinatura(d)

    /* Varrer sem politica exigiria inventar quantos dias dura o teste, e o job
       estaria bloqueando lojas por um numero que ninguem escolheu. */
    expect(r.outcome).toBe('skipped')
    expect(r.detalhes).toMatchObject({ motivo: 'prazos de assinatura nao configurados' })
  })

  it('sem tenant nenhum devolve zero, e nao erro', async () => {
    const r = await consumirVarreduraDeAssinatura(deps({ tenants: [] }))

    expect(r.detalhes).toMatchObject({ empresas: 0, restringidas: 0 })
  })
})
