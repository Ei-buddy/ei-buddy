import { createPurchaseInputSchema } from '@na-regua/contracts'
import {
  listPurchases,
  type ListPurchasesDeps,
  registerPurchase,
  type RegisterPurchaseDeps,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Entrada de mercadoria — NR-158.
 *
 * Uma compra soma ao estoque, atualiza o custo e lanca a conta a pagar ao
 * fornecedor, numa transacao so.
 */
export type ComprasDeps = RegisterPurchaseDeps & ListPurchasesDeps

export function registerComprasRoutes(app: FastifyInstance, deps: ComprasDeps): void {
  app.get('/compras', async (request, reply) => {
    const ctx = requireContext(request)
    return reply.code(200).send({ purchases: await listPurchases(deps, ctx) })
  })

  app.post('/compras', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(createPurchaseInputSchema, request.body)
    return reply.code(201).send(await registerPurchase(deps, ctx, input))
  })
}
