import {
  AppError,
  type Channel,
  type CompanyId,
  type ExecutionContext,
  type UserId,
} from '@na-regua/core'
import type { Role, SubscriptionStatus } from '@na-regua/contracts'
import type { FastifyRequest } from 'fastify'

/**
 * Monta o contexto de execucao de uma requisicao HTTP.
 *
 * Quem RESOLVE o principal (valida token, descobre empresa e papel) e a
 * autenticacao — NR-014, que depende da DEC-008 e ainda nao existe. Este
 * arquivo entrega o resto: a forma do contexto, de onde vem cada campo, e a
 * costura onde a autenticacao encaixa.
 *
 * A separacao nao e so organizacao. `buildExecutionContext` e funcao pura de
 * (principal, requisicao) para contexto, entao da para testar a montagem sem
 * subir servidor nem simular token.
 */

/** O que a autenticacao devolve depois de validar a credencial. */
export type AuthenticatedPrincipal = {
  readonly companyId: CompanyId
  readonly userId: UserId
  readonly role: Role
  /**
   * A situacao da assinatura, lida pelo plugin de sessao nas requisicoes que
   * ESCREVEM — RF-117. Ausente nas leituras: ler vale em todos os estados.
   */
  readonly subscriptionStatus?: SubscriptionStatus | null
}

/** Cabecalho de idempotencia — RNF-043. Reenvio nao pode virar venda dobrada. */
export const IDEMPOTENCY_HEADER = 'idempotency-key'

export type ContextSource = {
  readonly requestId: string
  readonly idempotencyKey?: string | undefined
  readonly channel?: Channel | undefined
  /** Injetado para o caso de uso nao chamar `new Date()` por dentro. */
  readonly now?: Date | undefined
}

export function buildExecutionContext(
  principal: AuthenticatedPrincipal,
  source: ContextSource,
): ExecutionContext {
  return {
    companyId: principal.companyId,
    userId: principal.userId,
    role: principal.role,
    channel: source.channel ?? 'app',
    requestId: source.requestId,
    /*
     * `exactOptionalPropertyTypes` esta ligado: incluir a chave com `undefined`
     * nao e o mesmo que omiti-la. Por isso o spread condicional.
     */
    ...(source.idempotencyKey === undefined ? {} : { idempotencyKey: source.idempotencyKey }),
    now: source.now ?? new Date(),
    ...(principal.subscriptionStatus === undefined
      ? {}
      : { subscriptionStatus: principal.subscriptionStatus }),
  }
}

/**
 * Le o principal que a autenticacao anexou a requisicao.
 *
 * Lanca UNAUTHORIZED se nao houver — e o comportamento certo para rota
 * protegida chamada sem sessao valida. Enquanto NR-014 nao existe, nada
 * popula `request.principal` e toda rota que exigir contexto responde 401,
 * que e melhor que responder com um contexto inventado.
 */
export function requireContext(request: FastifyRequest): ExecutionContext {
  const principal = request.principal
  if (!principal) {
    throw AppError.unauthorized('Entre na sua conta para continuar.')
  }

  const idempotencyKey = request.headers[IDEMPOTENCY_HEADER]

  return buildExecutionContext(principal, {
    requestId: request.id,
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
  })
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Populado pela autenticacao — NR-014. */
    principal?: AuthenticatedPrincipal
  }
}
