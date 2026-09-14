import type { MyPartnerApplicationOutput } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import type { PartnerApplicationRepository } from '../ports/partner-application-repository.js'

export type MyPartnerApplicationDeps = {
  readonly partners: PartnerApplicationRepository
}

/**
 * Status da propria candidatura de Parceiro — NR-115.
 *
 * `undefined` e resposta valida: a empresa nunca pediu para ser Parceira. Nao
 * e erro, e por isso nao lanca — a tela decide o que mostrar (nada, ou um
 * convite para se candidatar).
 */
export async function getMyPartnerApplication(
  deps: MyPartnerApplicationDeps,
  ctx: ExecutionContext,
): Promise<MyPartnerApplicationOutput | undefined> {
  return deps.partners.mine(ctx.companyId)
}
