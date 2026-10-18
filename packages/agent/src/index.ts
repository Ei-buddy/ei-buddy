/**
 * Runtime do assistente: agente de várias etapas, memória e confirmações.
 *
 * O modelo conduz a conversa e redige a resposta a partir do resultado das
 * consultas. NUNCA calcula valor — quem calcula é `domain`, via `core` (RF-101).
 * Gravação só por proposta e aceite (RF-103).
 */
export { InMemoryAiUsageCounter, TEXTO_TETO_IA } from './ai-usage.js'
export type { AiUsageCounter, InMemoryAiUsageOptions } from './ai-usage.js'
export { createBuddyBrain, MAXIMO_DE_ETAPAS } from './buddy-brain.js'
export type { CreateBuddyBrainOptions } from './buddy-brain.js'
export {
  FRASE_PEDIDO_DE_TEXTO,
  TEXTO_RECUSA_BANCO,
  TEXTO_RECUSA_CERTIFICADO,
  TEXTO_RECUSA_CONTA_CONTATO,
  TEXTO_RECUSA_NOTA,
} from './catalog.js'
export type { AgentUseCases } from './catalog.js'
export { InMemoryConfirmations, novaConfirmacao } from './confirmations.js'
export { InMemoryConversationStore } from './conversations.js'
export { createAgentRuntime } from './create-runtime.js'
export type { CreateRuntimeOptions } from './create-runtime.js'
export { CONFIRMATION_TTL_MS, FRASE_DE_FALHA, processMessage } from './process-message.js'
export type {
  AgentRuntime,
  BuddyBrain,
  ConfirmationDecision,
  ConfirmationStore,
  ConversarInput,
  ConversarSaida,
  ConversationStore,
  HistoryTurn,
  IncomingMessage,
  LinkedPeer,
  PeerDirectory,
  PendingConfirmation,
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
