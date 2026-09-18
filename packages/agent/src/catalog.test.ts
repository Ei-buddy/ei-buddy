import {
  catalogInputSchema,
  createCustomerInputSchema,
  createSaleInputSchema,
  dreInputSchema,
  sendChargeInputSchema,
  type CustomerOutput,
  type DreOutput,
  type ProductOutput,
} from '@na-regua/contracts'
import type { ExecutionContext, RegisterSaleResult } from '@na-regua/core'
import { describe, expect, it, vi } from 'vitest'
import {
  createToolCatalog,
  textoDasCapacidades,
  TEXTO_RECUSA_BANCO,
  TEXTO_RECUSA_CERTIFICADO,
  TEXTO_RECUSA_NOTA,
  type AgentUseCases,
} from './catalog.js'
import { parseToolArgs } from './define-tool.js'
import { formatarCentavos } from './format.js'

const ctx: ExecutionContext = {
  companyId: 'emp-1',
  userId: 'user-1',
  role: 'owner',
  channel: 'app',
  requestId: 'req-1',
  now: new Date('2026-09-11T15:00:00.000Z'),
}

const casos: AgentUseCases = {
  listSales: async () => {
    throw new Error('nao executa neste teste')
  },
  listReceivables: async () => {
    throw new Error('nao executa neste teste')
  },
  registerCustomer: async () => {
    throw new Error('nao executa neste teste')
  },
  registerSale: async () => {
    throw new Error('nao executa neste teste')
  },
  searchProducts: async () => [],
  revenueByMonth: async () => ({
    from: '2026-09-01',
    to: '2026-09-30',
    months: [],
    totalNetCents: 0,
  }),
  buildDre: async () => {
    throw new Error('nao executa neste teste')
  },
  sendCustomerCharge: async () => {
    throw new Error('nao executa neste teste')
  },
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

describe('textoDasCapacidades — RF-097', () => {
  it('lista so as tools do catalogo atual, sem roadmap US-065–067', () => {
    const tools = createToolCatalog(casos)
    const texto = textoDasCapacidades(tools)

    for (const tool of tools) {
      expect(texto).toContain(tool.id)
      expect(texto).toContain(tool.description)
    }

    expect(texto).not.toMatch(/US-065|US-066|US-067/i)
    expect(texto).not.toMatch(/estoque|contas a pagar|saldo de carteira/i)
    expect(texto).not.toMatch(/em breve|proxima fatia|roadmap|vai poder/i)
  })
})

describe('list_sales / list_receivables — US2', () => {
  it('list_sales chama listSales do AgentUseCases e formata os centavos dele', async () => {
    const saida = {
      sales: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: {
        salesCount: 2,
        grossCents: 10_000,
        netCents: 9_800,
        cardFeeCents: 200,
        netAfterFeesCents: 9_600,
        averageTicketCents: 4_900,
      },
    }
    const listSales = vi.fn(async () => saida)
    const tools = createToolCatalog({ ...casos, listSales })
    const tool = tools.find((t) => t.id === 'list_sales')
    expect(tool).toBeDefined()

    const input = { from: '2026-09-11', to: '2026-09-11' }
    const out = await tool!.execute(input, ctx)

    expect(listSales).toHaveBeenCalledOnce()
    expect(listSales).toHaveBeenCalledWith(ctx, input)
    expect(out).toBe(saida)
    const texto = tool!.formatReply(out)
    expect(texto).toContain('2 vendas')
    expect(texto).toContain(formatarCentavos(10_000))
    expect(texto).toContain(formatarCentavos(9_600))
    expect(texto).toContain(formatarCentavos(4_900))
  })

  it('list_receivables chama listReceivables do AgentUseCases e formata o aberto', async () => {
    const saida = {
      grupos: [
        {
          faixa: 'overdue' as const,
          totalCents: 3_500,
          receivables: [
            {
              id: 'r1',
              saleId: null,
              customerId: 'c1',
              customerName: 'Maria',
              description: 'Fiado',
              amountCents: 3_500,
              netAmountCents: 3_500,
              settledAmountCents: 0,
              dueDate: '2026-09-01',
              installmentNumber: 1,
              installmentCount: 1,
              status: 'open' as const,
              createdAt: '2026-08-01T12:00:00.000Z',
            },
          ],
        },
        { faixa: 'today' as const, totalCents: 0, receivables: [] },
        { faixa: 'week' as const, totalCents: 0, receivables: [] },
        { faixa: 'month' as const, totalCents: 0, receivables: [] },
        { faixa: 'later' as const, totalCents: 0, receivables: [] },
      ],
      totalCents: 3_500,
      temVencidas: true,
    }
    const listReceivables = vi.fn(async () => saida)
    const tools = createToolCatalog({ ...casos, listReceivables })
    const tool = tools.find((t) => t.id === 'list_receivables')
    expect(tool).toBeDefined()

    const out = await tool!.execute({}, ctx)

    expect(listReceivables).toHaveBeenCalledOnce()
    expect(listReceivables).toHaveBeenCalledWith(ctx)
    expect(out).toBe(saida)
    const texto = tool!.formatReply(out)
    expect(texto).toContain('Maria')
    expect(texto).toContain(formatarCentavos(3_500))
    expect(texto).toContain('2026-09-01')
  })

  it('nao inventa tools de estoque, a pagar ou saldo — NR-115 fora desta fatia', () => {
    const ids = createToolCatalog(casos).map((t) => t.id)
    expect(ids).toContain('list_sales')
    expect(ids).toContain('list_receivables')
    expect(ids).not.toEqual(expect.arrayContaining(['list_stock', 'list_payables', 'list_wallet']))
  })
})

describe('mutatesValue — FR-002 / US4', () => {
  it('leituras e recusas nao mutam; cadastro, venda e cobranca mutam', () => {
    const flags = Object.fromEntries(createToolCatalog(casos).map((t) => [t.id, t.mutatesValue]))
    expect(flags).toEqual({
      list_sales: false,
      list_receivables: false,
      search_products: false,
      period_summary: false,
      revenue_by_month: false,
      create_customer: true,
      create_sale: true,
      send_charge: true,
      refuse_certificate: false,
      refuse_banking: false,
      refuse_invoice_command: false,
    })
  })
})

function cliente(over: Partial<CustomerOutput> = {}): CustomerOutput {
  return {
    id: 'cli-1',
    name: 'Joao',
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
    createdAt: '2026-09-11T15:00:00.000Z',
    anonymizedAt: null,
    ...over,
  }
}

describe('create_customer — US3 / US-048', () => {
  it('usa createCustomerInputSchema de contracts e mutatesValue', () => {
    const tool = createToolCatalog(casos).find((t) => t.id === 'create_customer')
    expect(tool).toBeDefined()
    expect(tool!.mutatesValue).toBe(true)
    expect(tool!.inputSchema).toBe(createCustomerInputSchema)
  })

  it('resume nome e telefone na proposta e cadastra pelo registerCustomer', async () => {
    const created = cliente()
    const registerCustomer = vi.fn(async () => ({
      status: 'created' as const,
      customer: created,
    }))
    const tools = createToolCatalog({ ...casos, registerCustomer })
    const tool = tools.find((t) => t.id === 'create_customer')!
    const input = { name: 'Joao', phone: '11988887777' }

    const out = await tool.execute(input, ctx)

    expect(registerCustomer).toHaveBeenCalledOnce()
    expect(registerCustomer).toHaveBeenCalledWith(ctx, input)
    expect(tool.formatProposal(input)).toBe('Cadastrar cliente Joao, telefone 11988887777')
    expect(tool.formatReply(out)).toBe('Cliente Joao cadastrado.')
  })

  it('formata duplicate_found com os candidatos do core — RF-099', () => {
    const tool = createToolCatalog(casos).find((t) => t.id === 'create_customer')!
    const texto = tool.formatReply({
      status: 'duplicate_found',
      candidates: [
        cliente({ id: 'cli-a', name: 'Joao Silva' }),
        cliente({ id: 'cli-b', name: 'Joao Souza', phone: '11988887777' }),
      ],
    })
    expect(texto).toMatch(/Ja existe cadastro parecido/i)
    expect(texto).toContain('Joao Silva')
    expect(texto).toContain('Joao Souza')
    expect(texto).toMatch(/reutilize o existente/i)
  })
})

function produto(over: Partial<ProductOutput> = {}): ProductOutput {
  return {
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
    ...over,
  }
}

function vendaRegistrada(over: Partial<RegisterSaleResult['sale']> = {}): RegisterSaleResult {
  return {
    sale: {
      id: 's1',
      number: 1042,
      grossAmountCents: 9_980,
      costAmountCents: 4_000,
      taxAmountCents: 0,
      cardFeeAmountCents: 480,
      netAmountCents: 9_500,
      changeCents: 0,
      createdAt: '2026-09-11T15:00:00.000Z',
      ...over,
    },
    replayed: false,
    stockWarnings: [],
  }
}

describe('create_sale / search_products — US4 / US-049', () => {
  const entradaVenda = {
    items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
    payments: [{ method: 'cash' as const, amountCents: 10_000 }],
  }

  it('create_sale usa createSaleInputSchema de contracts e mutatesValue', () => {
    const tool = createToolCatalog(casos).find((t) => t.id === 'create_sale')
    expect(tool).toBeDefined()
    expect(tool!.mutatesValue).toBe(true)
    expect(tool!.inputSchema).toBe(createSaleInputSchema)
  })

  it('search_products usa catalogInputSchema de contracts e nao muta', () => {
    const tool = createToolCatalog(casos).find((t) => t.id === 'search_products')
    expect(tool).toBeDefined()
    expect(tool!.mutatesValue).toBe(false)
    expect(tool!.inputSchema).toBe(catalogInputSchema)
  })

  it('create_sale chama registerSale do AgentUseCases e exibe o liquido do core', async () => {
    const saida = vendaRegistrada()
    const registerSale = vi.fn(async () => saida)
    const tools = createToolCatalog({ ...casos, registerSale })
    const tool = tools.find((t) => t.id === 'create_sale')!

    const out = await tool.execute(entradaVenda, ctx)

    expect(registerSale).toHaveBeenCalledOnce()
    expect(registerSale).toHaveBeenCalledWith(ctx, entradaVenda)
    expect(out).toBe(saida)

    const proposta = tool.formatProposal(entradaVenda)
    expect(proposta).toContain('2x p-azul')
    expect(proposta).toContain(formatarCentavos(4_990))
    expect(proposta).toContain('cash')
    expect(proposta).toContain(formatarCentavos(10_000))
    /* 2 * 4_990 = 9_980 — o agente nao multiplica; so exibe centavos ja dados. */
    expect(proposta).not.toContain(formatarCentavos(9_980))

    const texto = tool.formatReply(out)
    expect(texto).toContain('#1042')
    expect(texto).toContain(formatarCentavos(9_500))
    expect(texto).not.toContain(formatarCentavos(9_980))
  })

  it('search_products chama searchProducts e lista precos do core', async () => {
    const encontrados = [
      produto(),
      produto({ id: 'p-branca', description: 'Camiseta M branca', salePriceCents: 5_490 }),
    ]
    const searchProducts = vi.fn(async () => encontrados)
    const tools = createToolCatalog({ ...casos, searchProducts })
    const tool = tools.find((t) => t.id === 'search_products')!
    const input = { q: 'camiseta' }

    const out = await tool.execute(input, ctx)

    expect(searchProducts).toHaveBeenCalledOnce()
    expect(searchProducts).toHaveBeenCalledWith(ctx, input)
    expect(out).toBe(encontrados)

    const texto = tool.formatReply(out)
    expect(texto).toMatch(/mais de um/i)
    expect(texto).toContain('p-azul')
    expect(texto).toContain('p-branca')
    expect(texto).toContain(formatarCentavos(4_990))
    expect(texto).toContain(formatarCentavos(5_490))
  })

  it('fiado sem cliente e recusado pelo mesmo schema da API — RF-136', () => {
    const tool = createToolCatalog(casos).find((t) => t.id === 'create_sale')!
    expect(() =>
      parseToolArgs(tool.inputSchema, {
        items: [{ productId: 'p-azul', quantity: 1, unitPriceCents: 4_990 }],
        payments: [{ method: 'wallet', amountCents: 4_990 }],
      }),
    ).toThrow(/entender os dados/)
  })
})

describe('period_summary — US6 / RF-108', () => {
  it('usa dreInputSchema de contracts e nao muta', () => {
    const tool = createToolCatalog(casos).find((t) => t.id === 'period_summary')
    expect(tool).toBeDefined()
    expect(tool!.mutatesValue).toBe(false)
    expect(tool!.inputSchema).toBe(dreInputSchema)
  })

  it('chama buildDre e exibe os quatro eixos com os centavos do core', async () => {
    const saida = dreSaida({
      lines: [
        {
          accountId: 'acc-1',
          accountName: 'Vendas',
          type: 'revenue',
          amountCents: 95_000,
          entryCount: 3,
        },
      ],
    })
    const buildDre = vi.fn(async () => saida)
    const tools = createToolCatalog({ ...casos, buildDre })
    const tool = tools.find((t) => t.id === 'period_summary')!
    const input = { from: '2026-09-01', to: '2026-09-30' }

    const out = await tool.execute(input, ctx)

    expect(buildDre).toHaveBeenCalledOnce()
    expect(buildDre).toHaveBeenCalledWith(ctx, input)
    expect(out).toBe(saida)

    const texto = tool.formatReply(out)
    expect(texto).toContain('Faturamento')
    expect(texto).toContain('Custo')
    expect(texto).toContain('Despesas')
    expect(texto).toContain('Resultado')
    expect(texto).toContain(formatarCentavos(95_000))
    expect(texto).toContain(formatarCentavos(40_000))
    expect(texto).toContain(formatarCentavos(20_000))
    expect(texto).toContain(formatarCentavos(12_345))
    expect(texto).toContain('Vendas')
    expect(texto).not.toContain(formatarCentavos(35_000))
    expect(texto).not.toMatch(/https?:\/\//)
  })
})

describe('send_charge — US5 / US-052', () => {
  it('usa sendChargeInputSchema de contracts e mutatesValue', () => {
    const tool = createToolCatalog(casos).find((t) => t.id === 'send_charge')
    expect(tool).toBeDefined()
    expect(tool!.mutatesValue).toBe(true)
    expect(tool!.inputSchema).toBe(sendChargeInputSchema)
  })

  it('chama sendCustomerCharge e formata os centavos do core', async () => {
    const saida = {
      status: 'sent' as const,
      customerName: 'Joao',
      amountCents: 5_000,
      to: '5511988887777',
    }
    const sendCustomerCharge = vi.fn(async () => saida)
    const tools = createToolCatalog({ ...casos, sendCustomerCharge })
    const tool = tools.find((t) => t.id === 'send_charge')!
    const input = { customerId: 'cli-1' }

    const out = await tool.execute(input, ctx)

    expect(sendCustomerCharge).toHaveBeenCalledOnce()
    expect(sendCustomerCharge).toHaveBeenCalledWith(ctx, input)
    expect(out).toBe(saida)
    expect(tool.formatProposal(input)).toBe('Enviar cobranca para cliente cli-1')
    expect(tool.formatReply(out)).toBe(`Cobranca de ${formatarCentavos(5_000)} enviada para Joao.`)
  })

  it('sem divida informa e deixa claro que nada foi enviado', () => {
    const tool = createToolCatalog(casos).find((t) => t.id === 'send_charge')!
    expect(tool.formatReply({ status: 'nothing_to_charge', customerName: 'Joao' })).toBe(
      'Joao nao tem divida em aberto. Nada foi enviado.',
    )
  })
})

describe('refuse_* — US7 / RF-149–151', () => {
  const recusas = [
    {
      id: 'refuse_certificate',
      texto: TEXTO_RECUSA_CERTIFICADO,
      rf: 'RF-149',
    },
    {
      id: 'refuse_banking',
      texto: TEXTO_RECUSA_BANCO,
      rf: 'RF-150',
    },
    {
      id: 'refuse_invoice_command',
      texto: TEXTO_RECUSA_NOTA,
      rf: 'RF-151',
    },
  ] as const

  it.each(recusas)(
    '$id usa input vazio strict, nao muta e nao chama core — $rf',
    async (recusa) => {
      const listSales = vi.fn(casos.listSales)
      const listReceivables = vi.fn(casos.listReceivables)
      const registerCustomer = vi.fn(casos.registerCustomer)
      const registerSale = vi.fn(casos.registerSale)
      const searchProducts = vi.fn(casos.searchProducts)
      const revenueByMonth = vi.fn(casos.revenueByMonth)
      const buildDre = vi.fn(casos.buildDre)
      const sendCustomerCharge = vi.fn(casos.sendCustomerCharge)
      const tools = createToolCatalog({
        listSales,
        listReceivables,
        registerCustomer,
        registerSale,
        searchProducts,
        revenueByMonth,
        buildDre,
        sendCustomerCharge,
      })
      const tool = tools.find((t) => t.id === recusa.id)
      expect(tool).toBeDefined()
      expect(tool!.mutatesValue).toBe(false)
      expect(() => parseToolArgs(tool!.inputSchema, {})).not.toThrow()
      expect(() => parseToolArgs(tool!.inputSchema, { reason: 'x' })).toThrow(/entender os dados/)

      const out = await tool!.execute({}, ctx)

      expect(out).toEqual({})
      expect(tool!.formatReply(out)).toBe(recusa.texto)
      expect(recusa.texto).toMatch(/aplicativo/i)
      expect(listSales).not.toHaveBeenCalled()
      expect(listReceivables).not.toHaveBeenCalled()
      expect(registerCustomer).not.toHaveBeenCalled()
      expect(registerSale).not.toHaveBeenCalled()
      expect(searchProducts).not.toHaveBeenCalled()
      expect(revenueByMonth).not.toHaveBeenCalled()
      expect(buildDre).not.toHaveBeenCalled()
      expect(sendCustomerCharge).not.toHaveBeenCalled()
    },
  )
})
