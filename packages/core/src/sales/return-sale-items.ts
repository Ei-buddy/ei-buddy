import type { ReturnSaleItemsInput, SaleReturnOutput } from '@na-regua/contracts'
import { AppError } from '../app-error.js'
import { assertCanWrite } from '../authorization.js'
import type { ExecutionContext } from '../context.js'
import type { RecebivelDaVenda, SaleReturnUnitOfWork } from '../ports/sale-return.js'

export type ReturnSaleItemsDeps = {
  readonly returns: SaleReturnUnitOfWork
}

/** O que o recibo da linha diz ter sido cobrado por `n` unidades, arredondado. */
const valorDe = (totalCents: number, n: number, quantidade: number): number =>
  Math.round((totalCents * n) / quantidade)

/**
 * Devolucao parcial — RF-044, US-021, NR-122.
 *
 * O cliente trouxe de volta PARTE do que levou. Volta o estoque desses itens,
 * e o valor proporcional sai de onde a venda deixou dinheiro:
 *
 * 1. **Primeiro, o que ainda estava em aberto** (fiado, parcela de cartao a
 *    receber): deixa de ser devido. Nenhum dinheiro sai do caixa.
 * 2. **Depois, o que ja tinha entrado** (dinheiro, Pix): sai do caixa e volta
 *    para a mao do cliente — e a resposta diz quanto, para o operador saber o
 *    que entregar.
 *
 * ## O valor e do servidor, por linha, e cumulativo
 *
 * `total * (ja devolvido + agora) / vendido - total * ja devolvido / vendido`,
 * cada termo arredondado. Devolver 1 de 3 itens de R$ 10,00 tres vezes soma
 * exatamente R$ 10,00, e nao R$ 9,99: o arredondamento de cada devolucao
 * compensa o da anterior.
 *
 * ## Recusa o mesmo que o cancelamento
 *
 * Nota emitida (a devolucao fiscal nao existe ainda), baixa ja lancada (o
 * estorno da baixa vem antes) e venda cancelada ou ja devolvida inteira.
 */
export async function returnSaleItems(
  deps: ReturnSaleItemsDeps,
  ctx: ExecutionContext,
  input: ReturnSaleItemsInput,
): Promise<SaleReturnOutput> {
  assertCanWrite(ctx)

  return deps.returns.transaction(ctx.companyId, async (tx) => {
    const venda = await tx.findSale(input.saleId)
    if (venda === undefined) throw AppError.notFound('Venda nao encontrada.')

    if (venda.status === 'cancelled' || venda.status === 'returned') {
      throw AppError.conflict('Esta venda ja foi cancelada ou devolvida. Nada foi alterado.')
    }
    if (venda.hasIssuedInvoice) {
      throw AppError.conflict(
        'Esta venda tem nota emitida. A devolucao com nota ainda nao existe — cancele a nota ' +
          'primeiro. Nada foi alterado.',
      )
    }
    if (venda.settledCents > 0) {
      throw AppError.conflict(
        'Esta venda ja tem recebimento baixado. Estorne a baixa antes de devolver. Nada foi alterado.',
      )
    }

    /* Por produto, somando: a tela pode mandar o mesmo produto duas vezes, e a
       venda pode ter o mesmo produto em duas linhas. */
    const pedido = new Map<string, number>()
    for (const item of input.items) {
      pedido.set(item.productId, (pedido.get(item.productId) ?? 0) + item.quantity)
    }

    const linhasDevolvidas: { saleItemId: string; quantity: number }[] = []
    let valor = 0

    for (const [productId, quantidade] of pedido) {
      const linhas = venda.lines.filter((l) => l.productId === productId)
      const disponivel = linhas.reduce((s, l) => s + l.quantity - l.returnedQuantity, 0)

      if (linhas.length === 0) {
        throw AppError.validation('Um dos itens nao faz parte desta venda. Nada foi alterado.')
      }
      if (quantidade > disponivel) {
        throw AppError.validation(
          `Devolucao maior que o que resta da venda: pediu ${quantidade}, restam ${disponivel}. ` +
            'Nada foi alterado.',
        )
      }

      let falta = quantidade
      for (const linha of linhas) {
        const aqui = Math.min(falta, linha.quantity - linha.returnedQuantity)
        if (aqui <= 0) continue
        falta -= aqui

        linhasDevolvidas.push({ saleItemId: linha.saleItemId, quantity: aqui })
        valor +=
          valorDe(linha.totalCents, linha.returnedQuantity + aqui, linha.quantity) -
          valorDe(linha.totalCents, linha.returnedQuantity, linha.quantity)
      }
    }

    await tx.restoreStock(
      [...pedido].map(([productId, quantity]) => ({ productId, quantity })),
      { saleId: venda.id, createdBy: ctx.userId, createdAt: ctx.now },
    )
    await tx.markLinesReturned(linhasDevolvidas)

    /* O aberto primeiro, do vencimento mais distante para o mais proximo: a
       ultima parcela e a que o cliente ainda nao se programou para pagar. */
    const ordem = (r: RecebivelDaVenda) => (r.status === 'settled' ? 1 : 0)
    const recebiveis = venda.receivables
      .filter((r) => r.status !== 'cancelled')
      .sort((a, b) => ordem(a) - ordem(b) || b.dueDate.localeCompare(a.dueDate))

    let resta = valor
    let paidBackCents = 0
    let uncollectedCents = 0

    for (const r of recebiveis) {
      if (resta === 0) break
      const tirar = Math.min(resta, r.amountCents)
      resta -= tirar

      if (tirar === r.amountCents) {
        await tx.cancelReceivable(r.id)
      } else {
        const novo = r.amountCents - tirar
        await tx.reduceReceivable(r.id, {
          amountCents: novo,
          netAmountCents: Math.round((r.netAmountCents * novo) / r.amountCents),
        })
      }

      if (r.status === 'settled') paidBackCents += tirar
      else uncollectedCents += tirar

      /* Fiado e divida na carteira do cliente: o que deixou de ser devido sai
         do saldo dele tambem. */
      if (r.description === 'Fiado' && venda.customerId !== null) {
        await tx.decreaseWalletBalance(venda.customerId, tirar)
      }
    }

    /* Sobra so se os recebiveis somassem menos que a venda — nao deveria. Se
       acontecer, o dinheiro sai do caixa, que e o lado seguro para o cliente. */
    paidBackCents += resta

    const devolvidoPorLinha = new Map(linhasDevolvidas.map((l) => [l.saleItemId, l.quantity]))
    const inteira = venda.lines.every(
      (l) => l.returnedQuantity + (devolvidoPorLinha.get(l.saleItemId) ?? 0) === l.quantity,
    )

    await tx.addReturnedAmount(venda.id, valor, inteira)

    await tx.record({
      companyId: ctx.companyId,
      entity: 'Sale',
      entityId: venda.id,
      /* `updated`, e nao uma acao nova: a lista de acoes da trilha e fechada
         no banco. O que aconteceu fica em `after` — `kind: 'return'`. */
      action: 'updated',
      actorId: ctx.userId,
      channel: ctx.channel,
      occurredAt: ctx.now,
      before: { status: venda.status },
      after: {
        kind: 'return',
        status: inteira ? 'returned' : venda.status,
        reason: input.reason,
        items: input.items,
        refundCents: valor,
        paidBackCents,
        uncollectedCents,
      },
    })

    return {
      refundCents: valor,
      paidBackCents,
      uncollectedCents,
      status: inteira ? 'returned' : venda.status,
    }
  })
}
