import { InMemoryCepLookup, InMemoryCnpjLookup } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import type { AuthenticatedPrincipal } from '../plugins/execution-context.js'
import { registerRateLimit } from '../plugins/rate-limit.js'
import { type ConsultasDeps, registerConsultasRoutes } from './consultas.js'

/**
 * CEP e CNPJ pelo ciclo real do Fastify — NR-072.
 *
 * Provedores em memoria: o que estas rotas prometem e um par status + corpo, e
 * bater na BrasilAPI de verdade dentro do teste tornaria a suite refem de um
 * servico de terceiro. O adapter real e um `fetch` e um mapeamento de campos,
 * exercitado quando alguem abre a tela.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  companyId: 'empresa-1',
  userId: 'usuario-1',
  role: 'owner',
}

const CEP_CONHECIDO = {
  street: 'Avenida Paulista',
  district: 'Bela Vista',
  city: 'Sao Paulo',
  state: 'SP',
  latitude: -23.5633,
  longitude: -46.6542,
}

const CNPJ_CONHECIDO = {
  legalName: 'PADARIA DO ZE LTDA',
  tradeName: 'Padaria do Ze',
  mainActivity: 'Padaria e confeitaria com predominancia de revenda',
  zipCode: '01310100',
  street: 'Avenida Paulista',
  streetNumber: '482',
  district: 'Bela Vista',
  city: 'Sao Paulo',
  state: 'SP',
  registrationStatus: 'ATIVA',
}

async function buildApp(principal: AuthenticatedPrincipal | null = PRINCIPAL) {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  await registerRateLimit(app)
  app.addHook('onRequest', async (request) => {
    if (principal !== null) request.principal = principal
  })

  const cepLookup = new InMemoryCepLookup()
  cepLookup.registrar('01310100', CEP_CONHECIDO)

  const cnpjLookup = new InMemoryCnpjLookup()
  cnpjLookup.registrar('12345678000199', CNPJ_CONHECIDO)

  const deps: ConsultasDeps = { cepLookup, cnpjLookup }
  registerConsultasRoutes(app, deps)

  return app
}

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
})

describe('CEP — GET /enderecos/cep/:cep', () => {
  it('devolve o endereco do provedor', async () => {
    app = await buildApp()

    const r = await app.inject({ method: 'GET', url: '/enderecos/cep/01310100' })

    expect(r.statusCode).toBe(200)
    expect(r.json().city).toBe('Sao Paulo')
  })

  /* A tela manda o que o lojista digitou, com mascara. Limpar os digitos e
     trabalho do caso de uso — se fosse do adapter, cada provedor novo teria de
     lembrar de fazer igual. */
  it('aceita o CEP com mascara', async () => {
    app = await buildApp()

    const r = await app.inject({ method: 'GET', url: '/enderecos/cep/01310-100' })

    expect(r.statusCode).toBe(200)
    expect(r.json().street).toBe('Avenida Paulista')
  })

  it('reprova CEP incompleto com 400, sem consultar o provedor', async () => {
    app = await buildApp()

    const r = await app.inject({ method: 'GET', url: '/enderecos/cep/0131010' })

    expect(r.statusCode).toBe(400)
  })

  /*
   * 404 e nao corpo vazio: a tela precisa separar "esse CEP nao existe" (o
   * lojista digita de novo) de "o provedor caiu" (ele tenta mais tarde), e as
   * duas coisas chegam da porta como `undefined`.
   */
  it('devolve 404 quando o provedor nao conhece o CEP', async () => {
    app = await buildApp()

    const r = await app.inject({ method: 'GET', url: '/enderecos/cep/99999999' })

    expect(r.statusCode).toBe(404)
  })

  it('exige sessao — a cota do provedor e nossa', async () => {
    app = await buildApp(null)

    const r = await app.inject({ method: 'GET', url: '/enderecos/cep/01310100' })

    expect(r.statusCode).toBe(401)
  })
})

describe('CNPJ — GET /empresas/cnpj/:cnpj', () => {
  it('devolve razao social, fantasia e endereco', async () => {
    app = await buildApp()

    const r = await app.inject({ method: 'GET', url: '/empresas/cnpj/12345678000199' })

    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({
      legalName: 'PADARIA DO ZE LTDA',
      tradeName: 'Padaria do Ze',
      registrationStatus: 'ATIVA',
    })
  })

  it('aceita o CNPJ com mascara', async () => {
    app = await buildApp()

    const r = await app.inject({ method: 'GET', url: '/empresas/cnpj/12.345.678%2F0001-99' })

    expect(r.statusCode).toBe(200)
    expect(r.json().legalName).toBe('PADARIA DO ZE LTDA')
  })

  it('reprova CNPJ incompleto com 400', async () => {
    app = await buildApp()

    const r = await app.inject({ method: 'GET', url: '/empresas/cnpj/1234567800019' })

    expect(r.statusCode).toBe(400)
  })

  it('devolve 404 quando o provedor nao conhece o CNPJ', async () => {
    app = await buildApp()

    const r = await app.inject({ method: 'GET', url: '/empresas/cnpj/99999999000191' })

    expect(r.statusCode).toBe(404)
  })

  it('exige sessao', async () => {
    app = await buildApp(null)

    const r = await app.inject({ method: 'GET', url: '/empresas/cnpj/12345678000199' })

    expect(r.statusCode).toBe(401)
  })
})
