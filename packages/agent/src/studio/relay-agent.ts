import { randomUUID } from 'node:crypto'
import { Agent } from '@mastra/core/agent'
import { Mastra } from '@mastra/core'
import { createTool } from '@mastra/core/tools'
import { agentMessageInputSchema } from '@na-regua/contracts'
import { processMessage } from '../process-message.js'
import type { AgentRuntime } from '../types.js'
import type { FixturePeerDirectory } from './fixture-peer-directory.js'
import { resolverPeerDoStudio, studioRequestContextSchema } from './request-context.js'
import { createStudioRelayModel } from './relay-model.js'

export const STUDIO_HARNESS_AGENT_ID = 'studio-harness'
export const STUDIO_RELAY_TOOL_ID = 'process_message'

/** Recusa generica do rele (FR-005): nao revela empresa, peer nem preset. */
export const TEXTO_STUDIO_NAO_VINCULADO = 'Numero nao vinculado. Nada foi executado.'

/**
 * Log `agent.studio.turn` (RNF-034): peer ja mascarado; sem texto da
 * mensagem, userId ou numero em claro.
 */
export type StudioTurnLog = {
  readonly companyId?: string
  readonly peer?: string
  readonly durationMs: number
  readonly kind: string
  readonly requestId: string
}

export type CreateStudioHarnessOptions = {
  readonly runtime: AgentRuntime
  readonly directory: FixturePeerDirectory
  readonly now?: () => Date
  readonly requestId?: () => string
  readonly onTurn?: (turno: StudioTurnLog) => void
}

/**
 * Telefone no log sai mascarado — RNF-034. Os quatro ultimos digitos
 * bastam para correlacionar a fixture sem vazar o numero.
 */
export function mascararPeerDoStudio(peer: string): string {
  const digitos = peer.replace(/\D/g, '')
  if (digitos.length <= 4) return '****'
  return `****${digitos.slice(-4)}`
}

const INSTRUCOES = `
Voce e o rele do harness de engenharia. Nao interprete a mensagem.
Sempre chame a ferramenta process_message com o texto do usuario.
`.trim()

/**
 * Agent Mastra do harness: uma tool, nenhum catalogo de negocio.
 * O execute chama o mesmo `processMessage` da NR-060 no canal whatsapp.
 * FakeLlm / provedor real so entra dentro do laco — o generate do Studio
 * usa `StudioRelayModel` (zero hop extra de LLM).
 */
export function createStudioHarnessAgent(opcoes: CreateStudioHarnessOptions): Agent {
  const now = opcoes.now ?? (() => new Date())
  const proximoId = opcoes.requestId ?? (() => randomUUID())

  const process_message = createTool({
    id: STUDIO_RELAY_TOOL_ID,
    description: 'Encaminha o texto do painel para o laco do assistente.',
    inputSchema: agentMessageInputSchema,
    requestContextSchema: studioRequestContextSchema,
    execute: async ({ text }, context) => {
      const startedAt = now()
      const requestId = proximoId()
      const peer = await resolverPeerDoStudio(opcoes.directory, context?.requestContext)
      const reply = await processMessage(opcoes.runtime, {
        text,
        requestId,
        now: startedAt,
        channel: 'whatsapp',
        ...(peer === undefined ? {} : { peer }),
      })
      const durationMs = Math.max(0, now().getTime() - startedAt.getTime())
      const kind = reply.kind
      const envelope = {
        kind,
        text: kind === 'ignored' ? TEXTO_STUDIO_NAO_VINCULADO : reply.text,
        durationMs,
        ...(reply.confirmationId === undefined ? {} : { confirmationId: reply.confirmationId }),
      }
      await registrarTurno(opcoes, { peer, durationMs, kind, requestId })
      return envelope
    },
  })

  return new Agent({
    id: STUDIO_HARNESS_AGENT_ID,
    name: 'Studio harness',
    instructions: INSTRUCOES,
    model: createStudioRelayModel(),
    tools: { process_message },
    requestContextSchema: studioRequestContextSchema,
    defaultOptions: { maxSteps: 2 },
  })
}

export function createStudioMastra(opcoes: CreateStudioHarnessOptions): Mastra {
  return new Mastra({
    agents: { [STUDIO_HARNESS_AGENT_ID]: createStudioHarnessAgent(opcoes) },
    workers: false,
  })
}

async function registrarTurno(
  opcoes: CreateStudioHarnessOptions,
  dados: {
    readonly peer: string | undefined
    readonly durationMs: number
    readonly kind: string
    readonly requestId: string
  },
): Promise<void> {
  if (opcoes.onTurn === undefined) return

  const ligado = dados.peer === undefined ? null : await opcoes.directory.resolve(dados.peer)
  opcoes.onTurn({
    durationMs: dados.durationMs,
    kind: dados.kind,
    requestId: dados.requestId,
    ...(ligado === null ? {} : { companyId: ligado.companyId }),
    ...(dados.peer === undefined ? {} : { peer: mascararPeerDoStudio(dados.peer) }),
  })
}
