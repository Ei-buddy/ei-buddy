import { InMemoryAuditTrail, InMemoryCashRegister } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerCaixaRoutes } from './caixa.js'

/** O caixa pelo ciclo real do Fastify — NR-157. */

const PRINCIPAL: AuthenticatedPrincipal = { companyId: 'empresa-1', userId: 'u1', role: 'owner' }

async function buildApp(principal: AuthenticatedPrincipal = PRINCIPAL) {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    request.principal = principal
  })
  registerCaixaRoutes(app, { cash: new InMemoryCashRegister(), audit: new InMemoryAuditTrail() })
  return app
}

let app: FastifyInstance
afterEach(async () => {
  await app?.close()
})

describe('caixa — NR-157', () => {
  it('fechado e 200 com current nulo, e nao 404', async () => {
    app = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/caixa' })
    expect(r.statusCode).toBe(200)
    expect(r.json().current).toBeNull()
  })

  it('abre, faz suprimento, fecha', async () => {
    app = await buildApp()

    const aberto = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { openingCents: 5000 },
    })
    const sup = await app.inject({
      method: 'POST',
      url: '/caixa/movimentos',
      payload: { kind: 'deposit', amountCents: 1000, reason: 'Troco' },
    })
    const fechado = await app.inject({
      method: 'POST',
      url: '/caixa/fechar',
      payload: { countedCents: 6000 },
    })

    expect(aberto.statusCode).toBe(201)
    expect(sup.statusCode).toBe(201)
    expect(fechado.statusCode).toBe(200)
    expect(fechado.json().session).toMatchObject({ expectedCents: 6000, countedCents: 6000 })
  })

  it('abrir duas vezes e 409; sangria sem motivo e 400', async () => {
    app = await buildApp()
    await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { openingCents: 0 } })

    const outro = await app.inject({
      method: 'POST',
      url: '/caixa/abrir',
      payload: { openingCents: 0 },
    })
    const semMotivo = await app.inject({
      method: 'POST',
      url: '/caixa/movimentos',
      payload: { kind: 'withdrawal', amountCents: 1 },
    })

    expect(outro.statusCode).toBe(409)
    expect(semMotivo.statusCode).toBe(400)
  })

  it('contador consulta mas nao abre', async () => {
    app = await buildApp({ ...PRINCIPAL, role: 'accountant' })
    expect((await app.inject({ method: 'GET', url: '/caixa' })).statusCode).toBe(200)
    expect(
      (await app.inject({ method: 'POST', url: '/caixa/abrir', payload: { openingCents: 0 } }))
        .statusCode,
    ).toBe(403)
  })
})
