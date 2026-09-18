import { isAppError, type ExecutionContext } from '@na-regua/core'
import type { AgentReply, CreateSaleInput, PaymentMethod, ProductOutput } from '@na-regua/contracts'
import { TEXTO_TETO_IA } from './ai-usage.js'
import { novaConfirmacao } from './confirmations.js'
import { textoDasCapacidades } from './catalog.js'
import { parseToolArgs } from './define-tool.js'
import { chaveDaConversa, diaIso, formatarCentavos } from './format.js'
import { parsePaymentMethod } from './parse-payment-method.js'
import { temPedidoCadastroExplicito } from './parse-register-intent.js'
import {
  MIME_FOTO_VALIDOS,
  TEXTO_FOTO_CADASTRO_CODIGO,
  TEXTO_FOTO_CADASTRO_PRODUTO_EXISTENTE,
  TEXTO_RECUSA_FOTO_ILEGIVEL,
  TEXTO_RECUSA_FOTO_MULTIPLOS,
  TEXTO_RECUSA_FOTO_PRODUTO_DESCONHECIDO,
} from './photo-replies.js'
import {
  limparRascunhoFoto,
  pegarRascunhoFoto,
  salvarRascunhoFoto,
  type PhotoSaleDraft,
} from './photo-sale-draft.js'
import type { AgentRuntime, HistoryTurn, IncomingMessage, LinkedPeer } from './types.js'

const SIM = /^(sim+|s|ok+|pode|confirmo|confirma|yes)[.!?]*$/i
const NAO = /^(nao|n|cancela|cancelar|no)[.!?]*$/i

const REPLY_VISIVEL = new Set<AgentReply['kind']>(['answer', 'clarify', 'unknown', 'confirmation'])

export const CONFIRMATION_TTL_MS = 5 * 60_000

type RespostaDoLaco = {
  readonly reply: AgentReply
  readonly toolCalls?: unknown
  readonly userBody?: string
}

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

  const { reply, toolCalls, userBody } = await responder(runtime, input, ctx, conversationKey)
  await gravarTurno(runtime, ctx, conversationKey, userBody ?? input.text, reply, toolCalls)
  return reply
}

async function responder(
  runtime: AgentRuntime,
  input: IncomingMessage,
  ctx: ExecutionContext,
  conversationKey: string,
): Promise<RespostaDoLaco> {
  const pendente = await runtime.confirmations.getOpen(ctx.companyId, conversationKey, ctx.now)
  if (pendente !== undefined) {
    return tratarConfirmacao(runtime, ctx, pendente, input, conversationKey)
  }

  if (input.image !== undefined) {
    return tratarFoto(runtime, input, ctx, conversationKey)
  }

  const rascunho = pegarRascunhoFoto(ctx.companyId, conversationKey)
  if (rascunho !== undefined) {
    const doRascunho = await tratarRascunhoFoto(runtime, input, ctx, conversationKey, rascunho)
    if (doRascunho !== undefined) return doRascunho
  }

  if (estourouTeto(runtime, ctx)) {
    return { reply: avisoDeTeto() }
  }

  const today = diaIso(ctx.now, runtime.timeZone)
  const history = await carregarHistorico(runtime, ctx, conversationKey)
  const decisao = await runtime.llm.decide({
    text: input.text,
    tools: runtime.tools,
    today,
    history,
  })
  runtime.aiUsage?.record(ctx.companyId, ctx.now)

  if (decisao.type === 'unknown') {
    return { reply: { kind: 'unknown', text: textoDasCapacidades(runtime.tools) } }
  }
  if (decisao.type === 'text') {
    return { reply: { kind: 'clarify', text: decisao.text } }
  }

  const tool = runtime.tools.find((t) => t.id === decisao.name)
  if (tool === undefined) {
    return { reply: { kind: 'unknown', text: textoDasCapacidades(runtime.tools) } }
  }

  let args: unknown
  try {
    args = parseToolArgs(tool.inputSchema, decisao.args)
  } catch (erro) {
    return { reply: responderErro(erro) }
  }

  const toolCalls = idsDaFerramenta(args)

  if (tool.mutatesValue) {
    if (estourouTeto(runtime, ctx)) {
      return { reply: avisoDeTeto() }
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
    return comToolCalls(
      {
        kind: 'confirmation',
        text: `${pending.summary}. Confirma?`,
        confirmationId: pending.id,
      },
      toolCalls,
    )
  }

  return comToolCalls(await executar(tool, args, ctx), toolCalls)
}

async function tratarFoto(
  runtime: AgentRuntime,
  input: IncomingMessage,
  ctx: ExecutionContext,
  conversationKey: string,
): Promise<RespostaDoLaco> {
  const imagem = input.image!

  if (!MIME_FOTO_VALIDOS.has(imagem.mimeType) || imagem.bytes.length === 0) {
    return respostaRecusaFoto(TEXTO_RECUSA_FOTO_ILEGIVEL, corpoDaFoto([]))
  }

  const decoder = runtime.barcodeDecoder
  let codes: string[] = []
  if (decoder !== undefined) {
    const resultado = await Promise.resolve(
      decoder.decode({ mimeType: imagem.mimeType, bytes: imagem.bytes }),
    )
    codes = resultado.codes
  }

  const userBody = corpoDaFoto(codes)

  if (codes.length === 0) {
    return respostaRecusaFoto(TEXTO_RECUSA_FOTO_ILEGIVEL, userBody)
  }

  if (codes.length > 1) {
    return respostaRecusaFoto(TEXTO_RECUSA_FOTO_MULTIPLOS, userBody)
  }

  const barcode = codes[0]!

  if (temPedidoCadastroExplicito(input.text)) {
    return tratarCadastroFoto(runtime, ctx, barcode, userBody)
  }

  if (runtime.findProductByBarcode !== undefined) {
    const produto = await runtime.findProductByBarcode(ctx, barcode)
    if (produto !== undefined) {
      return tratarProdutoFoto(runtime, input, ctx, conversationKey, produto, userBody)
    }
  }

  return respostaRecusaFoto(TEXTO_RECUSA_FOTO_PRODUTO_DESCONHECIDO, userBody)
}

async function tratarCadastroFoto(
  runtime: AgentRuntime,
  ctx: ExecutionContext,
  barcode: string,
  userBody: string,
): Promise<RespostaDoLaco> {
  if (runtime.findProductByBarcode !== undefined) {
    const produto = await runtime.findProductByBarcode(ctx, barcode)
    if (produto !== undefined) {
      return {
        reply: {
          kind: 'answer',
          text: TEXTO_FOTO_CADASTRO_PRODUTO_EXISTENTE(produto.description),
        },
        userBody,
      }
    }
  }

  return {
    reply: { kind: 'answer', text: TEXTO_FOTO_CADASTRO_CODIGO(barcode) },
    userBody,
  }
}

function respostaRecusaFoto(texto: string, userBody: string): RespostaDoLaco {
  return {
    reply: { kind: 'answer', text: texto },
    userBody,
  }
}

async function tratarProdutoFoto(
  runtime: AgentRuntime,
  input: IncomingMessage,
  ctx: ExecutionContext,
  conversationKey: string,
  produto: ProductOutput,
  userBody: string,
): Promise<RespostaDoLaco> {
  const pagamento = parsePaymentMethod(input.text)
  const draft: PhotoSaleDraft = {
    productId: produto.id,
    barcode: produto.barcode ?? codesDoCorpo(userBody)[0] ?? '',
    salePriceCents: produto.salePriceCents,
    description: produto.description,
  }

  if (pagamento.kind === 'method') {
    limparRascunhoFoto(ctx.companyId, conversationKey)
    return proporVendaFoto(runtime, ctx, conversationKey, draft, pagamento.method, userBody)
  }

  if (pagamento.kind === 'empty') {
    salvarRascunhoFoto(ctx.companyId, conversationKey, draft)
    return {
      reply: {
        kind: 'clarify',
        text: textoClarifyPagamentoFoto(draft.description, draft.salePriceCents),
      },
      userBody,
    }
  }

  salvarRascunhoFoto(ctx.companyId, conversationKey, draft)
  return {
    reply: {
      kind: 'clarify',
      text: textoClarifyPagamentoFoto(draft.description, draft.salePriceCents),
    },
    userBody,
  }
}

async function tratarRascunhoFoto(
  runtime: AgentRuntime,
  input: IncomingMessage,
  ctx: ExecutionContext,
  conversationKey: string,
  draft: PhotoSaleDraft,
): Promise<RespostaDoLaco | undefined> {
  const pagamento = parsePaymentMethod(input.text)
  if (pagamento.kind === 'method') {
    limparRascunhoFoto(ctx.companyId, conversationKey)
    return proporVendaFoto(runtime, ctx, conversationKey, draft, pagamento.method)
  }

  limparRascunhoFoto(ctx.companyId, conversationKey)
  return undefined
}

function textoClarifyPagamentoFoto(description: string, salePriceCents: number): string {
  return `${description} — ${formatarCentavos(salePriceCents)}. Qual a forma de pagamento?`
}

function montarVendaFoto(draft: PhotoSaleDraft, method: PaymentMethod): CreateSaleInput {
  return {
    items: [
      {
        productId: draft.productId,
        quantity: 1,
        unitPriceCents: draft.salePriceCents,
      },
    ],
    payments: [{ method, amountCents: draft.salePriceCents }],
  }
}

async function proporVendaFoto(
  runtime: AgentRuntime,
  ctx: ExecutionContext,
  conversationKey: string,
  draft: PhotoSaleDraft,
  method: PaymentMethod,
  userBody?: string,
): Promise<RespostaDoLaco> {
  const tool = runtime.tools.find((t) => t.id === 'create_sale')
  if (tool === undefined) {
    return { reply: { kind: 'answer', text: 'Nao consegui preparar a venda.' } }
  }

  const args = montarVendaFoto(draft, method)
  let parsed: unknown
  try {
    parsed = parseToolArgs(tool.inputSchema, args)
  } catch (erro) {
    return { reply: responderErro(erro), ...(userBody === undefined ? {} : { userBody }) }
  }

  if (tool.mutatesValue) {
    if (estourouTeto(runtime, ctx)) {
      return { reply: avisoDeTeto(), ...(userBody === undefined ? {} : { userBody }) }
    }
    const pending = novaConfirmacao({
      companyId: ctx.companyId,
      conversationKey,
      toolId: tool.id,
      args: parsed,
      summary: tool.formatProposal(parsed),
      expiresAt: new Date(ctx.now.getTime() + runtime.confirmationTtlMs),
    })
    await runtime.confirmations.put(pending)
    return {
      reply: {
        kind: 'confirmation',
        text: `${pending.summary}. Confirma?`,
        confirmationId: pending.id,
      },
      toolCalls: idsDaFerramenta(parsed),
      ...(userBody === undefined ? {} : { userBody }),
    }
  }

  return comToolCalls(await executar(tool, parsed, ctx), idsDaFerramenta(parsed))
}

function codesDoCorpo(userBody: string): string[] {
  const prefix = '[foto do codigo] '
  if (!userBody.startsWith(prefix)) return []
  const resto = userBody.slice(prefix.length).trim()
  return resto.length === 0 ? [] : [resto]
}

function corpoDaFoto(codes: readonly string[]): string {
  if (codes.length === 1) return `[foto do codigo] ${codes[0]}`
  return '[foto do codigo]'
}

async function tratarConfirmacao(
  runtime: AgentRuntime,
  ctx: ExecutionContext,
  pendente: import('./types.js').PendingConfirmation,
  input: IncomingMessage,
  conversationKey: string,
): Promise<RespostaDoLaco> {
  const expirada = pendente.expiresAt.getTime() <= ctx.now.getTime()
  const compacto = input.text.trim()

  if (expirada) {
    await runtime.confirmations.resolve(ctx.companyId, pendente.id, 'expired')
    if (SIM.test(compacto) || NAO.test(compacto) || !pareceIntencaoNova(compacto)) {
      return {
        reply: {
          kind: 'answer',
          text: 'A confirmacao expirou e nada foi feito. Envie o pedido de novo se ainda quiser.',
        },
      }
    }
    /* Intencao nova: segue o laco sem loadActive neste ramo; o responder
       seguinte nao tem pendencia e so ai carrega history. */
    return responder(runtime, input, ctx, conversationKey)
  }

  if (SIM.test(compacto)) {
    if (estourouTeto(runtime, ctx)) {
      return { reply: avisoDeTeto() }
    }
    await runtime.confirmations.resolve(ctx.companyId, pendente.id, 'accepted')
    const tool = runtime.tools.find((t) => t.id === pendente.toolId)
    if (tool === undefined) {
      return { reply: { kind: 'answer', text: 'Nao consegui repetir a acao. Tente de novo.' } }
    }
    return comToolCalls(await executar(tool, pendente.args, ctx), idsDaFerramenta(pendente.args))
  }

  await runtime.confirmations.resolve(ctx.companyId, pendente.id, 'rejected')
  if (NAO.test(compacto)) {
    return { reply: { kind: 'answer', text: 'Cancelado. Nada foi registrado.' } }
  }
  return {
    reply: {
      kind: 'answer',
      text: 'Nao entendi como confirmacao, entao cancelei. Nada foi registrado. Se quiser, envie o pedido de novo.',
    },
  }
}

async function carregarHistorico(
  runtime: AgentRuntime,
  ctx: ExecutionContext,
  conversationKey: string,
): Promise<readonly HistoryTurn[]> {
  if (runtime.conversations === undefined) return []
  /* Sem options.window — default 12 no store. MUST NOT aumentar o recorte. */
  const ativo = await runtime.conversations.loadActive(ctx.companyId, conversationKey, ctx.now)
  /* Idle: nao passa o trecho ocioso ao decide. Nao grava deleted_at. */
  if (ativo === undefined || ativo.idle) return []
  return ativo.messages.map((m) => ({ role: m.role, body: m.body }))
}

async function gravarTurno(
  runtime: AgentRuntime,
  ctx: ExecutionContext,
  conversationKey: string,
  userBody: string,
  reply: AgentReply,
  toolCalls: unknown,
): Promise<void> {
  if (!REPLY_VISIVEL.has(reply.kind) || runtime.conversations === undefined) return
  try {
    await runtime.conversations.append(ctx.companyId, {
      conversationKey,
      userBody,
      assistantBody: reply.text,
      at: ctx.now,
      ...(toolCalls === undefined ? {} : { toolCalls }),
    })
  } catch {
    /* Falha de append nao desfaz o execute. Sem body — RNF-034. */
    console.error(
      `Falha ao gravar turno da conversa companyId=${ctx.companyId} requestId=${ctx.requestId}`,
    )
  }
}

function comToolCalls(reply: AgentReply, toolCalls: unknown): RespostaDoLaco {
  return toolCalls === undefined ? { reply } : { reply, toolCalls }
}

/** Ids ja resolvidos neste turno — metadado, nao perfil permanente. */
function idsDaFerramenta(args: unknown): unknown {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const o = args as Record<string, unknown>
  const ids: Record<string, unknown> = {}
  for (const chave of ['customerId', 'saleId', 'productId'] as const) {
    if (o[chave] !== undefined) ids[chave] = o[chave]
  }
  return Object.keys(ids).length === 0 ? undefined : ids
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
