import { createVariableCostInputSchema } from '@na-regua/contracts'
import {
  createVariableCost,
  deleteVariableCost,
  listVariableCosts,
  type VariableCostDeps,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/** Custos variaveis — percentual sobre o preco de venda, Topico 6 do TXT. */
export type CustosVariaveisDeps = VariableCostDeps

export function registerCustosVariaveisRoutes(
  app: FastifyInstance,
  deps: CustosVariaveisDeps,
): void {
  app.get('/custos-variaveis', async (request, reply) => {
    const ctx = requireContext(request)

    return reply.code(200).send({ variableCosts: await listVariableCosts(deps, ctx) })
  })

  app.post(
    '/custos-variaveis',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(createVariableCostInputSchema, request.body)

      return reply.code(201).send(await createVariableCost(deps, ctx, input))
    },
  )

  app.delete(
    '/custos-variaveis/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }

      await deleteVariableCost(deps, ctx, id)

      return reply.code(204).send()
    },
  )
}
