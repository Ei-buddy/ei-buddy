import type { SendChargeInput, SendRejectionReason, SendTextRequest } from '@na-regua/contracts'
import { sendTextRequestSchema } from '@na-regua/contracts'
import { Money } from '@na-regua/money'
import { AppError } from '../app-error.js'
import type { CustomerChargeRepository } from '../ports/customer-charge-repository.js'
import { referenciaDaCobranca } from './referencia-da-cobranca.js'
import type { PaymentGateway } from '../ports/payment-gateway.js'
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
  /**
   * Gateway de pagamento — RF-068, opcional de proposito.
   *
   * Com ele, a cobranca leva um link que o cliente paga em dois toques. Sem
   * ele (loja sem conta de recebimento, provedor fora do ar), a mensagem sai
   * do mesmo jeito com o valor e o vencimento: cobrar sem link e melhor que
   * nao cobrar.
   */
  readonly gateway?: PaymentGateway | undefined
  /**
   * Onde a cobranca fica registrada, para o aviso do provedor achar os titulos
   * — RF-068.
   *
   * Opcional junto com o `gateway`: sem link nao ha o que registrar. Com link
   * e sem isto, o cliente pagaria e nenhum titulo baixaria — por isso o caso
   * de uso avisa no retorno quando cai nesse estado, em vez de fingir que
   * cobrou por completo.
   */
  readonly charges?: CustomerChargeRepository | undefined
}

export type SendCustomerChargeResult =
  | {
      readonly status: 'sent'
      readonly customerName: string
      readonly amountCents: number
      readonly to: string
      /** Ausente quando nao houve gateway, ou quando ele nao respondeu. */
      readonly paymentLinkUrl?: string | undefined
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
  /* O id do recebivel, para a cobranca saber a quais titulos ela corresponde
     quando o aviso do pagamento voltar. Sem ele, o link nao leva a lugar
     nenhum. */
  readonly id: string
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
  const link = await criarLink(deps, ctx, { amountCents, titulos })
  const linkDePagamento = link?.url

  /*
   * O registro acontece ANTES do envio, de proposito.
   *
   * Depois, uma falha de escrita deixaria o cliente com um link vivo que nao
   * leva a titulo nenhum: ele paga e nada baixa. Antes, uma falha de escrita
   * impede o envio — o lojista tenta de novo, e o `externalReference` e o
   * mesmo, entao nao nasce cobranca duplicada.
   */
  if (link !== undefined && deps.charges !== undefined) {
    await deps.charges.registrar({
      companyId: ctx.companyId,
      customerId: cliente.id,
      externalReference: referenciaDaCobranca(ctx.companyId, ctx.requestId),
      amountCents,
      providerLinkId: link.linkId,
      checkoutUrl: link.url,
      titulos: titulos.map((t) => ({ receivableId: t.id, amountCents: t.amountCents })),
      createdAt: ctx.now,
    })
  }

  const pedido = montarPedido({
    ctx,
    to: cliente.phone,
    optedInAt: consentimento.optedInAt,
    body: textoDaCobrancaAoCliente({
      customerName: cliente.name,
      titulos,
      ...(linkDePagamento === undefined ? {} : { paymentLinkUrl: linkDePagamento }),
    }),
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

  return {
    status: 'sent',
    customerName: cliente.name,
    amountCents,
    to: r.to,
    ...(linkDePagamento === undefined ? {} : { paymentLinkUrl: linkDePagamento }),
  }
}

/**
 * O link de pagamento, quando da — RF-068.
 *
 * Falha do provedor NAO derruba a cobranca. O lojista pediu para cobrar; o
 * link e uma facilidade em cima disso, e trocar "mensagem sem link" por
 * "nenhuma mensagem" seria piorar o resultado para proteger um detalhe.
 *
 * `externalReference` carrega EMPRESA e pedido — ver `referencia-da-cobranca`.
 * A empresa vai junto porque o aviso de pagamento chega sem contexto de tenant,
 * e sem ela a baixa nao teria como achar a cobranca. O pedido garante que
 * reenviar o mesmo pedido reaproveite o link, em vez de criar um segundo para
 * a mesma divida.
 */
async function criarLink(
  deps: SendCustomerChargeDeps,
  ctx: ExecutionContext,
  dados: { readonly amountCents: number; readonly titulos: readonly TituloAberto[] },
): Promise<{ readonly url: string; readonly linkId: string } | undefined> {
  if (deps.gateway === undefined) return undefined

  /* O vencimento do link e o mais PROXIMO em aberto: usar o mais distante
     daria ao cliente a impressao de que tudo vence la na frente. */
  const vencimento = [...dados.titulos].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
    ?.dueDate

  try {
    const link = await deps.gateway.createPaymentLink({
      companyId: ctx.companyId,
      externalReference: referenciaDaCobranca(ctx.companyId, ctx.requestId),
      amountCents: dados.amountCents,
      description: 'Pagamento de valores em aberto',
      ...(vencimento === undefined ? {} : { dueDate: vencimento }),
      requestedAt: ctx.now.toISOString(),
    })
    return { url: link.url, linkId: link.linkId }
  } catch {
    return undefined
  }
}

export function textoDaCobrancaAoCliente(input: {
  readonly customerName: string
  /* So o que a frase usa. Exigir o `id` aqui obrigaria quem quer apenas
     formatar um texto a carregar um identificador que a frase nunca le. */
  readonly titulos: readonly Omit<TituloAberto, 'id'>[]
  readonly paymentLinkUrl?: string | undefined
}): string {
  const partes = input.titulos.map((t) => {
    return `${Money.fromCents(t.amountCents).format()} com vencimento em ${formatarDia(t.dueDate)} (${t.description})`
  })
  const detalhe = partes.join('; ')
  const link =
    input.paymentLinkUrl === undefined
      ? ''
      : ` Se preferir, da para pagar por aqui: ${input.paymentLinkUrl}.`
  return (
    `Ola, ${input.customerName}! Passando para lembrar do valor em aberto de ` +
    `${detalhe}.${link} Qualquer duvida, e so responder por aqui.`
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
      id: r.id,
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
