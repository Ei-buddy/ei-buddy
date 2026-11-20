import type { ServiceInvoiceRequest } from '@na-regua/contracts'
import type { NfseGuardada, ServiceInvoiceRepository } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { type NfseDeps, registerNfseRoutes } from './nfse.js'

/**
 * As rotas da NFS-e nacional — NR-241. A regra mora em `core` e tem teste la;
 * aqui se prova o contrato HTTP: codigos, corpo e o isolamento pelo contexto.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

function memoria() {
  const notas = new Map<string, NfseGuardada>()
  const envios: ServiceInvoiceRequest[] = []
  const nfse: ServiceInvoiceRepository = {
    saleForNfse: async (companyId, saleId) =>
      companyId === 'empresa-1' && saleId === 'venda-1'
        ? {
            saleId,
            soldAt: new Date('2026-11-20T15:00:00Z'),
            grossAmountCents: 6000,
            discountCents: 0,
            items: [
              { description: 'Corte', quantity: 1, unitPriceCents: 6000, nbsCode: '101011000' },
            ],
            customer: undefined,
          }
        : undefined,
    companyForNfse: async () => ({
      cnpj: '12345678000195',
      municipalRegistration: null,
      city: 'Curitiba',
      state: 'PR',
      cityIbgeCode: '4106902',
      taxRegime: 'simples_nacional',
      nationalServiceCode: '060101',
      issRatePercent: null,
    }),
    saveCityCode: async () => {},
    find: async (_c, saleId) => notas.get(saleId),
    open: async (_c, saleId, p) => {
      if (notas.has(saleId)) return false
      notas.set(saleId, {
        status: 'processing',
        amountCents: p.amountCents,
        discountCents: p.discountCents,
        description: p.description,
        number: null,
        accessKey: null,
        verificationCode: null,
        danfseUrl: null,
        publicUrl: null,
        rejection: null,
        requestedAt: p.requestedAt.toISOString(),
        issuedAt: null,
        cancelledAt: null,
        lastCheckedAt: null,
        checks: 0,
      })
      return true
    },
    record: async () => {},
    markCancelled: async (_c, saleId, _m, em) => {
      notas.set(saleId, {
        ...notas.get(saleId)!,
        status: 'cancelled',
        cancelledAt: em.toISOString(),
      })
    },
  }
  const deps: NfseDeps = {
    nfse,
    queue: { enqueueIssue: async (r) => void envios.push(r) },
    cities: { codigoIbge: async () => '4106902' },
    issuer: { consult: async () => undefined, cancel: async () => ({ status: 'cancelled' }) },
    audit: { record: async () => ({}) as never },
  }
  return { deps, notas, envios }
}

let app: FastifyInstance

async function montar(deps: NfseDeps) {
  app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    request.principal = PRINCIPAL
  })
  registerNfseRoutes(app, deps)
  return app
}

afterEach(async () => {
  await app?.close()
})

describe('rotas da NFS-e — NR-241', () => {
  it('pedir responde 202 "processando" e enfileira o envio', async () => {
    const m = memoria()
    await montar(m.deps)

    const r = await app.inject({ method: 'POST', url: '/vendas/venda-1/nfse' })

    expect(r.statusCode).toBe(202)
    expect(r.json()).toMatchObject({ status: 'processing', amountCents: 6000, number: null })
    expect(m.envios).toHaveLength(1)
    expect(m.envios[0]?.companyId).toBe('empresa-1')
  })

  it('estado: nulo antes de pedir, e a nota depois', async () => {
    const m = memoria()
    await montar(m.deps)

    const antes = await app.inject({ method: 'GET', url: '/vendas/venda-1/nfse' })
    expect(antes.json()).toEqual({ serviceInvoice: null })

    await app.inject({ method: 'POST', url: '/vendas/venda-1/nfse' })
    const depois = await app.inject({ method: 'GET', url: '/vendas/venda-1/nfse' })
    expect(depois.json().serviceInvoice.status).toBe('processing')
  })

  it('venda que nao e da empresa responde 404', async () => {
    await montar(memoria().deps)
    const r = await app.inject({ method: 'POST', url: '/vendas/venda-de-outra/nfse' })
    expect(r.statusCode).toBe(404)
  })

  it('cancelar exige justificativa de 15 caracteres', async () => {
    await montar(memoria().deps)
    const r = await app.inject({
      method: 'POST',
      url: '/vendas/venda-1/nfse/cancelamento',
      payload: { reason: 'curta' },
    })
    expect(r.statusCode).toBe(400)
  })

  it('cancela a autorizada', async () => {
    const m = memoria()
    await montar(m.deps)
    await app.inject({ method: 'POST', url: '/vendas/venda-1/nfse' })
    m.notas.set('venda-1', {
      ...m.notas.get('venda-1')!,
      status: 'authorized',
      number: '1',
      danfseUrl: 'https://nfse.invalid/x.pdf',
    })

    const r = await app.inject({
      method: 'POST',
      url: '/vendas/venda-1/nfse/cancelamento',
      payload: { reason: 'Servico lancado em duplicidade' },
    })

    expect(r.statusCode).toBe(200)
    expect(r.json().status).toBe('cancelled')
  })
})
