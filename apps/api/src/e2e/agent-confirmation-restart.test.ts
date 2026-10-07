import { agentReplySchema } from '@na-regua/contracts'
import { registerCustomer, type RegisterCustomerDeps } from '@na-regua/core'
import { createAgentRuntime, type AgentUseCases } from '@na-regua/agent'
import {
  criarLojaDeTeste,
  roteiroDoModelo,
  type EtapaRoteirizada,
} from '@na-regua/agent/test-support'
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
 * T041 / FR-008 — a proposta sobrevive a matar o processo (NR-061), agora
 * sobre o agente de várias etapas (spec 013, T052).
 *
 * O modelo é o dublê do Mastra: ele escolhe as tools; o que se prova é o que
 * o Postgres guarda. Segunda instância = processo novo, store novo no mesmo
 * banco, sessão lida do banco (NR-083). Canal `app` (HTTP).
 *
 * Sem `DATABASE_URL` a suíte é pulada, como o caminho crítico.
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

const agoraMs = Date.now()
const CNPJ = cnpjValido(String(agoraMs).slice(-12))
const CADASTRO = {
  name: 'Operadora NR-061 Restart',
  email: `dona-nr061@${CNPJ}.local`,
  secret: 'senha-de-teste',
  legalName: 'Barbearia Confirmacao Persistente LTDA',
  cnpj: CNPJ,
  acceptedLegalTerms: true as const,
}

/* Nome e telefone únicos por execução: o banco da CI é compartilhado entre
   suítes, e buscar pelo telefone desta rodada isola o efeito do aceite. */
const NOME_CLIENTE = `Joao NR061 ${String(agoraMs).slice(-8)}`
const TELEFONE_CLIENTE = `1198${String(agoraMs).slice(-7)}`
const PEDIDO = `cadastra o ${NOME_CLIENTE}, ${TELEFONE_CLIENTE}`
const PROPOR: readonly EtapaRoteirizada[] = [
  { tool: 'create_customer', args: { name: NOME_CLIENTE, phone: TELEFONE_CLIENTE } },
  { texto: `Vou cadastrar o ${NOME_CLIENTE}. Posso confirmar?` },
]

describe.skipIf(!DATABASE_URL)('NR-061 T041 — HTTP proposta, restart, aceite', () => {
  let composicao: Composicao
  let app: FastifyInstance | undefined
  let token: string

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

  async function clientesDoPedido(): Promise<{ total: number; customers: { name: string }[] }> {
    const lista = await comSessao({
      method: 'GET',
      url: `/clientes?q=${encodeURIComponent(TELEFONE_CLIENTE)}`,
    })
    expect(lista.statusCode).toBe(200)
    return lista.json()
  }

  function casosComCadastroReal(): AgentUseCases {
    const cadastro: RegisterCustomerDeps = composicao.buildCadastroDeps()
    return {
      ...criarLojaDeTeste().useCases,
      registerCustomer: (ctx, input) => registerCustomer(cadastro, ctx, input),
    }
  }

  async function subir(etapas: readonly EtapaRoteirizada[]): Promise<void> {
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
      model: roteiroDoModelo(etapas).modelo,
      useCases: casosComCadastroReal(),
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
    composicao = await import('../composition.js')
    await migrate(MIGRATION_URL!)
    await subir([
      ...PROPOR,
      { tool: 'accept_proposal', args: {} },
      { texto: 'Certo, qual é o telefone novo?' },
      ...PROPOR,
    ])
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

  it('SC-001: pedido de cadastro devolve confirmation e nao cria cliente', async () => {
    const corpo = await falar(PEDIDO)
    expect(corpo.kind).toBe('confirmation')
    expect(corpo.confirmationId).toEqual(expect.any(String))
    expect((await clientesDoPedido()).total).toBe(0)
  })

  it('resposta com ressalva nao grava, mesmo com o modelo chamando o aceite', async () => {
    const corpo = await falar('pode, mas troca o telefone')
    expect(corpo.kind).toBe('answer')
    expect((await clientesDoPedido()).total).toBe(0)
  })

  it('SC-003: proposta refeita, processo novo, "fechou" no prazo grava uma vez', async () => {
    expect((await falar(PEDIDO)).kind).toBe('confirmation')

    await subir([
      { tool: 'accept_proposal', args: {} },
      { texto: `Pronto, ${NOME_CLIENTE} cadastrado.` },
      { tool: 'accept_proposal', args: {} },
      { texto: 'Não há nada pendente.' },
    ])
    const corpo = await falar('fechou')
    expect(corpo.kind).toBe('answer')
    expect(corpo.text).toContain(NOME_CLIENTE)

    const lista = await clientesDoPedido()
    expect(lista.total).toBe(1)
    expect(lista.customers[0]?.name).toBe(NOME_CLIENTE)
  })

  it('segundo aceite nao duplica', async () => {
    await falar('fechou')
    expect((await clientesDoPedido()).total).toBe(1)
  })
})
