import type { CustomerOutput, ProductOutput, Role, StockViewOutput } from '@na-regua/contracts'
import { AppError, assertCanWrite, type ExecutionContext } from '@na-regua/core'
import type { AgentUseCases } from '../catalog.js'

export const AGORA = new Date('2026-10-06T15:00:00.000Z')

/** Contexto de uma empresa de teste. `empresa` vira `emp-{empresa}`. */
export function ctxDaEmpresa(
  empresa = 'A',
  sobrescreve: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    companyId: `emp-${empresa}`,
    userId: `user-${empresa}`,
    role: 'owner' as Role,
    channel: 'whatsapp',
    requestId: 'req-1',
    now: AGORA,
    ...sobrescreve,
  }
}

type ComEmpresa<T> = T & { readonly companyId: string }

export type Gravacao = {
  readonly acao: string
  readonly ctx: ExecutionContext
  readonly input: unknown
}

export type LojaDeTeste = {
  readonly useCases: AgentUseCases
  /** Toda chamada de caso de uso que grava, na ordem. */
  readonly gravacoes: Gravacao[]
  readonly clientes: ComEmpresa<CustomerOutput>[]
  readonly produtos: ComEmpresa<ProductOutput>[]
}

export function cliente(
  dados: Partial<CustomerOutput> & { readonly companyId?: string } = {},
): ComEmpresa<CustomerOutput> {
  return {
    id: 'cli-maria',
    name: 'Maria',
    tradeName: null,
    document: null,
    phone: null,
    email: null,
    notes: null,
    walletLimitCents: 0,
    walletBalanceCents: 0,
    companyId: 'emp-A',
    ...dados,
  } as ComEmpresa<CustomerOutput>
}

export function produto(
  dados: Partial<ProductOutput> & { readonly companyId?: string } = {},
): ComEmpresa<ProductOutput> {
  return {
    id: 'p-cafe',
    description: 'café em grãos',
    internalCode: 'PROD-0001',
    barcode: null,
    unitOfMeasure: 'un',
    salePriceCents: 2_500,
    costPriceCents: 1_000,
    stock: 0,
    minStock: 0,
    location: null,
    companyId: 'emp-A',
    ...dados,
  } as ComEmpresa<ProductOutput>
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function casa(termo: string, ...campos: (string | null | undefined)[]): boolean {
  const t = normalizar(termo)
  return campos.some((c) => c !== null && c !== undefined && normalizar(c).includes(t))
}

/**
 * Loja em memória: os casos de uso de leitura filtram por `companyId`, os de
 * gravação passam por `assertCanWrite` e ficam registrados em `gravacoes`.
 */
export function criarLojaDeTeste(
  opcoes: {
    readonly clientes?: readonly ComEmpresa<CustomerOutput>[]
    readonly produtos?: readonly ComEmpresa<ProductOutput>[]
  } = {},
): LojaDeTeste {
  const clientes = [...(opcoes.clientes ?? [cliente()])]
  const produtos = [...(opcoes.produtos ?? [produto()])]
  const gravacoes: Gravacao[] = []
  const vendasPorChave = new Map<string, number>()
  let proximaVenda = 1041

  const daEmpresa = <T extends { companyId: string }>(lista: readonly T[], ctx: ExecutionContext) =>
    lista.filter((x) => x.companyId === ctx.companyId)

  const gravar = (acao: string, ctx: ExecutionContext, input: unknown) => {
    assertCanWrite(ctx)
    gravacoes.push({ acao, ctx, input })
  }

  const resolver = <T extends { id: string; companyId: string }>(
    lista: readonly T[],
    ctx: ExecutionContext,
    ref: string,
    rotulo: (x: T) => string,
    nome: string,
  ): string => {
    const doTenant = daEmpresa(lista, ctx)
    const porId = doTenant.find((x) => x.id === ref)
    if (porId !== undefined) return porId.id
    const achados = doTenant.filter((x) => casa(ref, rotulo(x)))
    if (achados.length === 0) throw AppError.notFound(`${nome} nao encontrado.`)
    if (achados.length > 1) {
      throw AppError.validation(`Encontrei mais de um ${nome.toLowerCase()}. Qual deles?`)
    }
    return achados[0]!.id
  }

  const visaoDeEstoque = (p: ProductOutput): StockViewOutput => ({
    productId: p.id,
    description: p.description,
    salePriceCents: p.salePriceCents,
    stockQuantity: p.stock,
    location: (p as { location?: string | null }).location ?? null,
    minStock: p.minStock,
    belowMinimum: false,
  })

  const useCases: AgentUseCases = {
    listSales: async () => ({
      sales: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: {
        salesCount: 2,
        grossCents: 5_000,
        netCents: 4_800,
        cardFeeCents: 0,
        netAfterFeesCents: 4_800,
        averageTicketCents: 2_500,
      },
    }),
    listReceivables: async () => ({ grupos: [], totalCents: 0, temVencidas: false }),
    checkStock: async (ctx, input) => {
      const p = daEmpresa(produtos, ctx).find((x) => x.id === input.productId)
      if (p === undefined) throw AppError.notFound('Produto nao encontrado.')
      return visaoDeEstoque(p)
    },
    checkStockByQuery: async (ctx, input) => {
      const achados = daEmpresa(produtos, ctx).filter((p) => casa(input.query, p.description))
      if (achados.length === 0) return { status: 'not_found' }
      if (achados.length > 1) return { status: 'ambiguous', alternatives: achados }
      return { status: 'found', view: visaoDeEstoque(achados[0]!) }
    },
    checkCustomerWalletByQuery: async (ctx, input) => {
      const achados = daEmpresa(clientes, ctx).filter((c) => casa(input.query, c.name))
      if (achados.length === 0) return { status: 'not_found' }
      if (achados.length > 1) return { status: 'ambiguous', alternatives: achados }
      const c = achados[0]!
      return {
        status: 'found',
        customerId: c.id,
        customerName: c.name,
        walletBalanceCents: c.walletBalanceCents,
      }
    },
    listPayables: async () => ({ grupos: [], totalCents: 0, temVencidas: false }),
    searchCustomers: async (ctx, input) =>
      daEmpresa(clientes, ctx).filter((c) => casa(input.termo ?? '', c.name, c.phone)),
    searchProducts: async (ctx, input) =>
      daEmpresa(produtos, ctx).filter((p) => casa(input.q ?? '', p.description, p.internalCode)),
    registerCustomer: async (ctx, input) => {
      gravar('registerCustomer', ctx, input)
      const parecido = daEmpresa(clientes, ctx).filter(
        (c) => input.phone !== undefined && c.phone === input.phone,
      )
      if (parecido.length > 0) return { status: 'duplicate_found', candidates: parecido }
      const novo = cliente({
        id: `cli-${clientes.length + 1}`,
        name: input.name,
        phone: input.phone ?? null,
        companyId: ctx.companyId,
      })
      clientes.push(novo)
      return { status: 'created', customer: novo }
    },
    registerSale: async (ctx, input) => {
      gravar('registerSale', ctx, input)
      const chave = ctx.idempotencyKey
      const repetida = chave === undefined ? undefined : vendasPorChave.get(chave)
      const numero = repetida ?? (proximaVenda += 1)
      if (chave !== undefined) vendasPorChave.set(chave, numero)
      const bruto = input.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0)
      return {
        sale: {
          id: `venda-${numero}`,
          number: numero,
          netAmountCents: bruto,
        },
        replayed: repetida !== undefined,
        stockWarnings: [],
      } as never
    },
    revenueByMonth: async (_ctx, input) => ({
      from: input.from,
      to: input.to,
      months: [],
      totalNetCents: 9_900,
    }),
    buildDre: async (_ctx, input) => ({
      from: input.from,
      to: input.to,
      grossRevenueCents: 10_000,
      deductionsCents: 0,
      netRevenueCents: 10_000,
      costCents: 4_000,
      grossProfitCents: 6_000,
      expensesCents: 1_000,
      resultCents: 5_000,
      grossMarginPoints: 60,
      lines: [],
    }),
    sendCustomerCharge: async (ctx, input) => {
      gravar('sendCustomerCharge', ctx, input)
      return { status: 'nothing_to_charge', customerName: 'Maria' }
    },
    registerProduct: async (ctx, input) => {
      gravar('registerProduct', ctx, input)
      const novo = produto({
        id: `p-${produtos.length + 1}`,
        description: input.description,
        salePriceCents: input.salePriceCents,
        costPriceCents: input.costPriceCents,
        internalCode: `PROD-${String(produtos.length + 1).padStart(4, '0')}`,
        companyId: ctx.companyId,
      })
      produtos.push(novo)
      return novo
    },
    createPayable: async (ctx, input) => {
      gravar('createPayable', ctx, input)
      return [
        {
          id: 'pag-1',
          supplier: input.supplier,
          description: input.description,
          amountCents: input.amountCents,
          settledAmountCents: 0,
          dueDate: input.dueDate,
        },
      ] as never
    },
    createReceivable: async (ctx, input) => {
      gravar('createReceivable', ctx, input)
      return {
        id: 'rec-1',
        description: input.description,
        amountCents: input.amountCents,
        dueDate: input.dueDate,
      } as never
    },
    settlePayable: async (ctx, input) => {
      gravar('settlePayable', ctx, input)
      return { id: 'baixa-1', amountCents: input.amountCents, settledOn: input.settledOn } as never
    },
    settleReceivable: async (ctx, input) => {
      gravar('settleReceivable', ctx, input)
      return { id: 'baixa-2', amountCents: input.amountCents, settledOn: input.settledOn } as never
    },
    adjustStock: async (ctx, input) => {
      gravar('adjustStock', ctx, input)
      return { id: 'mov-1', quantityDelta: 0, balanceAfter: input.countedQuantity } as never
    },
    createAppointment: async (ctx, input) => {
      gravar('createAppointment', ctx, input)
      return { id: 'ag-1', title: input.title, startsAt: input.startsAt } as never
    },
    cancelSale: async (ctx, input) => {
      gravar('cancelSale', ctx, input)
    },
    listDayAppointments: async (_ctx, input) => ({
      day: input.day,
      appointments: [],
      isEmpty: true,
    }),
    rankCustomers: async (_ctx, input) => ({
      from: input.from,
      to: input.to,
      customers: [],
      unidentifiedCents: 0,
    }),
    rankProducts: async (_ctx, input) => ({
      from: input.from,
      to: input.to,
      products: [],
      unlinkedCents: 0,
    }),
    updateCustomer: async (ctx, customerId, input) => {
      gravar('updateCustomer', ctx, { customerId, ...input })
      const atual = daEmpresa(clientes, ctx).find((c) => c.id === customerId)
      return { ...cliente(), ...atual, ...input } as CustomerOutput
    },
    updateProduct: async (ctx, productId, input) => {
      gravar('updateProduct', ctx, { productId, ...input })
      const atual = daEmpresa(produtos, ctx).find((p) => p.id === productId)
      return { ...produto(), ...atual, ...input } as ProductOutput
    },
    deleteCustomer: async (ctx, customerId) => {
      gravar('deleteCustomer', ctx, { customerId })
    },
    deleteProduct: async (ctx, productId) => {
      gravar('deleteProduct', ctx, { productId })
    },
    resolveCustomerId: async (ctx, ref) => resolver(clientes, ctx, ref, (c) => c.name, 'Cliente'),
    resolveProductId: async (ctx, ref) =>
      resolver(produtos, ctx, ref, (p) => p.description, 'Produto'),
  }

  return { useCases, gravacoes, clientes, produtos }
}
