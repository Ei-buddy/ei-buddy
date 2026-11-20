import { cancelSaleServiceInvoiceInputSchema } from '@na-regua/contracts'
import {
  cancelSaleServiceInvoice,
  type CancelServiceInvoiceDeps,
  getSaleServiceInvoice,
  type GetServiceInvoiceDeps,
  requestServiceInvoice,
  type RequestServiceInvoiceDeps,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * NFS-e nacional da venda — DEC-031, NR-241.
 *
 * Tres rotas, do mesmo jeito que a NFC-e: pedir, ver o estado e cancelar. A
 * diferenca e que a NFS-e fica "processando" por um tempo — a tela consulta
 * `GET` de novo, e a visita aproveita para perguntar ao provedor.
 */

export type NfseDeps = RequestServiceInvoiceDeps & GetServiceInvoiceDeps & CancelServiceInvoiceDeps

export function registerNfseRoutes(app: FastifyInstance, deps: NfseDeps): void {
  /**
   * Pede a NFS-e. `202`: o Ambiente Nacional ainda nao viu o pedido — a nota
   * volta "processando", e nao emitida.
   */
  app.post(
    '/vendas/:id/nfse',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }

      const r = await requestServiceInvoice(deps, ctx, { saleId: id })

      return reply.code(202).send(r)
    },
  )

  /** O estado da NFS-e da venda. `null` quando ela nunca foi pedida. */
  app.get('/vendas/:id/nfse', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    const r = await getSaleServiceInvoice(deps, ctx, { saleId: id })

    return reply.code(200).send({ serviceInvoice: r })
  })

  /** Cancela a NFS-e autorizada da venda. */
  app.post(
    '/vendas/:id/nfse/cancelamento',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const input = validate(cancelSaleServiceInvoiceInputSchema, request.body)

      const r = await cancelSaleServiceInvoice(deps, ctx, { saleId: id, reason: input.reason })

      return reply.code(200).send(r)
    },
  )
}
