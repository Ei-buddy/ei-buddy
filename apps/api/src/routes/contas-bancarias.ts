import { createBankAccountInputSchema } from '@na-regua/contracts'
import {
  type BankAccountDeps,
  createBankAccount,
  deleteBankAccount,
  listBankAccounts,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Contas bancarias da loja — RF-073, US-035.
 *
 * A lista ja vem com o saldo de cada conta: e o numero que o lojista abre a
 * tela para ver, e calcula-lo na tela exigiria trazer todas as baixas.
 */
export type ContasBancariasDeps = BankAccountDeps

export function registerContasBancariasRoutes(
  app: FastifyInstance,
  deps: ContasBancariasDeps,
): void {
  app.get('/contas-bancarias', async (request, reply) => {
    const ctx = requireContext(request)
    return reply.code(200).send({ accounts: await listBankAccounts(deps, ctx) })
  })

  app.post(
    '/contas-bancarias',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(createBankAccountInputSchema, request.body)
      return reply.code(201).send(await createBankAccount(deps, ctx, input))
    },
  )

  app.delete(
    '/contas-bancarias/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      await deleteBankAccount(deps, ctx, id)
      return reply.code(204).send()
    },
  )
}
