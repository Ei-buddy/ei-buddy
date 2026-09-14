import type { PendingPartnerApplication } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { UserId } from '../context.js'
import type { PartnerApplicationRepository } from '../ports/partner-application-repository.js'
import type { PlatformAdminAccess } from '../ports/platform-admin.js'

/**
 * Aprovacao de conta de Parceiro pelo Super Admin — NR-115, ADR-0013.
 *
 * Mesma disciplina de `waitlist-admin.ts`: ninguem chega perto da fila ou da
 * decisao sem `isPlatformAdmin` confirmado ANTES, com `AppError.forbidden`
 * legivel — a funcao SQL confere de novo, mas so como defesa em profundidade,
 * nao como a primeira barreira.
 */

export type ReviewPartnerApplicationDeps = {
  readonly partners: PartnerApplicationRepository
  readonly platformAdmin: PlatformAdminAccess
}

const MSG_NAO_E_ADMIN = 'Esta conta nao tem acesso de Super Admin.'

async function exigirSuperAdmin(deps: ReviewPartnerApplicationDeps, userId: UserId): Promise<void> {
  if (!(await deps.platformAdmin.isPlatformAdmin(userId))) {
    throw AppError.forbidden(MSG_NAO_E_ADMIN)
  }
}

export async function listPendingPartnerApplications(
  deps: ReviewPartnerApplicationDeps,
  requestedBy: UserId,
): Promise<readonly PendingPartnerApplication[]> {
  await exigirSuperAdmin(deps, requestedBy)
  return deps.partners.listPending(requestedBy)
}

export async function approvePartnerApplication(
  deps: ReviewPartnerApplicationDeps,
  reviewedBy: UserId,
  partnerId: string,
  note?: string,
): Promise<void> {
  await exigirSuperAdmin(deps, reviewedBy)
  await deps.partners.review({ reviewedBy, partnerId, decision: 'approve', note })
}

export async function rejectPartnerApplication(
  deps: ReviewPartnerApplicationDeps,
  reviewedBy: UserId,
  partnerId: string,
  note?: string,
): Promise<void> {
  await exigirSuperAdmin(deps, reviewedBy)
  await deps.partners.review({ reviewedBy, partnerId, decision: 'reject', note })
}
