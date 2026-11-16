import type { SubscriptionStatus } from '@na-regua/contracts'
import type { SessionClaims, SessionIssuer } from '@na-regua/core'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * Le a sessao da requisicao e popula `request.principal` — NR-014, RF-119.
 *
 * Este e o arquivo que faltava para `requireContext` parar de responder 401 em
 * tudo. A costura ja estava desenhada em `execution-context.ts`; aqui ela
 * ganha o outro lado.
 *
 * **Nao decide nada.** Se o token e valido, quem diz e `SessionIssuer.read`;
 * se o papel permite a acao, quem diz e `core`. Este plugin so traduz "tem
 * token bom" em "tem principal", e a distincao importa: qualquer regra que
 * morasse aqui seria uma regra que o canal WhatsApp nao aplica.
 */

/** `Authorization: Bearer <token>`. */
const PREFIXO = 'Bearer '

export function lerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith(PREFIXO)) return undefined

  const token = header.slice(PREFIXO.length).trim()
  return token.length === 0 ? undefined : token
}

/**
 * Sessao sem empresa escolhida NAO vira principal.
 *
 * `SessionClaims` e uniao discriminada justamente para isso: sessao com
 * `companyId: null` nao tem papel, e um principal sem papel entraria em
 * `assertCanWrite` como `undefined` — que e como uma verificacao de permissao
 * vira um `if` sempre falso.
 *
 * Quem esta nesse estado precisa chamar `/auth/select-company` primeiro. As
 * rotas de negocio respondem 401, que e verdade: nao ha sessao *operavel*.
 */
export function paraPrincipal(claims: SessionClaims) {
  if (claims.companyId === null) return undefined
  return { companyId: claims.companyId, userId: claims.userId, role: claims.role }
}

/** Metodos que so leem: a assinatura nao e consultada neles (RF-117). */
const SO_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * A situacao da assinatura da loja — RF-117. `null` = sem assinatura.
 * Opcional para os testes que nao falam de assinatura; a api sempre liga.
 */
export type SituacaoDaAssinatura = (companyId: string) => Promise<SubscriptionStatus | null>

export function registerSession(
  app: FastifyInstance,
  sessions: SessionIssuer,
  situacaoDaAssinatura?: SituacaoDaAssinatura,
): void {
  /*
   * `onRequest` e nao `preHandler`: o principal precisa existir antes de
   * qualquer hook de rota, e ler um token nao depende do corpo da requisicao.
   */
  app.addHook('onRequest', async (request) => {
    const token = lerToken(request)
    if (token === undefined) return

    const claims = await sessions.read(token)
    /* Token invalido, expirado ou adulterado nao lanca aqui: segue sem
       principal, e quem exige contexto responde 401. Lancar transformaria um
       token velho num 500 em rota publica, como a de login. */
    if (claims === undefined) return

    const principal = paraPrincipal(claims)
    if (principal !== undefined) {
      /*
       * Loja restrita so le — RF-117. A situacao vai no principal, e quem
       * recusa e `assertCanWrite`, em `core`: aqui so se le. So nas
       * requisicoes que escrevem, para leitura nao pagar uma consulta a mais.
       */
      const escreve = !SO_LEITURA.has(request.method)
      request.principal =
        escreve && situacaoDaAssinatura !== undefined
          ? { ...principal, subscriptionStatus: await situacaoDaAssinatura(principal.companyId) }
          : principal
    }

    /* Guardado inteiro para as rotas de sessao: `/auth/select-company` precisa
       do `userId` de uma sessao que ainda NAO tem empresa — e por isso ela nao
       pode depender de `request.principal`. */
    request.sessionClaims = claims
  })
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionClaims?: SessionClaims
  }
}
