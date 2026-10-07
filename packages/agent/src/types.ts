import type { AiUsageCounter } from './ai-usage.js'
import type { AgentReply, AgentReplyKind, Role } from '@na-regua/contracts'
import type {
  Channel,
  ConfirmationStore,
  ConversationRole,
  ConversationStore,
  ExecutionContext,
} from '@na-regua/core'
import type { BuddyBrain } from './buddy-brain.js'

export type { ConversationRole, ConversationStore }

export type { AgentReply, AgentReplyKind }
export type { ConfirmationDecision, ConfirmationStore, PendingConfirmation } from '@na-regua/core'
export type { BuddyBrain, ConversarInput, ConversarSaida } from './buddy-brain.js'

export type HistoryTurn = {
  readonly role: ConversationRole
  readonly body: string
}

export type LinkedPeer = {
  readonly companyId: string
  readonly userId: string
  readonly role: Role
}

export type PeerDirectory = {
  resolve(peer: string): Promise<LinkedPeer | null>
}

export type IncomingMessage = {
  readonly text: string
  readonly requestId: string
  readonly now: Date
  readonly channel: Channel
  /** Foto não é tratada nesta fatia: recebe o pedido de texto. */
  readonly image?: {
    readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
    readonly bytes: Uint8Array
  }
  /** Sessao autenticada — canal `app` ou `api`. */
  readonly ctx?: ExecutionContext
  /** Numero de origem — canal `whatsapp`. */
  readonly peer?: string
}

export type AgentRuntime = {
  readonly brain: BuddyBrain
  readonly confirmations: ConfirmationStore
  readonly timeZone: string
  readonly confirmationTtlMs: number
  readonly peers?: PeerDirectory
  /** Uso de IA por empresa; teto opcional, desligado por padrão. */
  readonly aiUsage?: AiUsageCounter
  /** Historico do fio ativo. Ausente = sem janela e sem append. */
  readonly conversations?: ConversationStore
}
