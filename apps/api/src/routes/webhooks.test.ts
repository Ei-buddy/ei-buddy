import type { Subscription, SubscriptionWebhookResult } from '@na-regua/contracts'
import { InMemorySubscriptionRepository, type WebhookInbox } from '@na-regua/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from '../plugins/error-handler.js'
import { registerWebhookRoutes, type WebhookRouteDeps } from './webhooks.js'

/**
 * Webhook da mensalidade, pelo ciclo real do Fastify — RNF-028, NR-063.
 *
 * Sem sessao e sem limitador de proposito: quem chama e o provedor. O que se
 * prova aqui sao os CODIGOS de resposta, porque e deles que depende o provedor
 * reentregar, desistir ou pausar a fila — e uma fila pausada e uma loja que
 * nao destrava ao pagar.
 */

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'token-de-aviso-da-conta-pai'

const assinatura = (over: Partial<Subscription> = {}): Subscription => ({
  companyId: EMPRESA,
  planCode: 'essencial',
  status: 'trial',
  trialEndsAt: '2026-10-03T23:59:59.999Z',
  currentPeriodEndsAt: null,
  couponId: null,
  restrictedAt: null,
  cancelledAt: null,
  nextDueDate: null,
  ...over,
})

/** Caixa de entrada em memoria, com a mesma promessa da real. */
function inboxDeMentira() {
  const vistos = new Set<string>()
  const processados = new Set<string>()
  const inbox: WebhookInbox = {
    registrar: async ({ provider, eventId }) => {
      const chave = `${provider}:${eventId}`
      if (vistos.has(chave)) return false
      vistos.add(chave)
      return true
    },
    marcarProcessado: async ({ provider, eventId }) => {
      processados.add(`${provider}:${eventId}`)
    },
  }
  return { inbox, vistos, processados }
}

function montar(
  leitura: SubscriptionWebhookResult,
  inicial: Subscription | undefined = assinatura(),
) {
  const subscriptions = new InMemorySubscriptionRepository()
  if (inicial) subscriptions.semear(inicial)
  const { inbox, processados } = inboxDeMentira()

  const deps: WebhookRouteDeps = {
    assinatura: {
      subscriptions,
      politica: { diasDeTeste: 14, diasDeAvisoDoFimDoTeste: 3, diasDeTolerancia: 5 },
      readWebhook: () => leitura,
      inbox,
    },
  }

  return { deps, subscriptions, processados }
}

async function buildApp(deps: WebhookRouteDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  registerWebhookRoutes(app, deps)
  await app.ready()
  return app
}

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

const postar = (instancia: FastifyInstance, corpo = '{"event":"PAYMENT_CONFIRMED"}') =>
  instancia.inject({
    method: 'POST',
    url: '/webhooks/asaas/plataforma',
    headers: { 'content-type': 'application/json', 'asaas-access-token': TOKEN },
    payload: corpo,
  })

const aceito = (over = {}): SubscriptionWebhookResult => ({
  status: 'accepted',
  event: {
    eventId: 'evt_1',
    type: 'subscription.paid',
    providerSubscriptionId: 'sub_1',
    externalReference: EMPRESA,
    amountCents: 8990,
    failureReason: null,
    occurredAt: '2026-10-05T12:00:00.000Z',
    ...over,
  },
})

describe('os codigos de resposta', () => {
  it('aviso valido processa e responde 200', async () => {
    const { deps, subscriptions, processados } = montar(aceito())
    app = await buildApp(deps)

    const r = await postar(app)

    expect(r.statusCode).toBe(200)
    expect((await subscriptions.findByCompany(EMPRESA))?.status).toBe('active')
    expect(processados.has('asaas:evt_1')).toBe(true)
  })

  it('token invalido responde 401, e nao 200', async () => {
    const { deps } = montar({ status: 'invalid_signature' })
    app = await buildApp(deps)

    const r = await postar(app)

    /* 200 ensinaria o atacante que o corpo foi aceito. */
    expect(r.statusCode).toBe(401)
  })

  it('corpo ilegivel responde 400', async () => {
    const { deps } = montar({ status: 'malformed', reason: 'Corpo do webhook nao e JSON.' })
    app = await buildApp(deps)

    expect((await postar(app)).statusCode).toBe(400)
  })

  it('evento que ignoramos responde 200, e nao 4xx', async () => {
    const { deps, subscriptions } = montar({ status: 'ignored', reason: 'PAYMENT_CREATED' })
    app = await buildApp(deps)

    const r = await postar(app)

    /* 4xx faria o provedor reentregar para sempre um aviso que nunca vamos
       querer — e, depois de insistir, pausar a fila. */
    expect(r.statusCode).toBe(200)
    expect((await subscriptions.findByCompany(EMPRESA))?.status).toBe('trial')
  })

  it('sem provedor configurado responde 503, e nao 404', async () => {
    app = await buildApp({})

    const r = await postar(app)

    /* 404 faria o Asaas DESATIVAR o webhook depois de algumas falhas — e
       reativa-lo e trabalho manual no painel dele. */
    expect(r.statusCode).toBe(503)
  })
})

describe('reentrega', () => {
  it('o mesmo aviso duas vezes processa uma vez so', async () => {
    const { deps, subscriptions } = montar(aceito())
    app = await buildApp(deps)

    const primeira = await postar(app)
    const segunda = await postar(app)

    expect([primeira.statusCode, segunda.statusCode]).toEqual([200, 200])
    expect(JSON.parse(segunda.body)).toMatchObject({ repetido: true })
    expect((await subscriptions.findByCompany(EMPRESA))?.status).toBe('active')
  })
})

describe('avisos sem assinatura nossa', () => {
  it('sem referencia externa, 200 sem entrar na caixa', async () => {
    const { deps, processados } = montar(aceito({ externalReference: null }))
    app = await buildApp(deps)

    const r = await postar(app)

    /* Sem empresa nao ha onde gravar: a tabela e isolada por tenant. */
    expect(r.statusCode).toBe(200)
    expect(processados.size).toBe(0)
  })

  it('empresa sem assinatura, 200 e nada muda', async () => {
    const { deps } = montar(aceito(), undefined)
    app = await buildApp(deps)

    expect((await postar(app)).statusCode).toBe(200)
  })
})

describe('o corpo chega BRUTO, e nao parseado', () => {
  it('a rota entrega ao adapter a string como veio', async () => {
    const corpos: string[] = []
    const subscriptions = new InMemorySubscriptionRepository()
    subscriptions.semear(assinatura())
    const { inbox } = inboxDeMentira()

    app = await buildApp({
      assinatura: {
        subscriptions,
        politica: { diasDeTeste: 14, diasDeAvisoDoFimDoTeste: 3, diasDeTolerancia: 5 },
        readWebhook: (rawBody) => {
          corpos.push(rawBody)
          return aceito()
        },
        inbox,
      },
    })

    const enviado = '{"event":"PAYMENT_CONFIRMED",  "espacos":   true}'
    await postar(app, enviado)

    /*
     * Byte a byte, com os espacos. O provedor de hoje nao assina o corpo, mas
     * quem assina assina os BYTES: um corpo reserializado depois de
     * `JSON.parse` tem outros bytes, e trocar de provedor nao pode virar
     * trocar a rota.
     */
    expect(corpos[0]).toBe(enviado)
  })
})
