import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '../context.js'
import type {
  RecebivelDaVenda,
  SaleReturnTransaction,
  SaleReturnUnitOfWork,
  SaleToReturn,
} from '../ports/sale-return.js'
import { returnSaleItems } from './return-sale-items.js'

const ctx: ExecutionContext = {
  companyId: 'emp-1',
  userId: 'user-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: new Date('2026-09-24T12:00:00.000Z'),
}

const recebivel = (over: Partial<RecebivelDaVenda>): RecebivelDaVenda => ({
  id: 'r-1',
  description: 'Recebimento em cash',
  amountCents: 3000,
  netAmountCents: 3000,
  status: 'settled',
  dueDate: '2026-09-24',
  ...over,
})

function venda(over: Partial<SaleToReturn> = {}): SaleToReturn {
  return {
    id: 'venda-1',
    status: 'settled',
    customerId: 'cli-1',
    /* 3 unidades de R$ 10,00 */
    lines: [
      { saleItemId: 'i-1', productId: 'p-1', quantity: 3, returnedQuantity: 0, totalCents: 1000 },
    ],
    receivables: [recebivel({})],
    hasIssuedInvoice: false,
    settledCents: 0,
    ...over,
  }
}

function mundo(sale: SaleToReturn) {
  const feito = {
    estoque: [] as { productId: string; quantity: number }[],
    linhas: [] as { saleItemId: string; quantity: number }[],
    reduzidos: [] as { id: string; amountCents: number }[],
    cancelados: [] as string[],
    carteira: 0,
    devolvido: null as { valor: number; inteira: boolean } | null,
  }
  const tx: SaleReturnTransaction = {
    findSale: async () => sale,
    restoreStock: async (itens) => void feito.estoque.push(...itens),
    markLinesReturned: async (l) => void feito.linhas.push(...l),
    reduceReceivable: async (id, novo) =>
      void feito.reduzidos.push({ id, amountCents: novo.amountCents }),
    cancelReceivable: async (id) => void feito.cancelados.push(id),
    decreaseWalletBalance: async (_c, v) => void (feito.carteira += v),
    addReturnedAmount: async (_s, valor, inteira) => void (feito.devolvido = { valor, inteira }),
    record: async () => ({}) as never,
  }
  const uow: SaleReturnUnitOfWork = { transaction: async (_c, fn) => fn(tx) }
  return { uow, feito }
}

const pedir = (quantity: number) => ({
  saleId: 'venda-1',
  reason: 'defeito',
  items: [{ productId: 'p-1', quantity }],
})

describe('devolucao parcial — RF-044', () => {
  it('devolve 1 de 3: estoque volta, e o valor proporcional sai do caixa', async () => {
    const { uow, feito } = mundo(
      venda({
        lines: [
          {
            saleItemId: 'i-1',
            productId: 'p-1',
            quantity: 3,
            returnedQuantity: 0,
            totalCents: 3000,
          },
        ],
      }),
    )

    const r = await returnSaleItems({ returns: uow }, ctx, pedir(1))

    expect(feito.estoque).toEqual([{ productId: 'p-1', quantity: 1 }])
    expect(r).toEqual({
      refundCents: 1000,
      paidBackCents: 1000,
      uncollectedCents: 0,
      status: 'settled',
    })
    expect(feito.reduzidos).toEqual([{ id: 'r-1', amountCents: 2000 }])
    expect(feito.devolvido).toEqual({ valor: 1000, inteira: false })
  })

  it('o arredondamento fecha: tres devolucoes de 1 somam o total da linha', async () => {
    const linha = (ret: number) => ({
      saleItemId: 'i-1',
      productId: 'p-1',
      quantity: 3,
      returnedQuantity: ret,
      totalCents: 1000,
    })
    let soma = 0
    for (const ret of [0, 1, 2]) {
      const { uow } = mundo(
        venda({ lines: [linha(ret)], receivables: [recebivel({ amountCents: 1000 })] }),
      )
      soma += (await returnSaleItems({ returns: uow }, ctx, pedir(1))).refundCents
    }
    expect(soma).toBe(1000)
  })

  it('abate primeiro o que esta em aberto (fiado), e tira da carteira do cliente', async () => {
    const { uow, feito } = mundo(
      venda({
        lines: [
          {
            saleItemId: 'i-1',
            productId: 'p-1',
            quantity: 2,
            returnedQuantity: 0,
            totalCents: 2000,
          },
        ],
        receivables: [
          recebivel({ id: 'dinheiro', amountCents: 1000 }),
          recebivel({ id: 'fiado', description: 'Fiado', amountCents: 1000, status: 'open' }),
        ],
      }),
    )

    const r = await returnSaleItems({ returns: uow }, ctx, pedir(1))

    expect(feito.cancelados).toEqual(['fiado'])
    expect(feito.carteira).toBe(1000)
    expect(r).toMatchObject({ paidBackCents: 0, uncollectedCents: 1000 })
  })

  it('devolver tudo o que resta marca a venda como devolvida', async () => {
    const { uow, feito } = mundo(
      venda({
        lines: [
          {
            saleItemId: 'i-1',
            productId: 'p-1',
            quantity: 3,
            returnedQuantity: 2,
            totalCents: 3000,
          },
        ],
        receivables: [recebivel({ amountCents: 1000 })],
      }),
    )

    const r = await returnSaleItems({ returns: uow }, ctx, pedir(1))

    expect(r.status).toBe('returned')
    expect(feito.cancelados).toEqual(['r-1'])
    expect(feito.devolvido).toEqual({ valor: 1000, inteira: true })
  })

  it('recusa devolver mais do que resta, sem mexer em nada', async () => {
    const { uow, feito } = mundo(venda())

    await expect(returnSaleItems({ returns: uow }, ctx, pedir(4))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(feito.estoque).toEqual([])
  })

  it('recusa venda com baixa lancada ou com nota', async () => {
    for (const over of [{ settledCents: 100 }, { hasIssuedInvoice: true }]) {
      const { uow } = mundo(venda(over))
      await expect(returnSaleItems({ returns: uow }, ctx, pedir(1))).rejects.toMatchObject({
        code: 'CONFLICT',
      })
    }
  })
})
