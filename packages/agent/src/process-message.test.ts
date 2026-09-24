import type {
  CatalogInput,
  CreateCustomerInput,
  CreateSaleInput,
  CustomerOutput,
  DreInput,
  DreOutput,
  ProductOutput,
  PayableOutput,
  RevenueByMonthInput,
  SaleHistoryInput,
  SendChargeInput,
} from '@na-regua/contracts'
import { AppError, assertCanWrite, type ExecutionContext } from '@na-regua/core'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryConfirmations } from './confirmations.js'
import { InMemoryConversationStore } from './conversations.js'
import { createAgentRuntime } from './create-runtime.js'
import { FakeLlm } from './fake-llm.js'
import { formatarCentavos, LIMITE_TEXTO_MENSAGEM } from './format.js'
import { CONFIRMATION_TTL_MS, eNao, eSim, processMessage } from './process-message.js'
import { InMemoryAiUsageCounter, TEXTO_TETO_IA } from './ai-usage.js'
import { bytesFromMarker } from './barcode-decoder.js'
import {
  TEXTO_RECUSA_BANCO,
  TEXTO_RECUSA_CERTIFICADO,
  TEXTO_RECUSA_NOTA,
  type AgentUseCases,
} from './catalog.js'
import { pegarRascunhoFoto } from './photo-sale-draft.js'
import {
  TEXTO_FOTO_CADASTRO_CODIGO,
  TEXTO_FOTO_CADASTRO_PRODUTO_EXISTENTE,
  TEXTO_RECUSA_FOTO_ILEGIVEL,
  TEXTO_RECUSA_FOTO_MULTIPLOS,
  TEXTO_RECUSA_FOTO_PRODUTO_DESCONHECIDO,
} from './photo-replies.js'
import type { HistoryTurn, IncomingMessage, LlmPort } from './types.js'

const agora = new Date('2026-09-11T15:00:00.000Z')

const ctx: ExecutionContext = {
  companyId: 'emp-1',
  userId: 'user-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: agora,
}

function clienteSaida(over: Partial<CustomerOutput> = {}): CustomerOutput {
  return {
    id: 'cli-1',
    name: 'Joao',
    tradeName: null,
    document: null,
    phone: '11988887777',
    email: null,
    notes: null,
    walletLimitCents: 0,
    walletBalanceCents: 0,
    address: {
      zipCode: null,
      street: null,
      number: null,
      complement: null,
      district: null,
      city: null,
      state: null,
    },
    createdAt: agora.toISOString(),
    anonymizedAt: null,
    ...over,
  }
}

function dreSaida(over: Partial<DreOutput> = {}): DreOutput {
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    grossRevenueCents: 100_000,
    deductionsCents: 5_000,
    netRevenueCents: 95_000,
    costCents: 40_000,
    grossProfitCents: 55_000,
    expensesCents: 20_000,
    resultCents: 12_345,
    grossMarginPoints: 58,
    lines: [],
    ...over,
  }
}

function casos(over: Partial<AgentUseCases> = {}): AgentUseCases {
  return {
    listSales: async () => ({
      sales: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: {
        salesCount: 3,
        grossCents: 15_000,
        netCents: 14_000,
        cardFeeCents: 500,
        netAfterFeesCents: 13_500,
        averageTicketCents: 5_000,
      },
    }),
    listReceivables: async () => ({
      grupos: [
        {
          faixa: 'overdue',
          totalCents: 2_000,
          receivables: [
            {
              id: 'r1',
              saleId: null,
              customerId: 'c1',
              customerName: 'Joao',
              description: 'Fiado',
              amountCents: 2_000,
              netAmountCents: 2_000,
              settledAmountCents: 0,
              dueDate: '2026-09-01',
              installmentNumber: 1,
              installmentCount: 1,
              status: 'open',
              createdAt: '2026-08-01T12:00:00.000Z',
            },
          ],
        },
        { faixa: 'today', totalCents: 0, receivables: [] },
        { faixa: 'week', totalCents: 0, receivables: [] },
        { faixa: 'month', totalCents: 0, receivables: [] },
        { faixa: 'later', totalCents: 0, receivables: [] },
      ],
      totalCents: 2_000,
      temVencidas: true,
    }),
    checkStock: async () => {
      throw new Error('nao executa neste teste')
    },
    checkStockByQuery: async () => {
      throw new Error('nao executa neste teste')
    },
    checkCustomerWalletByQuery: async () => {
      throw new Error('nao executa neste teste')
    },
    listPayables: async () => {
      throw new Error('nao executa neste teste')
    },
    registerCustomer: async (_ctx: ExecutionContext, input: CreateCustomerInput) => ({
      status: 'created',
      customer: clienteSaida({
        name: input.name,
        phone: input.phone ?? null,
      }),
    }),
    registerSale: async () => ({
      sale: {
        id: 's1',
        number: 1042,
        grossAmountCents: 9_980,
        costAmountCents: 4_000,
        taxAmountCents: 0,
        cardFeeAmountCents: 0,
        netAmountCents: 9_980,
        changeCents: 0,
        createdAt: agora.toISOString(),
      },
      replayed: false,
      stockWarnings: [],
    }),
    searchProducts: async (_ctx: ExecutionContext, input: CatalogInput) => {
      if (input.q === 'xyz') return []
      return [
        {
          id: 'p-azul',
          description: 'Camiseta M azul',
          barcode: null,
          internalCode: 'PROD-0001',
          unitOfMeasure: 'un',
          salePriceCents: 4_990,
          costPriceCents: 2_000,
          taxRate: 0,
          ncm: null,
          cfop: null,
          taxSituationCode: null,
          stock: 10,
          minStock: 0,
          category: null,
          supplier: null,
        },
        {
          id: 'p-branca',
          description: 'Camiseta M branca',
          barcode: null,
          internalCode: 'PROD-0002',
          unitOfMeasure: 'un',
          salePriceCents: 4_990,
          costPriceCents: 2_000,
          taxRate: 0,
          ncm: null,
          cfop: null,
          taxSituationCode: null,
          stock: 4,
          minStock: 0,
          category: null,
          supplier: null,
        },
      ]
    },
    revenueByMonth: async (_ctx: ExecutionContext, input: RevenueByMonthInput) => ({
      from: input.from,
      to: input.to,
      months: [],
      totalNetCents: 50_000,
    }),
    buildDre: async (_ctx: ExecutionContext, input: DreInput) =>
      dreSaida({ from: input.from, to: input.to }),
    sendCustomerCharge: async () => ({
      status: 'sent' as const,
      customerName: 'Joao',
      amountCents: 5_000,
      to: '5511988887777',
    }),
    findProductByBarcode: async () => undefined,
    registerProduct: async () => {
      throw new Error('nao executa neste teste')
    },
    createPayable: async () => {
      throw new Error('nao executa neste teste')
    },
    createReceivable: async () => {
      throw new Error('nao executa neste teste')
    },
    settlePayable: async () => {
      throw new Error('nao executa neste teste')
    },
    settleReceivable: async () => {
      throw new Error('nao executa neste teste')
    },
    adjustStock: async () => {
      throw new Error('nao executa neste teste')
    },
    cancelSale: async () => {
      throw new Error('nao executa neste teste')
    },
    createAppointment: async () => {
      throw new Error('nao executa neste teste')
    },
    listDayAppointments: async () => {
      throw new Error('nao executa neste teste')
    },
    ...over,
  }
}

function msg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    text: 'quanto vendi hoje?',
    requestId: 'req-1',
    now: agora,
    channel: 'app',
    ctx,
    ...over,
  }
}

describe('processMessage — consultas (RF-096, RF-097)', () => {
  it('totais de "quanto vendi hoje?" batem com listSales do mesmo fixture', async () => {
    const listSales = vi.fn(async (c: ExecutionContext, i: SaleHistoryInput) =>
      casos().listSales(c, i),
    )
    const revenueByMonth = vi.fn(async (c: ExecutionContext, i: RevenueByMonthInput) =>
      casos().revenueByMonth(c, i),
    )
    const runtime = createAgentRuntime({ useCases: casos({ listSales, revenueByMonth }) })
    const r = await processMessage(runtime, msg())
    expect(r.kind).toBe('answer')
    expect(r.text).toContain('3 vendas')
    expect(r.text).toContain(formatarCentavos(15_000))
    expect(r.text).toContain(formatarCentavos(13_500))
    expect(r.text).toContain(formatarCentavos(5_000))
    expect(listSales).toHaveBeenCalledOnce()
    expect(revenueByMonth).not.toHaveBeenCalled()
  })

  it('inadimplentes de "quem esta me devendo?" batem com listReceivables do mesmo fixture', async () => {
    const listReceivables = vi.fn(async (c: ExecutionContext) => casos().listReceivables(c))
    const revenueByMonth = vi.fn(async (c: ExecutionContext, i: RevenueByMonthInput) =>
      casos().revenueByMonth(c, i),
    )
    const runtime = createAgentRuntime({ useCases: casos({ listReceivables, revenueByMonth }) })
    const r = await processMessage(runtime, msg({ text: 'quem esta me devendo?' }))
    expect(r.kind).toBe('answer')
    expect(r.text).toContain('Joao')
    expect(r.text).toContain(formatarCentavos(2_000))
    expect(r.text).toContain('2026-09-01')
    expect(listReceivables).toHaveBeenCalledOnce()
    expect(revenueByMonth).not.toHaveBeenCalled()
  })

  it('declara capacidades quando nao reconhece — RF-097', async () => {
    const runtime = createAgentRuntime({ useCases: casos() })
    const r = await processMessage(runtime, msg({ text: 'me conta uma piada' }))
    expect(r.kind).toBe('unknown')
    expect(r.text).toContain('list_sales')
    expect(r.text).toContain('create_sale')
    expect(r.text).not.toMatch(/US-065|estoque|em breve/i)
  })

  it.each(['saldo da carteira'])(
    'consulta fora do catalogo "%s" lista so capacidades atuais — RF-097 / US3',
    async (text) => {
      const runtime = createAgentRuntime({ useCases: casos() })
      const r = await processMessage(runtime, msg({ text }))
      expect(r.kind).toBe('unknown')
      expect(r.text).toContain('list_sales')
      expect(r.text).toContain('list_receivables')
      expect(r.text).toContain('list_payables')
      expect(r.text).toContain('check_customer_wallet')
      expect(r.text).toContain('create_sale')
      expect(r.text).not.toMatch(/NR-115/i)
      expect(r.text).not.toMatch(/US-065|US-066|US-067|em breve/i)
    },
  )
})

describe('processMessage — consultar estoque (US1 / NR-115)', () => {
  it('quanto tem de camiseta responde sem confirmacao', async () => {
    const checkStockByQuery = vi.fn(async () => ({
      status: 'found' as const,
      view: {
        productId: 'p-azul',
        description: 'Camiseta M azul',
        salePriceCents: 4_990,
        stockQuantity: 10,
        location: 'Prateleira A',
        minStock: 0,
        belowMinimum: false,
      },
    }))
    const runtime = createAgentRuntime({ useCases: casos({ checkStockByQuery }) })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const r = await processMessage(runtime, msg({ text: 'quanto tem de camiseta?' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toContain('Camiseta M azul')
    expect(r.text).toContain('10 un')
    expect(r.text).toContain(formatarCentavos(4_990))
    expect(checkStockByQuery).toHaveBeenCalledOnce()
    expect(put).not.toHaveBeenCalled()
  })

  it('produto ambiguo lista opcoes sem escolher', async () => {
    const checkStockByQuery = vi.fn(async () => ({
      status: 'ambiguous' as const,
      alternatives: [
        {
          id: 'p-azul',
          description: 'Camiseta M azul',
          barcode: null,
          internalCode: 'PROD-0001',
          unitOfMeasure: 'un' as const,
          salePriceCents: 4_990,
          costPriceCents: 2_000,
          taxRate: 0,
          ncm: null,
          cfop: null,
          taxSituationCode: null,
          stock: 10,
          minStock: 0,
          category: null,
          supplier: null,
        },
        {
          id: 'p-branca',
          description: 'Camiseta M branca',
          barcode: null,
          internalCode: 'PROD-0002',
          unitOfMeasure: 'un' as const,
          salePriceCents: 4_990,
          costPriceCents: 2_000,
          taxRate: 0,
          ncm: null,
          cfop: null,
          taxSituationCode: null,
          stock: 4,
          minStock: 0,
          category: null,
          supplier: null,
        },
      ],
    }))
    const runtime = createAgentRuntime({ useCases: casos({ checkStockByQuery }) })

    const r = await processMessage(runtime, msg({ text: 'qual o estoque de camiseta?' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/mais de um/i)
    expect(r.text).toContain('p-azul')
    expect(r.text).toContain('p-branca')
  })

  it('produto ausente informa sem cadastrar', async () => {
    const checkStockByQuery = vi.fn(async () => ({ status: 'not_found' as const }))
    const registerCustomer = vi.fn(casos().registerCustomer)
    const runtime = createAgentRuntime({
      useCases: casos({ checkStockByQuery, registerCustomer }),
    })

    const r = await processMessage(runtime, msg({ text: 'quanto tem de xyz?' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/nao encontrei/i)
    expect(registerCustomer).not.toHaveBeenCalled()
  })
})

describe('processMessage — consultar contas a pagar (US2 / NR-115)', () => {
  function payablesSaida(
    over: Partial<{
      overdue: number
      today: number
      week: number
      month: number
      later: number
      temVencidas: boolean
    }> = {},
  ) {
    const overdue = over.overdue ?? 0
    const today = over.today ?? 0
    const week = over.week ?? 0
    const month = over.month ?? 0
    const later = over.later ?? 0
    return {
      grupos: [
        { faixa: 'overdue' as const, totalCents: overdue, payables: [] },
        { faixa: 'today' as const, totalCents: today, payables: [] },
        { faixa: 'week' as const, totalCents: week, payables: [] },
        { faixa: 'month' as const, totalCents: month, payables: [] },
        { faixa: 'later' as const, totalCents: later, payables: [] },
      ],
      totalCents: overdue + today + week + month + later,
      temVencidas: over.temVencidas ?? overdue > 0,
    }
  }

  it('o que vence essa semana responde sem confirmacao nem mutacao', async () => {
    const listPayables = vi.fn(async () =>
      payablesSaida({ overdue: 5_000, today: 2_000, week: 3_000, month: 1_000, temVencidas: true }),
    )
    const registerSale = vi.fn(casos().registerSale)
    const registerCustomer = vi.fn(casos().registerCustomer)
    const runtime = createAgentRuntime({
      useCases: casos({ listPayables, registerSale, registerCustomer }),
    })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const r = await processMessage(runtime, msg({ text: 'o que vence essa semana?' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toContain(formatarCentavos(5_000))
    expect(r.text).toContain(formatarCentavos(2_000))
    expect(r.text).toContain(formatarCentavos(3_000))
    expect(r.text).toContain(formatarCentavos(1_000))
    expect(listPayables).toHaveBeenCalledOnce()
    expect(put).not.toHaveBeenCalled()
    expect(registerSale).not.toHaveBeenCalled()
    expect(registerCustomer).not.toHaveBeenCalled()
  })

  it('sem contas abertas declara ausencia de vencimentos', async () => {
    const listPayables = vi.fn(async () => payablesSaida())
    const runtime = createAgentRuntime({ useCases: casos({ listPayables }) })

    const r = await processMessage(runtime, msg({ text: 'quanto tenho a pagar?' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/nao ha vencimentos/i)
    expect(listPayables).toHaveBeenCalledOnce()
  })
})

describe('processMessage — consultar fiado (US3 / NR-115)', () => {
  it('quanto o joao deve responde sem confirmacao', async () => {
    const checkCustomerWalletByQuery = vi.fn(async () => ({
      status: 'found' as const,
      customerName: 'Joao Devedor',
      walletBalanceCents: 2_500,
    }))
    const runtime = createAgentRuntime({ useCases: casos({ checkCustomerWalletByQuery }) })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const r = await processMessage(runtime, msg({ text: 'quanto o joao deve?' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toContain('Joao Devedor')
    expect(r.text).toContain(formatarCentavos(2_500))
    expect(checkCustomerWalletByQuery).toHaveBeenCalledOnce()
    expect(put).not.toHaveBeenCalled()
  })

  it('saldo zerado declara explicitamente', async () => {
    const checkCustomerWalletByQuery = vi.fn(async () => ({
      status: 'found' as const,
      customerName: 'Maria Quitada',
      walletBalanceCents: 0,
    }))
    const runtime = createAgentRuntime({ useCases: casos({ checkCustomerWalletByQuery }) })

    const r = await processMessage(runtime, msg({ text: 'qual o saldo do maria?' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/nao tem saldo devedor/i)
    expect(checkCustomerWalletByQuery).toHaveBeenCalledOnce()
  })

  it('cliente ausente nao inventa saldo', async () => {
    const checkCustomerWalletByQuery = vi.fn(async () => ({ status: 'not_found' as const }))
    const runtime = createAgentRuntime({ useCases: casos({ checkCustomerWalletByQuery }) })

    const r = await processMessage(runtime, msg({ text: 'quanto deve o inexistente?' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/nao encontrei/i)
    expect(checkCustomerWalletByQuery).toHaveBeenCalledOnce()
  })

  it('homonimos listam opcoes sem escolher', async () => {
    const checkCustomerWalletByQuery = vi.fn(async () => ({
      status: 'ambiguous' as const,
      alternatives: [
        clienteSaida({ id: 'cli-a', name: 'Maria Silva', phone: '41999991111' }),
        clienteSaida({ id: 'cli-b', name: 'Maria Souza', phone: '41999992222' }),
      ],
    }))
    const runtime = createAgentRuntime({ useCases: casos({ checkCustomerWalletByQuery }) })

    const r = await processMessage(runtime, msg({ text: 'fiado da maria' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/mais de um/i)
    expect(r.text).toContain('cli-a')
    expect(r.text).toContain('cli-b')
    expect(checkCustomerWalletByQuery).toHaveBeenCalledOnce()
  })
})

describe('processMessage — consultas NR-115 cross-tool (T021)', () => {
  const CONSULTAS: ReadonlyArray<{
    text: string
    trecho: string
  }> = [
    { text: 'quanto tem de camiseta?', trecho: 'Camiseta M azul' },
    { text: 'o que vence essa semana?', trecho: 'R$' },
    { text: 'quanto o joao deve?', trecho: 'Joao Devedor' },
  ]

  it.each(CONSULTAS)(
    '"%s" responde sem confirmacao nem mutacao de estoque, titulo ou carteira',
    async ({ text, trecho }) => {
      const checkStockByQuery = vi.fn(async () => ({
        status: 'found' as const,
        view: {
          productId: 'p-azul',
          description: 'Camiseta M azul',
          salePriceCents: 4_990,
          stockQuantity: 10,
          location: 'Prateleira A',
          minStock: 0,
          belowMinimum: false,
        },
      }))
      const listPayables = vi.fn(async () => ({
        grupos: [
          { faixa: 'overdue' as const, totalCents: 5_000, payables: [] },
          { faixa: 'today' as const, totalCents: 2_000, payables: [] },
          { faixa: 'week' as const, totalCents: 3_000, payables: [] },
          { faixa: 'month' as const, totalCents: 1_000, payables: [] },
          { faixa: 'later' as const, totalCents: 0, payables: [] },
        ],
        totalCents: 11_000,
        temVencidas: true,
      }))
      const checkCustomerWalletByQuery = vi.fn(async () => ({
        status: 'found' as const,
        customerName: 'Joao Devedor',
        walletBalanceCents: 2_500,
      }))
      const registerCustomer = vi.fn(casos().registerCustomer)
      const registerSale = vi.fn(casos().registerSale)
      const sendCustomerCharge = vi.fn(casos().sendCustomerCharge)
      const runtime = createAgentRuntime({
        useCases: casos({
          checkStockByQuery,
          listPayables,
          checkCustomerWalletByQuery,
          registerCustomer,
          registerSale,
          sendCustomerCharge,
        }),
      })
      const put = vi.spyOn(runtime.confirmations, 'put')

      const r = await processMessage(runtime, msg({ text }))

      expect(r.kind).toBe('answer')
      expect(r.kind).not.toBe('confirmation')
      expect(r.text).toContain(trecho)
      expect(r.text).not.toMatch(/Confirma\?/)
      expect(put).not.toHaveBeenCalled()
      expect(registerCustomer).not.toHaveBeenCalled()
      expect(registerSale).not.toHaveBeenCalled()
      expect(sendCustomerCharge).not.toHaveBeenCalled()
    },
  )
})

describe('processMessage — consulta sem atrito (US4 / FR-002)', () => {
  it.each([
    ['quanto vendi hoje?', '3 vendas'],
    ['quem esta me devendo?', 'Joao'],
    ['resumo do mes', 'Faturamento'],
  ])('"%s" responde sem put nem confirmation', async (text, trecho) => {
    const runtime = createAgentRuntime({ useCases: casos() })
    const put = vi.spyOn(runtime.confirmations, 'put')
    const r = await processMessage(runtime, msg({ text }))
    expect(r.kind).toBe('answer')
    expect(r.kind).not.toBe('confirmation')
    expect(r.text).toContain(trecho)
    expect(r.text).not.toMatch(/Confirma\?/)
    expect(put).not.toHaveBeenCalled()
  })
})

describe('processMessage — mesmo laco com LlmPort injetado (US1 / Mastra)', () => {
  it('tool do modelo segue para o caso de uso, como o FakeLlm', async () => {
    const llm: LlmPort = {
      async decide() {
        return { type: 'tool', name: 'list_sales', args: { from: '2026-09-11', to: '2026-09-11' } }
      },
    }
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const r = await processMessage(runtime, msg({ text: 'qualquer frase' }))
    expect(r.kind).toBe('answer')
    expect(r.text).toContain('3 vendas')
  })

  it('unknown do modelo lista so capacidades atuais', async () => {
    const llm: LlmPort = {
      async decide() {
        return { type: 'unknown' }
      },
    }
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const r = await processMessage(runtime, msg({ text: 'qualquer frase' }))
    expect(r.kind).toBe('unknown')
    expect(r.text).toContain('list_sales')
    expect(r.text).not.toMatch(/estoque|em breve/i)
  })
})

describe('processMessage — confirmacao (RF-103, RF-104)', () => {
  const venda = {
    items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
    payments: [{ method: 'pix' as const, amountCents: 9_980 }],
  }

  it('nao grava venda antes do sim', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script('venda pro joao', { type: 'tool', name: 'create_sale', args: venda })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerSale: async (_ctx, input: CreateSaleInput) => {
          chamadas += 1
          expect(input.items[0]?.productId).toBe('p-azul')
          return casos().registerSale(_ctx, input)
        },
      }),
      llm,
    })

    const put = vi.spyOn(runtime.confirmations, 'put')
    const getOpen = vi.spyOn(runtime.confirmations, 'getOpen')
    const resolve = vi.spyOn(runtime.confirmations, 'resolve')

    const pedido = await processMessage(runtime, msg({ text: 'venda pro joao' }))
    expect(pedido.kind).toBe('confirmation')
    expect(pedido.text).toMatch(/Confirma\?/)
    expect(chamadas).toBe(0)
    expect(put).toHaveBeenCalledOnce()
    expect(put.mock.calls[0]?.[0]?.companyId).toBe('emp-1')
    expect(getOpen).toHaveBeenCalledWith('emp-1', expect.any(String), agora)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toContain('#1042')
    expect(chamadas).toBe(1)
    expect(resolve).toHaveBeenCalledWith('emp-1', pedido.confirmationId, 'accepted')
  })

  it('put carrega companyId; getOpen de outra loja nao devolve a pendencia', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script('cadastra o joao', {
      type: 'tool',
      name: 'create_customer',
      args: { name: 'Joao', phone: '11988887777' },
    })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerCustomer: async (c, i) => {
          chamadas += 1
          return casos().registerCustomer(c, i)
        },
      }),
      llm,
    })

    const put = vi.spyOn(runtime.confirmations, 'put')
    const pedido = await processMessage(runtime, msg({ text: 'cadastra o joao' }))
    expect(pedido.kind).toBe('confirmation')
    expect(chamadas).toBe(0)

    const proposta = put.mock.calls[0]?.[0]
    expect(proposta?.companyId).toBe(ctx.companyId)
    const chave = proposta?.conversationKey ?? ''
    expect(chave.length).toBeGreaterThan(0)
    expect(pedido.text).toBe(`${proposta?.summary}. Confirma?`)

    const daLoja = await runtime.confirmations.getOpen(ctx.companyId, chave, agora)
    expect(daLoja?.id).toBe(proposta?.id)
    expect(daLoja?.companyId).toBe(ctx.companyId)

    const outraLoja = await runtime.confirmations.getOpen('emp-outra', chave, agora)
    expect(outraLoja).toBeUndefined()
  })

  it('recusa ambigua conta como nao — RF-104', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script('cadastra o joao', {
      type: 'tool',
      name: 'create_customer',
      args: { name: 'Joao', phone: '11988887777' },
    })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerCustomer: async (c, i) => {
          chamadas += 1
          return casos().registerCustomer(c, i)
        },
      }),
      llm,
    })

    const getOpen = vi.spyOn(runtime.confirmations, 'getOpen')
    const resolve = vi.spyOn(runtime.confirmations, 'resolve')

    const proposta = await processMessage(runtime, msg({ text: 'cadastra o joao' }))
    const r = await processMessage(runtime, msg({ text: 'talvez depois' }))
    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/cancelei/i)
    expect(chamadas).toBe(0)
    expect(getOpen).toHaveBeenCalledWith('emp-1', 'app:emp-1:user-1', agora)
    expect(resolve).toHaveBeenCalledWith('emp-1', proposta.confirmationId, 'rejected')
    expect(await runtime.confirmations.getOpen('emp-1', 'app:emp-1:user-1', agora)).toBeUndefined()
  })

  it('expira e nao executa', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script('cadastra o joao', {
      type: 'tool',
      name: 'create_customer',
      args: { name: 'Joao' },
    })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerCustomer: async (c, i) => {
          chamadas += 1
          return casos().registerCustomer(c, i)
        },
      }),
      llm,
    })
    expect(runtime.confirmationTtlMs).toBe(CONFIRMATION_TTL_MS)
    const getOpen = vi.spyOn(runtime.confirmations, 'getOpen')
    const resolve = vi.spyOn(runtime.confirmations, 'resolve')

    const proposta = await processMessage(runtime, msg({ text: 'cadastra o joao' }))
    const depois = new Date(agora.getTime() + CONFIRMATION_TTL_MS)
    const r = await processMessage(runtime, msg({ text: 'sim', now: depois }))
    expect(r.text).toMatch(/expirou/i)
    expect(chamadas).toBe(0)
    expect(getOpen).toHaveBeenCalledWith('emp-1', 'app:emp-1:user-1', depois)
    expect(resolve).toHaveBeenCalledWith('emp-1', proposta.confirmationId, 'expired')
    expect(await runtime.confirmations.getOpen('emp-1', 'app:emp-1:user-1', depois)).toBeUndefined()
  })

  it.each(['', '   ', '...', '🙂'])(
    'mensagem vazia / ruido "%s" com aberta recusa como ambigua',
    async (text) => {
      let chamadas = 0
      const llm = new FakeLlm()
      llm.script('cadastra o joao', {
        type: 'tool',
        name: 'create_customer',
        args: { name: 'Joao' },
      })
      const runtime = createAgentRuntime({
        useCases: casos({
          registerCustomer: async (c, i) => {
            chamadas += 1
            return casos().registerCustomer(c, i)
          },
        }),
        llm,
      })
      const resolve = vi.spyOn(runtime.confirmations, 'resolve')

      const proposta = await processMessage(runtime, msg({ text: 'cadastra o joao' }))
      const r = await processMessage(runtime, msg({ text }))
      expect(r.kind).toBe('answer')
      expect(r.text).toMatch(/cancelei/i)
      expect(r.text).toMatch(/Nada foi registrado/)
      expect(chamadas).toBe(0)
      expect(resolve).toHaveBeenCalledWith('emp-1', proposta.confirmationId, 'rejected')
      expect(
        await runtime.confirmations.getOpen('emp-1', 'app:emp-1:user-1', agora),
      ).toBeUndefined()
    },
  )
})

describe('processMessage — cadastrar cliente (US3 / US-048)', () => {
  const pedidoCadastro = 'cadastra o Joao, 11 98888-7777'
  const argsCadastro = { name: 'Joao', phone: '11 98888-7777' }

  it('script create_customer pede confirmacao e so grava no sim', async () => {
    let chamadas = 0
    let recebido: CreateCustomerInput | undefined
    const llm = new FakeLlm()
    llm.script(pedidoCadastro, { type: 'tool', name: 'create_customer', args: argsCadastro })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerCustomer: async (c, i) => {
          chamadas += 1
          recebido = i
          return casos().registerCustomer(c, i)
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedidoCadastro }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toBe('Cadastrar cliente Joao, telefone 11988887777. Confirma?')
    expect(chamadas).toBe(0)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toBe('Cliente Joao cadastrado.')
    expect(chamadas).toBe(1)
    expect(recebido).toEqual({ name: 'Joao', phone: '11988887777' })
  })

  it('talvez / resposta ambigua nao grava — FR-010', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(pedidoCadastro, { type: 'tool', name: 'create_customer', args: argsCadastro })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerCustomer: async (c, i) => {
          chamadas += 1
          return casos().registerCustomer(c, i)
        },
      }),
      llm,
    })

    await processMessage(runtime, msg({ text: pedidoCadastro }))
    const r = await processMessage(runtime, msg({ text: 'talvez' }))
    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/cancelei/i)
    expect(r.text).toMatch(/Nada foi registrado/)
    expect(chamadas).toBe(0)
  })

  it('duplicate_found do core vira aviso, sem criar as cegas — RF-099', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(pedidoCadastro, { type: 'tool', name: 'create_customer', args: argsCadastro })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerCustomer: async () => {
          chamadas += 1
          return {
            status: 'duplicate_found',
            candidates: [clienteSaida({ id: 'cli-existente', name: 'Joao Silva' })],
          }
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedidoCadastro }))
    expect(proposta.kind).toBe('confirmation')
    expect(chamadas).toBe(0)

    const r = await processMessage(runtime, msg({ text: 'sim' }))
    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/Ja existe cadastro parecido/i)
    expect(r.text).toContain('Joao Silva')
    expect(r.text).toMatch(/reutilize o existente/i)
    expect(r.text).not.toMatch(/cadastrado\./)
    expect(chamadas).toBe(1)
  })
})

function produtoSaida(over: Partial<ProductOutput> = {}): ProductOutput {
  return {
    id: 'p-novo',
    description: 'Camiseta M',
    barcode: null,
    internalCode: 'PROD-0042',
    unitOfMeasure: 'un',
    salePriceCents: 4_990,
    costPriceCents: 2_000,
    taxRate: 0,
    ncm: null,
    cfop: null,
    taxSituationCode: null,
    stock: 0,
    minStock: 0,
    category: null,
    supplier: null,
    ...over,
  }
}

describe('processMessage — cadastrar produto (US1 / US-069 / NR-117)', () => {
  const pedidoProduto = 'cadastra camiseta M custo 20 vende 49,90'
  const argsProduto = {
    description: 'camiseta m',
    unitOfMeasure: 'un' as const,
    costPriceCents: 2_000,
    salePriceCents: 4_990,
    stock: 0,
    minStock: 0,
  }

  it('script create_product pede confirmacao e so grava no sim', async () => {
    let chamadas = 0
    let recebido: unknown
    const llm = new FakeLlm()
    llm.script(pedidoProduto, { type: 'tool', name: 'create_product', args: argsProduto })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerProduct: async (_c, i) => {
          chamadas += 1
          recebido = i
          return produtoSaida({
            description: 'camiseta m',
            salePriceCents: 4_990,
            costPriceCents: 2_000,
          })
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedidoProduto }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toBe(
      `Cadastrar produto camiseta m: custo ${formatarCentavos(2_000)}, venda ${formatarCentavos(4_990)}. Confirma?`,
    )
    expect(chamadas).toBe(0)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toBe(
      `Produto camiseta m cadastrado (PROD-0042) — ${formatarCentavos(4_990)}.`,
    )
    expect(chamadas).toBe(1)
    expect(recebido).toEqual(argsProduto)
  })

  it('nao e TTL nao chamam registerProduct', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(pedidoProduto, { type: 'tool', name: 'create_product', args: argsProduto })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerProduct: async (_c, i) => {
          chamadas += 1
          return casos().registerProduct(_c, i)
        },
      }),
      llm,
    })
    const resolve = vi.spyOn(runtime.confirmations, 'resolve')

    const proposta = await processMessage(runtime, msg({ text: pedidoProduto }))
    const cancelado = await processMessage(runtime, msg({ text: 'nao' }))
    expect(cancelado.kind).toBe('answer')
    expect(cancelado.text).toMatch(/Nada foi registrado/)
    expect(chamadas).toBe(0)
    expect(resolve).toHaveBeenCalledWith('emp-1', proposta.confirmationId, 'rejected')

    llm.script(pedidoProduto, { type: 'tool', name: 'create_product', args: argsProduto })
    const proposta2 = await processMessage(runtime, msg({ text: pedidoProduto }))
    const depois = new Date(agora.getTime() + CONFIRMATION_TTL_MS)
    const expirado = await processMessage(runtime, msg({ text: 'sim', now: depois }))
    expect(expirado.text).toMatch(/expirou/i)
    expect(chamadas).toBe(0)
    expect(resolve).toHaveBeenCalledWith('emp-1', proposta2.confirmationId, 'expired')
  })

  it('preco abaixo do custo recusa antes da pendencia — sem gravacao', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script('cadastra item', {
      type: 'tool',
      name: 'create_product',
      args: {
        description: 'Item X',
        unitOfMeasure: 'un',
        costPriceCents: 5_000,
        salePriceCents: 1_000,
      },
    })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerProduct: async (_c, i) => {
          chamadas += 1
          return casos().registerProduct(_c, i)
        },
      }),
      llm,
    })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const r = await processMessage(runtime, msg({ text: 'cadastra item' }))
    expect(r.kind).toBe('clarify')
    expect(r.text).toMatch(/entender os dados/i)
    expect(r.text).toMatch(/Preco de venda menor que o custo/i)
    expect(r.confirmationId).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(chamadas).toBe(0)
  })

  it('conflito de EAN no registerProduct avisa e nao duplica — RF-140', async () => {
    let chamadas = 0
    const argsComEan = { ...argsProduto, barcode: '7891234567895' }
    const llm = new FakeLlm()
    llm.script(pedidoProduto, { type: 'tool', name: 'create_product', args: argsComEan })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerProduct: async () => {
          chamadas += 1
          throw AppError.conflict(
            'Este codigo de barras ja esta em "Camiseta velha". Edite o produto existente em vez de criar outro.',
          )
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedidoProduto }))
    expect(proposta.kind).toBe('confirmation')
    expect(chamadas).toBe(0)

    const r = await processMessage(runtime, msg({ text: 'sim' }))
    expect(r.kind).toBe('clarify')
    expect(r.text).toContain('codigo de barras ja esta')
    expect(r.text).toContain('Camiseta velha')
    expect(r.text).not.toMatch(/cadastrado \(/)
    expect(chamadas).toBe(1)
  })

  it('apos foto cadastra este, turno com dados e barcode confirma e grava', async () => {
    let chamadas = 0
    let recebido: unknown
    const pedidoAposFoto = 'camiseta nova custo 15 vende 39,90'
    const argsAposFoto = {
      description: 'camiseta nova',
      unitOfMeasure: 'un' as const,
      costPriceCents: 1_500,
      salePriceCents: 3_990,
      barcode: BARCODE_DESCONHECIDO,
      stock: 0,
      minStock: 0,
    }
    const llm = new FakeLlm()
    llm.script(pedidoAposFoto, { type: 'tool', name: 'create_product', args: argsAposFoto })
    const findProductByBarcode = vi.fn(async () => undefined)
    const runtime = createAgentRuntime({
      useCases: casos({
        findProductByBarcode,
        registerProduct: async (_c, i) => {
          chamadas += 1
          recebido = i
          return produtoSaida({
            description: 'camiseta nova',
            barcode: BARCODE_DESCONHECIDO,
            salePriceCents: 3_990,
            costPriceCents: 1_500,
          })
        },
      }),
      llm,
    })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const codigo = await processMessage(runtime, fotoRefusalMsg({ text: 'cadastra este' }))
    expect(codigo.kind).toBe('answer')
    expect(codigo.text).toBe(TEXTO_FOTO_CADASTRO_CODIGO(BARCODE_DESCONHECIDO))

    const proposta = await processMessage(runtime, msg({ text: pedidoAposFoto }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toContain(BARCODE_DESCONHECIDO)
    expect(chamadas).toBe(0)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toMatch(/cadastrado/)
    expect(chamadas).toBe(1)
    expect(recebido).toEqual(argsAposFoto)
    expect(put).toHaveBeenCalledTimes(1)
  })
})

function contaPagarSaida(over: Partial<PayableOutput> = {}): PayableOutput {
  return {
    id: 'pag-1',
    supplier: 'Aluguel',
    description: 'Aluguel',
    amountCents: 180_000,
    settledAmountCents: 0,
    dueDate: '2026-10-10',
    status: 'open',
    attachmentKey: null,
    accountId: null,
    recurrenceId: null,
    occurrenceNumber: null,
    occurrenceCount: null,
    createdAt: agora.toISOString(),
    ...over,
  }
}

describe('processMessage — lancar conta a pagar (US2 / US-070 / NR-117)', () => {
  const pedidoAluguel = 'lança aluguel 1800 vence dia 10'
  const argsAluguel = {
    supplier: 'Aluguel',
    description: 'Aluguel',
    amountCents: 180_000,
    dueDate: '2026-10-10',
  }

  it('FakeLlm create_payable pede confirmacao e so grava no sim', async () => {
    let chamadas = 0
    let recebido: unknown
    const llm = new FakeLlm()
    const runtime = createAgentRuntime({
      useCases: casos({
        createPayable: async (_c, i) => {
          chamadas += 1
          recebido = i
          return [contaPagarSaida()]
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedidoAluguel }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toBe(
      `Lancar conta a pagar de Aluguel: Aluguel, ${formatarCentavos(180_000)}, vence 2026-10-10. Confirma?`,
    )
    expect(chamadas).toBe(0)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toBe(
      `Conta de Aluguel lancada: ${formatarCentavos(180_000)}, vence 2026-10-10.`,
    )
    expect(chamadas).toBe(1)
    expect(recebido).toEqual(argsAluguel)
  })

  it('nao e TTL nao chamam createPayable', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    const runtime = createAgentRuntime({
      useCases: casos({
        createPayable: async (_c, i) => {
          chamadas += 1
          return casos().createPayable(_c, i)
        },
      }),
      llm,
    })
    const resolve = vi.spyOn(runtime.confirmations, 'resolve')

    const proposta = await processMessage(runtime, msg({ text: pedidoAluguel }))
    const cancelado = await processMessage(runtime, msg({ text: 'nao' }))
    expect(cancelado.kind).toBe('answer')
    expect(cancelado.text).toMatch(/Nada foi registrado/)
    expect(chamadas).toBe(0)
    expect(resolve).toHaveBeenCalledWith('emp-1', proposta.confirmationId, 'rejected')

    const proposta2 = await processMessage(runtime, msg({ text: pedidoAluguel }))
    const depois = new Date(agora.getTime() + CONFIRMATION_TTL_MS)
    const expirado = await processMessage(runtime, msg({ text: 'sim', now: depois }))
    expect(expirado.text).toMatch(/expirou/i)
    expect(chamadas).toBe(0)
    expect(resolve).toHaveBeenCalledWith('emp-1', proposta2.confirmationId, 'expired')
  })

  it('vencimento no passado grava open e aparece na faixa vencidas — 2A', async () => {
    const argsVencida = {
      supplier: 'Imobiliaria',
      description: 'Aluguel atrasado',
      amountCents: 150_000,
      dueDate: '2026-09-01',
    }
    const pedido = 'lanca aluguel atrasado 1500 vence dia 1'
    let criado = false
    const llm = new FakeLlm()
    llm.script(pedido, { type: 'tool', name: 'create_payable', args: argsVencida })
    const listPayables = vi.fn(async () => {
      if (!criado) {
        return {
          grupos: [
            { faixa: 'overdue' as const, totalCents: 0, payables: [] },
            { faixa: 'today' as const, totalCents: 0, payables: [] },
            { faixa: 'week' as const, totalCents: 0, payables: [] },
            { faixa: 'month' as const, totalCents: 0, payables: [] },
            { faixa: 'later' as const, totalCents: 0, payables: [] },
          ],
          totalCents: 0,
          temVencidas: false,
        }
      }
      const conta = contaPagarSaida({
        supplier: argsVencida.supplier,
        description: argsVencida.description,
        amountCents: argsVencida.amountCents,
        dueDate: argsVencida.dueDate,
        status: 'open',
      })
      return {
        grupos: [
          { faixa: 'overdue' as const, totalCents: argsVencida.amountCents, payables: [conta] },
          { faixa: 'today' as const, totalCents: 0, payables: [] },
          { faixa: 'week' as const, totalCents: 0, payables: [] },
          { faixa: 'month' as const, totalCents: 0, payables: [] },
          { faixa: 'later' as const, totalCents: 0, payables: [] },
        ],
        totalCents: argsVencida.amountCents,
        temVencidas: true,
      }
    })
    const runtime = createAgentRuntime({
      useCases: casos({
        listPayables,
        createPayable: async (_c, input) => {
          expect(input.dueDate).toBe('2026-09-01')
          criado = true
          return [
            contaPagarSaida({
              supplier: input.supplier,
              description: input.description,
              amountCents: input.amountCents,
              dueDate: input.dueDate,
              status: 'open',
            }),
          ]
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedido }))
    expect(proposta.kind).toBe('confirmation')
    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toContain('2026-09-01')

    const consulta = await processMessage(runtime, msg({ text: 'quanto tenho a pagar?' }))
    expect(consulta.kind).toBe('answer')
    expect(consulta.text).toMatch(/vencidas/i)
    expect(consulta.text).toContain(formatarCentavos(argsVencida.amountCents))
    expect(listPayables).toHaveBeenCalled()
  })

  it('recorrencia com N titulos resume quantidade na resposta', async () => {
    const argsRecorrente = {
      supplier: 'Imobiliaria',
      description: 'Aluguel',
      amountCents: 180_000,
      dueDate: '2026-10-10',
      recurrence: { frequency: 'monthly' as const, occurrences: 3 },
    }
    const pedido = 'lanca aluguel mensal 1800 vence dia 10 por 3 meses'
    const llm = new FakeLlm()
    llm.script(pedido, { type: 'tool', name: 'create_payable', args: argsRecorrente })
    const runtime = createAgentRuntime({
      useCases: casos({
        createPayable: async () => [
          contaPagarSaida({ supplier: 'Imobiliaria' }),
          contaPagarSaida({ id: 'pag-2', dueDate: '2026-11-10' }),
          contaPagarSaida({ id: 'pag-3', dueDate: '2026-12-10' }),
        ],
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedido }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toMatch(/repetindo/)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toContain('3 contas')
    expect(feito.text).toContain('2026-10-10')
  })

  it('pedido sem valor ou vencimento pede dado e nao cria pendencia — T014', async () => {
    const createPayable = vi.fn(casos().createPayable)
    const llm = new FakeLlm()
    llm.script('lança aluguel', {
      type: 'text',
      text: 'Qual o valor e o dia do vencimento?',
    })
    const runtime = createAgentRuntime({ useCases: casos({ createPayable }), llm })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const incompleto = await processMessage(runtime, msg({ text: 'lança conta a pagar' }))
    expect(incompleto.kind).toBe('unknown')
    expect(incompleto.confirmationId).toBeUndefined()

    const clarifica = await processMessage(runtime, msg({ text: 'lança aluguel' }))
    expect(clarifica.kind).toBe('clarify')
    expect(clarifica.text).toMatch(/valor/i)
    expect(clarifica.text).toMatch(/vencimento/i)
    expect(clarifica.confirmationId).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(createPayable).not.toHaveBeenCalled()

    llm.script('pagar fornecedor sem data', {
      type: 'tool',
      name: 'create_payable',
      args: { supplier: 'Fornecedor X', description: 'Material' },
    })
    const zod = await processMessage(runtime, msg({ text: 'pagar fornecedor sem data' }))
    expect(zod.kind).toBe('clarify')
    expect(zod.confirmationId).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(createPayable).not.toHaveBeenCalled()
  })
})

function recebivelSaida(
  over: Partial<{
    id: string
    description: string
    amountCents: number
    dueDate: string
    customerId: string | null
    customerName: string | null
  }> = {},
) {
  return {
    id: 'rec-1',
    saleId: null,
    customerId: null,
    customerName: null,
    description: 'aluguel vitrine',
    amountCents: 50_000,
    netAmountCents: 50_000,
    settledAmountCents: 0,
    dueDate: '2026-09-18',
    installmentNumber: 1,
    installmentCount: 1,
    status: 'open' as const,
    createdAt: agora.toISOString(),
    ...over,
  }
}

describe('processMessage — lancar recebivel avulso (US3 / US-071 / NR-117)', () => {
  const pedidoRecebivel = 'a receber 500 do João na sexta, aluguel vitrine'
  const argsRecebivel = {
    description: 'aluguel vitrine',
    amountCents: 50_000,
    dueDate: '2026-09-18',
  }

  it('FakeLlm create_receivable pede confirmacao e so grava no sim', async () => {
    let chamadas = 0
    let recebido: unknown
    const llm = new FakeLlm()
    const runtime = createAgentRuntime({
      useCases: casos({
        createReceivable: async (_c, i) => {
          chamadas += 1
          recebido = i
          return recebivelSaida()
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedidoRecebivel }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toBe(
      `Lancar a receber: aluguel vitrine, ${formatarCentavos(50_000)}, vence 2026-09-18. Confirma?`,
    )
    expect(chamadas).toBe(0)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toBe(
      `A receber lancado: aluguel vitrine, ${formatarCentavos(50_000)}, vence 2026-09-18.`,
    )
    expect(chamadas).toBe(1)
    expect(recebido).toEqual(argsRecebivel)
  })

  it('pedido sem valor ou vencimento pede dado e nao cria pendencia — T017', async () => {
    const createReceivable = vi.fn(casos().createReceivable)
    const llm = new FakeLlm()
    llm.script('quero lancar a receber', {
      type: 'text',
      text: 'Qual o valor, o vencimento e a descricao?',
    })
    const runtime = createAgentRuntime({ useCases: casos({ createReceivable }), llm })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const incompleto = await processMessage(runtime, msg({ text: 'a receber do joao' }))
    expect(incompleto.kind).toBe('unknown')
    expect(incompleto.confirmationId).toBeUndefined()

    const clarifica = await processMessage(runtime, msg({ text: 'quero lancar a receber' }))
    expect(clarifica.kind).toBe('clarify')
    expect(clarifica.text).toMatch(/valor/i)
    expect(clarifica.text).toMatch(/vencimento/i)
    expect(clarifica.confirmationId).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(createReceivable).not.toHaveBeenCalled()

    llm.script('receber sem data', {
      type: 'tool',
      name: 'create_receivable',
      args: { description: 'Servico avulso', amountCents: 10_000 },
    })
    const zod = await processMessage(runtime, msg({ text: 'receber sem data' }))
    expect(zod.kind).toBe('clarify')
    expect(zod.confirmationId).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(createReceivable).not.toHaveBeenCalled()
  })

  it('frase de venda usa create_sale e nao create_receivable — US-071', async () => {
    const fraseVenda = 'venda pro Joao: 2 camisetas M a 49,90, pagou no Pix'
    const argsVenda = {
      customerId: 'cli-1',
      items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
      payments: [{ method: 'pix' as const, amountCents: 9_980 }],
    }
    const createReceivable = vi.fn(casos().createReceivable)
    const registerSale = vi.fn(casos().registerSale)
    const llm = new FakeLlm()
    llm.script(fraseVenda, { type: 'tool', name: 'create_sale', args: argsVenda })
    const runtime = createAgentRuntime({
      useCases: casos({ createReceivable, registerSale }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: fraseVenda }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toMatch(/Registrar venda/)
    expect(proposta.text).toMatch(/Confirma\?/)
    expect(createReceivable).not.toHaveBeenCalled()
    expect(registerSale).not.toHaveBeenCalled()
  })

  it('dois clientes homonimos listam opcoes sem create_receivable — T017', async () => {
    const checkCustomerWalletByQuery = vi.fn(async () => ({
      status: 'ambiguous' as const,
      alternatives: [
        clienteSaida({ id: 'cli-a', name: 'Joao Silva', phone: '41999991111' }),
        clienteSaida({ id: 'cli-b', name: 'Joao Souza', phone: '41999992222' }),
      ],
    }))
    const createReceivable = vi.fn(casos().createReceivable)
    const llm = new FakeLlm()
    llm.script(pedidoRecebivel, {
      type: 'tool',
      name: 'check_customer_wallet',
      args: { query: 'joao' },
    })
    const runtime = createAgentRuntime({
      useCases: casos({ checkCustomerWalletByQuery, createReceivable }),
      llm,
    })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const r = await processMessage(runtime, msg({ text: pedidoRecebivel }))
    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/mais de um/i)
    expect(r.text).toContain('cli-a')
    expect(r.text).toContain('cli-b')
    expect(checkCustomerWalletByQuery).toHaveBeenCalledOnce()
    expect(createReceivable).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })
})

describe('processMessage — lancar venda (US4 / US-049)', () => {
  const fraseVenda = 'venda pro Joao: 2 camisetas M a 49,90, pagou no Pix'
  const argsVenda = {
    customerId: 'cli-1',
    items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
    payments: [{ method: 'pix' as const, amountCents: 9_980 }],
  }
  const liquidoDoCore = 9_500

  it('script create_sale pede confirmacao e o liquido bate com o core — RF-100 / RF-101', async () => {
    let chamadas = 0
    let recebido: CreateSaleInput | undefined
    const llm = new FakeLlm()
    llm.script(fraseVenda, { type: 'tool', name: 'create_sale', args: argsVenda })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerSale: async (_ctx, input) => {
          chamadas += 1
          recebido = input
          return {
            sale: {
              id: 's1',
              number: 1042,
              grossAmountCents: 9_980,
              costAmountCents: 4_000,
              taxAmountCents: 0,
              cardFeeAmountCents: 480,
              netAmountCents: liquidoDoCore,
              changeCents: 0,
              createdAt: agora.toISOString(),
            },
            replayed: false,
            stockWarnings: [],
          }
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: fraseVenda }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toContain('cli-1')
    expect(proposta.text).toContain('2x p-azul')
    expect(proposta.text).toContain(formatarCentavos(4_990))
    expect(proposta.text).toContain('pix')
    expect(proposta.text).toMatch(/Confirma\?/)
    expect(chamadas).toBe(0)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toContain('#1042')
    expect(feito.text).toContain(formatarCentavos(liquidoDoCore))
    expect(feito.text).not.toContain(formatarCentavos(2 * 4_990))
    expect(chamadas).toBe(1)
    expect(recebido).toEqual(argsVenda)
  })

  it('produto ambiguo lista opcoes e so vende depois da escolha — RF-102', async () => {
    let vendas = 0
    const llm = new FakeLlm()
    llm.script('venda 2 camisetas M', {
      type: 'tool',
      name: 'search_products',
      args: { q: 'camiseta' },
    })
    llm.script('a azul no pix', {
      type: 'tool',
      name: 'create_sale',
      args: {
        items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
        payments: [{ method: 'pix' as const, amountCents: 9_980 }],
      },
    })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerSale: async (c, i) => {
          vendas += 1
          return casos().registerSale(c, i)
        },
      }),
      llm,
    })

    const clarifica = await processMessage(runtime, msg({ text: 'venda 2 camisetas M' }))
    expect(clarifica.kind).toBe('answer')
    expect(clarifica.text).toMatch(/mais de um/i)
    expect(clarifica.text).toContain('p-azul')
    expect(clarifica.text).toContain('p-branca')
    expect(clarifica.text).toContain(formatarCentavos(4_990))
    expect(vendas).toBe(0)

    const proposta = await processMessage(runtime, msg({ text: 'a azul no pix' }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toContain('p-azul')
    expect(vendas).toBe(0)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toContain('#1042')
    expect(feito.text).toContain(formatarCentavos(9_980))
    expect(vendas).toBe(1)
  })

  it('fiado sem cliente e recusado e nao grava — RF-136', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script('vende no fiado', {
      type: 'tool',
      name: 'create_sale',
      args: {
        items: [{ productId: 'p-azul', quantity: 1, unitPriceCents: 4_990 }],
        payments: [{ method: 'wallet' as const, amountCents: 4_990 }],
      },
    })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerSale: async (c, i) => {
          chamadas += 1
          return casos().registerSale(c, i)
        },
      }),
      llm,
    })

    const r = await processMessage(runtime, msg({ text: 'vende no fiado' }))
    expect(r.kind).toBe('clarify')
    expect(r.text).toMatch(/fiado exige cliente/i)
    expect(chamadas).toBe(0)
  })

  it('recusa de fiado do core apos o sim tambem nao inventa venda — RF-136', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script('fiado do joao', {
      type: 'tool',
      name: 'create_sale',
      args: {
        customerId: 'cli-1',
        items: [{ productId: 'p-azul', quantity: 1, unitPriceCents: 4_990 }],
        payments: [{ method: 'wallet' as const, amountCents: 4_990 }],
      },
    })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerSale: async () => {
          chamadas += 1
          throw AppError.validation('Venda no fiado exige cliente identificado.', [
            { path: 'customerId', message: 'Informe o cliente para vender no fiado.' },
          ])
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: 'fiado do joao' }))
    expect(proposta.kind).toBe('confirmation')
    expect(chamadas).toBe(0)

    const r = await processMessage(runtime, msg({ text: 'sim' }))
    expect(r.kind).toBe('clarify')
    expect(r.text).toMatch(/fiado exige cliente/i)
    expect(chamadas).toBe(1)
  })
})

describe('processMessage — enviar cobranca (US5 / US-052)', () => {
  const pedidoCobranca = 'manda a cobranca pro Joao'
  const argsCobranca: SendChargeInput = { customerId: 'cli-1' }

  it('script send_charge pede confirmacao e so envia no sim', async () => {
    let chamadas = 0
    let recebido: SendChargeInput | undefined
    const llm = new FakeLlm()
    llm.script(pedidoCobranca, { type: 'tool', name: 'send_charge', args: argsCobranca })
    const runtime = createAgentRuntime({
      useCases: casos({
        sendCustomerCharge: async (_ctx, input) => {
          chamadas += 1
          recebido = input
          return {
            status: 'sent',
            customerName: 'Joao',
            amountCents: 5_000,
            to: '5511988887777',
          }
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedidoCobranca }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toContain('cli-1')
    expect(proposta.text).toMatch(/Confirma\?/)
    expect(chamadas).toBe(0)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toBe(`Cobranca de ${formatarCentavos(5_000)} enviada para Joao.`)
    expect(chamadas).toBe(1)
    expect(recebido).toEqual(argsCobranca)
  })

  it('sem divida informa e nao envia', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(pedidoCobranca, { type: 'tool', name: 'send_charge', args: argsCobranca })
    const runtime = createAgentRuntime({
      useCases: casos({
        sendCustomerCharge: async () => {
          chamadas += 1
          return { status: 'nothing_to_charge', customerName: 'Joao' }
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedidoCobranca }))
    expect(proposta.kind).toBe('confirmation')
    expect(chamadas).toBe(0)

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(feito.text).toMatch(/nao tem divida em aberto/i)
    expect(feito.text).toMatch(/Nada foi enviado/)
    expect(chamadas).toBe(1)
  })

  it('talvez / resposta ambigua nao envia — FR-010', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(pedidoCobranca, { type: 'tool', name: 'send_charge', args: argsCobranca })
    const runtime = createAgentRuntime({
      useCases: casos({
        sendCustomerCharge: async () => {
          chamadas += 1
          return {
            status: 'sent',
            customerName: 'Joao',
            amountCents: 5_000,
            to: '5511988887777',
          }
        },
      }),
      llm,
    })

    await processMessage(runtime, msg({ text: pedidoCobranca }))
    const r = await processMessage(runtime, msg({ text: 'talvez' }))
    expect(r.kind).toBe('answer')
    expect(r.text).toMatch(/cancelei/i)
    expect(r.text).toMatch(/Nada foi registrado/)
    expect(chamadas).toBe(0)
  })
})

describe('processMessage — resumo do periodo (US6 / RF-108)', () => {
  it('resumo do mes devolve os quatro eixos do buildDre — RF-108', async () => {
    const buildDre = vi.fn(async (c: ExecutionContext, i: DreInput) => casos().buildDre(c, i))
    const revenueByMonth = vi.fn(async (c: ExecutionContext, i: RevenueByMonthInput) =>
      casos().revenueByMonth(c, i),
    )
    const runtime = createAgentRuntime({ useCases: casos({ buildDre, revenueByMonth }) })
    const r = await processMessage(runtime, msg({ text: 'resumo do mes' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toContain('Faturamento')
    expect(r.text).toContain('Custo')
    expect(r.text).toContain('Despesas')
    expect(r.text).toContain('Resultado')
    expect(r.text).toContain(formatarCentavos(95_000))
    expect(r.text).toContain(formatarCentavos(40_000))
    expect(r.text).toContain(formatarCentavos(20_000))
    expect(r.text).toContain(formatarCentavos(12_345))
    expect(r.text).toContain('2026-09-01')
    expect(r.text).toContain('2026-09-30')
    expect(r.text).not.toContain('Faturamento liquido')
    expect(r.text).not.toContain(formatarCentavos(35_000))
    expect(buildDre).toHaveBeenCalledOnce()
    expect(buildDre).toHaveBeenCalledWith(ctx, { from: '2026-09-01', to: '2026-09-30' })
    expect(revenueByMonth).not.toHaveBeenCalled()
  })

  it('relatorio grande demais e truncado no texto, sem arquivo nem link — RF-108; RF-109 fora', async () => {
    const runtime = createAgentRuntime({
      useCases: casos({
        buildDre: async (_ctx, input) =>
          dreSaida({
            from: input.from,
            to: input.to,
            lines: Array.from({ length: 200 }, (_, i) => ({
              accountId: `acc-${i}`,
              accountName: `Conta detalhada ${i} com nome bem longo para estourar o teto da mensagem`,
              type: 'expense',
              amountCents: 1_000 + i,
              entryCount: 1,
            })),
          }),
      }),
    })
    const r = await processMessage(runtime, msg({ text: 'resumo do mes' }))

    expect(r.kind).toBe('answer')
    expect(r.text.length).toBeLessThanOrEqual(LIMITE_TEXTO_MENSAGEM)
    expect(r.text).toContain('Faturamento')
    expect(r.text).toContain('Custo')
    expect(r.text).toContain('Despesas')
    expect(r.text).toContain('Resultado')
    expect(r.text.endsWith('\n…')).toBe(true)
    expect(r.text).not.toMatch(/https?:\/\//)
    expect(r.text).not.toMatch(/arquivo|download|\.pdf|link para/i)
  })
})

describe('processMessage — WhatsApp sem vinculo (RF-095)', () => {
  it('ignora numero desconhecido sem vazar informacao', async () => {
    const runtime = createAgentRuntime({
      useCases: casos(),
      peers: { resolve: async () => null },
    })
    const r = await processMessage(runtime, {
      text: 'quanto vendi hoje?',
      requestId: 'req-w',
      now: agora,
      channel: 'whatsapp',
      peer: '5511999990000',
    })
    expect(r.kind).toBe('ignored')
    expect(r.text).toBe('')
  })

  it('atende numero vinculado', async () => {
    const runtime = createAgentRuntime({
      useCases: casos(),
      peers: {
        resolve: async () => ({ companyId: 'emp-1', userId: 'user-1', role: 'owner' }),
      },
    })
    const r = await processMessage(runtime, {
      text: 'quanto vendi hoje?',
      requestId: 'req-w',
      now: agora,
      channel: 'whatsapp',
      peer: '5511999990000',
    })
    expect(r.kind).toBe('answer')
    expect(r.text).toContain('3 vendas')
  })
})

describe('processMessage — produto ambiguo (RF-102)', () => {
  it('lista opcoes em vez de escolher', async () => {
    const llm = new FakeLlm()
    llm.script('camiseta m', { type: 'tool', name: 'search_products', args: { q: 'camiseta' } })
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const r = await processMessage(runtime, msg({ text: 'camiseta m' }))
    expect(r.text).toMatch(/mais de um/i)
    expect(r.text).toContain('azul')
    expect(r.text).toContain('branca')
  })
})

describe('processMessage — desfechos restantes', () => {
  it('pede esclarecimento quando o modelo so fala', async () => {
    const llm = new FakeLlm()
    llm.script('oi', { type: 'text', text: 'Qual o periodo?' })
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const r = await processMessage(runtime, msg({ text: 'oi' }))
    expect(r.kind).toBe('clarify')
    expect(r.text).toBe('Qual o periodo?')
  })

  it('cancela com nao e nao grava', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script('cadastra o joao', { type: 'tool', name: 'create_customer', args: { name: 'Joao' } })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerCustomer: async (c, i) => {
          chamadas += 1
          return casos().registerCustomer(c, i)
        },
      }),
      llm,
    })
    const proposta = await processMessage(runtime, msg({ text: 'cadastra o joao' }))
    const resolve = vi.spyOn(runtime.confirmations, 'resolve')
    const r = await processMessage(runtime, msg({ text: 'nao' }))
    expect(r.text).toMatch(/Cancelado/)
    expect(chamadas).toBe(0)
    expect(resolve).toHaveBeenCalledWith('emp-1', proposta.confirmationId, 'rejected')
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('expirada com pedido novo reprocessa a mensagem', async () => {
    let cadastros = 0
    const listSales = vi.fn(async (c: ExecutionContext, i: SaleHistoryInput) =>
      casos().listSales(c, i),
    )
    const llm = new FakeLlm()
    llm.script('cadastra o joao', { type: 'tool', name: 'create_customer', args: { name: 'Joao' } })
    const runtime = createAgentRuntime({
      useCases: casos({
        listSales,
        registerCustomer: async (c, i) => {
          cadastros += 1
          return casos().registerCustomer(c, i)
        },
      }),
      llm,
    })
    const put = vi.spyOn(runtime.confirmations, 'put')
    const getOpen = vi.spyOn(runtime.confirmations, 'getOpen')
    const resolve = vi.spyOn(runtime.confirmations, 'resolve')
    const proposta = await processMessage(runtime, msg({ text: 'cadastra o joao' }))
    expect(put).toHaveBeenCalledOnce()
    const depois = new Date(agora.getTime() + CONFIRMATION_TTL_MS)
    const r = await processMessage(runtime, msg({ text: 'quanto vendi hoje?', now: depois }))
    expect(r.kind).toBe('answer')
    expect(r.kind).not.toBe('confirmation')
    expect(r.text).toContain('3 vendas')
    expect(r.text).not.toMatch(/Confirma\?/)
    expect(cadastros).toBe(0)
    expect(listSales).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledOnce()
    expect(getOpen).toHaveBeenCalledWith('emp-1', 'app:emp-1:user-1', depois)
    expect(resolve).toHaveBeenCalledWith('emp-1', proposta.confirmationId, 'expired')
  })

  it('expirada com texto longo reprocessa e nao executa a acao velha', async () => {
    let cadastros = 0
    let vendas = 0
    const llm = new FakeLlm()
    llm.script('cadastra o joao', { type: 'tool', name: 'create_customer', args: { name: 'Joao' } })
    llm.script('vende duas camisetas azuis agora', {
      type: 'tool',
      name: 'create_sale',
      args: {
        items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
        payments: [{ method: 'pix', amountCents: 9_980 }],
      },
    })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerCustomer: async (c, i) => {
          cadastros += 1
          return casos().registerCustomer(c, i)
        },
        registerSale: async (c, i) => {
          vendas += 1
          return casos().registerSale(c, i)
        },
      }),
      llm,
    })
    const getOpen = vi.spyOn(runtime.confirmations, 'getOpen')
    const resolve = vi.spyOn(runtime.confirmations, 'resolve')
    const proposta = await processMessage(runtime, msg({ text: 'cadastra o joao' }))
    const depois = new Date(agora.getTime() + CONFIRMATION_TTL_MS)
    const r = await processMessage(
      runtime,
      msg({ text: 'vende duas camisetas azuis agora', now: depois }),
    )
    expect(r.kind).toBe('confirmation')
    expect(cadastros).toBe(0)
    expect(vendas).toBe(0)
    expect(getOpen).toHaveBeenCalledWith('emp-1', 'app:emp-1:user-1', depois)
    expect(resolve).toHaveBeenCalledWith('emp-1', proposta.confirmationId, 'expired')
    expect(r.confirmationId).not.toBe(proposta.confirmationId)
  })

  it('recusa argumentos invalidos da tool de escrita', async () => {
    const llm = new FakeLlm()
    llm.script('vende', { type: 'tool', name: 'create_sale', args: {} })
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const r = await processMessage(runtime, msg({ text: 'vende' }))
    expect(r.kind).toBe('clarify')
    expect(r.text).toMatch(/entender os dados/i)
  })

  it('ignora tool que nao existe no catalogo', async () => {
    const llm = new FakeLlm()
    llm.script('x', { type: 'tool', name: 'explodir', args: {} })
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const r = await processMessage(runtime, msg({ text: 'x' }))
    expect(r.kind).toBe('unknown')
  })

  it('traduz AppError do caso de uso', async () => {
    const runtime = createAgentRuntime({
      useCases: casos({
        listSales: async () => {
          throw AppError.validation('Periodo invalido.', [
            { path: 'from', message: 'depois do fim' },
          ])
        },
      }),
    })
    const r = await processMessage(runtime, msg())
    expect(r.kind).toBe('clarify')
    expect(r.text).toContain('Periodo invalido')
    expect(r.text).toContain('from')
  })

  it('nao vaza erro interno', async () => {
    const runtime = createAgentRuntime({
      useCases: casos({
        listSales: async () => {
          throw new Error('ECONNREFUSED')
        },
      }),
    })
    const r = await processMessage(runtime, msg())
    expect(r.text).toMatch(/tente de novo/i)
    expect(r.text).not.toContain('ECONNREFUSED')
  })

  it('lista vazia de produto', async () => {
    const llm = new FakeLlm()
    llm.script('xyz', { type: 'tool', name: 'search_products', args: { q: 'xyz' } })
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const r = await processMessage(runtime, msg({ text: 'xyz' }))
    expect(r.text).toMatch(/Nenhum produto/)
  })

  it('ignora WhatsApp sem diretorio de numeros', async () => {
    const runtime = createAgentRuntime({ useCases: casos() })
    const r = await processMessage(runtime, {
      text: 'quanto vendi hoje?',
      requestId: 'req-w',
      now: agora,
      channel: 'whatsapp',
      peer: '5511999990000',
    })
    expect(r.kind).toBe('ignored')
  })
})

describe('FakeLlm', () => {
  const tools = [
    { id: 'list_sales', description: '', inputSchema: {} as never, mutatesValue: false },
    { id: 'list_receivables', description: '', inputSchema: {} as never, mutatesValue: false },
    { id: 'list_payables', description: '', inputSchema: {} as never, mutatesValue: false },
    { id: 'check_customer_wallet', description: '', inputSchema: {} as never, mutatesValue: false },
    { id: 'period_summary', description: '', inputSchema: {} as never, mutatesValue: false },
    { id: 'revenue_by_month', description: '', inputSchema: {} as never, mutatesValue: false },
    { id: 'refuse_certificate', description: '', inputSchema: {} as never, mutatesValue: false },
    { id: 'refuse_banking', description: '', inputSchema: {} as never, mutatesValue: false },
    {
      id: 'refuse_invoice_command',
      description: '',
      inputSchema: {} as never,
      mutatesValue: false,
    },
    { id: 'create_sale', description: '', inputSchema: {} as never, mutatesValue: true },
  ]

  it('roteiro ganha de palavra-chave', async () => {
    const llm = new FakeLlm()
    llm.script('quanto vendi hoje?', { type: 'unknown' })
    const d = await llm.decide({
      text: 'quanto vendi hoje?',
      tools,
      today: '2026-09-11',
    })
    expect(d).toEqual({ type: 'unknown' })
  })

  it.each(['quanto vendi hoje?', 'faturamento de hoje', 'ticket medio'])(
    'reconhece "%s" como list_sales — US-047',
    async (text) => {
      const llm = new FakeLlm()
      const d = await llm.decide({ text, tools, today: '2026-09-11' })
      expect(d).toEqual({
        type: 'tool',
        name: 'list_sales',
        args: { from: '2026-09-11', to: '2026-09-11' },
      })
    },
  )

  it.each(['quem esta me devendo?', 'quem me deve', 'inadimplentes'])(
    'reconhece "%s" como list_receivables — US-047',
    async (text) => {
      const llm = new FakeLlm()
      const d = await llm.decide({ text, tools, today: '2026-09-11' })
      expect(d).toEqual({ type: 'tool', name: 'list_receivables', args: {} })
    },
  )

  it('consultas US-047 nao dependem de revenue_by_month nem de period_summary', async () => {
    const semResumo = tools.filter((t) => t.id !== 'revenue_by_month' && t.id !== 'period_summary')
    const llm = new FakeLlm()
    const vendas = await llm.decide({
      text: 'quanto vendi hoje?',
      tools: semResumo,
      today: '2026-09-11',
    })
    const divida = await llm.decide({
      text: 'quem esta me devendo?',
      tools: semResumo,
      today: '2026-09-11',
    })
    const resumo = await llm.decide({
      text: 'resumo do mes',
      tools: semResumo,
      today: '2026-09-11',
    })
    expect(vendas).toEqual({
      type: 'tool',
      name: 'list_sales',
      args: { from: '2026-09-11', to: '2026-09-11' },
    })
    expect(divida).toEqual({ type: 'tool', name: 'list_receivables', args: {} })
    expect(resumo).toEqual({ type: 'unknown' })
  })

  it.each(['resumo do mes', 'resultado do mes'])(
    'reconhece "%s" como period_summary — US-053 / RF-108',
    async (text) => {
      const llm = new FakeLlm()
      const d = await llm.decide({ text, tools, today: '2026-09-11' })
      expect(d).toEqual({
        type: 'tool',
        name: 'period_summary',
        args: { from: '2026-09-01', to: '2026-09-30' },
      })
    },
  )

  it('resumo do mes nao cai em revenue_by_month', async () => {
    const semPeriodo = tools.filter((t) => t.id !== 'period_summary')
    const llm = new FakeLlm()
    const d = await llm.decide({
      text: 'resumo do mes',
      tools: semPeriodo,
      today: '2026-09-11',
    })
    expect(d).toEqual({ type: 'unknown' })
  })

  it.each(['quanto tem de camiseta?', 'qual o estoque de camiseta?'])(
    'reconhece "%s" como check_stock — US-065',
    async (text) => {
      const llm = new FakeLlm()
      const d = await llm.decide({
        text,
        tools: [
          { id: 'check_stock', description: '', inputSchema: {} as never, mutatesValue: false },
        ],
        today: '2026-09-11',
      })
      expect(d).toEqual({ type: 'tool', name: 'check_stock', args: { query: 'camiseta' } })
    },
  )

  it.each(['o que vence essa semana?', 'quais contas a pagar vencem?', 'quanto tenho a pagar?'])(
    'reconhece "%s" como list_payables — US2 / NR-115',
    async (text) => {
      const llm = new FakeLlm()
      const d = await llm.decide({ text, tools, today: '2026-09-11' })
      expect(d).toEqual({ type: 'tool', name: 'list_payables', args: {} })
    },
  )

  it.each(['qual o saldo do joao?', 'quanto o joao deve?', 'fiado do joao'])(
    'reconhece "%s" como check_customer_wallet — US3 / NR-115',
    async (text) => {
      const llm = new FakeLlm()
      const d = await llm.decide({
        text,
        tools: [
          ...tools,
          {
            id: 'check_customer_wallet',
            description: '',
            inputSchema: {} as never,
            mutatesValue: false,
          },
        ],
        today: '2026-09-11',
      })
      expect(d).toEqual({ type: 'tool', name: 'check_customer_wallet', args: { query: 'joao' } })
    },
  )

  it.each(['me conta uma piada', 'asdfghjkl', 'saldo da carteira'])(
    'nao reconhece "%s" — unknown para o laco listar capacidades',
    async (text) => {
      const llm = new FakeLlm()
      const d = await llm.decide({
        text,
        tools: [
          ...tools,
          {
            id: 'check_customer_wallet',
            description: '',
            inputSchema: {} as never,
            mutatesValue: false,
          },
        ],
        today: '2026-09-11',
      })
      expect(d).toEqual({ type: 'unknown' })
    },
  )

  it.each([
    ['envia o certificado A1', 'refuse_certificate'],
    ['cadastrar emitente', 'refuse_certificate'],
    ['importa o OFX', 'refuse_banking'],
    ['conciliar o extrato', 'refuse_banking'],
    ['emite a nota', 'refuse_invoice_command'],
    ['emite a NFC-e da venda X', 'refuse_invoice_command'],
    ['cancela a nota', 'refuse_invoice_command'],
  ] as const)('reconhece "%s" como %s — RF-149–151', async (text, name) => {
    const llm = new FakeLlm()
    const d = await llm.decide({ text, tools, today: '2026-09-11' })
    expect(d).toEqual({ type: 'tool', name, args: {} })
  })

  it('cancela a venda nao e refuse_invoice_command', async () => {
    const llm = new FakeLlm()
    const d = await llm.decide({ text: 'cancela a venda', tools, today: '2026-09-11' })
    expect(d).toEqual({ type: 'unknown' })
  })

  const toolsNr117 = [
    ...tools,
    { id: 'create_product', description: '', inputSchema: {} as never, mutatesValue: true },
    { id: 'create_payable', description: '', inputSchema: {} as never, mutatesValue: true },
    { id: 'create_receivable', description: '', inputSchema: {} as never, mutatesValue: true },
  ]

  it('reconhece cadastro de produto — NR-117 / quickstart', async () => {
    const llm = new FakeLlm()
    const d = await llm.decide({
      text: 'cadastra camiseta M custo 20 vende 49,90',
      tools: toolsNr117,
      today: '2026-09-11',
    })
    expect(d).toEqual({
      type: 'tool',
      name: 'create_product',
      args: {
        description: 'camiseta m',
        unitOfMeasure: 'un',
        costPriceCents: 2_000,
        salePriceCents: 4_990,
        stock: 0,
        minStock: 0,
      },
    })
  })

  it('reconhece conta a pagar — NR-117 / quickstart', async () => {
    const llm = new FakeLlm()
    const d = await llm.decide({
      text: 'lança aluguel 1800 vence dia 10',
      tools: toolsNr117,
      today: '2026-09-11',
    })
    expect(d).toEqual({
      type: 'tool',
      name: 'create_payable',
      args: {
        supplier: 'Aluguel',
        description: 'Aluguel',
        amountCents: 180_000,
        dueDate: '2026-10-10',
      },
    })
  })

  it('reconhece recebivel avulso — NR-117 / quickstart', async () => {
    const llm = new FakeLlm()
    const d = await llm.decide({
      text: 'a receber 500 do João na sexta, aluguel vitrine',
      tools: toolsNr117,
      today: '2026-09-11',
    })
    expect(d).toEqual({
      type: 'tool',
      name: 'create_receivable',
      args: {
        description: 'aluguel vitrine',
        amountCents: 50_000,
        dueDate: '2026-09-18',
      },
    })
  })

  it('nao reconhece conta a pagar incompleta — NR-117', async () => {
    const llm = new FakeLlm()
    const d = await llm.decide({
      text: 'lança conta a pagar',
      tools: toolsNr117,
      today: '2026-09-11',
    })
    expect(d).toEqual({ type: 'unknown' })
  })

  it.each([
    'venda pro joao: 2 camisetas M a 49,90, pagou no Pix',
    'vende no fiado',
    'lanca a venda',
    '2 camisetas no pix',
  ])('nao reconhece venda por regex — so script() — "%s"', async (text) => {
    const llm = new FakeLlm()
    const d = await llm.decide({
      text,
      tools: toolsNr117,
      today: '2026-09-11',
    })
    expect(d).toEqual({ type: 'unknown' })
  })

  it('frase de venda nao cai em create_receivable — NR-117', async () => {
    const llm = new FakeLlm()
    const d = await llm.decide({
      text: 'venda pro joao: 2 camisetas M a 49,90, pagou no Pix',
      tools: toolsNr117,
      today: '2026-09-11',
    })
    expect(d).toEqual({ type: 'unknown' })
  })

  it.each(['manda a cobranca pro Joao', 'cobra o joao', 'enviar cobranca'])(
    'nao reconhece cobranca por regex — so script() — "%s"',
    async (text) => {
      const llm = new FakeLlm()
      const d = await llm.decide({
        text,
        tools: [
          ...tools,
          { id: 'send_charge', description: '', inputSchema: {} as never, mutatesValue: true },
        ],
        today: '2026-09-11',
      })
      expect(d).toEqual({ type: 'unknown' })
    },
  )

  it('reconhece sim e nao compactos', () => {
    expect(eSim('Sim!')).toBe(true)
    expect(eNao('cancela')).toBe(true)
    expect(eSim('talvez')).toBe(false)
  })
})

describe('processMessage — recusas RF-149–151 (US7 / SC-004)', () => {
  const frases = [
    {
      text: 'envia o certificado A1',
      texto: TEXTO_RECUSA_CERTIFICADO,
      rf: 'RF-149',
    },
    {
      text: 'importa o OFX',
      texto: TEXTO_RECUSA_BANCO,
      rf: 'RF-150',
    },
    {
      text: 'emite a nota',
      texto: TEXTO_RECUSA_NOTA,
      rf: 'RF-151',
    },
  ] as const

  it.each(frases)('"$text" recusa com texto fixo e zero efeito — $rf', async ({ text, texto }) => {
    const listSales = vi.fn(casos().listSales)
    const listReceivables = vi.fn(casos().listReceivables)
    const checkStock = vi.fn(casos().checkStock)
    const checkStockByQuery = vi.fn(casos().checkStockByQuery)
    const checkCustomerWalletByQuery = vi.fn(casos().checkCustomerWalletByQuery)
    const listPayables = vi.fn(casos().listPayables)
    const registerCustomer = vi.fn(casos().registerCustomer)
    const registerSale = vi.fn(casos().registerSale)
    const searchProducts = vi.fn(casos().searchProducts)
    const revenueByMonth = vi.fn(casos().revenueByMonth)
    const buildDre = vi.fn(casos().buildDre)
    const sendCustomerCharge = vi.fn(casos().sendCustomerCharge)
    const findProductByBarcode = vi.fn(casos().findProductByBarcode)
    const registerProduct = vi.fn(casos().registerProduct)
    const createPayable = vi.fn(casos().createPayable)
    const createReceivable = vi.fn(casos().createReceivable)
    const settlePayable = vi.fn(casos().settlePayable)
    const settleReceivable = vi.fn(casos().settleReceivable)
    const adjustStock = vi.fn(casos().adjustStock)
    const createAppointment = vi.fn(casos().createAppointment)
    const listDayAppointments = vi.fn(casos().listDayAppointments)
    const cancelSale = vi.fn(casos().cancelSale)
    const runtime = createAgentRuntime({
      useCases: {
        listSales,
        listReceivables,
        checkStock,
        checkStockByQuery,
        checkCustomerWalletByQuery,
        listPayables,
        registerCustomer,
        registerSale,
        searchProducts,
        revenueByMonth,
        buildDre,
        sendCustomerCharge,
        findProductByBarcode,
        registerProduct,
        createPayable,
        createReceivable,
        settlePayable,
        settleReceivable,
        adjustStock,
        createAppointment,
        listDayAppointments,
        cancelSale,
      },
    })

    const r = await processMessage(runtime, msg({ text }))

    expect(r.kind).toBe('answer')
    expect(r.text).toBe(texto)
    expect(r.text).toMatch(/aplicativo/i)
    expect(listSales).not.toHaveBeenCalled()
    expect(listReceivables).not.toHaveBeenCalled()
    expect(checkStock).not.toHaveBeenCalled()
    expect(checkStockByQuery).not.toHaveBeenCalled()
    expect(listPayables).not.toHaveBeenCalled()
    expect(registerCustomer).not.toHaveBeenCalled()
    expect(registerSale).not.toHaveBeenCalled()
    expect(searchProducts).not.toHaveBeenCalled()
    expect(revenueByMonth).not.toHaveBeenCalled()
    expect(buildDre).not.toHaveBeenCalled()
    expect(sendCustomerCharge).not.toHaveBeenCalled()
    expect(findProductByBarcode).not.toHaveBeenCalled()
    expect(registerProduct).not.toHaveBeenCalled()
    expect(createPayable).not.toHaveBeenCalled()
    expect(createReceivable).not.toHaveBeenCalled()
    expect(settlePayable).not.toHaveBeenCalled()
    expect(settleReceivable).not.toHaveBeenCalled()
    expect(adjustStock).not.toHaveBeenCalled()
    expect(createAppointment).not.toHaveBeenCalled()
    expect(listDayAppointments).not.toHaveBeenCalled()
    expect(cancelSale).not.toHaveBeenCalled()
  })

  it('cancela a nota recusa; cancela a venda nao vira comando de nota — RF-151', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casos({ registerSale }) })

    const nota = await processMessage(runtime, msg({ text: 'cancela a nota' }))
    expect(nota.kind).toBe('answer')
    expect(nota.text).toBe(TEXTO_RECUSA_NOTA)
    expect(registerSale).not.toHaveBeenCalled()

    const venda = await processMessage(runtime, msg({ text: 'cancela a venda' }))
    expect(venda.kind).toBe('unknown')
    expect(venda.text).toContain('list_sales')
    expect(registerSale).not.toHaveBeenCalled()
  })

  it('script() tambem roteia para refuse_* sem gravar — SC-004', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const llm = new FakeLlm()
    llm.script('manda o pfx da loja', { type: 'tool', name: 'refuse_certificate', args: {} })
    const runtime = createAgentRuntime({ useCases: casos({ registerSale }), llm })

    const r = await processMessage(runtime, msg({ text: 'manda o pfx da loja' }))
    expect(r.kind).toBe('answer')
    expect(r.text).toBe(TEXTO_RECUSA_CERTIFICADO)
    expect(registerSale).not.toHaveBeenCalled()
  })
})

describe('processMessage — teto de IA (RNF-073, FR-020)', () => {
  it('com teto estourado devolve aviso e nao chama o modelo', async () => {
    const llm = new FakeLlm()
    const decide = llm.decide.bind(llm)
    let chamadas = 0
    llm.decide = async (input) => {
      chamadas += 1
      return decide(input)
    }
    const aiUsage = new InMemoryAiUsageCounter({ budgetCents: 1 })
    aiUsage.record('emp-1', agora, 1)
    const runtime = createAgentRuntime({ useCases: casos(), llm, aiUsage })

    const r = await processMessage(runtime, msg())
    expect(r.kind).toBe('answer')
    expect(r.text).toBe(TEXTO_TETO_IA)
    expect(chamadas).toBe(0)
  })

  it('com teto estourado nao executa tool que muta valor', async () => {
    let vendas = 0
    const llm = new FakeLlm()
    llm.script('venda pro joao', {
      type: 'tool',
      name: 'create_sale',
      args: {
        items: [{ productId: 'p-azul', quantity: 1, unitPriceCents: 4_990 }],
        payments: [{ method: 'pix' as const, amountCents: 4_990 }],
      },
    })
    const aiUsage = new InMemoryAiUsageCounter({ budgetCents: 1 })
    aiUsage.record('emp-1', agora, 1)
    const runtime = createAgentRuntime({
      useCases: casos({
        registerSale: async (c, i) => {
          vendas += 1
          return casos().registerSale(c, i)
        },
      }),
      llm,
      aiUsage,
    })

    const r = await processMessage(runtime, msg({ text: 'venda pro joao' }))
    expect(r.text).toBe(TEXTO_TETO_IA)
    expect(vendas).toBe(0)
  })

  it('confirmacao pendente nao grava se o teto estourou no intervalo', async () => {
    let vendas = 0
    const llm = new FakeLlm()
    llm.script('venda pro joao', {
      type: 'tool',
      name: 'create_sale',
      args: {
        items: [{ productId: 'p-azul', quantity: 1, unitPriceCents: 4_990 }],
        payments: [{ method: 'pix' as const, amountCents: 4_990 }],
      },
    })
    const aiUsage = new InMemoryAiUsageCounter({ budgetCents: 2 })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerSale: async (c, i) => {
          vendas += 1
          return casos().registerSale(c, i)
        },
      }),
      llm,
      aiUsage,
    })

    const pedido = await processMessage(runtime, msg({ text: 'venda pro joao' }))
    expect(pedido.kind).toBe('confirmation')
    aiUsage.record('emp-1', agora, 2)
    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.text).toBe(TEXTO_TETO_IA)
    expect(vendas).toBe(0)
  })

  it('abaixo do teto ainda consulta e registra unidades', async () => {
    const aiUsage = new InMemoryAiUsageCounter({ budgetCents: 5 })
    const runtime = createAgentRuntime({ useCases: casos(), aiUsage })
    const r = await processMessage(runtime, msg())
    expect(r.kind).toBe('answer')
    expect(r.text).toContain('3 vendas')
    expect(aiUsage.unitsOf('emp-1', agora)).toBe(1)
  })
})

describe('processMessage — isolamento entre lojas (US5 / FR-009)', () => {
  const argsVenda = {
    customerId: 'cli-1',
    items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
    payments: [{ method: 'pix' as const, amountCents: 9_980 }],
  }

  function contexto(companyId: string, userId: string): ExecutionContext {
    return { ...ctx, companyId, userId, requestId: `req-${companyId}` }
  }

  it('sim da loja B nao incrementa registerSale da loja A', async () => {
    const store = new InMemoryConfirmations()
    let vendasA = 0
    let vendasB = 0

    const llmA = new FakeLlm()
    llmA.script('venda pro joao', { type: 'tool', name: 'create_sale', args: argsVenda })
    const llmB = new FakeLlm()
    llmB.script('venda pro joao', { type: 'tool', name: 'create_sale', args: argsVenda })

    const runtimeA = createAgentRuntime({
      useCases: casos({
        registerSale: async (c, i) => {
          vendasA += 1
          return casos().registerSale(c, i)
        },
      }),
      llm: llmA,
      confirmations: store,
    })
    const runtimeB = createAgentRuntime({
      useCases: casos({
        registerSale: async (c, i) => {
          vendasB += 1
          return casos().registerSale(c, i)
        },
      }),
      llm: llmB,
      confirmations: store,
    })

    const ctxA = contexto('emp-a', 'user-a')
    const ctxB = contexto('emp-b', 'user-b')

    const propostaA = await processMessage(runtimeA, msg({ text: 'venda pro joao', ctx: ctxA }))
    expect(propostaA.kind).toBe('confirmation')
    expect(propostaA.text).toMatch(/Confirma\?/)
    expect(vendasA).toBe(0)

    const simB = await processMessage(runtimeB, msg({ text: 'sim', ctx: ctxB }))
    expect(vendasA).toBe(0)
    expect(vendasB).toBe(0)
    expect(simB.kind).not.toBe('confirmation')
    expect(simB.text).not.toBe(propostaA.text)
    expect(simB.text).not.toMatch(/Confirma\?/)

    const chaveA = 'app:emp-a:user-a'
    expect(await store.getOpen('emp-a', chaveA, agora)).toBeDefined()
    expect(await store.getOpen('emp-b', chaveA, agora)).toBeUndefined()

    const feitoA = await processMessage(runtimeA, msg({ text: 'sim', ctx: ctxA }))
    expect(feitoA.kind).toBe('answer')
    expect(feitoA.text).toContain('#1042')
    expect(vendasA).toBe(1)
    expect(vendasB).toBe(0)
  })

  it('cada loja confirma so a propria venda no store compartilhado', async () => {
    const store = new InMemoryConfirmations()
    let vendasA = 0
    let vendasB = 0

    const llmA = new FakeLlm()
    llmA.script('venda pro joao', { type: 'tool', name: 'create_sale', args: argsVenda })
    const llmB = new FakeLlm()
    llmB.script('venda pro joao', { type: 'tool', name: 'create_sale', args: argsVenda })

    const runtimeA = createAgentRuntime({
      useCases: casos({
        registerSale: async (c, i) => {
          vendasA += 1
          return casos().registerSale(c, i)
        },
      }),
      llm: llmA,
      confirmations: store,
    })
    const runtimeB = createAgentRuntime({
      useCases: casos({
        registerSale: async (c, i) => {
          vendasB += 1
          return casos().registerSale(c, i)
        },
      }),
      llm: llmB,
      confirmations: store,
    })

    const ctxA = contexto('emp-a', 'user-a')
    const ctxB = contexto('emp-b', 'user-b')

    await processMessage(runtimeA, msg({ text: 'venda pro joao', ctx: ctxA }))
    await processMessage(runtimeB, msg({ text: 'venda pro joao', ctx: ctxB }))
    expect(vendasA).toBe(0)
    expect(vendasB).toBe(0)

    const feitoB = await processMessage(runtimeB, msg({ text: 'sim', ctx: ctxB }))
    expect(feitoB.kind).toBe('answer')
    expect(feitoB.text).toContain('#1042')
    expect(vendasA).toBe(0)
    expect(vendasB).toBe(1)

    const feitoA = await processMessage(runtimeA, msg({ text: 'sim', ctx: ctxA }))
    expect(feitoA.kind).toBe('answer')
    expect(vendasA).toBe(1)
    expect(vendasB).toBe(1)
  })
})

describe('processMessage — anafora no fio ativo (US1 / RF-105)', () => {
  const fraseAncora = 'cobra o Joao'
  const fraseEle = 'manda a cobranca pra ele'

  it('segundo turno com "ele" reusa o customerId ancorado via history — T013', async () => {
    const historicos: Array<readonly HistoryTurn[] | undefined> = []
    let turno = 0
    const llm: LlmPort = {
      async decide(input) {
        historicos.push(input.history)
        turno += 1
        if (turno === 1) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
        }
        const hist = input.history ?? []
        if (hist.length > 0) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
        }
        return { type: 'unknown' }
      },
    }
    const sendCustomerCharge = vi.fn(casos().sendCustomerCharge)
    const runtime = createAgentRuntime({
      useCases: casos({ sendCustomerCharge }),
      llm,
      confirmationTtlMs: 1_000,
    })

    const ancora = await processMessage(runtime, msg({ text: fraseAncora }))
    expect(ancora.kind).toBe('confirmation')
    expect(ancora.text).toContain('cli-1')
    expect(sendCustomerCharge).not.toHaveBeenCalled()

    const store = runtime.conversations
    expect(store).toBeDefined()
    if (store === undefined) return
    const ativo = await store.loadActive(ctx.companyId, 'app:emp-1:user-1', agora)
    expect(ativo?.idle).toBe(false)
    const comIds = JSON.stringify(ativo?.messages.map((m) => m.toolCalls) ?? [])
    expect(comIds).toContain('cli-1')

    const depois = new Date(agora.getTime() + 5_000)
    const ele = await processMessage(runtime, msg({ text: fraseEle, now: depois }))
    expect(ele.kind).toBe('confirmation')
    expect(ele.text).toContain('cli-1')
    expect(sendCustomerCharge).not.toHaveBeenCalled()

    expect(historicos.length).toBeGreaterThanOrEqual(2)
    const hist2 = historicos[1] ?? []
    expect(hist2.length).toBeGreaterThan(0)
    expect(hist2[0]?.body).toBe(fraseAncora)
    expect(hist2.some((h) => h.role === 'user' && h.body === fraseAncora)).toBe(true)
    expect(hist2.some((h) => h.role === 'assistant')).toBe(true)
  })

  it('consulta "quanto vendi hoje?" pelo FakeLlm continua igual — T013 regressao', async () => {
    const runtime = createAgentRuntime({ useCases: casos() })
    const r = await processMessage(runtime, msg())
    expect(r.kind).toBe('answer')
    expect(r.text).toContain('3 vendas')
    expect(r.text).toContain(formatarCentavos(15_000))
  })

  it('primeira mensagem com nome explicito chama decide com history vazio — T014', async () => {
    const visto: Array<readonly HistoryTurn[] | undefined> = []
    const llm: LlmPort = {
      async decide(input) {
        visto.push(input.history)
        return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
      },
    }
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const r = await processMessage(runtime, msg({ text: 'manda a cobranca pro Joao' }))
    expect(r.kind).toBe('confirmation')
    expect(r.text).toContain('cli-1')
    expect(visto).toHaveLength(1)
    const hist = visto[0]
    expect(hist === undefined || hist.length === 0).toBe(true)

    const consulta = createAgentRuntime({ useCases: casos() })
    const nr060 = await processMessage(consulta, msg())
    expect(nr060.kind).toBe('answer')
    expect(nr060.text).toContain('3 vendas')
  })

  it('dois candidatos no history esclarecem e nao executam send_charge — T015', async () => {
    const store = new InMemoryConversationStore()
    const chave = 'app:emp-1:user-1'
    await store.append(ctx.companyId, {
      conversationKey: chave,
      userBody: 'cobra o Joao cli-1',
      assistantBody: 'Enviar cobranca para cliente cli-1. Confirma?',
      toolCalls: { customerId: 'cli-1' },
      at: agora,
    })
    await store.append(ctx.companyId, {
      conversationKey: chave,
      userBody: 'cobra a Maria cli-2',
      assistantBody: 'Enviar cobranca para cliente cli-2. Confirma?',
      toolCalls: { customerId: 'cli-2' },
      at: agora,
    })

    const llm: LlmPort = {
      async decide(input) {
        const texto = (input.history ?? []).map((h) => h.body).join('\n')
        const tem1 = texto.includes('cli-1')
        const tem2 = texto.includes('cli-2')
        if (tem1 && tem2) {
          return { type: 'text', text: 'Qual cliente: Joao (cli-1) ou Maria (cli-2)?' }
        }
        return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
      },
    }
    const sendCustomerCharge = vi.fn(casos().sendCustomerCharge)
    const runtime = createAgentRuntime({
      useCases: casos({ sendCustomerCharge }),
      llm,
      conversations: store,
    })

    const r = await processMessage(runtime, msg({ text: 'manda a cobranca pra ele' }))
    expect(r.kind).toBe('clarify')
    expect(r.text).toMatch(/Qual cliente/)
    expect(sendCustomerCharge).not.toHaveBeenCalled()
  })
})

describe('processMessage — isolamento entre empresas (US2 / T019)', () => {
  it('history da loja A nao entra no decide da loja B; "ele" nao ancora o cliente da A', async () => {
    const store = new InMemoryConversationStore()
    const ctxA: ExecutionContext = { ...ctx, companyId: 'emp-A', requestId: 'req-a' }
    const ctxB: ExecutionContext = { ...ctx, companyId: 'emp-B', requestId: 'req-b' }

    const historicoB: Array<readonly HistoryTurn[] | undefined> = []
    const llmA: LlmPort = {
      async decide() {
        return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-da-A' } }
      },
    }
    const llmB: LlmPort = {
      async decide(input) {
        historicoB.push(input.history)
        const texto = (input.history ?? []).map((h) => h.body).join('\n')
        if (texto.includes('cli-da-A') || texto.includes('Joao da A')) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-da-A' } }
        }
        return { type: 'unknown' }
      },
    }

    const runtimeA = createAgentRuntime({
      useCases: casos(),
      llm: llmA,
      conversations: store,
    })
    const runtimeB = createAgentRuntime({
      useCases: casos(),
      llm: llmB,
      conversations: store,
    })

    const ancora = await processMessage(
      runtimeA,
      msg({ text: 'cobra o Joao da A', ctx: ctxA, requestId: 'req-a' }),
    )
    expect(ancora.kind).toBe('confirmation')
    expect(ancora.text).toContain('cli-da-A')

    const ele = await processMessage(
      runtimeB,
      msg({ text: 'manda a cobranca pra ele', ctx: ctxB, requestId: 'req-b' }),
    )
    expect(ele.kind).not.toBe('confirmation')
    expect(ele.text).not.toContain('cli-da-A')

    expect(historicoB).toHaveLength(1)
    const hist = historicoB[0] ?? []
    expect(hist).toHaveLength(0)
    expect(hist.some((h) => h.body.includes('Joao da A'))).toBe(false)
    expect(hist.some((h) => h.body.includes('cli-da-A'))).toBe(false)
  })
})

describe('processMessage — idle 2 h (US3 / RF-106)', () => {
  const fraseAncora = 'cobra o Joao'
  const fraseEle = 'manda a cobranca pra ele'
  const duasHorasMs = 2 * 60 * 60 * 1000

  it('depois de 2 h o stub recebe history vazio e nao devolve o customerId antigo — T024', async () => {
    const historicos: Array<readonly HistoryTurn[] | undefined> = []
    let turno = 0
    const llm: LlmPort = {
      async decide(input) {
        historicos.push(input.history)
        turno += 1
        if (turno === 1) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
        }
        const hist = input.history ?? []
        if (hist.length > 0) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
        }
        return { type: 'unknown' }
      },
    }
    const sendCustomerCharge = vi.fn(casos().sendCustomerCharge)
    const runtime = createAgentRuntime({
      useCases: casos({ sendCustomerCharge }),
      llm,
    })

    const ancora = await processMessage(runtime, msg({ text: fraseAncora }))
    expect(ancora.kind).toBe('confirmation')
    expect(ancora.text).toContain('cli-1')
    expect(sendCustomerCharge).not.toHaveBeenCalled()

    const depoisIdle = new Date(agora.getTime() + duasHorasMs + 1)
    const ctxIdle: ExecutionContext = { ...ctx, now: depoisIdle, requestId: 'req-idle' }
    const ele = await processMessage(
      runtime,
      msg({ text: fraseEle, now: depoisIdle, ctx: ctxIdle, requestId: 'req-idle' }),
    )

    expect(historicos.length).toBeGreaterThanOrEqual(2)
    const hist2 = historicos[1] ?? []
    expect(hist2).toHaveLength(0)
    expect(ele.kind).not.toBe('confirmation')
    expect(ele.text).not.toContain('cli-1')
    expect(sendCustomerCharge).not.toHaveBeenCalled()
  })

  it('recomeco apos idle ancora so o trecho novo — T026', async () => {
    const historicos: Array<readonly HistoryTurn[] | undefined> = []
    let turno = 0
    const llm: LlmPort = {
      async decide(input) {
        historicos.push(input.history)
        turno += 1
        const texto = (input.history ?? []).map((h) => h.body).join('\n')
        if (turno === 1) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-antigo' } }
        }
        if (turno === 2) {
          if (texto.includes('cli-antigo') || texto.includes(fraseAncora)) {
            return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-antigo' } }
          }
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-novo' } }
        }
        if (texto.includes('cli-antigo') || texto.includes(fraseAncora)) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-antigo' } }
        }
        if (texto.includes('cli-novo') || texto.includes('cobra a Maria')) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-novo' } }
        }
        return { type: 'unknown' }
      },
    }
    const sendCustomerCharge = vi.fn(casos().sendCustomerCharge)
    const runtime = createAgentRuntime({
      useCases: casos({ sendCustomerCharge }),
      llm,
      confirmationTtlMs: 1_000,
    })

    const ancora = await processMessage(runtime, msg({ text: fraseAncora }))
    expect(ancora.kind).toBe('confirmation')
    expect(ancora.text).toContain('cli-antigo')

    const tRecomeco = new Date(agora.getTime() + duasHorasMs + 1)
    const ctxRecomeco: ExecutionContext = { ...ctx, now: tRecomeco, requestId: 'req-re' }
    const recomeco = await processMessage(
      runtime,
      msg({
        text: 'cobra a Maria',
        now: tRecomeco,
        ctx: ctxRecomeco,
        requestId: 'req-re',
      }),
    )
    expect(recomeco.kind).toBe('confirmation')
    expect(recomeco.text).toContain('cli-novo')
    expect(recomeco.text).not.toContain('cli-antigo')

    const hist2 = historicos[1] ?? []
    expect(hist2).toHaveLength(0)

    const tPronome = new Date(tRecomeco.getTime() + 5_000)
    const ctxPronome: ExecutionContext = { ...ctx, now: tPronome, requestId: 'req-ele' }
    const ele = await processMessage(
      runtime,
      msg({
        text: fraseEle,
        now: tPronome,
        ctx: ctxPronome,
        requestId: 'req-ele',
      }),
    )
    expect(ele.kind).toBe('confirmation')
    expect(ele.text).toContain('cli-novo')
    expect(ele.text).not.toContain('cli-antigo')
    expect(sendCustomerCharge).not.toHaveBeenCalled()

    const hist3 = historicos[2] ?? []
    expect(hist3.length).toBeGreaterThan(0)
    expect(hist3.some((h) => h.body.includes(fraseAncora))).toBe(false)
    expect(hist3.some((h) => h.body.includes('cli-antigo'))).toBe(false)
    expect(hist3.some((h) => h.body.includes('cobra a Maria'))).toBe(true)
  })

  it('confirmacao pendente + 2 h nao estende expiresAt; sim apos 5 min expira — T027', async () => {
    const store = new InMemoryConversationStore()
    const loadActive = vi.spyOn(store, 'loadActive')
    let chamadas = 0
    const llm: LlmPort = {
      async decide() {
        return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
      },
    }
    const runtime = createAgentRuntime({
      useCases: casos({
        sendCustomerCharge: async (c, i) => {
          chamadas += 1
          return casos().sendCustomerCharge(c, i)
        },
      }),
      llm,
      conversations: store,
    })

    const proposta = await processMessage(runtime, msg({ text: 'cobra o Joao' }))
    expect(proposta.kind).toBe('confirmation')
    expect(chamadas).toBe(0)

    const chave = 'app:emp-1:user-1'
    const pendente = await runtime.confirmations.getOpen('emp-1', chave, agora)
    expect(pendente).toBeDefined()
    const expiresAtOriginal = pendente!.expiresAt.getTime()
    expect(expiresAtOriginal).toBe(agora.getTime() + CONFIRMATION_TTL_MS)

    const daqui2h = new Date(agora.getTime() + duasHorasMs)
    const ainda = await runtime.confirmations.getOpen('emp-1', chave, daqui2h)
    expect(ainda?.expiresAt.getTime()).toBe(expiresAtOriginal)

    loadActive.mockClear()
    const depoisTtl = new Date(agora.getTime() + CONFIRMATION_TTL_MS + 1)
    const ctxExpirada: ExecutionContext = { ...ctx, now: depoisTtl, requestId: 'req-sim' }
    const r = await processMessage(
      runtime,
      msg({ text: 'sim', now: depoisTtl, ctx: ctxExpirada, requestId: 'req-sim' }),
    )
    expect(r.text).toMatch(/expirou/i)
    expect(chamadas).toBe(0)
    expect(loadActive).not.toHaveBeenCalled()
  })
})

describe('processMessage — janela de 12 mensagens (US4 / RNF-075)', () => {
  it('13 turnos no InMemory; 14o decide recebe history.length === 12 — T029', async () => {
    const historicos: Array<readonly HistoryTurn[] | undefined> = []
    const llm: LlmPort = {
      async decide(input) {
        historicos.push(input.history)
        return {
          type: 'tool',
          name: 'list_sales',
          args: { from: '2026-09-11', to: '2026-09-11' },
        }
      },
    }
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const t0 = agora.getTime()

    for (let i = 1; i <= 13; i++) {
      const now = new Date(t0 + i * 1_000)
      const ctxTurno: ExecutionContext = { ...ctx, now, requestId: `req-w${i}` }
      await processMessage(
        runtime,
        msg({ text: `consulta ${i}`, now, ctx: ctxTurno, requestId: `req-w${i}` }),
      )
    }

    const store = runtime.conversations
    expect(store).toBeDefined()
    if (store === undefined) return
    const agora14 = new Date(t0 + 14_000)
    const antesDo14 = await store.loadActive(ctx.companyId, 'app:emp-1:user-1', agora14)
    expect(antesDo14?.idle).toBe(false)
    expect(antesDo14?.messages).toHaveLength(12)

    const ctx14: ExecutionContext = { ...ctx, now: agora14, requestId: 'req-w14' }
    await processMessage(
      runtime,
      msg({ text: 'consulta 14', now: agora14, ctx: ctx14, requestId: 'req-w14' }),
    )

    expect(historicos).toHaveLength(14)
    const hist14 = historicos[13] ?? []
    expect(hist14).toHaveLength(12)

    const users = hist14.filter((h) => h.role === 'user').map((h) => h.body)
    expect(users).toEqual([
      'consulta 8',
      'consulta 9',
      'consulta 10',
      'consulta 11',
      'consulta 12',
      'consulta 13',
    ])
    expect(hist14.some((h) => h.body === 'consulta 1')).toBe(false)
    expect(hist14[0]?.role).toBe('user')
    expect(hist14[hist14.length - 1]?.role).toBe('assistant')
    for (let i = 1; i < hist14.length; i++) {
      expect(hist14[i]?.role).not.toBe(hist14[i - 1]?.role)
    }
  })

  it('ancora so na mensagem 1 de 13+ nao viaja; pronome pede de novo — T031', async () => {
    const store = new InMemoryConversationStore()
    const chave = 'app:emp-1:user-1'
    const loadActive = vi.spyOn(store, 'loadActive')

    await store.append(ctx.companyId, {
      conversationKey: chave,
      userBody: 'cobra o Joao ancora-fora-da-janela',
      assistantBody: 'Enviar cobranca para cliente cli-1. Confirma?',
      toolCalls: { customerId: 'cli-1' },
      at: agora,
    })
    for (let i = 2; i <= 13; i++) {
      await store.append(ctx.companyId, {
        conversationKey: chave,
        userBody: `consulta ${i}`,
        assistantBody: `ok ${i}`,
        at: new Date(agora.getTime() + i * 1_000),
      })
    }

    const historicos: Array<readonly HistoryTurn[] | undefined> = []
    const llm: LlmPort = {
      async decide(input) {
        historicos.push(input.history)
        const texto = (input.history ?? []).map((h) => h.body).join('\n')
        if (texto.includes('cli-1') || texto.includes('ancora-fora-da-janela')) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
        }
        return { type: 'text', text: 'Quem e o cliente?' }
      },
    }
    const sendCustomerCharge = vi.fn(casos().sendCustomerCharge)
    const runtime = createAgentRuntime({
      useCases: casos({ sendCustomerCharge }),
      llm,
      conversations: store,
    })

    const tPronome = new Date(agora.getTime() + 14_000)
    const ctxPronome: ExecutionContext = { ...ctx, now: tPronome, requestId: 'req-janela' }
    const r = await processMessage(
      runtime,
      msg({
        text: 'manda a cobranca pra ele',
        now: tPronome,
        ctx: ctxPronome,
        requestId: 'req-janela',
      }),
    )

    expect(historicos).toHaveLength(1)
    const hist = historicos[0] ?? []
    expect(hist).toHaveLength(12)
    expect(hist.some((h) => h.body.includes('ancora-fora-da-janela'))).toBe(false)
    expect(hist.some((h) => h.body.includes('cli-1'))).toBe(false)
    expect(r.kind).toBe('clarify')
    expect(r.text).toMatch(/Quem e o cliente/)
    expect(r.text).not.toContain('cli-1')
    expect(sendCustomerCharge).not.toHaveBeenCalled()

    const ultima = loadActive.mock.calls[loadActive.mock.calls.length - 1]
    const opcoes = ultima?.[3]
    expect(opcoes?.window === undefined || opcoes.window === 12).toBe(true)
  })
})

describe('processMessage — mesmo peer wa ancora; outro nao (US6 / T042)', () => {
  const fraseAncora = 'cobra o Joao'
  const fraseEle = 'manda a cobranca pra ele'
  const peerA = '5511999000001'
  const peerB = '5511999000002'

  function wa(peer: string, text: string, now = agora, requestId = 'req-wa'): IncomingMessage {
    return {
      text,
      requestId,
      now,
      channel: 'whatsapp',
      peer,
    }
  }

  it('mesmo peer herda a ancora; peer distinto nao herda', async () => {
    let turno = 0
    const llm: LlmPort = {
      async decide(input) {
        turno += 1
        if (turno === 1) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
        }
        const hist = input.history ?? []
        if (hist.some((h) => h.body.includes(fraseAncora))) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
        }
        return { type: 'unknown' }
      },
    }
    const runtime = createAgentRuntime({
      useCases: casos(),
      llm,
      confirmationTtlMs: 1_000,
      peers: {
        resolve: async () => ({ companyId: 'emp-1', userId: 'user-1', role: 'owner' }),
      },
    })

    const ancora = await processMessage(runtime, wa(peerA, fraseAncora, agora, 'req-wa-1'))
    expect(ancora.kind).toBe('confirmation')
    expect(ancora.text).toContain('cli-1')

    const depois = new Date(agora.getTime() + 5_000)
    const mesmo = await processMessage(runtime, wa(peerA, fraseEle, depois, 'req-wa-2'))
    expect(mesmo.kind).toBe('confirmation')
    expect(mesmo.text).toContain('cli-1')

    const outro = await processMessage(runtime, wa(peerB, fraseEle, depois, 'req-wa-3'))
    expect(outro.kind).not.toBe('confirmation')
    expect(outro.text).not.toContain('cli-1')
  })
})

describe('processMessage — HTTP app e Studio wa nao compartilham fio (US6 / T045 / FR-011)', () => {
  const fraseAncora = 'cobra o Joao'
  const fraseEle = 'manda a cobranca pra ele'

  it('pronome no WhatsApp nao herda ancora do harness HTTP da mesma loja', async () => {
    let turno = 0
    const historicoWa: Array<readonly HistoryTurn[] | undefined> = []
    const llm: LlmPort = {
      async decide(input) {
        turno += 1
        if (turno === 1) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
        }
        historicoWa.push(input.history)
        const hist = input.history ?? []
        if (hist.some((h) => h.body.includes(fraseAncora))) {
          return { type: 'tool', name: 'send_charge', args: { customerId: 'cli-1' } }
        }
        return { type: 'unknown' }
      },
    }
    const runtime = createAgentRuntime({
      useCases: casos(),
      llm,
      confirmationTtlMs: 1_000,
      peers: {
        resolve: async () => ({ companyId: 'emp-1', userId: 'user-1', role: 'owner' }),
      },
    })

    const ancora = await processMessage(runtime, msg({ text: fraseAncora }))
    expect(ancora.kind).toBe('confirmation')
    expect(ancora.text).toContain('cli-1')

    const depois = new Date(agora.getTime() + 5_000)
    const ele = await processMessage(runtime, {
      text: fraseEle,
      requestId: 'req-wa-fr011',
      now: depois,
      channel: 'whatsapp',
      peer: '5511999000001',
    })
    expect(ele.kind).not.toBe('confirmation')
    expect(ele.text).not.toContain('cli-1')

    expect(historicoWa).toHaveLength(1)
    const hist = historicoWa[0] ?? []
    expect(hist).toHaveLength(0)
    expect(hist.some((h) => h.body.includes(fraseAncora))).toBe(false)
  })
})

const BARCODE_EAN = '7891234567895'

function produtoEan(): ProductOutput {
  return {
    id: 'p-ean',
    description: 'Camiseta M',
    barcode: BARCODE_EAN,
    internalCode: 'PROD-EAN',
    unitOfMeasure: 'un',
    salePriceCents: 4_990,
    costPriceCents: 2_000,
    taxRate: 0,
    ncm: null,
    cfop: null,
    taxSituationCode: null,
    stock: 10,
    minStock: 0,
    category: null,
    supplier: null,
  }
}

function casosFoto(over: Partial<AgentUseCases> = {}): AgentUseCases {
  const registerSale = vi.fn(casos().registerSale)
  return casos({
    findProductByBarcode: async (c, barcode) => {
      if (c.companyId === 'emp-1' && barcode === BARCODE_EAN) return produtoEan()
      return undefined
    },
    registerSale,
    ...over,
  })
}

function fotoMsg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return msg({
    text: '',
    image: { mimeType: 'image/png', bytes: bytesFromMarker(BARCODE_EAN) },
    ...over,
  })
}

describe('processMessage — venda por foto (NR-116 US1 / T008)', () => {
  it('foto so pede pagamento sem confirmacao nem venda', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })

    const r = await processMessage(runtime, fotoMsg())

    expect(r.kind).toBe('clarify')
    expect(r.text).toContain('Camiseta M')
    expect(r.text).toContain(formatarCentavos(4_990))
    expect(r.text).toMatch(/forma de pagamento/i)
    expect(r.confirmationId).toBeUndefined()
    expect(registerSale).not.toHaveBeenCalled()
  })

  it('foto + no pix pede confirmacao sem gravar', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })

    const r = await processMessage(runtime, fotoMsg({ text: 'no pix' }))

    expect(r.kind).toBe('confirmation')
    expect(r.confirmationId).toBeDefined()
    expect(r.text).toMatch(/Confirma\?/)
    expect(r.text).toContain('p-ean')
    expect(r.text).toContain('pix')
    expect(registerSale).not.toHaveBeenCalled()
  })

  it('sim apos confirmacao da foto grava venda com preco copiado', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })

    const proposta = await processMessage(runtime, fotoMsg({ text: 'no pix' }))
    expect(proposta.kind).toBe('confirmation')

    const feito = await processMessage(runtime, msg({ text: 'sim' }))
    expect(feito.kind).toBe('answer')
    expect(registerSale).toHaveBeenCalledOnce()
    const input = registerSale.mock.calls[0]?.[1] as CreateSaleInput
    expect(input.items[0]?.productId).toBe('p-ean')
    expect(input.items[0]?.quantity).toBe(1)
    expect(input.items[0]?.unitPriceCents).toBe(4_990)
    expect(input.payments[0]?.method).toBe('pix')
    expect(input.payments[0]?.amountCents).toBe(4_990)
  })

  it('pagamento na mensagem seguinte reutiliza o rascunho sem reenviar foto', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })

    const pergunta = await processMessage(runtime, fotoMsg())
    expect(pergunta.kind).toBe('clarify')

    const proposta = await processMessage(runtime, msg({ text: 'no pix' }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toContain('p-ean')
    expect(registerSale).not.toHaveBeenCalled()
  })

  it('mensagem que nao e pagamento descarta o rascunho e atende a consulta', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })

    await processMessage(runtime, fotoMsg())
    const consulta = await processMessage(runtime, msg({ text: 'quanto vendi hoje?' }))
    expect(consulta.kind).toBe('answer')
    expect(consulta.kind).not.toBe('confirmation')
    expect(consulta.text).toContain('3 vendas')

    const tardio = await processMessage(runtime, msg({ text: 'no pix' }))
    expect(tardio.kind).not.toBe('confirmation')
    expect(registerSale).not.toHaveBeenCalled()
  })

  it('outra empresa nao vende produto da empresa A', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })
    const ctxB: ExecutionContext = { ...ctx, companyId: 'emp-2', requestId: 'req-b' }

    const r = await processMessage(
      runtime,
      fotoMsg({ text: 'no pix', ctx: ctxB, requestId: 'req-b' }),
    )

    expect(r.kind).toBe('answer')
    expect(r.text).toContain(TEXTO_RECUSA_FOTO_PRODUTO_DESCONHECIDO)
    expect(registerSale).not.toHaveBeenCalled()
  })
})

const BARCODE_DESCONHECIDO = '0000000000000'

function fotoRefusalMsg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return msg({
    text: '',
    image: { mimeType: 'image/png', bytes: bytesFromMarker(BARCODE_DESCONHECIDO) },
    ...over,
  })
}

describe('processMessage — recusas por foto (NR-116 US2 / T013–T016)', () => {
  it('bytes vazios recusa ilegivel sem confirmacao nem venda', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const r = await processMessage(
      runtime,
      msg({ text: '', image: { mimeType: 'image/jpeg', bytes: new Uint8Array() } }),
    )

    expect(r.kind).toBe('answer')
    expect(r.text).toContain(TEXTO_RECUSA_FOTO_ILEGIVEL)
    expect(r.text).toMatch(/por texto/i)
    expect(r.text).toMatch(/vender ou cadastrar/i)
    expect(r.confirmationId).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(registerSale).not.toHaveBeenCalled()
    expect(await runtime.confirmations.getOpen('emp-1', 'app:emp-1:user-1', agora)).toBeUndefined()
  })

  it('dois codigos recusa um produto por vez sem escolher codigo', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const findProductByBarcode = vi.fn(casosFoto().findProductByBarcode)
    const runtime = createAgentRuntime({
      useCases: casosFoto({ registerSale, findProductByBarcode }),
    })

    const r = await processMessage(
      runtime,
      msg({
        text: '',
        image: {
          mimeType: 'image/png',
          bytes: bytesFromMarker(`${BARCODE_EAN}\n${BARCODE_DESCONHECIDO}`),
        },
      }),
    )

    expect(r.kind).toBe('answer')
    expect(r.text).toContain(TEXTO_RECUSA_FOTO_MULTIPLOS)
    expect(r.text).toMatch(/um produto por vez/i)
    expect(r.text).not.toContain(BARCODE_EAN)
    expect(r.text).not.toContain(BARCODE_DESCONHECIDO)
    expect(r.confirmationId).toBeUndefined()
    expect(registerSale).not.toHaveBeenCalled()
    expect(findProductByBarcode).not.toHaveBeenCalled()
  })

  it('codigo sem produto pede descricao por texto sem avulso nem convite a cadastrar', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const findProductByBarcode = vi.fn(async () => undefined)
    const runtime = createAgentRuntime({
      useCases: casosFoto({ registerSale, findProductByBarcode }),
    })

    const r = await processMessage(runtime, fotoRefusalMsg())

    expect(r.kind).toBe('answer')
    expect(r.text).toContain(TEXTO_RECUSA_FOTO_PRODUTO_DESCONHECIDO)
    expect(r.text).toMatch(/por texto/i)
    expect(r.text).not.toMatch(/avulso/i)
    expect(r.text).not.toMatch(/quer cadastrar/i)
    expect(r.text).not.toMatch(/cadastra\?/i)
    expect(r.confirmationId).toBeUndefined()
    expect(registerSale).not.toHaveBeenCalled()
    expect(findProductByBarcode).toHaveBeenCalledOnce()
  })

  it('marcador corrompido com zero codigos recusa como ilegivel', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })

    const r = await processMessage(
      runtime,
      msg({
        text: '',
        image: { mimeType: 'image/webp', bytes: bytesFromMarker('desconhecido') },
      }),
    )

    expect(r.kind).toBe('answer')
    expect(r.text).toContain(TEXTO_RECUSA_FOTO_ILEGIVEL)
    expect(r.confirmationId).toBeUndefined()
    expect(registerSale).not.toHaveBeenCalled()
  })

  it('MIME invalido recusa como ilegivel', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })

    const r = await processMessage(
      runtime,
      msg({
        text: '',
        image: {
          mimeType: 'image/gif' as 'image/png',
          bytes: bytesFromMarker(BARCODE_EAN),
        },
      }),
    )

    expect(r.kind).toBe('answer')
    expect(r.text).toContain(TEXTO_RECUSA_FOTO_ILEGIVEL)
    expect(registerSale).not.toHaveBeenCalled()
  })

  it('empresa B com codigo da A recusa produto desconhecido sem vazar produto da A — T014', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const findProductByBarcode = vi.fn(casosFoto().findProductByBarcode)
    const runtime = createAgentRuntime({
      useCases: casosFoto({ registerSale, findProductByBarcode }),
    })
    const ctxB: ExecutionContext = { ...ctx, companyId: 'emp-2', requestId: 'req-b' }
    const put = vi.spyOn(runtime.confirmations, 'put')

    const r = await processMessage(
      runtime,
      fotoMsg({ text: 'no pix', ctx: ctxB, requestId: 'req-b' }),
    )

    expect(r.kind).toBe('answer')
    expect(r.text).toContain(TEXTO_RECUSA_FOTO_PRODUTO_DESCONHECIDO)
    expect(r.text).not.toContain('Camiseta M')
    expect(r.text).not.toContain('p-ean')
    expect(r.confirmationId).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(registerSale).not.toHaveBeenCalled()
    expect(findProductByBarcode).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'emp-2' }),
      BARCODE_EAN,
    )
  })

  it('recusas nao gravam confirmacao nem mutam catalogo — T016', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const findProductByBarcode = vi.fn(async () => undefined)
    const runtime = createAgentRuntime({
      useCases: casosFoto({ registerSale, findProductByBarcode }),
    })
    const put = vi.spyOn(runtime.confirmations, 'put')
    const chave = 'app:emp-1:user-1'

    await processMessage(runtime, fotoRefusalMsg())
    await processMessage(
      runtime,
      msg({ text: '', image: { mimeType: 'image/jpeg', bytes: new Uint8Array() } }),
    )
    await processMessage(
      runtime,
      msg({
        text: '',
        image: {
          mimeType: 'image/png',
          bytes: bytesFromMarker(`${BARCODE_EAN}\n${BARCODE_DESCONHECIDO}`),
        },
      }),
    )

    expect(put).not.toHaveBeenCalled()
    expect(registerSale).not.toHaveBeenCalled()
    expect(findProductByBarcode).toHaveBeenCalled()
    expect(await runtime.confirmations.getOpen('emp-1', chave, agora)).toBeUndefined()
  })
})

describe('processMessage — cadastro por foto (NR-116 US3 / T017)', () => {
  it('codigo desconhecido + cadastra este devolve o codigo sem venda nem rascunho', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const findProductByBarcode = vi.fn(async () => undefined)
    const runtime = createAgentRuntime({
      useCases: casosFoto({ registerSale, findProductByBarcode }),
    })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const r = await processMessage(runtime, fotoRefusalMsg({ text: 'cadastra este' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toBe(TEXTO_FOTO_CADASTRO_CODIGO(BARCODE_DESCONHECIDO))
    expect(r.text).toContain(BARCODE_DESCONHECIDO)
    expect(r.confirmationId).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(registerSale).not.toHaveBeenCalled()
    expect(pegarRascunhoFoto('emp-1', 'app:emp-1:user-1')).toBeUndefined()

    const tardio = await processMessage(runtime, msg({ text: 'no pix' }))
    expect(tardio.kind).not.toBe('confirmation')
    expect(registerSale).not.toHaveBeenCalled()
  })

  it('produto existente + cadastra este avisa sem venda nem duplicar', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const r = await processMessage(runtime, fotoMsg({ text: 'cadastra este' }))

    expect(r.kind).toBe('answer')
    expect(r.text).toBe(TEXTO_FOTO_CADASTRO_PRODUTO_EXISTENTE('Camiseta M'))
    expect(r.text).toContain('Camiseta M')
    expect(r.confirmationId).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(registerSale).not.toHaveBeenCalled()
    expect(pegarRascunhoFoto('emp-1', 'app:emp-1:user-1')).toBeUndefined()
  })

  it('produto existente + no pix segue rota de venda US1 — regressao', async () => {
    const registerSale = vi.fn(casos().registerSale)
    const runtime = createAgentRuntime({ useCases: casosFoto({ registerSale }) })

    const r = await processMessage(runtime, fotoMsg({ text: 'no pix' }))

    expect(r.kind).toBe('confirmation')
    expect(r.confirmationId).toBeDefined()
    expect(r.text).toMatch(/Confirma\?/)
    expect(registerSale).not.toHaveBeenCalled()
  })
})

describe('processMessage — foto do codigo (NR-116 T006)', () => {
  it('texto so continua chamando o LLM', async () => {
    const decide = vi.fn(async () => ({ type: 'unknown' as const }))
    const llm: LlmPort = { decide }
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    await processMessage(runtime, msg({ text: 'quanto vendi hoje?' }))
    expect(decide).toHaveBeenCalledOnce()
  })

  it('foto presente nao chama llm.decide', async () => {
    const decide = vi.fn(async () => ({ type: 'unknown' as const }))
    const llm: LlmPort = { decide }
    const runtime = createAgentRuntime({ useCases: casos(), llm })
    const bytes = bytesFromMarker('7891234567895')
    await processMessage(
      runtime,
      msg({
        text: '',
        image: { mimeType: 'image/jpeg', bytes },
      }),
    )
    expect(decide).not.toHaveBeenCalled()
  })

  it('historico grava [foto do codigo] sem base64', async () => {
    const store = new InMemoryConversationStore()
    const runtime = createAgentRuntime({ useCases: casos(), conversations: store })
    const marker = '7891234567895'
    const dataBase64 = Buffer.from(marker, 'utf-8').toString('base64')
    await processMessage(
      runtime,
      msg({
        text: '',
        image: { mimeType: 'image/jpeg', bytes: bytesFromMarker(marker) },
      }),
    )
    const ativo = await store.loadActive(ctx.companyId, 'app:emp-1:user-1', agora)
    expect(ativo?.messages[0]?.body).toBe(`[foto do codigo] ${marker}`)
    expect(ativo?.messages[0]?.body).not.toContain(dataBase64)
    expect(ativo?.messages[0]?.body).not.toContain('data:')
  })
})

describe('processMessage — privacidade da foto (NR-116 T022)', () => {
  it('turno com foto nao persiste dataBase64 nem bytes crus no historico', async () => {
    const store = new InMemoryConversationStore()
    const runtime = createAgentRuntime({
      useCases: casosFoto(),
      conversations: store,
    })
    const bytes = bytesFromMarker(BARCODE_EAN)
    const dataBase64 = Buffer.from(bytes).toString('base64')

    await processMessage(runtime, fotoMsg())

    const ativo = await store.loadActive(ctx.companyId, 'app:emp-1:user-1', agora)
    expect(ativo?.messages.length).toBeGreaterThan(0)

    const corpos = (ativo?.messages ?? []).map((m) => m.body)
    expect(corpos.some((body) => body.includes('[foto do codigo]'))).toBe(true)

    for (const body of corpos) {
      expect(body).not.toContain('dataBase64')
      expect(body).not.toContain(dataBase64)
      expect(body).not.toContain('data:')
      expect(Buffer.from(body, 'utf-8')).not.toEqual(Buffer.from(bytes))
    }

    const serializado = JSON.stringify(ativo)
    expect(serializado).not.toContain(dataBase64)
    expect(serializado).not.toMatch(/data:image\//)
  })
})

describe('processMessage — NR-117 polish (RF-010 / FR-012)', () => {
  const pedidoProduto = 'cadastra camiseta M custo 20 vende 49,90'
  const argsProduto = {
    description: 'camiseta m',
    unitOfMeasure: 'un' as const,
    costPriceCents: 2_000,
    salePriceCents: 4_990,
    stock: 0,
    minStock: 0,
  }
  const pedidoAluguel = 'lança aluguel 1800 vence dia 10'
  const pedidoRecebivel = 'a receber 500 do João na sexta, aluguel vitrine'

  function contextoEmpresa(companyId: string, userId: string): ExecutionContext {
    return { ...ctx, companyId, userId, requestId: `req-${companyId}` }
  }

  it('sim da loja B nao chama registerProduct da loja A — T020 / SC-007', async () => {
    const store = new InMemoryConfirmations()
    let gravacoesA = 0
    let gravacoesB = 0
    const llmA = new FakeLlm()
    llmA.script(pedidoProduto, { type: 'tool', name: 'create_product', args: argsProduto })
    const llmB = new FakeLlm()
    llmB.script(pedidoProduto, { type: 'tool', name: 'create_product', args: argsProduto })
    const runtimeA = createAgentRuntime({
      useCases: casos({
        registerProduct: async () => {
          gravacoesA += 1
          return produtoSaida()
        },
      }),
      llm: llmA,
      confirmations: store,
    })
    const runtimeB = createAgentRuntime({
      useCases: casos({
        registerProduct: async () => {
          gravacoesB += 1
          return produtoSaida()
        },
      }),
      llm: llmB,
      confirmations: store,
    })
    const ctxA = contextoEmpresa('emp-a', 'user-a')
    const ctxB = contextoEmpresa('emp-b', 'user-b')

    const propostaA = await processMessage(runtimeA, msg({ text: pedidoProduto, ctx: ctxA }))
    expect(propostaA.kind).toBe('confirmation')
    expect(gravacoesA).toBe(0)

    const simB = await processMessage(runtimeB, msg({ text: 'sim', ctx: ctxB }))
    expect(gravacoesA).toBe(0)
    expect(gravacoesB).toBe(0)
    expect(simB.kind).not.toBe('confirmation')
    expect(simB.text).not.toBe(propostaA.text)

    const feitoA = await processMessage(runtimeA, msg({ text: 'sim', ctx: ctxA }))
    expect(feitoA.kind).toBe('answer')
    expect(feitoA.text).toMatch(/cadastrado/)
    expect(gravacoesA).toBe(1)
    expect(gravacoesB).toBe(0)
  })

  it('sim da loja B nao chama createPayable da loja A — T020 / SC-007', async () => {
    const store = new InMemoryConfirmations()
    let gravacoesA = 0
    let gravacoesB = 0
    const llmA = new FakeLlm()
    const llmB = new FakeLlm()
    const runtimeA = createAgentRuntime({
      useCases: casos({
        createPayable: async () => {
          gravacoesA += 1
          return [contaPagarSaida()]
        },
      }),
      llm: llmA,
      confirmations: store,
    })
    const runtimeB = createAgentRuntime({
      useCases: casos({
        createPayable: async () => {
          gravacoesB += 1
          return [contaPagarSaida()]
        },
      }),
      llm: llmB,
      confirmations: store,
    })
    const ctxA = contextoEmpresa('emp-a', 'user-a')
    const ctxB = contextoEmpresa('emp-b', 'user-b')

    await processMessage(runtimeA, msg({ text: pedidoAluguel, ctx: ctxA }))
    expect(gravacoesA).toBe(0)

    const simB = await processMessage(runtimeB, msg({ text: 'sim', ctx: ctxB }))
    expect(gravacoesA).toBe(0)
    expect(gravacoesB).toBe(0)
    expect(simB.kind).not.toBe('confirmation')

    const feitoA = await processMessage(runtimeA, msg({ text: 'sim', ctx: ctxA }))
    expect(feitoA.kind).toBe('answer')
    expect(gravacoesA).toBe(1)
    expect(gravacoesB).toBe(0)
  })

  it('sim da loja B nao chama createReceivable da loja A — T020 / SC-007', async () => {
    const store = new InMemoryConfirmations()
    let gravacoesA = 0
    let gravacoesB = 0
    const llmA = new FakeLlm()
    const llmB = new FakeLlm()
    const runtimeA = createAgentRuntime({
      useCases: casos({
        createReceivable: async () => {
          gravacoesA += 1
          return recebivelSaida()
        },
      }),
      llm: llmA,
      confirmations: store,
    })
    const runtimeB = createAgentRuntime({
      useCases: casos({
        createReceivable: async () => {
          gravacoesB += 1
          return recebivelSaida()
        },
      }),
      llm: llmB,
      confirmations: store,
    })
    const ctxA = contextoEmpresa('emp-a', 'user-a')
    const ctxB = contextoEmpresa('emp-b', 'user-b')

    await processMessage(runtimeA, msg({ text: pedidoRecebivel, ctx: ctxA }))
    expect(gravacoesA).toBe(0)

    const simB = await processMessage(runtimeB, msg({ text: 'sim', ctx: ctxB }))
    expect(gravacoesA).toBe(0)
    expect(gravacoesB).toBe(0)
    expect(simB.kind).not.toBe('confirmation')

    const feitoA = await processMessage(runtimeA, msg({ text: 'sim', ctx: ctxA }))
    expect(feitoA.kind).toBe('answer')
    expect(gravacoesA).toBe(1)
    expect(gravacoesB).toBe(0)
  })

  it('pendencia create_product + mensagem de pagar + sim nao grava produto nem conta — T020a', async () => {
    const registerProduct = vi.fn(casos().registerProduct)
    const createPayable = vi.fn(casos().createPayable)
    const llm = new FakeLlm()
    llm.script(pedidoProduto, { type: 'tool', name: 'create_product', args: argsProduto })
    const runtime = createAgentRuntime({
      useCases: casos({ registerProduct, createPayable }),
      llm,
    })
    const put = vi.spyOn(runtime.confirmations, 'put')

    const proposta = await processMessage(runtime, msg({ text: pedidoProduto }))
    expect(proposta.kind).toBe('confirmation')
    expect(proposta.text).toMatch(/Cadastrar produto camiseta m/i)

    const interrupt = await processMessage(runtime, msg({ text: pedidoAluguel }))
    expect(interrupt.kind).toBe('answer')
    expect(interrupt.text).toMatch(/Nao entendi como confirmacao|cancelei/i)
    expect(registerProduct).not.toHaveBeenCalled()
    expect(createPayable).not.toHaveBeenCalled()

    const sim = await processMessage(runtime, msg({ text: 'sim' }))
    expect(sim.kind).not.toBe('confirmation')
    expect(sim.confirmationId).toBeUndefined()
    expect(registerProduct).not.toHaveBeenCalled()
    expect(createPayable).not.toHaveBeenCalled()
    expect(put).toHaveBeenCalledTimes(1)
    expect(await runtime.confirmations.getOpen('emp-1', 'app:emp-1:user-1', agora)).toBeUndefined()
  })

  it('perfil somente leitura recusa create_product apos sim — T020b', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(pedidoProduto, { type: 'tool', name: 'create_product', args: argsProduto })
    const ctxReadOnly: ExecutionContext = { ...ctx, role: 'accountant' }
    const runtime = createAgentRuntime({
      useCases: casos({
        registerProduct: async (c) => {
          assertCanWrite(c)
          chamadas += 1
          return produtoSaida()
        },
      }),
      llm,
    })

    const proposta = await processMessage(runtime, msg({ text: pedidoProduto, ctx: ctxReadOnly }))
    expect(proposta.kind).toBe('confirmation')
    expect(chamadas).toBe(0)

    const r = await processMessage(runtime, msg({ text: 'sim', ctx: ctxReadOnly }))
    expect(r.kind).toBe('clarify')
    expect(r.text).toMatch(/somente de leitura/i)
    expect(r.confirmationId).toBeUndefined()
    expect(chamadas).toBe(0)
  })

  it('falha do core apos sim nao abre segunda confirmacao — T020c', async () => {
    let chamadas = 0
    const llm = new FakeLlm()
    llm.script(pedidoProduto, { type: 'tool', name: 'create_product', args: argsProduto })
    const runtime = createAgentRuntime({
      useCases: casos({
        registerProduct: async () => {
          chamadas += 1
          throw AppError.conflict('Nao foi possivel gravar o produto agora.')
        },
      }),
      llm,
    })
    const put = vi.spyOn(runtime.confirmations, 'put')

    await processMessage(runtime, msg({ text: pedidoProduto }))
    expect(put).toHaveBeenCalledTimes(1)

    const r = await processMessage(runtime, msg({ text: 'sim' }))
    expect(r.kind).toBe('clarify')
    expect(r.text).toContain('Nao foi possivel gravar o produto agora.')
    expect(r.confirmationId).toBeUndefined()
    expect(chamadas).toBe(1)
    expect(put).toHaveBeenCalledTimes(1)
  })
})
