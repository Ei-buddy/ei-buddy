/**
 * Runtime do assistente: tools, memoria e confirmacoes.
 *
 * Interpreta linguagem natural e transporta a intencao para um caso de uso de
 * core. NUNCA calcula valor — quem calcula e domain (RF-101).
 *
 * Runtime: Mastra + gpt-4o-mini (ADR-0010). Sem WhatsApp, o canal e HTTP
 * autenticado (`POST /agent/messages`) e `AGENT_PROVIDER=fake`.
 */
export { bytesFromMarker, FakeBarcodeDecoder } from './barcode-decoder.js'
export { InMemoryAiUsageCounter, TEXTO_TETO_IA } from './ai-usage.js'
export type { AiUsageCounter, InMemoryAiUsageOptions } from './ai-usage.js'
export { createToolCatalog, textoDasCapacidades } from './catalog.js'
export type { AgentUseCases } from './catalog.js'
export { InMemoryConfirmations, novaConfirmacao } from './confirmations.js'
export { InMemoryConversationStore } from './conversations.js'
export { createAgentRuntime } from './create-runtime.js'
export type { CreateRuntimeOptions } from './create-runtime.js'
export { defineTool, parseToolArgs } from './define-tool.js'
export { FakeLlm } from './fake-llm.js'
export { CONFIRMATION_TTL_MS, eNao, eSim, processMessage } from './process-message.js'
export type {
  AgentRuntime,
  AgentTool,
  BarcodeDecoder,
  ConfirmationDecision,
  ConfirmationStore,
  ConversationStore,
  HistoryTurn,
  IncomingMessage,
  LinkedPeer,
  LlmDecision,
  LlmPort,
  PeerDirectory,
  PendingConfirmation,
  ToolDescriptor,
} from './types.js'
export { FixturePeerDirectory, normalizarPeer } from './studio/fixture-peer-directory.js'
export type { StudioPeerRef } from './studio/fixture-peer-directory.js'
export {
  loadStudioPresets,
  mapaDeRequestContextPresets,
  resolverCaminhoDosPresets,
  StudioPresetsError,
} from './studio/presets.js'
export type {
  StudioPreset,
  StudioPresetsFile,
  StudioRequestContextPresetMap,
} from './studio/presets.js'
export {
  createStudioHarnessAgent,
  createStudioMastra,
  STUDIO_HARNESS_AGENT_ID,
  STUDIO_RELAY_TOOL_ID,
} from './studio/relay-agent.js'
export type { CreateStudioHarnessOptions, StudioTurnLog } from './studio/relay-agent.js'
export { studioRequestContextSchema } from './studio/request-context.js'
export { createStudioRelayModel, StudioRelayModel } from './studio/relay-model.js'
