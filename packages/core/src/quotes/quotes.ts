import type { ConvertQuoteInput, CreateQuoteInput, QuoteOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { QuoteRepository } from '../ports/quote-repository.js'

/**
 * Orcamento — NR-159.
 *
 * Proposta ao cliente: nao baixa estoque, nao gera financeiro. Os precos
 * prometidos ficam gravados. Aceito, vira venda pelo PDV — a venda entra pelo
 * caminho normal (estoque, pagamento, nota) e o orcamento so registra de qual
 * venda ele virou.
 */
export type QuoteDeps = {
  readonly quotes: QuoteRepository
  readonly audit: AuditTrail
}

export async function createQuote(
  deps: QuoteDeps,
  ctx: ExecutionContext,
  input: CreateQuoteInput,
): Promise<QuoteOutput> {
  assertCanWrite(ctx)

  const produtos = await deps.quotes.findProducts(
    ctx.companyId,
    input.items.map((i) => i.productId),
  )
  const porId = new Map(produtos.map((p) => [p.id, p]))

  for (const item of input.items) {
    const p = porId.get(item.productId)
    if (p === undefined) throw AppError.notFound('Produto nao encontrado.')
    if (!p.isActive) {
      throw AppError.conflict(`O produto "${p.description}" esta inativo e nao pode ser orcado.`)
    }
  }

  const subtotal = input.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0)
  const desconto = input.discountCents ?? 0
  if (desconto > subtotal) {
    throw AppError.validation('O desconto nao pode passar do valor dos produtos.', [
      { path: 'discountCents', message: 'Desconto maior que o total.' },
    ])
  }

  const nome = input.customerName?.trim()
  const orcamento = await deps.quotes.create({
    companyId: ctx.companyId,
    customerName: nome ? nome : null,
    validUntil: input.validUntil,
    notes: input.notes ? input.notes : null,
    discountCents: desconto,
    totalCents: subtotal - desconto,
    items: input.items.map((i) => ({
      productId: i.productId,
      description: porId.get(i.productId)!.description,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
    })),
    createdBy: ctx.userId,
    createdAt: ctx.now,
  })

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Quote',
    entityId: orcamento.id,
    action: 'created',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: null,
    after: { number: orcamento.number, totalCents: orcamento.totalCents },
  })

  return orcamento
}

export async function listQuotes(
  deps: QuoteDeps,
  ctx: ExecutionContext,
): Promise<readonly QuoteOutput[]> {
  return deps.quotes.list(ctx.companyId, 100)
}

export async function getQuote(
  deps: QuoteDeps,
  ctx: ExecutionContext,
  id: string,
): Promise<QuoteOutput> {
  const q = await deps.quotes.findById(ctx.companyId, id)
  if (q === null) throw AppError.notFound('Orcamento nao encontrado.')
  return q
}

async function fechar(
  deps: QuoteDeps,
  ctx: ExecutionContext,
  id: string,
  status: 'converted' | 'cancelled',
  saleId: string | null,
): Promise<QuoteOutput> {
  assertCanWrite(ctx)
  const antes = await getQuote(deps, ctx, id)
  if (antes.status !== 'open') {
    throw AppError.conflict(
      antes.status === 'converted'
        ? 'Este orcamento ja virou venda.'
        : 'Este orcamento foi cancelado.',
    )
  }

  const depois = await deps.quotes.close(ctx.companyId, id, { status, saleId, closedAt: ctx.now })
  /* Entre ler e fechar, outra pessoa fechou: o banco so fecha o que esta aberto. */
  if (depois === null)
    throw AppError.conflict('Este orcamento acabou de ser fechado por outra pessoa.')

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Quote',
    entityId: id,
    action: status === 'cancelled' ? 'cancelled' : 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { status: antes.status },
    after: { status, saleId },
  })

  return depois
}

export async function cancelQuote(
  deps: QuoteDeps,
  ctx: ExecutionContext,
  id: string,
): Promise<QuoteOutput> {
  return fechar(deps, ctx, id, 'cancelled', null)
}

/** Registra a venda que nasceu do orcamento. A venda ja existe — veio do PDV. */
export async function convertQuote(
  deps: QuoteDeps,
  ctx: ExecutionContext,
  id: string,
  input: ConvertQuoteInput,
): Promise<QuoteOutput> {
  assertCanWrite(ctx)
  if (!(await deps.quotes.saleExists(ctx.companyId, input.saleId))) {
    throw AppError.notFound('Venda nao encontrada.')
  }
  return fechar(deps, ctx, id, 'converted', input.saleId)
}
