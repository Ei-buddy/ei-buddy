import {
  createCrmCardInputSchema,
  crmCommentInputSchema,
  moveCrmCardInputSchema,
} from '@na-regua/contracts'
import {
  commentOnCrmCard,
  createCrmCard,
  deleteCrmCard,
  listCrmBoard,
  listTeam,
  moveCrmCard,
  type CrmDeps,
  type TeamDeps,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * O quadro de CRM e a equipe — NR-109.
 *
 * A tela existia inteira sobre `mock-data`: criar card, mover coluna e
 * comentar eram `await delay(...)` seguidos de sucesso, e o quadro voltava aos
 * mesmos tres cartoes de exemplo a cada abertura.
 *
 * `/equipe` mora aqui e nao em `/crm/equipe`: e o seletor de responsavel do
 * card hoje, mas a porta (`TeamRepository`) le `company_users` direto, sem
 * nada de CRM — qualquer outra tela que precise "quem esta na equipe"
 * reaproveita a mesma rota.
 */

export type CrmRouteDeps = CrmDeps & TeamDeps

export function registerCrmRoutes(app: FastifyInstance, deps: CrmRouteDeps): void {
  app.get('/crm/cards', async (request, reply) => {
    const ctx = requireContext(request)

    return reply.code(200).send(await listCrmBoard(deps, ctx))
  })

  app.post('/crm/cards', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(createCrmCardInputSchema, request.body)

    return reply.code(201).send(await createCrmCard(deps, ctx, input))
  })

  app.patch(
    '/crm/cards/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const input = validate(moveCrmCardInputSchema, request.body)

      return reply.code(200).send(await moveCrmCard(deps, ctx, id, input.column))
    },
  )

  /** Excluir o card — NR-213. `204`: nao ha corpo a devolver. */
  app.delete(
    '/crm/cards/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }

      await deleteCrmCard(deps, ctx, id)
      return reply.code(204).send()
    },
  )

  app.post(
    '/crm/cards/:id/comentarios',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const input = validate(crmCommentInputSchema, request.body)

      return reply.code(201).send(await commentOnCrmCard(deps, ctx, id, input.text))
    },
  )

  app.get('/equipe', async (request, reply) => {
    const ctx = requireContext(request)

    return reply.code(200).send(await listTeam(deps, ctx))
  })
}
