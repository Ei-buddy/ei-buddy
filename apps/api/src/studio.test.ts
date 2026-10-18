import { createAgentRuntime, FixturePeerDirectory, type AgentUseCases } from '@na-regua/agent'
import {
  criarLojaDeTeste,
  roteiroDoModelo,
  type EtapaRoteirizada,
} from '@na-regua/agent/test-support'
import { agentReplySchema } from '@na-regua/contracts'
import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerErrorHandler } from './plugins/error-handler.js'
import type { AuthenticatedPrincipal } from './plugins/execution-context.js'
import { registerAgentRoutes } from './routes/agent.js'
import { montarStudio, origemDoPainelStudio } from './studio.js'

const UUID_A = '00000000-0000-4000-8000-000000000001'
const USER_A = '00000000-0000-4000-8000-000000000011'

const useCases: AgentUseCases = criarLojaDeTeste().useCases

const directory = new FixturePeerDirectory([
  {
    id: 'claudia-loja-1',
    peer: '5511999000001',
    companyId: UUID_A,
    userId: USER_A,
    role: 'owner',
  },
])

/** Cada pergunta de vendas: consulta e depois texto. Repetido para varios turnos. */
function modeloVendas() {
  const turno: EtapaRoteirizada[] = [
    { tool: 'list_sales', args: { from: '2026-09-11', to: '2026-09-11' } },
    { texto: 'Hoje foi 1 venda de R$ 100,00.' },
  ]
  return roteiroDoModelo(Array.from({ length: 6 }, () => turno).flat()).modelo
}

function runtime() {
  return createAgentRuntime({ model: modeloVendas(), useCases, peers: directory })
}

async function appComStudio(over: Parameters<typeof montarStudio>[1]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await montarStudio(app, over)
  return app
}

describe('montarStudio — porteiro', () => {
  it('sem chave: adapter nao monta, /api/agents e 404 e nao lista studio-harness', async () => {
    const app = await appComStudio({
      motivo: 'OPENAI_API_KEY ausente: o assistente nao monta.',
      runtime: runtime(),
      directory,
    })
    const res = await app.inject({ method: 'GET', url: '/api/agents' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('studio-harness')
    await app.close()
  })

  it('harness off: adapter nao monta e /api/agents e 404', async () => {
    const app = await appComStudio({
      motivo: 'Harness do assistente desligado em producao (FR-001b).',
      runtime: runtime(),
      directory,
    })
    const res = await app.inject({ method: 'GET', url: '/api/agents' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('presets ausentes: adapter nao monta e /api/agents e 404', async () => {
    const app = await appComStudio({
      motivo: undefined,
      runtime: runtime(),
      directory: null,
    })
    const res = await app.inject({ method: 'GET', url: '/api/agents' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('harness local lista so studio-harness, sem erp-agent', async () => {
    const app = await appComStudio({
      motivo: undefined,
      runtime: runtime(),
      directory,
    })
    const res = await app.inject({ method: 'GET', url: '/api/agents' })
    expect(res.statusCode).toBe(200)
    const corpo = JSON.parse(res.body) as Record<string, { id?: string }>
    expect(Object.keys(corpo)).toEqual(['studio-harness'])
    expect(corpo['studio-harness']?.id).toBe('studio-harness')
    expect(JSON.stringify(corpo)).not.toMatch(/erp-agent/)
    await app.close()
  })

  it('GET /api/agents/studio-harness expoe requestContextSchema para o editor do Studio', async () => {
    const app = await appComStudio({
      motivo: undefined,
      runtime: runtime(),
      directory,
    })
    const res = await app.inject({ method: 'GET', url: '/api/agents/studio-harness' })
    expect(res.statusCode).toBe(200)
    const corpo = JSON.parse(res.body) as { requestContextSchema?: unknown }
    expect(corpo.requestContextSchema).toBeTruthy()
    const bruto =
      typeof corpo.requestContextSchema === 'string'
        ? corpo.requestContextSchema
        : JSON.stringify(corpo.requestContextSchema)
    expect(bruto).toContain('preset')
    expect(bruto).toContain('peer')
    expect(bruto).not.toContain('companyId')
    await app.close()
  })

  it('SPA do Studio em localhost: OPTIONS /api/auth/capabilities recebe CORS', async () => {
    const app = await appComStudio({
      motivo: undefined,
      runtime: runtime(),
      directory,
    })
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/capabilities',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
      },
    })
    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(preflight.headers['access-control-allow-credentials']).toBe('true')

    const get = await app.inject({
      method: 'GET',
      url: '/api/auth/capabilities',
      headers: { origin: 'http://localhost:3000' },
    })
    expect(get.statusCode).toBe(200)
    expect(get.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    await app.close()
  })

  it('origem remota nao ganha CORS do harness', async () => {
    const app = await appComStudio({
      motivo: undefined,
      runtime: runtime(),
      directory,
    })
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/capabilities',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'GET',
      },
    })
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    await app.close()
  })

  it('POST /agent/messages permanece estrito com o adapter montado', async () => {
    const principal: AuthenticatedPrincipal = {
      companyId: 'empresa-1',
      userId: 'usuario-1',
      role: 'owner',
    }
    const app = Fastify({ logger: false })
    registerErrorHandler(app)
    app.addHook('onRequest', async (request) => {
      request.principal = principal
    })
    const rt = runtime()
    registerAgentRoutes(app, { runtime: rt })
    await montarStudio(app, { motivo: undefined, runtime: rt, directory })

    const extra = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?', peer: '5511999000001' },
    })
    expect(extra.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?' },
    })
    expect(ok.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(ok.body))
    expect(corpo.kind).toBe('answer')
    await app.close()
  })
})

describe('montarStudio — generate US1', () => {
  it('POST /api/agents/studio-harness/generate com o modelo duble devolve os mesmos centavos/kind do HTTP', async () => {
    const visto: string[] = []
    const useCasesEmpresa: AgentUseCases = {
      ...useCases,
      listSales: async (ctx) => {
        visto.push(ctx.companyId)
        return {
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
        }
      },
    }
    const dir = directory
    const rt = createAgentRuntime({ model: modeloVendas(), useCases: useCasesEmpresa, peers: dir })
    const principal: AuthenticatedPrincipal = {
      companyId: UUID_A,
      userId: USER_A,
      role: 'owner',
    }
    const app = Fastify({ logger: false })
    registerErrorHandler(app)
    app.addHook('onRequest', async (request) => {
      request.principal = principal
    })
    registerAgentRoutes(app, { runtime: rt })
    await montarStudio(app, { motivo: undefined, runtime: rt, directory: dir })

    const http = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?' },
    })
    expect(http.statusCode).toBe(200)
    const httpCorpo = agentReplySchema.parse(JSON.parse(http.body))

    const generate = await app.inject({
      method: 'POST',
      url: '/api/agents/studio-harness/generate',
      payload: {
        messages: 'quanto vendi hoje?',
        requestContext: {
          preset: 'claudia-loja-1',
          companyId: '00000000-0000-4000-8000-000000000002',
        },
      },
    })
    expect(generate.statusCode).toBe(200)
    const generateCorpo = JSON.parse(generate.body) as {
      text?: string
      error?: unknown
      toolResults?: unknown
    }
    expect(generateCorpo.error).toBeUndefined()

    const envelope = envelopeDoGenerate(generateCorpo)
    expect(httpCorpo.kind).toBe('answer')
    expect(envelope.kind).toBe(httpCorpo.kind)
    expect(envelope.text).toBe(httpCorpo.text)
    expect(httpCorpo.text).toContain('1 venda')
    expect(visto).toEqual([UUID_A, UUID_A])
    await app.close()
  })
})

describe('origemDoPainelStudio', () => {
  it('aceita loopback do pnpm studio e recusa o resto', () => {
    expect(origemDoPainelStudio('http://localhost:3000')).toBe(true)
    expect(origemDoPainelStudio('http://127.0.0.1:3000')).toBe(true)
    expect(origemDoPainelStudio('https://evil.example')).toBe(false)
    expect(origemDoPainelStudio(undefined)).toBe(false)
  })
})

function envelopeDoGenerate(out: { text?: string; toolResults?: unknown }): {
  kind: string
  text: string
} {
  const results = out.toolResults
  if (Array.isArray(results)) {
    for (const item of results) {
      const found = extrairEnvelope(item)
      if (found !== undefined) return found
    }
  }
  return { kind: 'answer', text: typeof out.text === 'string' ? out.text : '' }
}

function extrairEnvelope(valor: unknown): { kind: string; text: string } | undefined {
  if (valor === null || typeof valor !== 'object') return undefined
  const row = valor as Record<string, unknown>
  if (typeof row.kind === 'string' && typeof row.text === 'string') {
    return { kind: row.kind, text: row.text }
  }
  for (const chave of ['result', 'output', 'payload', 'value'] as const) {
    const found = extrairEnvelope(row[chave])
    if (found !== undefined) return found
  }
  return undefined
}
