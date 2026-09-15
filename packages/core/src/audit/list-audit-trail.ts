import type { AuditLogOutput, AuditQueryInput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type { AuditQueries } from '../ports/audit-trail.js'

/**
 * Consultar a trilha de auditoria — US-061, RF-123.
 *
 * ## O que faltava
 *
 * A US-061 tem tres criterios, e so os dois primeiros existiam: a trilha
 * gravava autor/canal/data/antes/depois, e o banco impedia alterar. O
 * terceiro — "DADO uma acao feita pelo assistente QUANDO consulto ENTAO vejo o
 * usuario humano que confirmou" — nunca teve como acontecer, porque **nada
 * lia**. Dezesseis pontos do sistema escreviam numa tabela sem leitor.
 *
 * ## Por que so o dono
 *
 * A historia e "resolver divergencia com meu funcionario". A trilha mostra o
 * que cada pessoa fez; entregar isso ao proprio funcionario auditado inverte o
 * instrumento. `staff` fica de fora por isso, e `accountant` porque o acesso
 * dele e o dado contabil, nao o comportamento de quem opera.
 *
 * O Super Admin cai aqui como `owner` (ADR-0007, `PAPEL_AO_ENTRAR`) quando
 * entra numa loja — que e exatamente o caminho previsto para ele ver a trilha,
 * e que exige justificativa registrada.
 */

export type ListAuditTrailDeps = {
  readonly auditQueries: AuditQueries
}

export async function listAuditTrail(
  deps: ListAuditTrailDeps,
  ctx: ExecutionContext,
  input: AuditQueryInput,
): Promise<AuditLogOutput> {
  if (ctx.role !== 'owner') {
    throw AppError.forbidden('Somente o responsável pela loja vê a trilha de auditoria.')
  }

  const { entries, total } = await deps.auditQueries.list(ctx.companyId, input)

  return {
    entries: [...entries],
    total,
    page: input.page,
    pageSize: input.pageSize,
  }
}
