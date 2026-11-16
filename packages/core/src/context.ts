import type { Role, SubscriptionStatus } from '@na-regua/contracts'

/**
 * Quem esta pedindo, por qual empresa e por qual canal.
 *
 * E o parametro que torna verificavel a promessa do produto: um caso de uso
 * recebe `(deps, ctx, input)` e nao sabe se veio do aplicativo ou do WhatsApp.
 * A diferenca entre canais termina em `ctx.channel` — daqui para frente e o
 * mesmo codigo, com as mesmas validacoes e a mesma auditoria.
 *
 * Ver docs/arquitetura/principios.md#1-core-e-o-nucleo
 */

/** Identificadores opacos. Formato e problema do `db`, nao de quem consome. */
export type CompanyId = string
export type UserId = string

/** Por onde a operacao entrou. */
export type Channel = 'app' | 'whatsapp' | 'api' | 'job'

export type ExecutionContext = {
  /**
   * Resolvido da autenticacao, NUNCA do corpo da requisicao — principio 8.
   * O isolamento entre empresas depende disso e de RLS no banco.
   */
  readonly companyId: CompanyId
  readonly userId: UserId
  readonly role: Role
  readonly channel: Channel
  /** Correlaciona logs de uma mesma requisicao — RNF-058. */
  readonly requestId: string
  /** Presente em escrita com valor. Reenvio nao pode virar venda dobrada. */
  readonly idempotencyKey?: string
  /**
   * Injetado, nunca lido de dentro do caso de uso.
   *
   * Regra que so vale se o relogio entrar por parametro: caso de uso que
   * chama `new Date()` nao e testavel sem congelar o relogio do processo.
   */
  readonly now: Date
  /**
   * A situacao da assinatura da loja quando o contexto foi montado — RF-117.
   *
   * Quem monta o contexto de uma ESCRITA (a api e o canal WhatsApp) le e
   * preenche; `assertCanWrite` recusa loja restrita ou cancelada. Ausente ou
   * nulo = nao ha assinatura, ou nao foi lida (leitura, job do sistema,
   * testes) — e ai ninguem e barrado: o bloqueio so pode atingir quem foi
   * avisado (RF-116).
   */
  readonly subscriptionStatus?: SubscriptionStatus | null
}

/**
 * Assinatura de todo caso de uso.
 *
 * `deps` e o grafo montado na raiz de composicao — repositorios e adapters.
 */
export type UseCase<Deps, Input, Output> = (
  deps: Deps,
  ctx: ExecutionContext,
  input: Input,
) => Promise<Output>
