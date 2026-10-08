import type { CreatePurchaseData, PurchaseOutput } from '@na-regua/contracts'
import { ocorrenciasDaRecorrencia } from '@na-regua/domain'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { IdGenerator, NewPayable } from '../ports/payable-repository.js'
import type {
  PurchaseProductSnapshot,
  PurchaseQueries,
  PurchaseUnitOfWork,
} from '../ports/purchase-register.js'

export type RegisterPurchaseDeps = {
  readonly uow: PurchaseUnitOfWork
  readonly ids: IdGenerator
}

/**
 * Custo medio ponderado.
 *
 * O saldo que ja estava na prateleira foi pago a um preco, o que chega agora a
 * outro; o custo que vale e a media dos dois pesada pela quantidade. Sem saldo
 * positivo (zerado, negativo por venda sem estoque, ou sem controle), o custo
 * passa a ser o desta compra — nao ha o que ponderar.
 */
export function custoMedio(
  saldo: number | null,
  custoAtual: number,
  quantidade: number,
  custoUnitario: number,
): number {
  if (saldo === null || saldo <= 0) return custoUnitario
  return Math.round((saldo * custoAtual + quantidade * custoUnitario) / (saldo + quantidade))
}

/** Divide o total em parcelas inteiras; os centavos que sobram vao na primeira. */
export function dividirEmParcelas(totalCents: number, parcelas: number): readonly number[] {
  const base = Math.floor(totalCents / parcelas)
  const sobra = totalCents - base * parcelas
  return Array.from({ length: parcelas }, (_, i) => (i === 0 ? base + sobra : base))
}

/**
 * Entrada de mercadoria — NR-158.
 *
 * Soma ao estoque (com a linha `purchase` na trilha), atualiza o custo pelo
 * custo medio e lanca a conta a pagar ao fornecedor. Tudo numa transacao.
 */
export async function registerPurchase(
  deps: RegisterPurchaseDeps,
  ctx: ExecutionContext,
  input: CreatePurchaseData,
): Promise<PurchaseOutput> {
  assertCanWrite(ctx)

  const totalCents = input.items.reduce((soma, i) => soma + i.quantity * i.unitCostCents, 0)

  if (totalCents > 0 && totalCents < input.installments) {
    throw AppError.conflict('O total da compra é pequeno demais para esse número de parcelas.')
  }

  const parcelado = input.installments > 1
  const grupo = parcelado ? deps.ids.next() : null

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const produtos: PurchaseProductSnapshot[] = []
    for (const item of input.items) {
      const produto = await tx.findProduct(ctx.companyId, item.productId)
      if (produto === undefined) throw AppError.notFound('Produto não encontrado.')
      if (!produto.isActive) {
        throw AppError.conflict(
          `O produto "${produto.description}" está inativo. Reative-o antes de dar entrada.`,
        )
      }
      produtos.push(produto)
    }

    const compra = await tx.insertPurchase({
      companyId: ctx.companyId,
      supplier: input.supplier,
      invoiceNumber: input.invoiceNumber ?? null,
      notes: input.notes ?? null,
      totalCents,
      installments: input.installments,
      payablesGroup: grupo,
      items: input.items.map((item, i) => ({
        productId: item.productId,
        description: produtos[i]!.description,
        quantity: item.quantity,
        unitCostCents: item.unitCostCents,
      })),
      createdBy: ctx.userId,
      createdAt: ctx.now,
    })

    for (const [i, item] of input.items.entries()) {
      const produto = produtos[i]!
      const saldo = produto.stockQuantity === null ? null : produto.stockQuantity + item.quantity
      const custo = custoMedio(
        produto.stockQuantity,
        produto.costPriceCents,
        item.quantity,
        item.unitCostCents,
      )

      await tx.updateProduct(ctx.companyId, item.productId, { stock: saldo, costPriceCents: custo })

      if (saldo !== null) {
        await tx.insertMovement({
          companyId: ctx.companyId,
          productId: item.productId,
          purchaseId: compra.id,
          quantityDelta: item.quantity,
          balanceAfter: saldo,
          createdBy: ctx.userId,
          createdAt: ctx.now,
        })
      }
    }

    /* Compra de custo zero (bonificacao) nao gera conta: nao ha o que pagar. */
    if (totalCents > 0) {
      const vencimentos = ocorrenciasDaRecorrencia(input.dueDate, 'monthly', input.installments)
      const valores = dividirEmParcelas(totalCents, input.installments)
      const nota = input.invoiceNumber ? ` NF ${input.invoiceNumber}` : ''
      const contas: NewPayable[] = vencimentos.map((dueDate, i) => ({
        companyId: ctx.companyId,
        supplier: input.supplier,
        description: `Compra de mercadoria${nota}`,
        amountCents: valores[i]!,
        dueDate,
        attachmentKey: null,
        accountId: null,
        recurrenceId: grupo,
        occurrenceNumber: parcelado ? i + 1 : null,
        occurrenceCount: parcelado ? vencimentos.length : null,
        createdBy: ctx.userId,
        createdAt: ctx.now,
      }))
      await tx.insertPayables(contas)
    }

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Purchase',
      entityId: compra.id,
      action: 'created',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: null,
      after: {
        supplier: input.supplier,
        totalCents,
        installments: input.installments,
        items: input.items.length,
      },
    })

    return compra
  })
}

export type ListPurchasesDeps = { readonly queries: PurchaseQueries }

export async function listPurchases(
  deps: ListPurchasesDeps,
  ctx: ExecutionContext,
): Promise<readonly PurchaseOutput[]> {
  return deps.queries.list(ctx.companyId, 100)
}
