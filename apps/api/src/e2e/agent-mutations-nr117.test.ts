import { agentReplySchema } from '@na-regua/contracts'
import { createAgentRuntime } from '@na-regua/agent'
import { roteiroDoModelo } from '@na-regua/agent/test-support'
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
 * `buildAgentUseCases()`; o modelo dublê só escolhe as tools (spec 013, T057).
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

describe.skipIf(!DATABASE_URL)('NR-117 — mutacoes persistidas apos o aceite', () => {
  let composicao: Composicao
  let app: FastifyInstance | undefined
  let token: string

  const agoraMs = Date.now()
  const CNPJ = cnpjValido(String(agoraMs).slice(-12))
  const CADASTRO = {
    name: 'Operadora NR-117 Mutacoes',
    email: `dona-nr117@${CNPJ}.local`,
    secret: 'senha-de-teste',
    legalName: 'Loja Mutacoes Agent LTDA',
    cnpj: CNPJ,
    acceptedLegalTerms: true as const,
  }

  const ARGS_PRODUTO = {
    description: 'camiseta m',
    unitOfMeasure: 'un' as const,
    costPriceCents: 2_000,
    salePriceCents: 4_990,
    stock: 0,
    minStock: 0,
  }
  const ARGS_PAGAR_VENCIDA = {
    supplier: 'Aluguel',
    description: 'Aluguel',
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

  const falar = async (text: string) => {
    const r = await comSessao({ method: 'POST', url: '/agent/messages', payload: { text } })
    expect(r.statusCode).toBe(200)
    return agentReplySchema.parse(JSON.parse(r.body))
  }

  beforeAll(async () => {
    vi.stubEnv('API_URL', process.env.API_URL ?? 'http://localhost:3333')
    vi.stubEnv('JWT_SECRET', process.env.JWT_SECRET ?? 'segredo-que-o-e2e-nao-usa')
    vi.stubEnv('REDIS_URL', process.env.REDIS_URL ?? 'redis://localhost:6379')
    composicao = await import('../composition.js')
    await migrate(MIGRATION_URL!)

    const proxima = Fastify({ logger: false })
    registerErrorHandler(proxima)
    await registerRateLimit(proxima)
    const authDeps = composicao.buildAuthDeps()
    registerSession(proxima, authDeps.sessions)
    registerAuthRoutes(proxima, authDeps)
    registerCadastroRoutes(proxima, composicao.buildCadastroDeps())
    registerContasRoutes(proxima, composicao.buildContasDeps())

    const { modelo } = roteiroDoModelo([
      { tool: 'create_product', args: ARGS_PRODUTO },
      { texto: 'Vou cadastrar a camiseta m, custo R$ 20,00, venda R$ 49,90. Posso?' },
      { tool: 'accept_proposal', args: {} },
      { texto: 'Pronto, camiseta m cadastrada.' },
      { tool: 'create_payable', args: ARGS_PAGAR_VENCIDA },
      { texto: 'Vou lançar o aluguel de R$ 1.500,00 com vencimento em 2026-09-01. Posso?' },
      { tool: 'accept_proposal', args: {} },
      { texto: 'Pronto, conta do aluguel lançada.' },
      { tool: 'list_payables', args: {} },
      { texto: 'Você tem contas vencidas: o aluguel.' },
    ])
    const runtime = createAgentRuntime({
      model: modelo,
      useCases: composicao.buildAgentUseCases(),
      confirmations: createConfirmationStore(getClient(DATABASE_URL!)),
    })
    registerAgentRoutes(proxima, { runtime })
    await proxima.ready()
    app = proxima
  }, 90_000)

  afterAll(async () => {
    await app?.close()
    if (composicao !== undefined) await composicao.shutdown()
    vi.unstubAllEnvs()
  })

  it('abre a fixture e a sessao fica no banco', async () => {
    const r = await http().inject({ method: 'POST', url: '/auth/signup', payload: CADASTRO })
    expect(r.statusCode).toBe(201)
    token = r.json().token
    expect(token).toBeTruthy()
  })

  it('SC-001: aceite em cadastro de produto persiste custo e preco', async () => {
    const proposta = await falar('cadastra camiseta M custo 20 vende 49,90')
    expect(proposta.kind).toBe('confirmation')

    const antes = await comSessao({ method: 'GET', url: '/produtos?q=camiseta' })
    expect(antes.json().products).toHaveLength(0)

    expect((await falar('pode')).kind).toBe('answer')

    const depois = await comSessao({ method: 'GET', url: '/produtos?q=camiseta' })
    const lista = depois.json() as {
      products: ReadonlyArray<{
        description: string
        costPriceCents: number
        salePriceCents: number
      }>
    }
    expect(lista.products).toHaveLength(1)
    expect(lista.products[0]?.costPriceCents).toBe(2_000)
    expect(lista.products[0]?.salePriceCents).toBe(4_990)
  })

  it('SC-003: conta a pagar vencida persiste open e aparece na faixa vencidas', async () => {
    expect((await falar('lanca aluguel 1500 vence dia 1')).kind).toBe('confirmation')
    expect((await falar('sim')).kind).toBe('answer')
    expect((await falar('quanto tenho a pagar?')).kind).toBe('answer')

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
