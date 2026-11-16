import { paymentFeeSettingsInputSchema } from '@na-regua/contracts'
import {
  getPaymentFeeSettings,
  type PaymentFeeSettingsDeps,
  savePaymentFeeSettings,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Taxas de recebimento da loja — DEC-027 (NR-223).
 *
 * Leitura para todo mundo da loja (o PDV mostra o liquido com elas); gravacao
 * so do responsavel — quem decide isso e `core`, e nao a rota.
 */
export type TaxasDeRecebimentoDeps = PaymentFeeSettingsDeps

export function registerTaxasDeRecebimentoRoutes(
  app: FastifyInstance,
  deps: TaxasDeRecebimentoDeps,
): void {
  app.get('/taxas-de-recebimento', async (request, reply) => {
    const ctx = requireContext(request)
    return reply.code(200).send(await getPaymentFeeSettings(deps, ctx))
  })

  app.put(
    '/taxas-de-recebimento',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(paymentFeeSettingsInputSchema, request.body ?? {})
      return reply.code(200).send(await savePaymentFeeSettings(deps, ctx, input))
    },
  )
}
