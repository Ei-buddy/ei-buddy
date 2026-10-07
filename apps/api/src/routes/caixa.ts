import {
  cashMovementInputSchema,
  closeCashInputSchema,
  openCashInputSchema,
} from '@na-regua/contracts'
import {
  addCashMovement,
  type CashDeps,
  cashHistory,
  closeCash,
  currentCash,
  openCash,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Abertura e fechamento de caixa — NR-157.
 *
 * `GET /caixa` responde 200 com `current: null` quando nao ha caixa aberto:
 * "caixa fechado" e um estado normal da loja, e nao um recurso que falta.
 */
export type CaixaDeps = CashDeps

export function registerCaixaRoutes(app: FastifyInstance, deps: CaixaDeps): void {
  app.get('/caixa', async (request, reply) => {
    const ctx = requireContext(request)
    return reply.code(200).send({ current: await currentCash(deps, ctx) })
  })

  app.get('/caixa/historico', async (request, reply) => {
    const ctx = requireContext(request)
    return reply.code(200).send({ sessions: await cashHistory(deps, ctx) })
  })

  app.post('/caixa/abrir', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(openCashInputSchema, request.body)
    return reply.code(201).send(await openCash(deps, ctx, input))
  })

  app.post(
    '/caixa/movimentos',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(cashMovementInputSchema, request.body)
      return reply.code(201).send(await addCashMovement(deps, ctx, input))
    },
  )

  app.post(
    '/caixa/fechar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(closeCashInputSchema, request.body)
      return reply.code(200).send(await closeCash(deps, ctx, input))
    },
  )
}
