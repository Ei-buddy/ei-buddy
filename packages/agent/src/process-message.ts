import type { ExecutionContext, PendingConfirmation } from '@na-regua/core'
import type { AgentReply } from '@na-regua/contracts'
import { TEXTO_TETO_IA } from './ai-usage.js'
import type { ConversarInput } from './buddy-brain.js'
import { FRASE_PEDIDO_DE_TEXTO } from './catalog.js'
import { montarResumoDeEntidades, RESUMO_VAZIO } from './conversation-context.js'
import { chaveDaConversa, diaIso } from './format.js'
import type { AgentRuntime, IncomingMessage, LinkedPeer } from './types.js'

export const CONFIRMATION_TTL_MS = 5 * 60_000

/** Falha inesperada (modelo ou banco fora): sem modelo para redigir, frase fixa. */
export const FRASE_DE_FALHA = 'Opa, não consegui responder agora. Tenta de novo em instantes?'

/**
 * Borda do Buddy — identidade, janela, agente, turno.
 *
 * Quem raciocina é o `BuddyBrain`. Aqui só se resolve quem fala (peer ou
 * sessão, nunca o modelo), carrega o contexto da conversa, chama o agente e
 * grava o turno. Nada aqui grava dado de negócio.
 */
export async function processMessage(
  runtime: AgentRuntime,
  input: IncomingMessage,
): Promise<AgentReply> {
  const ctx = await resolverContexto(runtime, input)
  if (ctx === undefined) {
    return { kind: 'ignored', text: '' }
  }

  if (input.image !== undefined) {
    return { kind: 'answer', text: FRASE_PEDIDO_DE_TEXTO }
  }

  if (runtime.aiUsage?.isOverBudget(ctx.companyId, ctx.now) === true) {
    return { kind: 'answer', text: TEXTO_TETO_IA }
  }

  const conversationKey = chaveDaConversa({
    channel: ctx.channel,
    companyId: ctx.companyId,
    userId: ctx.userId,
    ...(input.peer === undefined ? {} : { peer: input.peer }),
  })

  const janela = await carregarJanela(runtime, ctx, conversationKey)
  const { pendente, avisos } = await pendenteDaConversa(runtime, ctx, conversationKey)
  const entrada: ConversarInput = {
    execucao: ctx,
    conversationKey,
    texto: input.text,
    janela: janela.map((m) => ({ role: m.role, body: m.body })),
    resumo: janela.length === 0 ? RESUMO_VAZIO : montarResumoDeEntidades(janela),
    hoje: diaIso(ctx.now, runtime.timeZone),
    ...(pendente === undefined ? {} : { pendente }),
    ...(avisos.length === 0 ? {} : { avisos }),
  }

  let saida: Awaited<ReturnType<AgentRuntime['brain']['conversar']>>
  try {
    saida = await runtime.brain.conversar(entrada)
  } catch {
    /* Provedor fora, timeout, erro não tratado: nada foi gravado pelo modelo
       (gravação só no aceite) e a mensagem técnica não chega à dona. Sem
       corpo no log — RNF-034. */
    console.error(`Falha no agente companyId=${ctx.companyId} requestId=${ctx.requestId}`)
    await gravarTurno(runtime, ctx, conversationKey, input.text, FRASE_DE_FALHA, undefined)
    return { kind: 'answer', text: FRASE_DE_FALHA }
  }

  runtime.aiUsage?.record(ctx.companyId, ctx.now, saida.etapas)

  /* Mudança de assunto: a dona respondeu outra coisa e o modelo nem aceitou,
     nem cancelou, nem refez a proposta. Ela não fica pendurada (FR-017). */
  if (
    pendente !== undefined &&
    saida.decidiuPendente !== true &&
    saida.propostaNova === undefined
  ) {
    await runtime.confirmations.resolve(ctx.companyId, pendente.id, 'rejected')
  }
  const reply: AgentReply =
    saida.propostaNova === undefined
      ? { kind: 'answer', text: saida.texto }
      : { kind: 'confirmation', text: saida.texto, confirmationId: saida.propostaNova.id }

  await gravarTurno(runtime, ctx, conversationKey, input.text, reply.text, saida.snapshot)
  return reply
}

/** A pendente aberta da conversa; vencida vira aviso e não é oferecida ao aceite. */
async function pendenteDaConversa(
  runtime: AgentRuntime,
  ctx: ExecutionContext,
  conversationKey: string,
): Promise<{ readonly pendente?: PendingConfirmation; readonly avisos: readonly string[] }> {
  const aberta = await runtime.confirmations.getOpen(ctx.companyId, conversationKey, ctx.now)
  if (aberta === undefined) return { avisos: [] }
  if (aberta.expiresAt.getTime() > ctx.now.getTime()) return { pendente: aberta, avisos: [] }

  await runtime.confirmations.resolve(ctx.companyId, aberta.id, 'expired')
  return {
    avisos: [
      `A proposta anterior (${aberta.summary}) venceu sem confirmação e nada foi gravado. ` +
        'Se a dona responder a ela agora, diga que venceu e ofereça refazer.',
    ],
  }
}

async function carregarJanela(
  runtime: AgentRuntime,
  ctx: ExecutionContext,
  conversationKey: string,
) {
  if (runtime.conversations === undefined) return []
  /* Sem options.window — default 12 no store. MUST NOT aumentar o recorte. */
  const ativo = await runtime.conversations.loadActive(ctx.companyId, conversationKey, ctx.now)
  /* Idle: o trecho ocioso não vai ao modelo, e o resumo zera junto. */
  if (ativo === undefined || ativo.idle) return []
  return ativo.messages
}

async function gravarTurno(
  runtime: AgentRuntime,
  ctx: ExecutionContext,
  conversationKey: string,
  userBody: string,
  assistantBody: string,
  toolCalls: unknown,
): Promise<void> {
  if (runtime.conversations === undefined || assistantBody.trim() === '') return
  try {
    await runtime.conversations.append(ctx.companyId, {
      conversationKey,
      userBody,
      assistantBody,
      at: ctx.now,
      toolCalls,
    })
  } catch {
    /* Falha de append não desfaz o que já foi feito. Sem body — RNF-034. */
    console.error(
      `Falha ao gravar turno da conversa companyId=${ctx.companyId} requestId=${ctx.requestId}`,
    )
  }
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
