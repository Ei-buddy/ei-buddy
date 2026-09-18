import type { ConversationPurgeRepository } from '../ports/conversations.js'
import type { ExecutionContext } from '../context.js'

/** Retencao de 30 dias (RNF-035). Relogio entra por `ctx.now`, nunca `new Date()`. */
export const RETENCAO_MENSAGENS_MS = 30 * 24 * 60 * 60 * 1000

export type PurgeConversationHistoryDeps = {
  readonly conversations: ConversationPurgeRepository
}

export type PurgeConversationHistoryResult = {
  readonly messagesDeleted: number
  readonly conversationsClosed: number
}

/**
 * Expurga corpos de mensagem com mais de 30 dias e fecha conversas orfas.
 *
 * DELETE das messages primeiro; depois UPDATE `deleted_at` nas conversas
 * sem mensagem vigente. Nao apaga venda, cadastro nem `audit_logs`. Nao
 * faz `DELETE FROM conversations` (FK de confirmations e RESTRICT).
 */
export async function purgeConversationHistory(
  deps: PurgeConversationHistoryDeps,
  ctx: ExecutionContext,
): Promise<PurgeConversationHistoryResult> {
  const messagesDeleted = await deps.conversations.deleteMessagesOlderThan(
    ctx.companyId,
    ctx.now,
    RETENCAO_MENSAGENS_MS,
  )
  const conversationsClosed = await deps.conversations.closeConversationsWithoutMessages(
    ctx.companyId,
    ctx.now,
  )
  return { messagesDeleted, conversationsClosed }
}
