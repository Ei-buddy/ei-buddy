import { agentReplySchema } from '@na-regua/contracts'
import { createAgentRuntime, FakeLlm, type AgentUseCases } from '@na-regua/agent'
import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerAgentRoutes } from './agent.js'

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

const useCases: AgentUseCases = {
  listSales: async () => ({
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
  }),
  listReceivables: async () => ({
    grupos: [],
    totalCents: 0,
    temVencidas: false,
  }),
  registerCustomer: async () => {
    throw new Error('nao deveria cadastrar neste teste')
  },
  registerSale: async () => {
    throw new Error('nao deveria vender neste teste')
  },
  searchProducts: async () => [],
  revenueByMonth: async () => ({
    from: '2026-09-01',
    to: '2026-09-30',
    months: [],
    totalNetCents: 0,
  }),
}

function buildApp(principal: AuthenticatedPrincipal | null = PRINCIPAL): FastifyInstance {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    if (principal !== null) request.principal = principal
  })
  registerAgentRoutes(app, { runtime: createAgentRuntime({ useCases, llm: new FakeLlm() }) })
  return app
}

describe('POST /agent/messages', () => {
  it('responde consulta autenticada sem WhatsApp', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?' },
    })
    expect(res.statusCode).toBe(200)
    const corpo = agentReplySchema.parse(JSON.parse(res.body))
    expect(corpo.kind).toBe('answer')
    expect(corpo.text).toContain('1 venda')
    await app.close()
  })

  it('recusa sem sessao', async () => {
    const app = buildApp(null)
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('recusa mensagem vazia', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: '   ' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

/**
 * Sem runtime configurado — ADR-0010.
 *
 * O ponto nao e o 503: e que exista resposta. Enquanto a api recusava subir
 * por falta de chave de IA, isto aqui era um processo em laco de reinicio e
 * nenhuma outra rota respondendo.
 */
describe('POST /agent/messages sem runtime', () => {
  function buildAppSemRuntime(): FastifyInstance {
    const app = Fastify({ logger: false })
    registerErrorHandler(app)
    app.addHook('onRequest', async (request) => {
      request.principal = PRINCIPAL
    })
    registerAgentRoutes(app, null)
    return app
  }

  it('responde 503 com motivo, em vez de 404', async () => {
    const app = buildAppSemRuntime()
    const res = await app.inject({
      method: 'POST',
      url: '/agent/messages',
      payload: { text: 'quanto vendi hoje?' },
    })

    expect(res.statusCode).toBe(503)
    const corpo = JSON.parse(res.body) as { error: { code: string; message: string } }
    expect(corpo.error.code).toBe('UNAVAILABLE')
    /* A tela precisa poder dizer o que houve sem mandar o lojista adivinhar. */
    expect(corpo.error.message).toMatch(/indisponivel/i)
    await app.close()
  })
})
