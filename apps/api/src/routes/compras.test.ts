import { InMemoryAuditTrail, InMemoryPurchases } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerComprasRoutes } from './compras.js'

/** Entrada de mercadoria pelo ciclo real do Fastify — NR-158. */

const PRINCIPAL: AuthenticatedPrincipal = { companyId: 'empresa-1', userId: 'u1', role: 'owner' }

async function buildApp(principal: AuthenticatedPrincipal = PRINCIPAL) {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    request.principal = principal
  })
  const compras = new InMemoryPurchases(new InMemoryAuditTrail())
  compras.cadastrar({
    id: 'p1',
    companyId: 'empresa-1',
    description: 'Cafe',
    costPriceCents: 1000,
    stockQuantity: 4,
    isActive: true,
  })
  registerComprasRoutes(app, { uow: compras, queries: compras, ids: compras })
  return { app, compras }
}

let app: FastifyInstance
afterEach(async () => {
  await app?.close()
})

const corpo = {
  supplier: 'Distribuidora',
  items: [{ productId: 'p1', quantity: 6, unitCostCents: 1500 }],
  dueDate: '2026-10-30',
}

describe('compras — NR-158', () => {
  it('registra a compra e a lista', async () => {
    const montado = await buildApp()
    app = montado.app
    const r = await app.inject({ method: 'POST', url: '/compras', payload: corpo })
    expect(r.statusCode).toBe(201)
    expect(r.json()).toMatchObject({ totalCents: 9000, installments: 1 })
    expect(montado.compras.produto('p1')).toMatchObject({ stockQuantity: 10, costPriceCents: 1300 })

    const lista = await app.inject({ method: 'GET', url: '/compras' })
    expect(lista.json().purchases).toHaveLength(1)
  })

  it('corpo sem itens e 400', async () => {
    app = (await buildApp()).app
    const r = await app.inject({
      method: 'POST',
      url: '/compras',
      payload: { ...corpo, items: [] },
    })
    expect(r.statusCode).toBe(400)
  })

  it('perfil somente leitura e 403', async () => {
    app = (await buildApp({ ...PRINCIPAL, role: 'accountant' })).app
    const r = await app.inject({ method: 'POST', url: '/compras', payload: corpo })
    expect(r.statusCode).toBe(403)
  })
})
