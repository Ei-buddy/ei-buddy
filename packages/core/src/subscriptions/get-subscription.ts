import { podeEscrever, type Subscription, type SubscriptionStatus } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import type { SubscriptionRepository } from '../ports/subscription-repository.js'

export type GetSubscriptionDeps = {
  readonly subscriptions: SubscriptionRepository
}

/**
 * O estado da assinatura da empresa ativa — RF-117.
 *
 * `podeLancar` vem junto, calculado, e nao e a tela que deriva do status. A
 * pergunta "posso lancar?" e feita por web, mobile e assistente, e tres
 * derivacoes independentes da mesma regra e como uma delas fica para tras
 * quando um estado novo entra no enum.
 */
export type SubscriptionView = {
  readonly assinatura: Subscription | null
  readonly status: SubscriptionStatus | null
  readonly podeLancar: boolean
}

/**
 * Empresa sem assinatura nenhuma ESCREVE.
 *
 * E o caso das empresas que existem desde antes da assinatura existir. Tratar
 * ausencia como bloqueio trancaria todas elas de uma vez, na primeira subida —
 * e o bloqueio por inadimplencia so pode atingir quem foi avisado (RF-116).
 */
export async function getSubscription(
  deps: GetSubscriptionDeps,
  ctx: ExecutionContext,
): Promise<SubscriptionView> {
  const assinatura = await deps.subscriptions.findByCompany(ctx.companyId)

  if (assinatura === undefined) {
    return { assinatura: null, status: null, podeLancar: true }
  }

  return {
    assinatura,
    status: assinatura.status,
    podeLancar: podeEscrever(assinatura.status),
  }
}
