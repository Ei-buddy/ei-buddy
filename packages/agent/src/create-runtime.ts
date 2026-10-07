import type { AiUsageCounter } from './ai-usage.js'
import { createBuddyBrain, type CreateBuddyBrainOptions } from './buddy-brain.js'
import type { AgentUseCases } from './catalog.js'
import { InMemoryConfirmations } from './confirmations.js'
import { InMemoryConversationStore } from './conversations.js'
import { CONFIRMATION_TTL_MS } from './process-message.js'
import type {
  AgentRuntime,
  BuddyBrain,
  ConfirmationStore,
  ConversationStore,
  PeerDirectory,
} from './types.js'

export type CreateRuntimeOptions = {
  readonly timeZone?: string
  readonly confirmationTtlMs?: number
  readonly confirmations?: ConfirmationStore
  readonly peers?: PeerDirectory
  readonly aiUsage?: AiUsageCounter
  readonly conversations?: ConversationStore
} & (
  | { readonly brain: BuddyBrain }
  | { readonly model: CreateBuddyBrainOptions['model']; readonly useCases: AgentUseCases }
)

/**
 * Monta o runtime. Com `model` + `useCases`, cria o `BuddyBrain` com as
 * mesmas `confirmations` do runtime; com `brain`, usa o dado (teste de borda).
 */
export function createAgentRuntime(opcoes: CreateRuntimeOptions): AgentRuntime {
  const confirmations = opcoes.confirmations ?? new InMemoryConfirmations()
  const confirmationTtlMs = opcoes.confirmationTtlMs ?? CONFIRMATION_TTL_MS
  const brain =
    'brain' in opcoes
      ? opcoes.brain
      : createBuddyBrain({
          model: opcoes.model,
          useCases: opcoes.useCases,
          confirmations,
          ttlMs: confirmationTtlMs,
        })

  return {
    brain,
    confirmations,
    timeZone: opcoes.timeZone ?? 'America/Sao_Paulo',
    confirmationTtlMs,
    ...(opcoes.peers === undefined ? {} : { peers: opcoes.peers }),
    ...(opcoes.aiUsage === undefined ? {} : { aiUsage: opcoes.aiUsage }),
    conversations: opcoes.conversations ?? new InMemoryConversationStore(),
  }
}
