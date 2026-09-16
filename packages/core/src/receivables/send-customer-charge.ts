import type { SendChargeInput, SendRejectionReason, SendTextRequest } from '@na-regua/contracts'
import { sendTextRequestSchema } from '@na-regua/contracts'
import { Money } from '@na-regua/money'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { MessageSender } from '../ports/message-sender.js'
import type { ReceivableQueries } from '../ports/receivable-repository.js'
import type { CustomerRepository } from '../ports/registration-repositories.js'

/**
 * Consentimento de WhatsApp do cliente — RF-016, RF-070.
 *
 * Fora de `CustomerOutput` de proposito: a ficha publica nao expoe o instante
 * do aceite, e inventar o campo la mudaria o contrato da tela. Quem dispara
 * cobranca precisa do fato; quem lista cliente, nao.
 */
export type WhatsappConsent = {
  readonly optedInAt: Date | null
  readonly optedOutAt: Date | null
}

export type WhatsappConsentReader = {
  of(companyId: string, customerId: string): Promise<WhatsappConsent>
}

export type SendCustomerChargeDeps = {
  readonly receivables: ReceivableQueries
  readonly customers: CustomerRepository
  readonly messages: MessageSender
  readonly consents: WhatsappConsentReader
}

export type SendCustomerChargeResult =
  | {
      readonly status: 'sent'
      readonly customerName: string
      readonly amountCents: number
      readonly to: string
    }
  | {
      readonly status: 'nothing_to_charge'
      readonly customerName: string
    }
  | {
      readonly status: 'rejected'
      readonly customerName: string
      readonly reason: SendRejectionReason
      readonly message: string
    }

type TituloAberto = {
  readonly amountCents: number
  readonly dueDate: string
  readonly description: string
}

/**
 * Disparo pontual de cobranca a um cliente — US-052, RF-107, RF-068, RF-070.
 *
 * Nao e a varredura diaria (`charge-overdue`): aquela enfileira um envio por
 * vencido, esta cobra QUEM o lojista apontou, depois da confirmacao do
 * assistente. Sem divida, informa e nao envia. Sem consentimento, recusa e nao
 * envia — a porta `MessageSender` exige a base, e core e quem verifica.
 */
export async function sendCustomerCharge(
  deps: SendCustomerChargeDeps,
  ctx: ExecutionContext,
  input: SendChargeInput,
): Promise<SendCustomerChargeResult> {
  assertCanWrite(ctx)

  const cliente = await resolverCliente(deps.customers, ctx, input)
  const titulos = await titulosAbertosDoCliente(deps.receivables, ctx.companyId, cliente.id)

  if (titulos.length === 0) {
    return { status: 'nothing_to_charge', customerName: cliente.name }
  }

  if (cliente.phone === null || cliente.phone === '') {
    throw AppError.validation(
      'Este cliente nao tem telefone cadastrado. Inclua o numero no cadastro para enviar a cobranca.',
    )
  }

  const consentimento = await deps.consents.of(ctx.companyId, cliente.id)
  if (consentimento.optedOutAt !== null) {
    throw AppError.forbidden('Este cliente pediu para nao receber mensagens. Nada foi enviado.')
  }
  if (consentimento.optedInAt === null) {
    throw AppError.forbidden(
      'Este cliente ainda nao autorizou mensagens. Peca o aceite dele no aplicativo antes de cobrar por aqui.',
    )
  }

  const amountCents = titulos.reduce((soma, t) => soma + t.amountCents, 0)
  const pedido = montarPedido({
    ctx,
    to: cliente.phone,
    optedInAt: consentimento.optedInAt,
    body: textoDaCobrancaAoCliente({ customerName: cliente.name, titulos }),
  })

  const r = await deps.messages.sendText(pedido)
  if (r.status === 'rejected') {
    return {
      status: 'rejected',
      customerName: cliente.name,
      reason: r.reason,
      message: r.message,
    }
  }

  return { status: 'sent', customerName: cliente.name, amountCents, to: r.to }
}

export function textoDaCobrancaAoCliente(input: {
  readonly customerName: string
  readonly titulos: readonly TituloAberto[]
}): string {
  const partes = input.titulos.map((t) => {
    return `${Money.fromCents(t.amountCents).format()} com vencimento em ${formatarDia(t.dueDate)} (${t.description})`
  })
  const detalhe = partes.join('; ')
  return (
    `Ola, ${input.customerName}! Passando para lembrar do valor em aberto de ` +
    `${detalhe}. Qualquer duvida, e so responder por aqui.`
  )
}

async function resolverCliente(
  customers: CustomerRepository,
  ctx: ExecutionContext,
  input: SendChargeInput,
): Promise<{ id: string; name: string; phone: string | null }> {
  if (input.customerId !== undefined) {
    const achado = await customers.findById(ctx.companyId, input.customerId)
    if (achado === undefined) {
      throw AppError.notFound('Nao encontramos esse cliente.')
    }
    return { id: achado.id, name: achado.name, phone: achado.phone }
  }

  const parecidos = await customers.findSimilar(ctx.companyId, { phone: input.phone })
  if (parecidos.length === 0) {
    throw AppError.notFound('Nao encontramos cliente com esse telefone.')
  }
  if (parecidos.length > 1) {
    throw AppError.validation(
      'Ha mais de um cliente com esse telefone. Informe qual deles cobrar.',
      parecidos.map((c) => ({ path: 'customerId', message: c.name })),
    )
  }
  const unico = parecidos[0]
  if (unico === undefined) {
    throw AppError.notFound('Nao encontramos cliente com esse telefone.')
  }
  return { id: unico.id, name: unico.name, phone: unico.phone }
}

async function titulosAbertosDoCliente(
  receivables: ReceivableQueries,
  companyId: string,
  customerId: string,
): Promise<readonly TituloAberto[]> {
  const abertos = await receivables.list(companyId, { status: ['open', 'partially_settled'] })
  return abertos
    .filter((r) => r.customerId === customerId)
    .map((r) => ({
      amountCents: r.amountCents - r.settledAmountCents,
      dueDate: r.dueDate,
      description: r.description,
    }))
    .filter((t) => t.amountCents > 0)
}

function montarPedido(input: {
  readonly ctx: ExecutionContext
  readonly to: string
  readonly optedInAt: Date
  readonly body: string
}): SendTextRequest {
  const bruto = {
    companyId: input.ctx.companyId,
    to: input.to,
    consent: {
      basis: 'customer_opt_in' as const,
      recordedAt: input.optedInAt.toISOString(),
    },
    idempotencyKey: input.ctx.idempotencyKey ?? `charge:${input.ctx.requestId}`,
    requestedAt: input.ctx.now.toISOString(),
    body: input.body,
  }
  const parsed = sendTextRequestSchema.safeParse(bruto)
  if (!parsed.success) {
    throw AppError.validation(
      'Nao deu para montar o envio. Confira o telefone do cliente e tente de novo.',
    )
  }
  return parsed.data
}

/** `AAAA-MM-DD` para `DD/MM`. */
function formatarDia(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}
