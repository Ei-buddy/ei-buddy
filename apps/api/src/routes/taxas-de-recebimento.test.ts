import { InMemoryAuditTrail, InMemoryPaymentFeeSettings } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerTaxasDeRecebimentoRoutes } from './taxas-de-recebimento.js'

/** Taxas de recebimento pelo ciclo real do Fastify — DEC-027 (NR-223). */

let principal: AuthenticatedPrincipal = { companyId: 'empresa-1', userId: 'u1', role: 'owner' }
const audit = new InMemoryAuditTrail()

async function buildApp() {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    request.principal = principal
  })
  registerTaxasDeRecebimentoRoutes(app, { feeSettings: new InMemoryPaymentFeeSettings(), audit })
  return app
}

const TAXAS = {
  pixFeePercent: 0.99,
  debitFeePercent: 1.49,
  creditFeePercents: [2.99, 4.5],
  brandOverrides: [{ brand: 'amex', method: 'credit', installments: 1, feePercent: 3.99 }],
  debitSettlementDays: 1,
  creditSettlementDays: 30,
  anticipation: { enabled: false, monthlyRatePercent: null },
}

let app: FastifyInstance
afterEach(async () => {
  await app?.close()
  principal = { companyId: 'empresa-1', userId: 'u1', role: 'owner' }
})

describe('taxas de recebimento — NR-223', () => {
  it('sem configuracao devolve as padrao; o responsavel grava e le de volta', async () => {
    app = await buildApp()

    const antes = await app.inject({ method: 'GET', url: '/taxas-de-recebimento' })
    expect(antes.statusCode).toBe(200)
    expect(antes.json()).toMatchObject({ isDefault: true, updatedAt: null, debitFeePercent: 3 })

    const gravou = await app.inject({ method: 'PUT', url: '/taxas-de-recebimento', payload: TAXAS })
    expect(gravou.statusCode).toBe(200)
    expect(gravou.json()).toMatchObject({ ...TAXAS, isDefault: false })

    const depois = await app.inject({ method: 'GET', url: '/taxas-de-recebimento' })
    expect(depois.json()).toMatchObject({ isDefault: false, pixFeePercent: 0.99 })
    expect(audit.daEmpresa('empresa-1').at(-1)).toMatchObject({
      entity: 'PaymentFeeSettings',
      action: 'updated',
    })
  })

  it('formato errado e 400; funcionario le mas nao grava (403)', async () => {
    app = await buildApp()
    const errada = await app.inject({
      method: 'PUT',
      url: '/taxas-de-recebimento',
      payload: { ...TAXAS, debitFeePercent: 45 },
    })
    expect(errada.statusCode).toBe(400)

    principal = { companyId: 'empresa-1', userId: 'u2', role: 'staff' }
    expect((await app.inject({ method: 'GET', url: '/taxas-de-recebimento' })).statusCode).toBe(200)
    const negado = await app.inject({ method: 'PUT', url: '/taxas-de-recebimento', payload: TAXAS })
    expect(negado.statusCode).toBe(403)
  })

  it('debito parcelado na excecao de bandeira e recusado', async () => {
    app = await buildApp()
    const r = await app.inject({
      method: 'PUT',
      url: '/taxas-de-recebimento',
      payload: {
        ...TAXAS,
        brandOverrides: [{ brand: 'visa', method: 'debit', installments: 2, feePercent: 2 }],
      },
    })
    expect(r.statusCode).toBe(400)
  })
})
