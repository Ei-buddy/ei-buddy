import { describe, expect, it } from 'vitest'
import { createPurchaseInputSchema, type CreatePurchaseInput } from '@na-regua/contracts'
import { isAppError } from '../app-error.js'
import { InMemoryAuditTrail } from '../audit/fakes.js'
import type { ExecutionContext } from '../context.js'
import { InMemoryPurchases } from './fakes.js'
import {
  custoMedio,
  dividirEmParcelas,
  listPurchases,
  registerPurchase,
} from './register-purchase.js'

/** Entrada de mercadoria — NR-158. */

const AGORA = new Date('2026-10-07T12:00:00.000Z')

function ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    companyId: 'emp-1',
    userId: 'usr-1',
    role: 'owner',
    channel: 'app',
    requestId: 'req-1',
    now: AGORA,
    ...over,
  }
}

function montar() {
  const trilha = new InMemoryAuditTrail()
  const compras = new InMemoryPurchases(trilha)
  compras.cadastrar({
    id: 'p-cafe',
    companyId: 'emp-1',
    description: 'Cafe 500g',
    costPriceCents: 1000,
    stockQuantity: 10,
    isActive: true,
  })
  compras.cadastrar({
    id: 'p-granel',
    companyId: 'emp-1',
    description: 'Farinha a granel',
    costPriceCents: 500,
    stockQuantity: null,
    isActive: true,
  })
  compras.cadastrar({
    id: 'p-velho',
    companyId: 'emp-1',
    description: 'Produto antigo',
    costPriceCents: 100,
    stockQuantity: 0,
    isActive: false,
  })
  compras.cadastrar({
    id: 'p-outra',
    companyId: 'emp-2',
    description: 'De outra loja',
    costPriceCents: 100,
    stockQuantity: 0,
    isActive: true,
  })
  return { trilha, compras, deps: { uow: compras, ids: compras } }
}

const entrada = (over: Partial<CreatePurchaseInput> = {}) =>
  createPurchaseInputSchema.parse({
    supplier: 'Distribuidora Boa',
    invoiceNumber: '123',
    items: [{ productId: 'p-cafe', quantity: 10, unitCostCents: 1200 }],
    dueDate: '2026-10-20',
    ...over,
  })

const erroDe = (p: Promise<unknown>) => p.then(() => undefined).catch((e) => e)

describe('entrada de mercadoria — NR-158', () => {
  it('custo medio pondera o saldo atual com a compra', () => {
    expect(custoMedio(10, 1000, 10, 1200)).toBe(1100)
    expect(custoMedio(0, 1000, 5, 1200)).toBe(1200)
    expect(custoMedio(-2, 1000, 5, 1200)).toBe(1200)
    expect(custoMedio(null, 1000, 5, 1200)).toBe(1200)
  })

  it('parcelas somam o total, com a sobra na primeira', () => {
    expect(dividirEmParcelas(1000, 3)).toEqual([334, 333, 333])
    expect(dividirEmParcelas(1000, 1)).toEqual([1000])
  })

  it('soma ao estoque, atualiza o custo, grava a trilha e lanca a conta', async () => {
    const { compras, deps, trilha } = montar()
    const compra = await registerPurchase(deps, ctx(), entrada())

    expect(compra.totalCents).toBe(12000)
    expect(compra.items[0]).toMatchObject({ description: 'Cafe 500g', quantity: 10 })
    expect(compras.produto('p-cafe')).toMatchObject({ stockQuantity: 20, costPriceCents: 1100 })
    expect(compras.movimentos).toEqual([
      expect.objectContaining({ productId: 'p-cafe', quantityDelta: 10, balanceAfter: 20 }),
    ])
    expect(compras.contas).toEqual([
      expect.objectContaining({
        supplier: 'Distribuidora Boa',
        description: 'Compra de mercadoria NF 123',
        amountCents: 12000,
        dueDate: '2026-10-20',
        recurrenceId: null,
      }),
    ])
    expect(trilha.daEmpresa('emp-1')).toEqual([
      expect.objectContaining({ entity: 'Purchase', action: 'created' }),
    ])
  })

  it('parcela a conta em vencimentos mensais', async () => {
    const { compras, deps } = montar()
    await registerPurchase(deps, ctx(), entrada({ installments: 3 }))

    expect(compras.contas.map((c) => [c.amountCents, c.dueDate, c.occurrenceNumber])).toEqual([
      [4000, '2026-10-20', 1],
      [4000, '2026-11-20', 2],
      [4000, '2026-12-20', 3],
    ])
    expect(new Set(compras.contas.map((c) => c.recurrenceId)).size).toBe(1)
  })

  it('produto sem controle de estoque atualiza o custo, sem linha na trilha', async () => {
    const { compras, deps } = montar()
    await registerPurchase(
      deps,
      ctx(),
      entrada({ items: [{ productId: 'p-granel', quantity: 3, unitCostCents: 700 }] }),
    )

    expect(compras.produto('p-granel')).toMatchObject({ stockQuantity: null, costPriceCents: 700 })
    expect(compras.movimentos).toEqual([])
  })

  it('compra de custo zero nao gera conta a pagar', async () => {
    const { compras, deps } = montar()
    await registerPurchase(
      deps,
      ctx(),
      entrada({ items: [{ productId: 'p-cafe', quantity: 2, unitCostCents: 0 }] }),
    )
    expect(compras.contas).toEqual([])
    expect(compras.produto('p-cafe')?.stockQuantity).toBe(12)
  })

  it('recusa produto inativo e desfaz tudo', async () => {
    const { compras, deps, trilha } = montar()
    const erro = await erroDe(
      registerPurchase(
        deps,
        ctx(),
        entrada({
          items: [
            { productId: 'p-cafe', quantity: 1, unitCostCents: 100 },
            { productId: 'p-velho', quantity: 1, unitCostCents: 100 },
          ],
        }),
      ),
    )
    expect(isAppError(erro) && erro.code).toBe('CONFLICT')
    expect(compras.produto('p-cafe')?.stockQuantity).toBe(10)
    expect(compras.contas).toEqual([])
    expect(trilha.total).toBe(0)
  })

  it('produto de outra loja e nao encontrado', async () => {
    const { deps } = montar()
    const erro = await erroDe(
      registerPurchase(
        deps,
        ctx(),
        entrada({ items: [{ productId: 'p-outra', quantity: 1, unitCostCents: 100 }] }),
      ),
    )
    expect(isAppError(erro) && erro.code).toBe('NOT_FOUND')
  })

  it('falha no fim desfaz estoque, conta e trilha', async () => {
    const { compras, deps, trilha } = montar()
    compras.falharNoFim = true
    await erroDe(registerPurchase(deps, ctx(), entrada()))
    expect(compras.produto('p-cafe')?.stockQuantity).toBe(10)
    expect(compras.contas).toEqual([])
    expect(trilha.total).toBe(0)
  })

  it('perfil somente leitura nao da entrada', async () => {
    const { deps } = montar()
    const erro = await erroDe(registerPurchase(deps, ctx({ role: 'accountant' }), entrada()))
    expect(isAppError(erro) && erro.code).toBe('FORBIDDEN')
  })

  it('a lista traz a compra mais recente primeiro', async () => {
    const { deps, compras } = montar()
    await registerPurchase(deps, ctx(), entrada({ supplier: 'Primeiro' }))
    await registerPurchase(deps, ctx(), entrada({ supplier: 'Segundo' }))
    const lista = await listPurchases({ queries: compras }, ctx())
    expect(lista.map((c) => c.supplier)).toEqual(['Segundo', 'Primeiro'])
  })

  it('o contrato recusa o mesmo produto duas vezes', () => {
    const r = createPurchaseInputSchema.safeParse({
      supplier: 'X Ltda',
      items: [
        { productId: 'p-cafe', quantity: 1, unitCostCents: 1 },
        { productId: 'p-cafe', quantity: 2, unitCostCents: 1 },
      ],
      dueDate: '2026-10-20',
    })
    expect(r.success).toBe(false)
  })
})
