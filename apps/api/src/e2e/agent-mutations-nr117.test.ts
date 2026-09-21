import { agentReplySchema } from '@na-regua/contracts'
import { createAgentRuntime, FakeLlm } from '@na-regua/agent'
import { createConfirmationStore, getClient, migrate } from '@na-regua/db'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerSession } from '../plugins/session.js'
import { registerAgentRoutes } from '../routes/agent.js'
import { registerAuthRoutes } from '../routes/auth.js'
import { registerCadastroRoutes } from '../routes/cadastro.js'
import { registerContasRoutes } from '../routes/contas.js'

/**
 * NR-117 T020d — paridade persistida (SC-001 / SC-003) quando `DATABASE_URL`
 * aponta para o Postgres do Compose. Mesmos casos de uso das telas via
 * `buildAgentUseCases()`; FakeLlm so roteia a intencao.
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

describe.skipIf(!DATABASE_URL)('NR-117 — mutacoes persistidas apos confirmacao', () => {
  let composicao: Composicao
  let app: FastifyInstance | undefined
  let token: string

  const agoraMs = Date.now()
  const CNPJ = cnpjValido(String(agoraMs).slice(-12))
  const SENHA = 'senha-de-teste'
  const CADASTRO = {
    name: 'Operadora NR-117 Mutacoes',
    email: `dona-nr117@${CNPJ}.local`,
    secret: SENHA,
    legalName: 'Loja Mutacoes Agent LTDA',
    cnpj: CNPJ,
    acceptedLegalTerms: true as const,
  }

  const PEDIDO_PRODUTO = 'cadastra camiseta M custo 20 vende 49,90'
  const ARGS_PRODUTO = {
    description: 'camiseta m',
    unitOfMeasure: 'un' as const,
    costPriceCents: 2_000,
    salePriceCents: 4_990,
    stock: 0,
    minStock: 0,
  }

  const PEDIDO_PAGAR_VENCIDA = 'lanca aluguel atrasado 1500 vence dia 1'
  const ARGS_PAGAR_VENCIDA = {
    supplier: 'Imobiliaria',
    description: 'Aluguel atrasado',
    amountCents: 150_000,
    dueDate: '2026-09-01',
  }

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
    registerContasRoutes(proxima, composicao.buildContasDeps())

    const runtime = createAgentRuntime({
      useCases: composicao.buildAgentUseCases(),
      llm,
      confirmations: createConfirmationStore(getClient(DATABASE_URL!)),
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
    llm.script(PEDIDO_PRODUTO, { type: 'tool', name: 'create_product', args: ARGS_PRODUTO })
    llm.script(PEDIDO_PAGAR_VENCIDA, {
      type: 'tool',
      name: 'create_payable',
      args: ARGS_PAGAR_VENCIDA,
    })
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

  it('SC-001: sim em cadastro de produto persiste custo e preco', async () => {
    const proposta = await comSessao({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: PEDIDO_PRODUTO },
    })
    expect(proposta.statusCode).toBe(200)
    const corpoProposta = agentReplySchema.parse(JSON.parse(proposta.body))
    expect(corpoProposta.kind).toBe('confirmation')
    expect(corpoProposta.text).toMatch(/Confirma\?/)

    const antes = await comSessao({ method: 'GET', url: '/produtos?q=camiseta' })
    expect(antes.statusCode).toBe(200)
    expect(antes.json().total).toBe(0)

    const sim = await comSessao({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'sim' },
    })
    expect(sim.statusCode).toBe(200)
    const corpoSim = agentReplySchema.parse(JSON.parse(sim.body))
    expect(corpoSim.kind).toBe('answer')
    expect(corpoSim.text).toMatch(/cadastrado/i)

    const depois = await comSessao({ method: 'GET', url: '/produtos?q=camiseta' })
    expect(depois.statusCode).toBe(200)
    const lista = depois.json() as {
      total: number
      products: ReadonlyArray<{
        description: string
        costPriceCents: number
        salePriceCents: number
      }>
    }
    expect(lista.total).toBe(1)
    expect(lista.products[0]?.description).toMatch(/camiseta/i)
    expect(lista.products[0]?.costPriceCents).toBe(2_000)
    expect(lista.products[0]?.salePriceCents).toBe(4_990)
  })

  it('SC-003: conta a pagar vencida persiste open e aparece na faixa vencidas', async () => {
    const proposta = await comSessao({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: PEDIDO_PAGAR_VENCIDA },
    })
    expect(proposta.statusCode).toBe(200)
    const corpoProposta = agentReplySchema.parse(JSON.parse(proposta.body))
    expect(corpoProposta.kind).toBe('confirmation')
    expect(corpoProposta.text).toMatch(/Confirma\?/)

    const sim = await comSessao({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'sim' },
    })
    expect(sim.statusCode).toBe(200)
    const corpoSim = agentReplySchema.parse(JSON.parse(sim.body))
    expect(corpoSim.kind).toBe('answer')
    expect(corpoSim.text).toContain('2026-09-01')

    const consulta = await comSessao({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto tenho a pagar?' },
    })
    expect(consulta.statusCode).toBe(200)
    const corpoConsulta = agentReplySchema.parse(JSON.parse(consulta.body))
    expect(corpoConsulta.kind).toBe('answer')
    expect(corpoConsulta.text).toMatch(/vencidas/i)

    const titulos = await comSessao({ method: 'GET', url: '/contas-a-pagar' })
    expect(titulos.statusCode).toBe(200)
    const grupos = titulos.json().grupos as ReadonlyArray<{
      faixa: string
      payables: ReadonlyArray<{ dueDate: string; status: string; amountCents: number }>
    }>
    const vencidas = grupos.find((g) => g.faixa === 'overdue')?.payables ?? []
    expect(vencidas.some((p) => p.dueDate === '2026-09-01' && p.status === 'open')).toBe(true)
    expect(vencidas.some((p) => p.amountCents === 150_000)).toBe(true)
  })
})
