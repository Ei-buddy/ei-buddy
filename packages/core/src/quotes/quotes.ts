import type {
  ConvertQuoteInput,
  CreateQuoteInput,
  QuoteOutput,
  UpdateQuoteInput,
} from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { AuditTrail } from '../ports/audit-trail.js'
import type { QuoteChanges, QuoteRepository } from '../ports/quote-repository.js'

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

/**
 * Confere cliente, produtos e desconto, e monta o que sera gravado — o mesmo
 * para criar e para editar: um orcamento editado nao pode escapar de uma regra
 * que o novo cumpre.
 */
async function montar(
  deps: QuoteDeps,
  ctx: ExecutionContext,
  input: CreateQuoteInput | UpdateQuoteInput,
): Promise<QuoteChanges> {
  const cliente = await deps.quotes.findCustomer(ctx.companyId, input.customerId)
  if (cliente === null) {
    throw AppError.validation('Escolha um cliente cadastrado para o orçamento.', [
      { path: 'customerId', message: 'Cliente não encontrado.' },
    ])
  }

  const produtos = await deps.quotes.findProducts(
    ctx.companyId,
    input.items.map((i) => i.productId),
  )
  const porId = new Map(produtos.map((p) => [p.id, p]))

  for (const item of input.items) {
    const p = porId.get(item.productId)
    if (p === undefined) throw AppError.notFound('Produto não encontrado.')
    if (!p.isActive) {
      throw AppError.conflict(`O produto "${p.description}" está inativo e não pode ser orçado.`)
    }
  }

  const subtotal = input.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0)
  const desconto = input.discountCents ?? 0
  if (desconto > subtotal) {
    throw AppError.validation('O desconto não pode passar do valor dos produtos.', [
      { path: 'discountCents', message: 'Desconto maior que o total.' },
    ])
  }

  return {
    customerId: cliente.id,
    customerName: cliente.name.slice(0, 120),
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
  }
}

export async function createQuote(
  deps: QuoteDeps,
  ctx: ExecutionContext,
  input: CreateQuoteInput,
): Promise<QuoteOutput> {
  assertCanWrite(ctx)

  const dados = await montar(deps, ctx, input)
  const orcamento = await deps.quotes.create({
    ...dados,
    companyId: ctx.companyId,
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

/**
 * Edita o orcamento ABERTO — achado do QA ("o abrir do orcamento deveria
 * permitir o editar"). O que virou venda ou foi cancelado fica como foi.
 */
export async function updateQuote(
  deps: QuoteDeps,
  ctx: ExecutionContext,
  id: string,
  input: UpdateQuoteInput,
): Promise<QuoteOutput> {
  assertCanWrite(ctx)
  const antes = await getQuote(deps, ctx, id)
  if (antes.status !== 'open') {
    throw AppError.conflict(
      antes.status === 'converted'
        ? 'Este orçamento já virou venda e não pode ser editado.'
        : 'Este orçamento foi cancelado e não pode ser editado.',
    )
  }

  const dados = await montar(deps, ctx, input)
  const depois = await deps.quotes.update(ctx.companyId, id, dados)
  /* Entre ler e gravar, outra pessoa fechou: o banco so edita o que esta aberto. */
  if (depois === null) {
    throw AppError.conflict('Este orçamento acabou de ser fechado por outra pessoa.')
  }

  await deps.audit.record({
    companyId: ctx.companyId,
    entity: 'Quote',
    entityId: id,
    action: 'updated',
    actorId: ctx.userId,
    channel: ctx.channel,
    occurredAt: ctx.now,
    before: { customerId: antes.customerId, totalCents: antes.totalCents },
    after: { customerId: depois.customerId, totalCents: depois.totalCents },
  })

  return depois
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
  if (q === null) throw AppError.notFound('Orçamento não encontrado.')
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
        ? 'Este orçamento já virou venda.'
        : 'Este orçamento foi cancelado.',
    )
  }

  const depois = await deps.quotes.close(ctx.companyId, id, { status, saleId, closedAt: ctx.now })
  /* Entre ler e fechar, outra pessoa fechou: o banco so fecha o que esta aberto. */
  if (depois === null)
    throw AppError.conflict('Este orçamento acabou de ser fechado por outra pessoa.')

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
    throw AppError.notFound('Venda não encontrada.')
  }
  return fechar(deps, ctx, id, 'converted', input.saleId)
}
