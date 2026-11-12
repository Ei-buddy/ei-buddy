import type {
  SupportInboxDetail,
  SupportInboxOutput,
  SupportInboxQuery,
  SupportReplyInput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import type { UserId } from '../context.js'
import type { PlatformAdminAccess } from '../ports/platform-admin.js'
import type { SupportInbox } from '../ports/support-inbox.js'

/**
 * A fila de chamados da plataforma — NR-215.
 *
 * Achado do QA: "Suporte — como enxergaremos os chamados?". O chamado so
 * existia dentro da loja, e nada respondia como "suporte". Aqui a equipe
 * EiBuddy ve todas as lojas, responde e encerra.
 *
 * Quem pode e conferido aqui E no banco: aqui para a resposta ser um 403
 * claro; la para que nenhum caminho novo atravesse empresas sem a checagem.
 */

export type PlatformInboxDeps = {
  readonly access: Pick<PlatformAdminAccess, 'isPlatformAdmin'>
  readonly inbox: SupportInbox
}

const MSG_NAO_E_ADMIN = 'Esta conta nao tem acesso de Super Admin.'

async function exigirSuperAdmin(deps: PlatformInboxDeps, userId: UserId): Promise<void> {
  if (!(await deps.access.isPlatformAdmin(userId))) throw AppError.forbidden(MSG_NAO_E_ADMIN)
}

export async function listSupportInbox(
  deps: PlatformInboxDeps,
  requestedBy: UserId,
  query: SupportInboxQuery,
): Promise<SupportInboxOutput> {
  await exigirSuperAdmin(deps, requestedBy)
  const [counts, pagina] = await Promise.all([
    deps.inbox.counts(requestedBy),
    deps.inbox.list(requestedBy, {
      situacao: query.situation,
      limite: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }),
  ])
  return {
    tickets: [...pagina.tickets],
    total: pagina.total,
    page: query.page,
    pageSize: query.pageSize,
    counts,
  }
}

export async function getSupportInboxTicket(
  deps: PlatformInboxDeps,
  requestedBy: UserId,
  ticketId: string,
): Promise<SupportInboxDetail> {
  await exigirSuperAdmin(deps, requestedBy)
  const chamado = await deps.inbox.find(requestedBy, ticketId)
  if (chamado === undefined) throw AppError.notFound('Chamado não encontrado.')
  return chamado
}

/** Responde como "Suporte EiBuddy". Reabre o chamado encerrado. */
export async function replyAsSupport(
  deps: PlatformInboxDeps,
  requestedBy: UserId,
  ticketId: string,
  input: SupportReplyInput,
): Promise<SupportInboxDetail> {
  await exigirSuperAdmin(deps, requestedBy)
  if (!(await deps.inbox.reply(requestedBy, ticketId, input.body))) {
    throw AppError.notFound('Chamado não encontrado.')
  }
  return getSupportInboxTicket(deps, requestedBy, ticketId)
}

export async function closeSupportTicket(
  deps: PlatformInboxDeps,
  requestedBy: UserId,
  ticketId: string,
): Promise<SupportInboxDetail> {
  await exigirSuperAdmin(deps, requestedBy)
  if (!(await deps.inbox.close(requestedBy, ticketId))) {
    throw AppError.notFound('Chamado não encontrado.')
  }
  return getSupportInboxTicket(deps, requestedBy, ticketId)
}
