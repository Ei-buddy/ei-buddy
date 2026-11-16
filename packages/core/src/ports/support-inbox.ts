import type {
  SupportInboxCounts,
  SupportInboxDetail,
  SupportInboxItem,
  SupportInboxSituation,
} from '@na-regua/contracts'
import type { UserId } from '../context.js'

/**
 * A fila de chamados da plataforma — NR-215.
 *
 * Toda chamada leva QUEM PEDE: o banco confere de novo se e Super Admin antes
 * de atravessar empresas (defesa em profundidade, como a `PlatformAdminAccess`).
 */
export type SupportInbox = {
  counts(requestedBy: UserId): Promise<SupportInboxCounts>
  list(
    requestedBy: UserId,
    filtro: {
      readonly situacao: SupportInboxSituation
      readonly limite: number
      readonly offset: number
    },
  ): Promise<{ readonly tickets: readonly SupportInboxItem[]; readonly total: number }>
  /** `undefined` quando o chamado nao existe. */
  find(requestedBy: UserId, ticketId: string): Promise<SupportInboxDetail | undefined>
  /** Grava a resposta como "suporte"; `false` quando o chamado nao existe. */
  reply(requestedBy: UserId, ticketId: string, body: string): Promise<boolean>
  /** Encerra; `false` quando o chamado nao existe. */
  close(requestedBy: UserId, ticketId: string): Promise<boolean>
}
