import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryConfirmations } from '@na-regua/agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A logica dos tres desfechos de `checkIsolation`.
 *
 * Vale um teste porque e facil de inverter, e inverter tem consequencia
 * assimetrica: tratar `bypassed` como `unknown` faz a api subir servindo dados
 * de todas as lojas — que foi o estado real de um ambiente ate a CI notar.
 * Tratar `unknown` como `bypassed` so causa indisponibilidade.
 */

const vazio = vi.hoisted(() => () => ({}))

const { db, storePostgres } = vi.hoisted(() => {
  const storePostgres = { loadActive: vi.fn(), append: vi.fn() }
  return {
    storePostgres,
    db: {
      assertRlsEnforced: vi.fn(),
      getClient: vi.fn(() => ({}) as never),
      checkConnection: vi.fn(),
      closeConnection: vi.fn(),
      createSaleUnitOfWork: vi.fn(vazio),
      createSaleHistoryRepository: vi.fn(vazio),
      createCompanyRepository: vi.fn(vazio),
      createConfirmationStore: vi.fn(vazio),
      createCustomerRepository: vi.fn(vazio),
      createProductRepository: vi.fn(vazio),
      createChartOfAccountsRepository: vi.fn(vazio),
      createInventoryUnitOfWork: vi.fn(vazio),
      createAuditTrail: vi.fn(vazio),
      createPayableUnitOfWork: vi.fn(vazio),
      createPayableQueries: vi.fn(vazio),
      createReceivableRepository: vi.fn(vazio),
      createManualReceivableUnitOfWork: vi.fn(vazio),
      createReportRepository: vi.fn(vazio),
      createConversationStore: vi.fn(() => storePostgres),
    },
  }
})

const coreConsultas = vi.hoisted(() => ({
  listSales: vi.fn(),
  listReceivables: vi.fn(),
  registerSale: vi.fn(),
  searchProducts: vi.fn(),
  sendCustomerCharge: vi.fn(),
  buildDre: vi.fn(),
}))

vi.mock('@na-regua/db', () => db)

vi.mock('@na-regua/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@na-regua/core')>()
  return {
    ...actual,
    listSales: coreConsultas.listSales,
    listReceivables: coreConsultas.listReceivables,
    registerSale: coreConsultas.registerSale,
    searchProducts: coreConsultas.searchProducts,
    sendCustomerCharge: coreConsultas.sendCustomerCharge,
    buildDre: coreConsultas.buildDre,
  }
})

vi.mock('ioredis', () => ({
  Redis: class {
    status = 'ready'
    async connect(): Promise<void> {}
    async ping(): Promise<string> {
      return 'PONG'
    }
    async quit(): Promise<void> {}
  },
}))

/** O minimo que `loadApiEnv` exige, senao o modulo nem carrega. */
const AMBIENTE = {
  NODE_ENV: 'test',
  API_URL: 'http://localhost:3333',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/naregua',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'apenas-para-teste',
  AGENT_PROVIDER: 'fake',
}

/*
 * Teto generoso, e a razao nao e lentidao de teste.
 *
 * `carregar()` faz `vi.resetModules()` e reimporta `composition.js` a cada
 * caso — e o grafo dele so cresce: `core`, `db`, `banking`, `env`, `ioredis`.
 * O PRIMEIRO caso paga a transpilacao inteira e ja passou dos 5s do padrao
 * aqui, com folga cada vez menor. Um teto maior e a resposta certa: o que se
 * mede neste arquivo e a LOGICA dos tres desfechos, nunca o tempo de carga.
 */
vi.setConfig({ testTimeout: 60_000 })

async function carregar(over: Record<string, string> = {}) {
  vi.resetModules()
  vi.unstubAllEnvs()
  for (const [chave, valor] of Object.entries({ ...AMBIENTE, ...over })) {
    vi.stubEnv(chave, valor)
  }
  return import('./composition.js')
}

describe('checkIsolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('devolve enforced quando o papel nao escapa da politica', async () => {
    db.assertRlsEnforced.mockResolvedValue({
      role: 'naregua_app',
      isSuperuser: false,
      bypassesRls: false,
      enforced: true,
    })
    const { checkIsolation } = await carregar()

    expect(await checkIsolation()).toEqual({ status: 'enforced', role: 'naregua_app' })
  })

  it('devolve bypassed quando o papel ignora a politica', async () => {
    /* A mensagem e a do `assertRlsEnforced` de verdade: e por ela que os dois
       casos de falha se distinguem. */
    db.assertRlsEnforced.mockRejectedValue(
      new Error(
        'A conexao da aplicacao usa o papel "naregua", que e superusuario — e por isso ' +
          'IGNORA as politicas de RLS. O isolamento entre empresas nao estaria em vigor.',
      ),
    )
    const { checkIsolation } = await carregar()

    const r = await checkIsolation()
    /* Este e o desfecho que derruba o processo. Confundi-lo com `unknown`
       faria a api subir servindo dados de todas as lojas. */
    expect(r.status).toBe('bypassed')
  })

  it('devolve unknown quando o banco esta fora do ar', async () => {
    db.assertRlsEnforced.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
    const { checkIsolation } = await carregar()

    const r = await checkIsolation()
    /*
     * Indisponibilidade nao e falha de seguranca. Recusar subir aqui deixaria
     * nem o `/health/live` de pe, e o `/health` ja responde 503.
     */
    expect(r.status).toBe('unknown')
    if (r.status !== 'unknown') return
    expect(r.reason).toContain('ECONNREFUSED')
  })

  it('nao confunde erro de banco com configuracao errada', async () => {
    db.assertRlsEnforced.mockRejectedValue(new Error('timeout expired'))
    const { checkIsolation } = await carregar()

    expect((await checkIsolation()).status).not.toBe('bypassed')
  })
})

/**
 * A guarda que impede subir em producao com a autenticacao de desenvolvimento
 * — ADR-0002.
 *
 * Vale um teste pelo mesmo motivo de `checkIsolation`: e facil de inverter, e a
 * consequencia e assimetrica. Deixar passar publica um sistema em que
 * `AUTH_PROVIDER=fake` aceita qualquer credencial. Barrar de menos so causa
 * indisponibilidade em ambiente mal configurado, que e o que se quer.
 */
describe('assertAuthUsavelEmProducao — ADR-0002', () => {
  async function comAmbiente(over: Record<string, string>) {
    vi.resetModules()
    for (const [chave, valor] of Object.entries({ ...AMBIENTE, ...over })) {
      vi.stubEnv(chave, valor)
    }
    return import('./composition.js')
  }

  it('recusa producao com o provedor falso', async () => {
    const { assertAuthUsavelEmProducao } = await comAmbiente({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'fake',
    })

    expect(() => assertAuthUsavelEmProducao()).toThrow(/nao pode rodar em producao/)
  })

  /* A mensagem precisa dizer O QUE fazer, senao quem for acordado as 3h so
     sabe que algo esta errado. */
  it('a recusa diz o que configurar', async () => {
    const { assertAuthUsavelEmProducao } = await comAmbiente({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'fake',
    })

    expect(() => assertAuthUsavelEmProducao()).toThrow(/Defina um provedor real/)
  })

  it('aceita producao com provedor de verdade', async () => {
    const { assertAuthUsavelEmProducao } = await comAmbiente({
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'better-auth',
    })

    expect(() => assertAuthUsavelEmProducao()).not.toThrow()
  })

  /* Desenvolvimento e teste continuam com o falso — e o modo previsto pela
     ADR-0002 enquanto a DEC-009 nao escolhe entre provedor gerenciado e
     biblioteca auto-hospedada. */
  it.each(['development', 'test'])('aceita %s com o provedor falso', async (NODE_ENV) => {
    const { assertAuthUsavelEmProducao } = await comAmbiente({ NODE_ENV, AUTH_PROVIDER: 'fake' })

    expect(() => assertAuthUsavelEmProducao()).not.toThrow()
  })
})

/**
 * O assistente desliga a rota, nao a api — ADR-0010, FR-001b.
 *
 * Servir `AGENT_PROVIDER=fake` em producao publicaria um reconhecedor de tres
 * frases no lugar do modelo, entao ele continua barrado. Harness em producao
 * so com `AGENT_HARNESS=1` (staging). O teste que mais importa aqui e o
 * ultimo: nenhum destes casos pode voltar a ser excecao.
 */
describe('motivoDoAgenteIndisponivel — ADR-0010 / FR-001b', () => {
  async function comAmbiente(over: Record<string, string>) {
    vi.resetModules()
    vi.unstubAllEnvs()
    for (const [chave, valor] of Object.entries({ ...AMBIENTE, ...over })) {
      vi.stubEnv(chave, valor)
    }
    return import('./composition.js')
  }

  it('recusa servir o provedor falso em producao', async () => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'fake',
    })

    expect(motivoDoAgenteIndisponivel()).toMatch(/nao serve em producao/)
  })

  it('o motivo diz o que configurar', async () => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'fake',
    })

    expect(motivoDoAgenteIndisponivel()).toMatch(/AGENT_PROVIDER=mastra/)
  })

  it('fake em producao continua barrado mesmo com AGENT_HARNESS=1', async () => {
    const { motivoDoAgenteIndisponivel, buildAgentDeps } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'fake',
      AGENT_HARNESS: '1',
    })

    expect(motivoDoAgenteIndisponivel()).toMatch(/nao serve em producao/)
    expect(await buildAgentDeps()).toBeNull()
  })

  it('producao sem harness nao serve o canal de produto — FR-001b', async () => {
    const { motivoDoAgenteIndisponivel, buildAgentDeps } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'mastra',
      OPENAI_API_KEY: 'sk-de-teste',
    })

    expect(motivoDoAgenteIndisponivel()).toMatch(/Harness do assistente desligado/)
    expect(await buildAgentDeps()).toBeNull()
  })

  it('Mastra sem chave tambem nao serve — em vez de estourar na construcao', async () => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'mastra',
      OPENAI_API_KEY: '',
      AGENT_HARNESS: '1',
    })

    expect(motivoDoAgenteIndisponivel()).toMatch(/exige OPENAI_API_KEY/)
  })

  it('aceita producao com harness, Mastra e chave (caminho de fixture)', async () => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER: 'mastra',
      OPENAI_API_KEY: 'sk-de-teste',
      AGENT_HARNESS: '1',
    })

    expect(motivoDoAgenteIndisponivel()).toBeUndefined()
  })

  it.each(['development', 'test'])('aceita %s com o provedor falso sem flag', async (NODE_ENV) => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({ NODE_ENV, AGENT_PROVIDER: 'fake' })

    expect(motivoDoAgenteIndisponivel()).toBeUndefined()
  })

  /*
   * A regressao que este arquivo existe para impedir a partir de agora.
   *
   * Producao sem chave nenhuma foi exatamente o estado que deixou a api em
   * laco de reinicio com o front no ar: assistente ausente parando gravacao de
   * venda. Nao ha configuracao de IA que justifique derrubar o processo.
   */
  it.each([
    ['fake', ''],
    ['mastra', ''],
  ])('%s sem chave devolve motivo, e nunca lanca', async (AGENT_PROVIDER, OPENAI_API_KEY) => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_PROVIDER,
      OPENAI_API_KEY,
    })

    expect(() => motivoDoAgenteIndisponivel()).not.toThrow()
    expect(motivoDoAgenteIndisponivel()).toBeTypeOf('string')
  })
})

describe('buildAgentDeps — US2 list_sales / list_receivables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coreConsultas.listSales.mockResolvedValue({
      sales: [],
      total: 0,
      page: 1,
      pageSize: 20,
      summary: {
        salesCount: 1,
        grossCents: 10_000,
        netCents: 10_000,
        cardFeeCents: 0,
        netAfterFeesCents: 10_000,
        averageTicketCents: 10_000,
      },
    })
    coreConsultas.listReceivables.mockResolvedValue({
      grupos: [],
      totalCents: 0,
      temVencidas: false,
    })
  })

  it('tools do catalogo chamam listSales e listReceivables de core', async () => {
    const { buildAgentDeps } = await carregar({ AGENT_PROVIDER: 'fake' })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return

    const ctx = {
      companyId: 'emp-1',
      userId: 'user-1',
      role: 'owner' as const,
      channel: 'app' as const,
      requestId: 'req-1',
      now: new Date('2026-09-11T15:00:00.000Z'),
    }

    const vendas = deps.runtime.tools.find((t) => t.id === 'list_sales')
    const receber = deps.runtime.tools.find((t) => t.id === 'list_receivables')
    expect(vendas).toBeDefined()
    expect(receber).toBeDefined()

    await vendas!.execute({ from: '2026-09-11', to: '2026-09-11' }, ctx)
    expect(coreConsultas.listSales).toHaveBeenCalledOnce()
    expect(coreConsultas.listSales.mock.calls[0]?.[1]).toEqual(ctx)

    await receber!.execute({}, ctx)
    expect(coreConsultas.listReceivables).toHaveBeenCalledOnce()
    expect(coreConsultas.listReceivables.mock.calls[0]?.[1]).toEqual(ctx)
  })
})

describe('buildAgentDeps — US4 registerSale idempotencia agent:requestId', () => {
  const ctx = {
    companyId: 'emp-1',
    userId: 'user-1',
    role: 'owner' as const,
    channel: 'app' as const,
    requestId: 'req-venda-1',
    now: new Date('2026-09-11T15:00:00.000Z'),
  }

  const entrada = {
    items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
    payments: [{ method: 'pix' as const, amountCents: 9_980 }],
  }

  const saidaVenda = {
    sale: {
      id: 's1',
      number: 1042,
      grossAmountCents: 9_980,
      costAmountCents: 4_000,
      taxAmountCents: 0,
      cardFeeAmountCents: 0,
      netAmountCents: 9_980,
      changeCents: 0,
      createdAt: '2026-09-11T15:00:00.000Z',
    },
    replayed: false,
    stockWarnings: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    coreConsultas.registerSale.mockResolvedValue(saidaVenda)
    coreConsultas.searchProducts.mockResolvedValue([])
  })

  it('injeta idempotencyKey agent:requestId quando o contexto nao trouxe chave', async () => {
    const { buildAgentDeps } = await carregar({ AGENT_PROVIDER: 'fake' })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return

    const tool = deps.runtime.tools.find((t) => t.id === 'create_sale')
    expect(tool).toBeDefined()

    await tool!.execute(entrada, ctx)

    expect(coreConsultas.registerSale).toHaveBeenCalledOnce()
    const ctxPassado = coreConsultas.registerSale.mock.calls[0]?.[1]
    expect(ctxPassado).toMatchObject({
      companyId: 'emp-1',
      requestId: 'req-venda-1',
      idempotencyKey: 'agent:req-venda-1',
    })
    expect(coreConsultas.registerSale.mock.calls[0]?.[2]).toEqual(entrada)
  })

  it('preserva idempotencyKey ja presente no contexto', async () => {
    const { buildAgentDeps } = await carregar({ AGENT_PROVIDER: 'fake' })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return

    const tool = deps.runtime.tools.find((t) => t.id === 'create_sale')
    await tool!.execute(entrada, { ...ctx, idempotencyKey: 'chave-externa' })

    const ctxPassado = coreConsultas.registerSale.mock.calls[0]?.[1]
    expect(ctxPassado?.idempotencyKey).toBe('chave-externa')
  })
})

describe('buildAgentDeps — US5 sendCustomerCharge + MessageSender fake', () => {
  const ctx = {
    companyId: 'emp-1',
    userId: 'user-1',
    role: 'owner' as const,
    channel: 'app' as const,
    requestId: 'req-cobranca-1',
    now: new Date('2026-09-11T15:00:00.000Z'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    coreConsultas.sendCustomerCharge.mockResolvedValue({
      status: 'sent',
      customerName: 'Joao',
      amountCents: 5_000,
      to: '5511988887777',
    })
  })

  it('tool send_charge chama sendCustomerCharge de core', async () => {
    const { buildAgentDeps } = await carregar({ AGENT_PROVIDER: 'fake' })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return

    const tool = deps.runtime.tools.find((t) => t.id === 'send_charge')
    expect(tool).toBeDefined()
    expect(tool!.mutatesValue).toBe(true)

    const entrada = { customerId: 'cli-1' }
    await tool!.execute(entrada, ctx)

    expect(coreConsultas.sendCustomerCharge).toHaveBeenCalledOnce()
    expect(coreConsultas.sendCustomerCharge.mock.calls[0]?.[1]).toEqual(ctx)
    expect(coreConsultas.sendCustomerCharge.mock.calls[0]?.[2]).toEqual(entrada)
  })
})

describe('buildAgentDeps — US6 period_summary / buildDre', () => {
  const ctx = {
    companyId: 'emp-1',
    userId: 'user-1',
    role: 'owner' as const,
    channel: 'app' as const,
    requestId: 'req-dre-1',
    now: new Date('2026-09-11T15:00:00.000Z'),
  }

  const saidaDre = {
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
  }

  beforeEach(() => {
    vi.clearAllMocks()
    coreConsultas.buildDre.mockResolvedValue(saidaDre)
  })

  it('tool period_summary chama buildDre de core', async () => {
    const { buildAgentDeps } = await carregar({ AGENT_PROVIDER: 'fake' })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return

    const tool = deps.runtime.tools.find((t) => t.id === 'period_summary')
    expect(tool).toBeDefined()
    expect(tool!.mutatesValue).toBe(false)

    const entrada = { from: '2026-09-01', to: '2026-09-30' }
    const out = await tool!.execute(entrada, ctx)

    expect(coreConsultas.buildDre).toHaveBeenCalledOnce()
    expect(coreConsultas.buildDre.mock.calls[0]?.[1]).toEqual(ctx)
    expect(coreConsultas.buildDre.mock.calls[0]?.[2]).toEqual(entrada)
    expect(out).toEqual(saidaDre)
    expect(tool!.formatReply(out)).toContain('Faturamento')
    expect(tool!.formatReply(out)).toContain('Resultado')
  })
})

describe('buildAgentDeps — US2 ConfirmationStore Postgres', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injeta o store Postgres, nao InMemoryConfirmations, quando o harness sobe', async () => {
    const store = { put: vi.fn(), getOpen: vi.fn(), resolve: vi.fn() }
    db.createConfirmationStore.mockReturnValue(store)

    const { buildAgentDeps } = await carregar({ AGENT_PROVIDER: 'fake' })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return

    expect(db.createConfirmationStore).toHaveBeenCalled()
    expect(deps.runtime.confirmations).toBe(store)
    expect(deps.runtime.confirmations).not.toBeInstanceOf(InMemoryConfirmations)
  })
})

describe('buildAgentDeps — FixturePeerDirectory (NR-121)', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('injeta peers quando o arquivo de presets e valido', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-presets-'))
    dirs.push(dir)
    const caminho = join(dir, 'presets.json')
    writeFileSync(
      caminho,
      JSON.stringify({
        presets: [
          {
            id: 'claudia-loja-1',
            peer: '5511999000001',
            companyId: '00000000-0000-4000-8000-000000000001',
            userId: '00000000-0000-4000-8000-000000000011',
            role: 'owner',
          },
        ],
      }),
    )

    const { buildAgentDeps } = await carregar({
      AGENT_PROVIDER: 'fake',
      AGENT_STUDIO_PRESETS: caminho,
    })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return
    expect(deps.studioDirectory).toBeDefined()
    expect(deps.runtime.peers).toBe(deps.studioDirectory)
    expect(await deps.runtime.peers?.resolve('5511999000001')).toEqual({
      companyId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000011',
      role: 'owner',
    })
  })

  it('arquivo ausente: runtime HTTP segue sem peers e sem studioDirectory', async () => {
    const { buildAgentDeps } = await carregar({
      AGENT_PROVIDER: 'fake',
      AGENT_STUDIO_PRESETS: join(tmpdir(), 'nao-existe-studio-presets.json'),
    })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return
    expect(deps.studioDirectory).toBeUndefined()
    expect(deps.runtime.peers).toBeUndefined()
  })
})

describe('buildAgentDeps — NR-062 ConversationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injeta o store Postgres no runtime, nao InMemory — T043', async () => {
    const { buildAgentDeps } = await carregar({ AGENT_PROVIDER: 'fake' })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return
    expect(db.createConversationStore).toHaveBeenCalled()
    expect(deps.runtime.conversations).toBe(storePostgres)
  })
})
