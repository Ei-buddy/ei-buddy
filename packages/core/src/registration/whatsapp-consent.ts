import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { CustomerRepository } from '../ports/registration-repositories.js'
import type { WhatsappConsent, WhatsappConsentReader } from '../receivables/send-customer-charge.js'

/**
 * Registrar o consentimento e o opt-out do cliente — RF-016.
 *
 * `sendCustomerCharge` ja recusava enviar sem aceite e ja respeitava o
 * opt-out. O que faltava era ALGUEM escrever essas duas datas: a composicao
 * entregava ao caso de uso um aceite fixo para todo cliente identificado, e o
 * bloqueio rodava contra um leitor que nunca dizia nao.
 *
 * ## Quem manifesta e o cliente; quem registra e o lojista
 *
 * Nao ha tela do cliente neste sistema — o WhatsApp de entrada e do LOJISTA,
 * que opera a loja por mensagem. Entao isto aqui e o equivalente digital de
 * anotar um papel assinado: o lojista declara o que o cliente disse, e a
 * trilha guarda quem declarou e quando.
 *
 * Por isso a mensagem de erro do envio fala em "peca o aceite dele", e nao em
 * "marque a caixinha": a caixinha e o registro, nao o consentimento.
 */

export type WhatsappConsentWriter = WhatsappConsentReader & {
  record(
    companyId: string,
    customerId: string,
    decisao: 'opt_in' | 'opt_out',
    quando: Date,
    updatedBy: string,
  ): Promise<boolean>
}

export type WhatsappConsentDeps = {
  readonly consents: WhatsappConsentWriter
  readonly customers: CustomerRepository
}

export async function recordWhatsappConsent(
  deps: WhatsappConsentDeps,
  ctx: ExecutionContext,
  customerId: string,
  decisao: 'opt_in' | 'opt_out',
): Promise<WhatsappConsent> {
  assertCanWrite(ctx)

  const gravou = await deps.consents.record(ctx.companyId, customerId, decisao, ctx.now, ctx.userId)

  /* Cliente de outra empresa cai no MESMO 404 de "nao existe" — um erro
     diferente confirmaria que aquele id existe em alguma outra loja. */
  if (!gravou) {
    throw AppError.notFound('Cliente nao encontrado.')
  }

  return deps.consents.of(ctx.companyId, customerId)
}

export async function getWhatsappConsent(
  deps: { readonly consents: WhatsappConsentReader },
  ctx: ExecutionContext,
  customerId: string,
): Promise<WhatsappConsent> {
  return deps.consents.of(ctx.companyId, customerId)
}
