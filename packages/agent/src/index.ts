/**
 * Runtime do assistente: tools, memoria e confirmacoes.
 *
 * Interpreta linguagem natural e transporta a intencao para um caso de uso de
 * core. NUNCA calcula valor — quem calcula e domain (RF-101).
 *
 * Runtime: Mastra + gpt-4o-mini (ADR-0010). Sem WhatsApp, o canal e HTTP
 * autenticado (`POST /agent/messages`) e `AGENT_PROVIDER=fake`.
 */
export { InMemoryAiUsageCounter, TEXTO_TETO_IA } from './ai-usage.js'
export type { AiUsageCounter, InMemoryAiUsageOptions } from './ai-usage.js'
export { createToolCatalog, textoDasCapacidades } from './catalog.js'
export type { AgentUseCases } from './catalog.js'
export { InMemoryConfirmations, novaConfirmacao } from './confirmations.js'
export { createAgentRuntime } from './create-runtime.js'
export type { CreateRuntimeOptions } from './create-runtime.js'
export { defineTool, parseToolArgs } from './define-tool.js'
export { FakeLlm } from './fake-llm.js'
export { CONFIRMATION_TTL_MS, eNao, eSim, processMessage } from './process-message.js'
export type {
  AgentRuntime,
  AgentTool,
  ConfirmationStore,
  IncomingMessage,
  LinkedPeer,
  LlmDecision,
  LlmPort,
  PeerDirectory,
  PendingConfirmation,
  ToolDescriptor,
} from './types.js'
