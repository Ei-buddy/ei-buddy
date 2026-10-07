import { InMemoryAuditTrail, InMemoryQuotes } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerOrcamentosRoutes } from './orcamentos.js'

/** Orcamento pelo ciclo real do Fastify — NR-159. */

const PRINCIPAL: AuthenticatedPrincipal = { companyId: 'empresa-1', userId: 'u1', role: 'owner' }

async function buildApp(principal: AuthenticatedPrincipal = PRINCIPAL) {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    request.principal = principal
  })
  const quotes = new InMemoryQuotes()
  quotes.cadastrar({ id: 'p1', companyId: 'empresa-1', description: 'Tinta', isActive: true })
  quotes.registrarVenda('v1', 'empresa-1')
  registerOrcamentosRoutes(app, { quotes, audit: new InMemoryAuditTrail() })
  return app
}

let app: FastifyInstance
afterEach(async () => {
  await app?.close()
})

const corpo = {
  customerName: 'Joana',
  items: [{ productId: 'p1', quantity: 2, unitPriceCents: 5000 }],
  validUntil: '2026-10-20',
}

describe('orcamentos — NR-159', () => {
  it('cria, lista, le e converte', async () => {
    app = await buildApp()
    const criado = await app.inject({ method: 'POST', url: '/orcamentos', payload: corpo })
    expect(criado.statusCode).toBe(201)
    const id = criado.json().id as string

    expect((await app.inject({ method: 'GET', url: '/orcamentos' })).json().quotes).toHaveLength(1)
    expect((await app.inject({ method: 'GET', url: `/orcamentos/${id}` })).json().number).toBe(1)

    const conv = await app.inject({
      method: 'POST',
      url: `/orcamentos/${id}/converter`,
      payload: { saleId: 'v1' },
    })
    expect(conv.statusCode).toBe(200)
    expect(conv.json()).toMatchObject({ status: 'converted', saleId: 'v1' })
  })

  it('cancelar duas vezes e 409', async () => {
    app = await buildApp()
    const id = (await app.inject({ method: 'POST', url: '/orcamentos', payload: corpo })).json().id
    expect(
      (await app.inject({ method: 'POST', url: `/orcamentos/${id}/cancelar` })).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ method: 'POST', url: `/orcamentos/${id}/cancelar` })).statusCode,
    ).toBe(409)
  })

  it('orcamento inexistente e 404', async () => {
    app = await buildApp()
    expect((await app.inject({ method: 'GET', url: '/orcamentos/nada' })).statusCode).toBe(404)
  })
})
