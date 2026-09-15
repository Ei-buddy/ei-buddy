import { aceiteLegalInputSchema, type PendenciasLegais, VERSOES_LEGAIS } from '@na-regua/contracts'
import {
  pendingLegalAcceptance,
  recordLegalAcceptance,
  type LegalConsentDeps,
} from '@na-regua/core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError } from '@na-regua/core'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Documentos legais: o que falta aceitar, e o reaceite — RF-03.
 *
 * ## Por que nao passa por `requireContext`
 *
 * O aceite e da PESSOA, nao da loja. Quem tem sessao mas ainda nao escolheu
 * empresa (ou e Super Admin, que nao tem empresa ativa) precisa poder aceitar
 * os termos igual — exigir contexto de empresa aqui deixaria essas contas sem
 * caminho nenhum para regularizar a pendencia. Por isso a rota le
 * `request.principal` direto, como `/admin/*` faz.
 */

export type LegalRouteDeps = LegalConsentDeps

/** O `userId` da sessao, sem exigir empresa ativa. */
function usuarioOuFalha(request: FastifyRequest): string {
  const principal = request.principal
  if (principal === undefined) throw AppError.unauthorized()
  return principal.userId
}

export function registerLegalRoutes(app: FastifyInstance, deps: LegalRouteDeps): void {
  /**
   * As versoes em vigor — publica, sem sessao.
   *
   * O mobile usa isto para saber o que esta no ar sem embutir copia do texto:
   * ele abre as paginas do web, que sao a fonte unica.
   */
  app.get('/legal/versoes', async (_request, reply) =>
    reply.code(200).send({ versoes: VERSOES_LEGAIS }),
  )

  /** O que esta pessoa ainda precisa aceitar. Lista vazia = em dia. */
  app.get('/legal/pendencias', async (request, reply) => {
    const userId = usuarioOuFalha(request)

    const pendencias: PendenciasLegais = await pendingLegalAcceptance(deps, userId)

    return reply.code(200).send(pendencias)
  })

  /**
   * Registra o aceite das versoes vigentes.
   *
   * O corpo e vazio de proposito — quem decide a versao gravada e o servidor.
   * Ver `aceiteLegalInputSchema` para o motivo.
   */
  app.post(
    '/legal/aceites',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const userId = usuarioOuFalha(request)
      validate(aceiteLegalInputSchema, request.body ?? {})

      await recordLegalAcceptance(deps, userId, {
        ip: request.ip,
        ...(request.headers['user-agent'] === undefined
          ? {}
          : { userAgent: request.headers['user-agent'] }),
      })

      /* Devolve a pendencia recalculada: a tela fecha o aviso com a resposta que
       ja tem em maos, sem uma segunda ida ao servidor para confirmar. */
      return reply.code(200).send(await pendingLegalAcceptance(deps, userId))
    },
  )
}
