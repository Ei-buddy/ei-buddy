import { isAppError, type ExecutionContext } from '@na-regua/core'
import type { AgentReply } from '@na-regua/contracts'
import { TEXTO_TETO_IA } from './ai-usage.js'
import { novaConfirmacao } from './confirmations.js'
import { textoDasCapacidades } from './catalog.js'
import { parseToolArgs } from './define-tool.js'
import { chaveDaConversa, diaIso } from './format.js'
import type { AgentRuntime, IncomingMessage, LinkedPeer, PendingConfirmation } from './types.js'

const SIM = /^(sim+|s|ok+|pode|confirmo|confirma|yes)[.!?]*$/i
const NAO = /^(nao|n|cancela|cancelar|no)[.!?]*$/i

export const CONFIRMATION_TTL_MS = 5 * 60_000

export async function processMessage(
  runtime: AgentRuntime,
  input: IncomingMessage,
): Promise<AgentReply> {
  const ctx = await resolverContexto(runtime, input)
  if (ctx === undefined) {
    return { kind: 'ignored', text: '' }
  }

  const conversationKey = chaveDaConversa({
    channel: ctx.channel,
    companyId: ctx.companyId,
    userId: ctx.userId,
    ...(input.peer === undefined ? {} : { peer: input.peer }),
  })

  const pendente = await runtime.confirmations.getOpen(ctx.companyId, conversationKey, ctx.now)
  if (pendente !== undefined) {
    return tratarConfirmacao(runtime, ctx, pendente, input)
  }

  if (estourouTeto(runtime, ctx)) {
    return avisoDeTeto()
  }

  const today = diaIso(ctx.now, runtime.timeZone)
  const decisao = await runtime.llm.decide({
    text: input.text,
    tools: runtime.tools,
    today,
  })
  runtime.aiUsage?.record(ctx.companyId, ctx.now)

  if (decisao.type === 'unknown') {
    return { kind: 'unknown', text: textoDasCapacidades(runtime.tools) }
  }
  if (decisao.type === 'text') {
    return { kind: 'clarify', text: decisao.text }
  }

  const tool = runtime.tools.find((t) => t.id === decisao.name)
  if (tool === undefined) {
    return { kind: 'unknown', text: textoDasCapacidades(runtime.tools) }
  }

  let args: unknown
  try {
    args = parseToolArgs(tool.inputSchema, decisao.args)
  } catch (erro) {
    return responderErro(erro)
  }

  if (tool.mutatesValue) {
    if (estourouTeto(runtime, ctx)) {
      return avisoDeTeto()
    }
    const pending = novaConfirmacao({
      companyId: ctx.companyId,
      conversationKey,
      toolId: tool.id,
      args,
      summary: tool.formatProposal(args),
      expiresAt: new Date(ctx.now.getTime() + runtime.confirmationTtlMs),
    })
    await runtime.confirmations.put(pending)
    return {
      kind: 'confirmation',
      text: `${pending.summary}. Confirma?`,
      confirmationId: pending.id,
    }
  }

  return executar(tool, args, ctx)
}

async function tratarConfirmacao(
  runtime: AgentRuntime,
  ctx: ExecutionContext,
  pendente: PendingConfirmation,
  input: IncomingMessage,
): Promise<AgentReply> {
  const expirada = pendente.expiresAt.getTime() <= ctx.now.getTime()
  const compacto = input.text.trim()

  if (expirada) {
    await runtime.confirmations.resolve(ctx.companyId, pendente.id, 'expired')
    if (SIM.test(compacto) || NAO.test(compacto) || !pareceIntencaoNova(compacto)) {
      return {
        kind: 'answer',
        text: 'A confirmacao expirou e nada foi feito. Envie o pedido de novo se ainda quiser.',
      }
    }
    return processMessage(runtime, input)
  }

  if (SIM.test(compacto)) {
    if (estourouTeto(runtime, ctx)) {
      return avisoDeTeto()
    }
    await runtime.confirmations.resolve(ctx.companyId, pendente.id, 'accepted')
    const tool = runtime.tools.find((t) => t.id === pendente.toolId)
    if (tool === undefined) {
      return { kind: 'answer', text: 'Nao consegui repetir a acao. Tente de novo.' }
    }
    return executar(tool, pendente.args, ctx)
  }

  await runtime.confirmations.resolve(ctx.companyId, pendente.id, 'rejected')
  if (NAO.test(compacto)) {
    return { kind: 'answer', text: 'Cancelado. Nada foi registrado.' }
  }
  return {
    kind: 'answer',
    text: 'Nao entendi como confirmacao, entao cancelei. Nada foi registrado. Se quiser, envie o pedido de novo.',
  }
}

function pareceIntencaoNova(texto: string): boolean {
  return texto.length > 12
}

function estourouTeto(runtime: AgentRuntime, ctx: ExecutionContext): boolean {
  return runtime.aiUsage?.isOverBudget(ctx.companyId, ctx.now) === true
}

function avisoDeTeto(): AgentReply {
  return { kind: 'answer', text: TEXTO_TETO_IA }
}

async function executar(
  tool: AgentRuntime['tools'][number],
  args: unknown,
  ctx: ExecutionContext,
): Promise<AgentReply> {
  try {
    const saida = await tool.execute(args, ctx)
    return { kind: 'answer', text: tool.formatReply(saida) }
  } catch (erro) {
    return responderErro(erro)
  }
}

function responderErro(erro: unknown): AgentReply {
  if (isAppError(erro)) {
    const detalhe =
      erro.fields.length === 0
        ? ''
        : ' ' +
          erro.fields.map((f) => (f.path === '' ? f.message : `${f.path}: ${f.message}`)).join(' ')
    return { kind: 'clarify', text: `${erro.message}${detalhe}` }
  }
  return { kind: 'clarify', text: 'Nao deu para concluir. Tente de novo em instantes.' }
}

async function resolverContexto(
  runtime: AgentRuntime,
  input: IncomingMessage,
): Promise<ExecutionContext | undefined> {
  if (input.channel === 'whatsapp') {
    const peer = input.peer
    if (peer === undefined || peer === '' || runtime.peers === undefined) {
      return undefined
    }
    const ligado = await runtime.peers.resolve(peer)
    if (ligado === null) return undefined
    return contextoDoPeer(ligado, input)
  }

  if (input.ctx === undefined) return undefined
  return {
    ...input.ctx,
    now: input.now,
    requestId: input.requestId,
    channel: input.channel,
  }
}

function contextoDoPeer(ligado: LinkedPeer, input: IncomingMessage): ExecutionContext {
  return {
    companyId: ligado.companyId,
    userId: ligado.userId,
    role: ligado.role,
    channel: 'whatsapp',
    requestId: input.requestId,
    now: input.now,
  }
}

export function eSim(texto: string): boolean {
  return SIM.test(texto.trim())
}

export function eNao(texto: string): boolean {
  return NAO.test(texto.trim())
}
