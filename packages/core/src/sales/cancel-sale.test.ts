import { describe, expect, it } from 'vitest'
import { AppError } from '../app-error.js'
import type { ExecutionContext } from '../context.js'
import type {
  SaleCancellationTransaction,
  SaleCancellationUnitOfWork,
  SaleToCancel,
} from '../ports/sale-cancellation.js'
import { cancelSale } from './cancel-sale.js'

const ctx: ExecutionContext = {
  companyId: 'emp-1',
  userId: 'user-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: new Date('2026-09-19T12:00:00.000Z'),
}

function venda(over: Partial<SaleToCancel> = {}): SaleToCancel {
  return {
    id: 'venda-1',
    status: 'open',
    customerId: null,
    items: [{ productId: 'p-1', quantity: 2 }],
    hasIssuedInvoice: false,
    settledCents: 0,
    walletCents: 0,
    ...over,
  }
}

/** Registra o que o caso de uso pediu, para o teste afirmar efeito e nao chamada. */
function mundo(sale: SaleToCancel | undefined) {
  const feito = {
    estoqueDevolvido: [] as { productId: string; quantity: number }[],
    recebiveisCancelados: [] as string[],
    carteira: [] as { customerId: string; amountCents: number }[],
    cancelada: null as { reason: string } | null,
    trilha: [] as { action: string; entityId: string }[],
  }

  const tx: SaleCancellationTransaction = {
    findSale: async () => sale,
    restoreStock: async (itens) => {
      feito.estoqueDevolvido.push(...itens.map((i) => ({ ...i })))
    },
    cancelReceivables: async (saleId) => {
      feito.recebiveisCancelados.push(saleId)
    },
    decreaseWalletBalance: async (customerId, amountCents) => {
      feito.carteira.push({ customerId, amountCents })
    },
    markCancelled: async (_id, dados) => {
      feito.cancelada = { reason: dados.reason }
    },
    record: async (entrada) => {
      feito.trilha.push({ action: entrada.action, entityId: entrada.entityId })
      return {} as never
    },
  }

  const uow: SaleCancellationUnitOfWork = { transaction: async (_c, fn) => fn(tx) }
  return { uow, feito }
}

const pedido = { saleId: 'venda-1', reason: 'cliente desistiu' }

describe('cancelSale — RF-043 / US-021', () => {
  it('devolve estoque, cancela recebiveis e marca a venda, tudo na mesma transacao', async () => {
    const { uow, feito } = mundo(venda())

    await cancelSale({ uow }, ctx, pedido)

    expect(feito.estoqueDevolvido).toEqual([{ productId: 'p-1', quantity: 2 }])
    expect(feito.recebiveisCancelados).toEqual(['venda-1'])
    expect(feito.cancelada).toEqual({ reason: 'cliente desistiu' })
  })

  it('registra quem, quando e por que — a venda nunca e apagada', async () => {
    const { uow, feito } = mundo(venda())

    await cancelSale({ uow }, ctx, pedido)

    expect(feito.trilha).toEqual([{ action: 'cancelled', entityId: 'venda-1' }])
  })

  it('devolve a carteira do cliente quando parte foi fiado', async () => {
    const { uow, feito } = mundo(venda({ customerId: 'cli-1', walletCents: 5_000 }))

    await cancelSale({ uow }, ctx, pedido)

    expect(feito.carteira).toEqual([{ customerId: 'cli-1', amountCents: 5_000 }])
  })

  it('nao mexe na carteira quando nada foi fiado', async () => {
    const { uow, feito } = mundo(venda({ customerId: 'cli-1', walletCents: 0 }))

    await cancelSale({ uow }, ctx, pedido)

    expect(feito.carteira).toEqual([])
  })

  /*
   * As tres recusas. O que se prova aqui nao e a mensagem — e que NADA foi
   * estornado: recusa que ja mexeu no estoque e pior que recusa nenhuma.
   */
  it('recusa venda com nota emitida, sem estornar nada — RF-050 antes', async () => {
    const { uow, feito } = mundo(venda({ hasIssuedInvoice: true }))

    await expect(cancelSale({ uow }, ctx, pedido)).rejects.toThrow(AppError)
    expect(feito.estoqueDevolvido).toEqual([])
    expect(feito.cancelada).toBeNull()
  })

  it('recusa venda com recebimento ja baixado, sem estornar nada', async () => {
    const { uow, feito } = mundo(venda({ settledCents: 1 }))

    await expect(cancelSale({ uow }, ctx, pedido)).rejects.toThrow(/baixa/i)
    expect(feito.estoqueDevolvido).toEqual([])
    expect(feito.cancelada).toBeNull()
  })

  it('recusa segunda passagem, para o estoque nao voltar duas vezes', async () => {
    const { uow, feito } = mundo(venda({ status: 'cancelled' }))

    await expect(cancelSale({ uow }, ctx, pedido)).rejects.toThrow(/ja foi cancelada/i)
    expect(feito.estoqueDevolvido).toEqual([])
  })

  it('venda inexistente responde 404, nunca 403', async () => {
    const { uow } = mundo(undefined)

    await expect(cancelSale({ uow }, ctx, pedido)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('quem nao pode escrever nao cancela', async () => {
    const { uow, feito } = mundo(venda())

    await expect(cancelSale({ uow }, { ...ctx, role: 'accountant' }, pedido)).rejects.toThrow(
      AppError,
    )
    expect(feito.cancelada).toBeNull()
  })
})
