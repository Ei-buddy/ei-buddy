import {
  resendPartnerApplicationInputSchema,
  reviewPartnerApplicationInputSchema,
} from '@na-regua/contracts'
import {
  AppError,
  approvePartnerApplication,
  getMyPartnerApplication,
  listPendingPartnerApplications,
  rejectPartnerApplication,
  resendPartnerApplication,
  type MyPartnerApplicationDeps,
  type ResendPartnerApplicationDeps,
  type ReviewPartnerApplicationDeps,
  type SessionClaims,
} from '@na-regua/core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { validate } from '../plugins/validate.js'

/**
 * Conta de Parceiro — NR-115, ADR-0013.
 *
 * `/admin/parceiros*` segue o mesmo molde de `routes/admin.ts`: le
 * `request.sessionClaims` direto, sem `requireContext` — quem revisa
 * candidatura e Super Admin, que pode nao ter empresa ativa nenhuma no
 * momento. `/parceiros/*` (self-service) e o oposto: `requireContext`
 * normal, porque e a PROPRIA empresa lendo/reenviando a candidatura dela.
 */

export type PartnersRouteDeps = ReviewPartnerApplicationDeps &
  ResendPartnerApplicationDeps &
  MyPartnerApplicationDeps

function sessaoOuFalha(request: FastifyRequest): SessionClaims {
  const claims = request.sessionClaims
  if (claims === undefined) {
    throw AppError.unauthorized('Entre na sua conta para continuar.')
  }
  return claims
}

export function registerPartnersRoutes(app: FastifyInstance, deps: PartnersRouteDeps): void {
  /** Fila de aprovacao — so Super Admin (checado dentro do caso de uso). */
  app.get('/admin/parceiros', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const fila = await listPendingPartnerApplications(deps, sessao.userId)
    return reply.code(200).send({ applications: fila })
  })

  app.post('/admin/parceiros/:id/aprovar', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const { id } = request.params as { id: string }
    const input = validate(reviewPartnerApplicationInputSchema, request.body ?? {})

    await approvePartnerApplication(deps, sessao.userId, id, input.note)

    return reply.code(200).send({ ok: true })
  })

  app.post('/admin/parceiros/:id/recusar', async (request, reply) => {
    const sessao = sessaoOuFalha(request)
    const { id } = request.params as { id: string }
    const input = validate(reviewPartnerApplicationInputSchema, request.body ?? {})

    await rejectPartnerApplication(deps, sessao.userId, id, input.note)

    return reply.code(200).send({ ok: true })
  })

  /** Self-service: a propria empresa le o status da candidatura dela. */
  app.get('/parceiros/mim', async (request, reply) => {
    const ctx = requireContext(request)
    const minha = await getMyPartnerApplication(deps, ctx)

    /* `null` explicito, e nao 404: "nunca se candidatou" nao e erro, e um
       estado de resposta valido — a tela decide o que mostrar. */
    return reply.code(200).send({ application: minha ?? null })
  })

  app.post('/parceiros/reenviar', async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(resendPartnerApplicationInputSchema, request.body)

    await resendPartnerApplication(deps, ctx, input)

    return reply.code(200).send({ ok: true })
  })
}
