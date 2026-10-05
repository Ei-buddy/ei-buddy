import type { InvoiceIssueResult } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { InvoiceIssuer } from '../ports/invoice-issuer.js'

export type CancelInvoiceDeps = {
  readonly invoices: Pick<InvoiceIssuer, 'cancel'>
  readonly store: {
    findBySale(
      companyId: string,
      saleId: string,
    ): Promise<{ readonly resultado: InvoiceIssueResult } | undefined>
  }
  readonly audit: AuditTrail
}

/**
 * Prazo de cancelamento da NFC-e — RF-051.
 *
 * Trinta minutos depois da autorizacao, que e o prazo da NFC-e na maior parte
 * das UFs. Recusar AQUI, antes de transmitir, poupa uma rejeicao certa da SEFAZ
 * e da a orientacao que ela nao da.
 */
export const PRAZO_DE_CANCELAMENTO_MINUTOS = 30

/**
 * Cancela a nota da venda — RF-050, RF-051, US-024.
 *
 * E o passo que faltava antes do estorno e da devolucao: os dois recusam venda
 * com nota valida, porque estornar o estoque com a nota valendo na SEFAZ deixa
 * os dois lados divergentes. O adapter marca a nota como cancelada na guarda
 * quando a SEFAZ confirma — dali em diante a venda pode ser estornada.
 *
 * Rejeicao da SEFAZ e resultado, e volta como erro de validacao com a frase
 * dela: o lojista precisa saber o motivo para decidir o que fazer.
 */
export async function cancelSaleInvoice(
  deps: CancelInvoiceDeps,
  ctx: ExecutionContext,
  input: { readonly saleId: string; readonly reason: string },
): Promise<{ readonly cancelledAt: string; readonly protocol: string }> {
  assertCanWrite(ctx)

  const nota = await deps.store.findBySale(ctx.companyId, input.saleId)
  if (nota === undefined || nota.resultado.status === 'rejected') {
    throw AppError.notFound('Esta venda nao tem nota fiscal valida para cancelar.')
  }

  if (nota.resultado.status === 'contingency') {
    throw AppError.conflict(
      'A nota ainda esta em contingencia, sem autorizacao da SEFAZ. Espere a autorizacao ' +
        'para cancelar. Nada foi alterado.',
    )
  }

  const autorizadaHa = ctx.now.getTime() - new Date(nota.resultado.issuedAt).getTime()
  if (autorizadaHa > PRAZO_DE_CANCELAMENTO_MINUTOS * 60_000) {
    throw AppError.conflict(
      `Passou o prazo de ${PRAZO_DE_CANCELAMENTO_MINUTOS} minutos para cancelar a NFC-e. ` +
        'Fora do prazo, o caminho e uma nota de devolucao — fale com o seu contador. ' +
        'Nada foi alterado.',
    )
  }

  const r = await deps.invoices.cancel({
    companyId: ctx.companyId,
    accessKey: nota.resultado.accessKey,
    reason: input.reason,
    requestedAt: ctx.now.toISOString(),
  })

  if (r.status === 'rejected') {
    throw AppError.validation(r.rejection.message, [
      { path: 'reason', message: r.rejection.message },
    ])
  }

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Sale',
    entityId: input.saleId,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { invoice: 'authorized', accessKey: r.accessKey },
    after: { invoice: 'cancelled', protocol: r.protocol, reason: input.reason },
  })

  return { cancelledAt: r.cancelledAt, protocol: r.protocol }
}
