import { agentReplySchema } from '@na-regua/contracts'
import { registerCustomer, type RegisterCustomerDeps } from '@na-regua/core'
import { createAgentRuntime, FakeLlm, type AgentUseCases } from '@na-regua/agent'
import { createConfirmationStore, getClient, migrate } from '@na-regua/db'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerSession } from '../plugins/session.js'
import { registerAgentRoutes } from '../routes/agent.js'
import { registerAuthRoutes } from '../routes/auth.js'
import { registerCadastroRoutes } from '../routes/cadastro.js'

/**
 * T041 / FR-008 — o smoke manual do quickstart NR-061, pela API de verdade.
 *
 * FakeLlm local nao reconhece cadastro (so consulta). Por isso o pedido e
 * roteirizado. O que este arquivo prova, e que o teste in-memory da rota nao
 * prova: a pendencia sobrevive a matar o Fastify. Segunda instancia = processo
 * novo; store novo no mesmo Postgres; sessao lida do banco (NR-083).
 *
 * Canal so `app` (HTTP). Nao manda `sim` numa chave `wa:` — research §4.
 *
 * Sem `DATABASE_URL` a suite e pulada, como o caminho critico.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

type Composicao = typeof import('../composition.js')

function cnpjValido(base12: string): string {
  const digito = (nums: number[], pesos: number[]): number => {
    const resto = nums.reduce((acc, n, i) => acc + n * pesos[i]!, 0) % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const base = base12.split('').map(Number)
  const d1 = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digito([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base12}${d1}${d2}`
}

const CNPJ = cnpjValido(String(Date.now()).slice(-12))
const SENHA = 'senha-de-teste'
const CADASTRO = {
  name: 'Operadora NR-061 Restart',
  email: `dona-nr061@${CNPJ}.local`,
  secret: SENHA,
  legalName: 'Barbearia Confirmacao Persistente LTDA',
  cnpj: CNPJ,
  acceptedLegalTerms: true as const,
}

const PEDIDO = 'cadastra o Joao, 11 98888-7777'
const ARGS_CADASTRO = { name: 'Joao', phone: '11 98888-7777' }

const leituraVazia: AgentUseCases = {
  listSales: async () => ({
    sales: [],
    total: 0,
    page: 1,
    pageSize: 20,
    summary: {
      salesCount: 0,
      grossCents: 0,
      netCents: 0,
      cardFeeCents: 0,
      netAfterFeesCents: 0,
      averageTicketCents: 0,
    },
  }),
  listReceivables: async () => ({ grupos: [], totalCents: 0, temVencidas: false }),
  registerCustomer: async () => {
    throw new Error('registerCustomer precisa do cadastro real')
  },
  registerSale: async () => {
    throw new Error('nao deveria vender neste smoke')
  },
  searchProducts: async () => [],
  revenueByMonth: async () => ({
    from: '2026-09-01',
    to: '2026-09-30',
    months: [],
    totalNetCents: 0,
  }),
  buildDre: async () => {
    throw new Error('nao deveria montar DRE neste smoke')
  },
  sendCustomerCharge: async () => {
    throw new Error('nao deveria cobrar neste smoke')
  },
}

describe.skipIf(!DATABASE_URL)('NR-061 T041 — HTTP proposta, restart, sim', () => {
  let composicao: Composicao
  let app: FastifyInstance | undefined
  let token: string

  const sql = () => getClient(DATABASE_URL!)

  const http = (): FastifyInstance => {
    if (app === undefined) throw new Error('API ainda nao subiu')
    return app
  }

  const comSessao = (opcoes: { method: 'GET' | 'POST'; url: string; payload?: object }) => {
    const base = {
      method: opcoes.method,
      url: opcoes.url,
      headers: { authorization: `Bearer ${token}` },
    }
    return opcoes.payload === undefined
      ? http().inject(base)
      : http().inject({ ...base, payload: opcoes.payload })
  }

  function casosComCadastroReal(): AgentUseCases {
    const cadastro: RegisterCustomerDeps = composicao.buildCadastroDeps()
    return {
      ...leituraVazia,
      registerCustomer: (ctx, input) => registerCustomer(cadastro, ctx, input),
    }
  }

  async function subir(llm: FakeLlm): Promise<void> {
    if (app !== undefined) await app.close()
    app = undefined

    const proxima = Fastify({ logger: false })
    registerErrorHandler(proxima)
    await registerRateLimit(proxima)

    const authDeps = composicao.buildAuthDeps()
    registerSession(proxima, authDeps.sessions)
    registerAuthRoutes(proxima, authDeps)
    registerCadastroRoutes(proxima, composicao.buildCadastroDeps())

    const runtime = createAgentRuntime({
      useCases: casosComCadastroReal(),
      llm,
      confirmations: createConfirmationStore(sql()),
    })
    registerAgentRoutes(proxima, { runtime })
    await proxima.ready()
    app = proxima
  }

  beforeAll(async () => {
    vi.stubEnv('API_URL', process.env.API_URL ?? 'http://localhost:3333')
    vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET ?? 'segredo-que-o-e2e-nao-usa')
    vi.stubEnv('REDIS_URL', process.env.REDIS_URL ?? 'redis://localhost:6379')
    vi.stubEnv('AGENT_PROVIDER', 'fake')

    composicao = await import('../composition.js')
    await migrate(MIGRATION_URL!)

    const llm = new FakeLlm()
    llm.script(PEDIDO, { type: 'tool', name: 'create_customer', args: ARGS_CADASTRO })
    await subir(llm)
  }, 90_000)

  afterAll(async () => {
    await app?.close()
    if (composicao !== undefined) await composicao.shutdown()
    vi.unstubAllEnvs()
  })

  it('abre a fixture e a sessao fica no banco', async () => {
    const r = await http().inject({
      method: 'POST',
      url: '/auth/signup',
      payload: CADASTRO,
    })
    expect(r.statusCode).toBe(201)
    token = r.json().token
    expect(token).toBeTruthy()
  })

  it('SC-001: mutacao devolve confirmation e nao cria cliente', async () => {
    const proposta = await comSessao({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: PEDIDO },
    })
    expect(proposta.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(proposta.body))
    expect(corpo.kind).toBe('confirmation')
    expect(corpo.text).toMatch(/Confirma\?/)

    const lista = await comSessao({ method: 'GET', url: '/clientes' })
    expect(lista.statusCode).toBe(200)
    expect(lista.json().total).toBe(0)
  })

  it('SC-003: depois de matar o processo, sim no prazo grava uma vez', async () => {
    /* Processo novo: FakeLlm vazio. "sim" nao passa pelo modelo — getOpen no
       Postgres acha a aberta. Canal continua app: (HTTP), nao wa:. */
    await subir(new FakeLlm())

    const sim = await comSessao({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'sim' },
    })
    expect(sim.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(sim.body))
    expect(corpo.kind).toBe('answer')
    expect(corpo.text).toBe('Cliente Joao cadastrado.')

    const lista = await comSessao({ method: 'GET', url: '/clientes' })
    expect(lista.json().total).toBe(1)
    expect(lista.json().customers[0]?.name).toBe('Joao')
  })

  it('segundo sim nao duplica', async () => {
    const deNovo = await comSessao({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'sim' },
    })
    expect(deNovo.statusCode).toBe(200)
    const lista = await comSessao({ method: 'GET', url: '/clientes' })
    expect(lista.json().total).toBe(1)
  })
})
