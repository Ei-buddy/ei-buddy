import type { SubscriptionViewOutput } from '@na-regua/contracts'
import { getSubscription, type GetSubscriptionDeps } from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'

/**
 * A situacao da assinatura da loja — NR-216, RF-117.
 *
 * A web lia o estado do armazenamento do navegador (`demo:subscription-status`)
 * e o app nem perguntava. O caso de uso existia desde a NR-063; faltava a
 * rota. Leitura e por isso vale em TODOS os estados, inclusive restrita —
 * a loja precisa saber por que esta restrita.
 */

export type AssinaturaDeps = GetSubscriptionDeps

export function registerAssinaturaRoutes(app: FastifyInstance, deps: AssinaturaDeps): void {
  app.get('/assinatura', async (request, reply) => {
    const ctx = requireContext(request)
    const view = await getSubscription(deps, ctx)

    const corpo: SubscriptionViewOutput = {
      subscription: view.assinatura,
      status: view.status,
      canWrite: view.podeLancar,
    }
    return reply.code(200).send(corpo)
  })
}
