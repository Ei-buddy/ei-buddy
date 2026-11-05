import { InMemoryAuditTrail, InMemorySuppliers } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { registerCadastroDeFornecedoresRoutes } from './cadastro-fornecedores.js'

/** Cadastro de fornecedor pelo ciclo real do Fastify — NR-191. */

const PRINCIPAL: AuthenticatedPrincipal = { companyId: 'empresa-1', userId: 'u1', role: 'owner' }

async function buildApp() {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    request.principal = PRINCIPAL
  })
  registerCadastroDeFornecedoresRoutes(app, {
    suppliers: new InMemorySuppliers(),
    audit: new InMemoryAuditTrail(),
  })
  return app
}

let app: FastifyInstance
afterEach(async () => {
  await app?.close()
})

describe('cadastro de fornecedor — NR-191', () => {
  it('cadastra, lista, edita e exclui', async () => {
    app = await buildApp()

    const criado = await app.inject({
      method: 'POST',
      url: '/cadastros/fornecedores',
      payload: {
        name: 'Distribuidora Boa Vista LTDA',
        document: '11.222.333/0001-81',
        phone: '(41) 3333-4444',
        address: { zipCode: '80010000', city: 'Curitiba', state: 'PR' },
      },
    })
    expect(criado.statusCode).toBe(201)
    const id = criado.json().id as string
    expect(criado.json()).toMatchObject({ document: '11222333000181', phone: '4133334444' })

    const lista = await app.inject({ method: 'GET', url: '/cadastros/fornecedores?q=boa vista' })
    expect(lista.json().suppliers).toHaveLength(1)

    const editado = await app.inject({
      method: 'PATCH',
      url: `/cadastros/fornecedores/${id}`,
      payload: { contactName: 'Carlos', phone: null },
    })
    expect(editado.json()).toMatchObject({ contactName: 'Carlos', phone: null })

    expect(
      (await app.inject({ method: 'DELETE', url: `/cadastros/fornecedores/${id}` })).statusCode,
    ).toBe(204)
    expect(
      (await app.inject({ method: 'GET', url: `/cadastros/fornecedores/${id}` })).statusCode,
    ).toBe(404)
  })

  it('recusa CNPJ invalido e CNPJ repetido', async () => {
    app = await buildApp()
    const invalido = await app.inject({
      method: 'POST',
      url: '/cadastros/fornecedores',
      payload: { name: 'X Ltda', document: '11222333000100' },
    })
    expect(invalido.statusCode).toBe(400)

    await app.inject({
      method: 'POST',
      url: '/cadastros/fornecedores',
      payload: { name: 'Primeiro', document: '11222333000181' },
    })
    const repetido = await app.inject({
      method: 'POST',
      url: '/cadastros/fornecedores',
      payload: { name: 'Segundo', document: '11222333000181' },
    })
    expect(repetido.statusCode).toBe(409)
  })
})
