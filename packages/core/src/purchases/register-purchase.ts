import type { CancelPurchaseInput, CreatePurchaseData, PurchaseOutput } from '@na-regua/contracts'
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

  /*
   * As parcelas — achado do QA: vencimento e valor de CADA uma. Com
   * `parcels`, elas mandam e a soma tem de fechar com o total; sem, sao
   * mensais e iguais a partir de `dueDate`, como antes.
   */
  const parcelas: readonly { dueDate: string; amountCents: number }[] =
    totalCents === 0
      ? []
      : input.parcels !== undefined
        ? input.parcels
        : (() => {
            if (totalCents < input.installments) {
              throw AppError.conflict(
                'O total da compra é pequeno demais para esse número de parcelas.',
              )
            }
            const valores = dividirEmParcelas(totalCents, input.installments)
            return ocorrenciasDaRecorrencia(input.dueDate!, 'monthly', input.installments).map(
              (dueDate, i) => ({ dueDate, amountCents: valores[i]! }),
            )
          })()

  const somaDasParcelas = parcelas.reduce((s, p) => s + p.amountCents, 0)
  if (parcelas.length > 0 && somaDasParcelas !== totalCents) {
    throw AppError.validation(
      `As parcelas somam ${reais(somaDasParcelas)}, e a compra é de ${reais(totalCents)}. Ajuste os valores.`,
      [{ path: 'parcels', message: 'A soma das parcelas não fecha com o total.' }],
    )
  }

  const quantasParcelas = Math.max(1, parcelas.length)
  const parcelado = quantasParcelas > 1
  const grupo = parcelado ? deps.ids.next() : null

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    if (input.supplierId !== undefined) {
      const fornecedor = await tx.findSupplier(ctx.companyId, input.supplierId)
      if (fornecedor === undefined) throw AppError.notFound('Fornecedor não encontrado.')
    }

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
      supplierId: input.supplierId ?? null,
      invoiceNumber: input.invoiceNumber ?? null,
      notes: input.notes ?? null,
      totalCents,
      installments: quantasParcelas,
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
    if (parcelas.length > 0) {
      const nota = input.invoiceNumber ? ` NF ${input.invoiceNumber}` : ''
      const contas: NewPayable[] = parcelas.map((p, i) => ({
        companyId: ctx.companyId,
        supplier: input.supplier,
        description: `Compra de mercadoria${nota}`,
        amountCents: p.amountCents,
        dueDate: p.dueDate,
        attachmentKey: null,
        accountId: null,
        recurrenceId: grupo,
        occurrenceNumber: parcelado ? i + 1 : null,
        occurrenceCount: parcelado ? parcelas.length : null,
        purchaseId: compra.id,
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
        installments: quantasParcelas,
        items: input.items.length,
      },
    })

    return compra
  })
}

const reais = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Estorno da compra — achado do QA ("poder estornar a compra").
 *
 * Devolve o estoque (uma linha "Estorno da compra" na trilha de cada produto)
 * e cancela as contas a pagar da compra. Conta ja paga, mesmo em parte,
 * trava o estorno: dinheiro que saiu do caixa se desfaz estornando a baixa
 * primeiro, e e o lojista quem decide isso.
 *
 * O custo do produto NAO volta: o custo medio ja foi usado nas vendas feitas
 * depois, e refaze-lo sem refazer essas vendas daria uma margem que nao
 * existiu. O estoque pode ficar negativo — a mercadoria pode ja ter sido
 * vendida, e a trilha mostra isso.
 */
export async function cancelPurchase(
  deps: Pick<RegisterPurchaseDeps, 'uow'>,
  ctx: ExecutionContext,
  purchaseId: string,
  input: CancelPurchaseInput,
): Promise<PurchaseOutput> {
  assertCanWrite(ctx)

  return deps.uow.transaction(ctx.companyId, async (tx) => {
    const compra = await tx.findPurchase(ctx.companyId, purchaseId)
    if (compra === undefined) throw AppError.notFound('Compra não encontrada.')
    if (compra.status === 'cancelled') throw AppError.conflict('Esta compra já foi estornada.')

    const contas = await tx.payablesOfPurchase(ctx.companyId, purchaseId)
    if (contas.some((c) => c.settledAmountCents > 0)) {
      throw AppError.conflict(
        'Esta compra tem conta a pagar com pagamento registrado. Estorne o pagamento em Contas a pagar antes de estornar a compra.',
      )
    }

    for (const item of compra.items) {
      const produto = await tx.findProduct(ctx.companyId, item.productId)
      /* Produto excluido depois da compra: nao ha saldo onde devolver. */
      if (produto === undefined || produto.stockQuantity === null) continue
      const saldo = produto.stockQuantity - item.quantity
      await tx.updateProduct(ctx.companyId, item.productId, {
        stock: saldo,
        costPriceCents: produto.costPriceCents,
      })
      await tx.insertMovement({
        companyId: ctx.companyId,
        productId: item.productId,
        purchaseId,
        quantityDelta: -item.quantity,
        balanceAfter: saldo,
        reason: 'Estorno da compra',
        createdBy: ctx.userId,
        createdAt: ctx.now,
      })
    }

    const abertas = contas.filter((c) => c.status !== 'cancelled').map((c) => c.id)
    if (abertas.length > 0) await tx.cancelPayables(ctx.companyId, abertas, ctx.userId, ctx.now)

    const estornada = await tx.markPurchaseCancelled(
      ctx.companyId,
      purchaseId,
      ctx.userId,
      ctx.now,
      input.reason,
    )

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Purchase',
      entityId: purchaseId,
      action: 'cancelled',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: { status: 'active', totalCents: compra.totalCents },
      after: { status: 'cancelled', reason: input.reason, contasCanceladas: abertas.length },
    })

    return estornada
  })
}

export type ListPurchasesDeps = { readonly queries: PurchaseQueries }

export async function listPurchases(
  deps: ListPurchasesDeps,
  ctx: ExecutionContext,
): Promise<readonly PurchaseOutput[]> {
  return deps.queries.list(ctx.companyId, 100)
}
