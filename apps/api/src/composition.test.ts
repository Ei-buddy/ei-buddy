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
      createWhatsappConsentRepository: vi.fn(vazio),
      createCustomerContactRepository: vi.fn(vazio),
      createCustomerRepository: vi.fn(vazio),
      createProductRepository: vi.fn(vazio),
      createChartOfAccountsRepository: vi.fn(vazio),
      createInventoryUnitOfWork: vi.fn(vazio),
      /* NR-118: o agente passou a usar baixa de titulo, e `buildBaixasDeps`
         pede estes dois. Sem eles o mock derruba todo o arquivo. */
      createSaleCancellationUnitOfWork: vi.fn(vazio),
      createSaleReturnUnitOfWork: vi.fn(vazio),
      createSettlementUnitOfWork: vi.fn(vazio),
      createSettlementQueries: vi.fn(vazio),
      /* NR-119: e a agenda, pelo mesmo motivo. */
      createAppointmentRepository: vi.fn(vazio),
      createCustomerChargeRepository: vi.fn(vazio),
      createRetrievalStore: vi.fn(vazio),
      createInventoryQueries: vi.fn(() => ({ products: {} })),
      createInventoryHistory: vi.fn(vazio),
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
  checkStock: vi.fn(),
  listSales: vi.fn(),
  listPayables: vi.fn(),
  listReceivables: vi.fn(),
  registerSale: vi.fn(),
  searchProducts: vi.fn(),
  sendCustomerCharge: vi.fn(),
  buildDre: vi.fn(),
  resolveProductRef: vi.fn(async (_deps: unknown, _ctx: unknown, ref: string) => ref),
  resolveCustomerRef: vi.fn(async (_deps: unknown, _ctx: unknown, ref: string) => ref),
  searchCustomers: vi.fn(),
}))

const agente = vi.hoisted(() => ({ createAgentRuntime: vi.fn() }))

vi.mock('@na-regua/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@na-regua/agent')>()
  agente.createAgentRuntime.mockImplementation(actual.createAgentRuntime)
  return { ...actual, createAgentRuntime: agente.createAgentRuntime }
})

vi.mock('@na-regua/db', () => db)

vi.mock('@na-regua/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@na-regua/core')>()
  return {
    ...actual,
    checkStock: coreConsultas.checkStock,
    listSales: coreConsultas.listSales,
    listPayables: coreConsultas.listPayables,
    listReceivables: coreConsultas.listReceivables,
    registerSale: coreConsultas.registerSale,
    searchProducts: coreConsultas.searchProducts,
    sendCustomerCharge: coreConsultas.sendCustomerCharge,
    buildDre: coreConsultas.buildDre,
    resolveProductRef: coreConsultas.resolveProductRef,
    resolveCustomerRef: coreConsultas.resolveCustomerRef,
    searchCustomers: coreConsultas.searchCustomers,
  }
})

vi.mock('ioredis', () => ({
  Redis: class {
    status = 'ready'
    /* `getRedis` registra um ouvinte de `error` na criacao — sem isto o mock
       derruba qualquer caminho que toque Redis, e a agenda do agente (NR-119)
       passou a tocar, pelo agendador de lembrete. */
    on(): this {
      return this
    }
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
 * Sem `OPENAI_API_KEY` o runtime nao monta. Producao sem `AGENT_HARNESS=1`
 * continua desligada mesmo com a chave. Nenhum destes casos derruba o processo.
 */
describe('motivoDoAgenteIndisponivel — chave e harness', () => {
  async function comAmbiente(over: Record<string, string>) {
    vi.resetModules()
    vi.unstubAllEnvs()
    for (const [chave, valor] of Object.entries({ ...AMBIENTE, ...over })) {
      vi.stubEnv(chave, valor)
    }
    return import('./composition.js')
  }

  it.each(['development', 'test'])(
    '%s sem OPENAI_API_KEY devolve motivo e nao monta',
    async (NODE_ENV) => {
      const { motivoDoAgenteIndisponivel, buildAgentDeps } = await comAmbiente({ NODE_ENV })
      expect(() => motivoDoAgenteIndisponivel()).not.toThrow()
      const motivo = motivoDoAgenteIndisponivel()
      expect(motivo).toMatch(/OPENAI_API_KEY/)
      expect(motivo).not.toMatch(/AGENT_PROVIDER/)
      expect(await buildAgentDeps()).toBeNull()
    },
  )

  it('chave em branco e o mesmo que ausente', async () => {
    const { motivoDoAgenteIndisponivel, buildAgentDeps } = await comAmbiente({
      OPENAI_API_KEY: '   ',
    })
    expect(() => motivoDoAgenteIndisponivel()).not.toThrow()
    expect(motivoDoAgenteIndisponivel()).toMatch(/OPENAI_API_KEY/)
    expect(await buildAgentDeps()).toBeNull()
  })

  it('AGENT_PROVIDER=fake no ambiente nao religa o assistente sem chave', async () => {
    const { motivoDoAgenteIndisponivel, buildAgentDeps } = await comAmbiente({
      AGENT_PROVIDER: 'fake',
    })
    expect(motivoDoAgenteIndisponivel()).toMatch(/OPENAI_API_KEY/)
    expect(motivoDoAgenteIndisponivel()).not.toMatch(/AGENT_PROVIDER=fake/)
    expect(await buildAgentDeps()).toBeNull()
  })

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['zero', '0'],
  ] as const)('producao com chave e harness %s continua no porteiro', async (_rotulo, harness) => {
    const over: Record<string, string> = {
      NODE_ENV: 'production',
      OPENAI_API_KEY: 'sk-de-teste',
    }
    if (harness !== undefined) over.AGENT_HARNESS = harness
    const { motivoDoAgenteIndisponivel, buildAgentDeps } = await comAmbiente(over)
    expect(motivoDoAgenteIndisponivel()).toMatch(/Harness do assistente desligado/)
    expect(motivoDoAgenteIndisponivel()).not.toMatch(/AGENT_PROVIDER/)
    expect(await buildAgentDeps()).toBeNull()
  })

  it('producao com harness ligado e sem chave cita a chave, nao um modo falso', async () => {
    const { motivoDoAgenteIndisponivel, buildAgentDeps } = await comAmbiente({
      NODE_ENV: 'production',
      AGENT_HARNESS: '1',
      OPENAI_API_KEY: '',
    })
    expect(() => motivoDoAgenteIndisponivel()).not.toThrow()
    expect(motivoDoAgenteIndisponivel()).toMatch(/OPENAI_API_KEY/)
    expect(motivoDoAgenteIndisponivel()).not.toMatch(/AGENT_PROVIDER=fake/)
    expect(await buildAgentDeps()).toBeNull()
  })

  it('producao com harness e chave libera o assistente', async () => {
    const { motivoDoAgenteIndisponivel } = await comAmbiente({
      NODE_ENV: 'production',
      OPENAI_API_KEY: 'sk-de-teste',
      AGENT_HARNESS: '1',
    })
    expect(motivoDoAgenteIndisponivel()).toBeUndefined()
  })
})
describe('buildAgentDeps — modelo do Buddy quando a chave existe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fora de producao, com chave, monta o brain com AGENT_MODEL e a chave na config', async () => {
    const { buildAgentDeps } = await carregar({
      NODE_ENV: 'development',
      OPENAI_API_KEY: 'sk-de-teste',
    })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return
    expect(typeof deps.runtime.brain.conversar).toBe('function')
    expect(agente.createAgentRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { id: 'openai/gpt-5.4-mini', apiKey: 'sk-de-teste' },
      }),
    )
  })

  it('producao com AGENT_HARNESS=1 e chave tambem monta o brain', async () => {
    const { buildAgentDeps } = await carregar({
      NODE_ENV: 'production',
      AGENT_HARNESS: '1',
      OPENAI_API_KEY: 'sk-de-teste',
    })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    expect(typeof deps?.runtime.brain.conversar).toBe('function')
  })
})

describe('buildAgentUseCases — casos de uso de core com o contexto autenticado', () => {
  const ctx = {
    companyId: 'emp-1',
    userId: 'user-1',
    role: 'owner' as const,
    channel: 'app' as const,
    requestId: 'req-1',
    now: new Date('2026-09-11T15:00:00.000Z'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('consultas chamam core com o mesmo ctx — NR-115', async () => {
    coreConsultas.checkStock.mockResolvedValue({ productId: 'p-1' })
    coreConsultas.listPayables.mockResolvedValue({ grupos: [], totalCents: 0, temVencidas: false })
    coreConsultas.listSales.mockResolvedValue({ summary: {} })
    coreConsultas.listReceivables.mockResolvedValue({
      grupos: [],
      totalCents: 0,
      temVencidas: false,
    })
    coreConsultas.buildDre.mockResolvedValue({})
    const { buildAgentUseCases } = await carregar()
    const useCases = buildAgentUseCases()

    await useCases.checkStock(ctx, { productId: 'p-1' })
    await useCases.listPayables(ctx)
    await useCases.listSales(ctx, { from: '2026-09-11', to: '2026-09-11', page: 1, pageSize: 20 })
    await useCases.listReceivables(ctx)
    await useCases.buildDre(ctx, { from: '2026-09-01', to: '2026-09-30' })

    expect(coreConsultas.checkStock).toHaveBeenCalledWith(
      expect.objectContaining({ products: expect.anything() }),
      ctx,
      { productId: 'p-1' },
    )
    expect(coreConsultas.listPayables).toHaveBeenCalledWith(expect.anything(), ctx)
    expect(coreConsultas.listSales.mock.calls[0]?.[1]).toEqual(ctx)
    expect(coreConsultas.listReceivables.mock.calls[0]?.[1]).toEqual(ctx)
    expect(coreConsultas.buildDre.mock.calls[0]?.[1]).toEqual(ctx)
  })

  it('searchCustomers chama core com o termo e o limite', async () => {
    coreConsultas.searchCustomers.mockResolvedValue([])
    const { buildAgentUseCases } = await carregar()
    await buildAgentUseCases().searchCustomers(ctx, { termo: 'Joao', limite: 5 })
    expect(coreConsultas.searchCustomers).toHaveBeenCalledWith(expect.anything(), ctx, {
      termo: 'Joao',
      limite: 5,
    })
  })

  it('registerSale injeta agent:requestId quando o contexto nao trouxe chave', async () => {
    coreConsultas.registerSale.mockResolvedValue({ sale: {}, replayed: false, stockWarnings: [] })
    const { buildAgentUseCases } = await carregar()
    const entrada = {
      items: [{ productId: 'p-azul', quantity: 2, unitPriceCents: 4_990 }],
      payments: [{ method: 'pix' as const, amountCents: 9_980 }],
    }
    await buildAgentUseCases().registerSale(ctx, entrada)
    expect(coreConsultas.registerSale.mock.calls[0]?.[1]).toMatchObject({
      idempotencyKey: 'agent:req-1',
    })
    expect(coreConsultas.registerSale.mock.calls[0]?.[2]).toEqual(entrada)
  })

  it('registerSale preserva a chave da confirmacao no contexto', async () => {
    coreConsultas.registerSale.mockResolvedValue({ sale: {}, replayed: false, stockWarnings: [] })
    const { buildAgentUseCases } = await carregar()
    await buildAgentUseCases().registerSale(
      { ...ctx, idempotencyKey: 'confirmation:conf-1' },
      {
        items: [{ productId: 'p-azul', quantity: 1, unitPriceCents: 4_990 }],
        payments: [{ method: 'pix' as const, amountCents: 4_990 }],
      },
    )
    expect(coreConsultas.registerSale.mock.calls[0]?.[1]?.idempotencyKey).toBe(
      'confirmation:conf-1',
    )
  })

  it('sendCustomerCharge chama core com o ctx', async () => {
    coreConsultas.sendCustomerCharge.mockResolvedValue({ status: 'nothing_to_charge' })
    const { buildAgentUseCases } = await carregar()
    await buildAgentUseCases().sendCustomerCharge(ctx, { customerId: 'cli-1' })
    expect(coreConsultas.sendCustomerCharge.mock.calls[0]?.[1]).toEqual(ctx)
    expect(coreConsultas.sendCustomerCharge.mock.calls[0]?.[2]).toEqual({ customerId: 'cli-1' })
  })
})

describe('buildAgentDeps — US2 ConfirmationStore Postgres', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injeta o store Postgres, nao InMemoryConfirmations, quando o harness sobe', async () => {
    const store = { put: vi.fn(), getOpen: vi.fn(), resolve: vi.fn() }
    db.createConfirmationStore.mockReturnValue(store)

    const { buildAgentDeps } = await carregar({ OPENAI_API_KEY: 'sk-de-teste' })
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
      OPENAI_API_KEY: 'sk-de-teste',
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
      OPENAI_API_KEY: 'sk-de-teste',
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
    const { buildAgentDeps } = await carregar({ OPENAI_API_KEY: 'sk-de-teste' })
    const deps = await buildAgentDeps()
    expect(deps).not.toBeNull()
    if (deps === null) return
    expect(db.createConversationStore).toHaveBeenCalled()
    expect(deps.runtime.conversations).toBe(storePostgres)
  })
})
