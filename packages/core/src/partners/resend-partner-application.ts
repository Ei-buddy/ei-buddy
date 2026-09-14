import type { ResendPartnerApplicationInput } from '@na-regua/contracts'
import type { ExecutionContext } from '../context.js'
import type { PartnerApplicationRepository } from '../ports/partner-application-repository.js'

export type ResendPartnerApplicationDeps = {
  readonly partners: PartnerApplicationRepository
}

/**
 * Reenvio de candidatura recusada — NR-115, ADR-0013.
 *
 * `ctx.companyId` ja e a empresa autenticada (principio 8) — nao ha checagem
 * extra de dono aqui porque a candidatura pertence a EMPRESA, e a sessao so
 * chega com `companyId` preenchido depois do login/cadastro daquela empresa.
 */
export async function resendPartnerApplication(
  deps: ResendPartnerApplicationDeps,
  ctx: ExecutionContext,
  input: ResendPartnerApplicationInput,
): Promise<void> {
  await deps.partners.resend({
    ownerCompanyId: ctx.companyId,
    pixKey: input.pixKey,
    pixKeyType: input.pixKeyType,
    message: input.message,
  })
}
