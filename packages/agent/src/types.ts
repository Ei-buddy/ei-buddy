import type { AiUsageCounter } from './ai-usage.js'
import type { AgentReply, AgentReplyKind, Role } from '@na-regua/contracts'
import type { Channel, ConfirmationStore, ExecutionContext } from '@na-regua/core'
import type { z } from 'zod'

export type { AgentReply, AgentReplyKind }
export type { ConfirmationDecision, ConfirmationStore, PendingConfirmation } from '@na-regua/core'

/** Descritor da tool para o LLM — sem o execute, que o modelo nao ve. */
export type ToolDescriptor = {
  readonly id: string
  readonly description: string
  readonly inputSchema: z.ZodType
  readonly mutatesValue: boolean
}

export type AgentTool = ToolDescriptor & {
  readonly execute: (input: unknown, ctx: ExecutionContext) => Promise<unknown>
  readonly formatReply: (output: unknown) => string
  readonly formatProposal: (input: unknown) => string
}

export type LlmDecision =
  | { readonly type: 'tool'; readonly name: string; readonly args: unknown }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'unknown' }

export type LlmPort = {
  decide(input: {
    readonly text: string
    readonly tools: readonly ToolDescriptor[]
    readonly today: string
  }): Promise<LlmDecision>
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
  /** Sessao autenticada — canal `app` ou `api`. */
  readonly ctx?: ExecutionContext
  /** Numero de origem — canal `whatsapp`. */
  readonly peer?: string
}

export type AgentRuntime = {
  readonly llm: LlmPort
  readonly tools: readonly AgentTool[]
  readonly confirmations: ConfirmationStore
  readonly timeZone: string
  readonly confirmationTtlMs: number
  readonly peers?: PeerDirectory
  /** Contador de decides por empresa; ausente = sem teto e sem medicao. */
  readonly aiUsage?: AiUsageCounter
}
