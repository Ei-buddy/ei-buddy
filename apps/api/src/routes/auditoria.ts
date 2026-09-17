import { auditQueryInputSchema } from '@na-regua/contracts'
import { listAuditActors, listAuditTrail, type ListAuditTrailDeps } from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { validate } from '../plugins/validate.js'

/**
 * Consultar a trilha de auditoria — US-061.
 *
 * Exige empresa ativa, e isso e a decisao de produto e nao um detalhe: a trilha
 * e da LOJA. O Super Admin ve a lista de todas as lojas no painel, mas so le a
 * trilha de uma depois de entrar nela — e a entrada dele fica registrada na
 * propria trilha que ele vai ler.
 *
 * Quem pode ler (so o dono) e decidido no caso de uso, nao aqui: o WhatsApp usa
 * os mesmos casos de uso, e uma regra de papel no handler HTTP deixaria o outro
 * canal sem ela.
 */

export type AuditoriaDeps = ListAuditTrailDeps

export function registerAuditoriaRoutes(app: FastifyInstance, deps: AuditoriaDeps): void {
  /**
   * Quem agiu na loja — a tela abre por esta lista, e nao pela trilha.
   *
   * Rota separada, e nao um `groupBy` na mesma: sao perguntas diferentes, e
   * juntar as duas num parametro faria a tela pedir a trilha inteira so para
   * descobrir quem sao as pessoas.
   */
  app.get('/auditoria/pessoas', async (request, reply) => {
    const ctx = requireContext(request)

    return reply.code(200).send(await listAuditActors(deps, ctx))
  })

  app.get('/auditoria', async (request, reply) => {
    const ctx = requireContext(request)

    const input = validate(auditQueryInputSchema, request.query ?? {})
    const trilha = await listAuditTrail(deps, ctx, input)

    return reply.code(200).send(trilha)
  })
}
