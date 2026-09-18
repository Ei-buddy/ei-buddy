import type { AiUsageCounter } from './ai-usage.js'
import { FakeBarcodeDecoder } from './barcode-decoder.js'
import { createToolCatalog, type AgentUseCases } from './catalog.js'
import { InMemoryConversationStore } from './conversations.js'
import { CONFIRMATION_TTL_MS } from './process-message.js'
import { InMemoryConfirmations } from './confirmations.js'
import { FakeLlm } from './fake-llm.js'
import type {
  AgentRuntime,
  BarcodeDecoder,
  ConfirmationStore,
  ConversationStore,
  LlmPort,
  PeerDirectory,
} from './types.js'

export type CreateRuntimeOptions = {
  readonly useCases: AgentUseCases
  readonly llm?: LlmPort
  readonly timeZone?: string
  readonly confirmationTtlMs?: number
  readonly confirmations?: ConfirmationStore
  readonly peers?: PeerDirectory
  readonly aiUsage?: AiUsageCounter
  readonly conversations?: ConversationStore
  readonly barcodeDecoder?: BarcodeDecoder
}

/**
 * Monta o runtime. Sem `llm`, usa o falso — o modo local, sem OpenAI.
 */
export function createAgentRuntime(opcoes: CreateRuntimeOptions): AgentRuntime {
  const tools = createToolCatalog(opcoes.useCases)
  return {
    llm: opcoes.llm ?? new FakeLlm(),
    tools,
    confirmations: opcoes.confirmations ?? new InMemoryConfirmations(),
    timeZone: opcoes.timeZone ?? 'America/Sao_Paulo',
    confirmationTtlMs: opcoes.confirmationTtlMs ?? CONFIRMATION_TTL_MS,
    ...(opcoes.peers === undefined ? {} : { peers: opcoes.peers }),
    ...(opcoes.aiUsage === undefined ? {} : { aiUsage: opcoes.aiUsage }),
    conversations: opcoes.conversations ?? new InMemoryConversationStore(),
    findProductByBarcode: opcoes.useCases.findProductByBarcode,
    barcodeDecoder: opcoes.barcodeDecoder ?? new FakeBarcodeDecoder(),
  }
}
