import {
  processMessage,
  type AgentRuntime,
  type AgentTool,
  type IncomingMessage,
  type PeerDirectory,
} from '@na-regua/agent'
import type { AgentReply } from '@na-regua/contracts'
import { abrirCanal, type PeerDirectory as VinculosDoCanal } from '@na-regua/core'
import type { WebhookInbox } from '@na-regua/core'
import { FakeMessageSender } from '@na-regua/whatsapp'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ExecutionContext } from '@na-regua/core'
import { registerErrorHandler } from '../plugins/error-handler.js'
import {
  FRASE_PEDIDO_DE_TEXTO_WHATSAPP,
  registerWhatsAppWebhookRoutes,
  type WhatsAppWebhookRouteDeps,
} from './whatsapp-webhook.js'

/**
 * Webhook WhatsApp — NR-046 US1.
 *
 * Sem credenciais Meta a rota recusa 503. Com Meta montada, prova handshake,
 * assinatura, dedup e envio sem chamar graph.facebook.com.
 */

const SEGREDO = 'segredo-de-webhook-para-teste'
const VERIFY = 'verify-token-de-teste'
const EMPRESA = '11111111-1111-4111-8111-111111111111'
const USUARIA = '22222222-2222-4222-8222-222222222222'
const EMPRESA_ISCA = '33333333-3333-4333-8333-333333333333'
const FROM = '5541988887777'
const MSG_ID = 'wamid.US1'
const RECEBIDA_EM = '2026-09-02T13:00:00.000Z'

type Montagem = {
  deps: WhatsAppWebhookRouteDeps
  remetente: FakeMessageSender
  inbox: WebhookInbox & {
    registros: Array<{ eventId: string; payload: unknown }>
  }
  processMessage: (input: IncomingMessage) => Promise<AgentReply>
  sendText: ReturnType<typeof vi.fn>
}

function inboxDeTeste(opcoes: { marcar?: boolean } = {}) {
  const vistos = new Set<string>()
  const processados = new Set<string>()
  const registros: Array<{ eventId: string; payload: unknown }> = []
  const inbox: WebhookInbox & { registros: typeof registros } = {
    registros,
    registrar: async ({ provider, eventId, payload }) => {
      const chave = `${provider}:${eventId}`
      if (!vistos.has(chave)) {
        vistos.add(chave)
        registros.push({ eventId, payload })
        return 'novo'
      }
      return processados.has(chave) ? 'processado' : 'pendente'
    },
    marcarProcessado: async ({ provider, eventId }) => {
      if (opcoes.marcar === false) return
      processados.add(`${provider}:${eventId}`)
    },
  }
  return inbox
}

function runtimeMinimo(peers: PeerDirectory): AgentRuntime {
  return {
    llm: { decide: async () => ({ type: 'unknown' }) },
    tools: [],
    confirmations: {
      getOpen: async () => undefined,
      put: async () => {},
      resolve: async () => {},
    },
    timeZone: 'America/Sao_Paulo',
    confirmationTtlMs: 300_000,
    peers,
  }
}

function montar(
  ajustes: Partial<{
    peers: PeerDirectory
    processMessage: (input: IncomingMessage) => Promise<AgentReply>
    executarTurno: (runtime: AgentRuntime, input: IncomingMessage) => Promise<AgentReply>
    /**
     * Simula reentrega da Meta: o adapter real nao lembra POST anterior, e o
     * inbox nao marca processado (crash depois do INSERT).
     */
    reentrega: boolean
  }> = {},
): Montagem {
  const remetente = new FakeMessageSender({ webhookSecret: SEGREDO })
  const inbox = inboxDeTeste(ajustes.reentrega === true ? { marcar: false } : {})
  const peers: PeerDirectory =
    ajustes.peers ??
    ({
      resolve: vi.fn().mockResolvedValue({
        companyId: EMPRESA,
        userId: USUARIA,
        role: 'owner',
      }),
    } satisfies PeerDirectory)

  const processMessage =
    ajustes.processMessage ??
    vi.fn(async () => ({ kind: 'answer', text: 'Resposta do assistente' }) satisfies AgentReply)

  const sendText = vi.fn(async (pedido: unknown) => remetente.sendText(pedido as never))

  const remetentePorta = {
    readInbound: (corpo: string, assinatura: string) =>
      ajustes.reentrega === true
        ? new FakeMessageSender({ webhookSecret: SEGREDO }).readInbound(corpo, assinatura)
        : remetente.readInbound(corpo, assinatura),
    sendText,
    sendMedia: remetente.sendMedia.bind(remetente),
  }

  const deps: WhatsAppWebhookRouteDeps = {
    verificacao: { verifyToken: VERIFY },
    meta: {
      remetente: remetentePorta as never,
      peers,
      inbox,
      runtime: runtimeMinimo(peers),
      executarTurno:
        ajustes.executarTurno ??
        (async (_runtime, input: IncomingMessage) => processMessage(input)),
    },
  }

  return { deps, remetente, inbox, processMessage, sendText }
}

function corpoTexto(texto: string, id = MSG_ID, from = FROM): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { display_phone_number: '5541999990000' },
              messages: [
                {
                  id,
                  from,
                  timestamp: String(Math.floor(new Date(RECEBIDA_EM).getTime() / 1000)),
                  type: 'text',
                  text: { body: texto },
                },
              ],
            },
          },
        ],
      },
    ],
  })
}

function corpoSemTexto(id = MSG_ID): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { display_phone_number: '5541999990000' },
              messages: [
                {
                  id,
                  from: FROM,
                  timestamp: String(Math.floor(new Date(RECEBIDA_EM).getTime() / 1000)),
                  type: 'image',
                },
              ],
            },
          },
        ],
      },
    ],
  })
}

function corpoRecibo(): string {
  return JSON.stringify({
    entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.recibo', status: 'delivered' }] } }] }],
  })
}

function assinar(remetente: FakeMessageSender, corpo: string): string {
  /* O fake compara o hex cru; o adapter Meta aceita `sha256=` + hex. */
  return remetente.assinar(corpo)
}

async function buildApp(deps: WhatsAppWebhookRouteDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  registerErrorHandler(app)
  registerWhatsAppWebhookRoutes(app, deps)
  await app.ready()
  return app
}

const postar = (instancia: FastifyInstance, corpo: string, assinatura: string) =>
  instancia.inject({
    method: 'POST',
    url: '/webhooks/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': assinatura,
    },
    payload: corpo,
  })

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('GET /webhooks/whatsapp sem verify token', () => {
  it('responde 503 UNAVAILABLE', async () => {
    app = await buildApp({})
    const resposta = await app.inject({ method: 'GET', url: '/webhooks/whatsapp' })
    expect(resposta.statusCode).toBe(503)
    expect(resposta.json()).toEqual({ error: { code: 'UNAVAILABLE' } })
  })
})

describe('POST /webhooks/whatsapp sem Meta configurada', () => {
  it('responde 503 UNAVAILABLE', async () => {
    app = await buildApp({})
    const resposta = await postar(app, '{}', '')
    expect(resposta.statusCode).toBe(503)
    expect(resposta.json()).toEqual({ error: { code: 'UNAVAILABLE' } })
  })

  it('so com verify token responde 401 e nao processa mensagem', async () => {
    const processMessage = vi.fn()
    app = await buildApp({ verificacao: { verifyToken: VERIFY } })
    const corpo = corpoTexto('oi')

    const resposta = await postar(app, corpo, '')

    expect(resposta.statusCode).toBe(401)
    expect(resposta.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Nao autorizado.' },
    })
    expect(processMessage).not.toHaveBeenCalled()
  })
})

describe('GET /webhooks/whatsapp so com verify token', () => {
  it('devolve o challenge sem meta de POST', async () => {
    app = await buildApp({ verificacao: { verifyToken: VERIFY } })

    const resposta = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-de-teste&hub.challenge=abc-123',
    })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.body).toBe('abc-123')
  })
})

describe('GET /webhooks/whatsapp com Meta — US1', () => {
  it('token certo devolve o challenge em texto puro', async () => {
    const { deps } = montar()
    app = await buildApp(deps)

    const resposta = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-de-teste&hub.challenge=abc-123',
    })

    expect(resposta.statusCode).toBe(200)
    expect(resposta.headers['content-type']).toMatch(/text\/plain/)
    expect(resposta.body).toBe('abc-123')
  })

  it('token errado, mode errado ou token vazio respondem 403 sem corpo', async () => {
    const { deps } = montar()
    app = await buildApp(deps)

    const casos = [
      '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=x',
      '/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=verify-token-de-teste&hub.challenge=x',
      '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=x',
    ]

    for (const url of casos) {
      const resposta = await app.inject({ method: 'GET', url })
      expect(resposta.statusCode).toBe(403)
      expect(resposta.body).toBe('')
    }
  })
})

describe('POST /webhooks/whatsapp com Meta — US1', () => {
  it('assinatura invalida ou ausente responde 401 e nao chama processMessage', async () => {
    const { deps, remetente, processMessage } = montar()
    app = await buildApp(deps)
    const corpo = corpoTexto('tem coca?')

    const semCabecalho = await postar(app, corpo, '')
    expect(semCabecalho.statusCode).toBe(401)
    expect(processMessage).not.toHaveBeenCalled()

    const errada = await postar(app, corpo, 'sha256=0000')
    expect(errada.statusCode).toBe(401)
    expect(processMessage).not.toHaveBeenCalled()

    const valida = assinar(remetente, corpo)
    expect(valida.length).toBeGreaterThan(10)
  })

  it('recibo de entrega responde 200 e nao chama processMessage', async () => {
    const { deps, remetente, processMessage } = montar()
    app = await buildApp(deps)
    const corpo = corpoRecibo()

    const resposta = await postar(app, corpo, assinar(remetente, corpo))

    expect(resposta.statusCode).toBe(200)
    expect(processMessage).not.toHaveBeenCalled()
  })

  it('texto autorizado chama processMessage e envia sendText uma vez', async () => {
    const { deps, remetente, processMessage, sendText, inbox } = montar()
    app = await buildApp(deps)
    const corpo = corpoTexto('quanto vendi hoje?')

    const resposta = await postar(app, corpo, assinar(remetente, corpo))

    expect(resposta.statusCode).toBe(200)
    expect(processMessage).toHaveBeenCalledOnce()
    expect(processMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        text: 'quanto vendi hoje?',
        peer: FROM,
      }),
    )

    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText).toHaveBeenCalledWith({
      companyId: EMPRESA,
      to: FROM,
      body: 'Resposta do assistente',
      consent: { basis: 'service_reply', inboundAt: RECEBIDA_EM },
      idempotencyKey: MSG_ID,
      requestedAt: expect.any(String),
    })

    expect(inbox.registros).toEqual([{ eventId: MSG_ID, payload: { kind: 'text', id: MSG_ID } }])
  })

  it('mesmo id de mensagem responde 200 sem segundo turno nem segundo envio', async () => {
    const { deps, remetente, processMessage, sendText } = montar()
    app = await buildApp(deps)
    const corpo = corpoTexto('oi de novo')

    const assinatura = assinar(remetente, corpo)
    expect((await postar(app, corpo, assinatura)).statusCode).toBe(200)
    expect((await postar(app, corpo, assinatura)).statusCode).toBe(200)

    expect(processMessage).toHaveBeenCalledOnce()
    expect(sendText).toHaveBeenCalledOnce()
  })

  it('reentrega com processed_at nulo chama processMessage de novo', async () => {
    const { deps, remetente, processMessage, sendText } = montar({ reentrega: true })
    app = await buildApp(deps)
    const corpo = corpoTexto('oi de novo')

    const assinatura = assinar(remetente, corpo)
    expect((await postar(app, corpo, assinatura)).statusCode).toBe(200)
    expect((await postar(app, corpo, assinatura)).statusCode).toBe(200)

    /* A primeira entrega morreu depois do INSERT; a reentrega e a chance de
       terminar o turno. Duplicar a resposta e melhor do que a dona nunca
       receber. */
    expect(processMessage).toHaveBeenCalledTimes(2)
    expect(sendText).toHaveBeenCalledTimes(2)
  })

  it('texto vazio autorizado manda frase fixa e nao chama o modelo', async () => {
    const { deps, remetente, processMessage, sendText } = montar()
    app = await buildApp(deps)
    const corpo = corpoSemTexto()

    const resposta = await postar(app, corpo, assinar(remetente, corpo))

    expect(resposta.statusCode).toBe(200)
    expect(processMessage).not.toHaveBeenCalled()
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({
      to: FROM,
      body: FRASE_PEDIDO_DE_TEXTO_WHATSAPP,
      consent: { basis: 'service_reply', inboundAt: RECEBIDA_EM },
      idempotencyKey: MSG_ID,
    })
  })
})

const SILENCIO_PROIBIDO = /cadastrad|não autorizado|nao autorizado|sem vínculo|sem vinculo/i

describe('POST /webhooks/whatsapp com Meta — US2 silencio', () => {
  const peersSilencio: PeerDirectory = {
    resolve: vi.fn().mockResolvedValue(null),
  }

  it('numero sem vinculo com texto responde 200 sem inbox, turno nem envio', async () => {
    const { deps, remetente, processMessage, sendText, inbox } = montar({ peers: peersSilencio })
    app = await buildApp(deps)
    const corpo = corpoTexto('quem sou eu?')

    const resposta = await postar(app, corpo, assinar(remetente, corpo))

    expect(resposta.statusCode).toBe(200)
    expect(resposta.body).toBe('')
    expect(SILENCIO_PROIBIDO.test(resposta.body)).toBe(false)
    expect(processMessage).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(inbox.registros).toHaveLength(0)
    expect(peersSilencio.resolve).toHaveBeenCalledWith(FROM)
  })

  it('numero sem vinculo sem texto responde 200 sem frase fixa nem inbox', async () => {
    const { deps, remetente, processMessage, sendText, inbox } = montar({ peers: peersSilencio })
    app = await buildApp(deps)
    const corpo = corpoSemTexto('wamid.US2.sem.texto')

    const resposta = await postar(app, corpo, assinar(remetente, corpo))

    expect(resposta.statusCode).toBe(200)
    expect(resposta.body).toBe('')
    expect(processMessage).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(inbox.registros).toHaveLength(0)
  })
})

describe('POST /webhooks/whatsapp com Meta — US3 nono digito', () => {
  const FROM_SEM_NONO = '554188888888'
  const CHAVE_CANONICA = '41988888888'

  it('554188888888 autoriza cadastro 41988888888 e responde ao from original', async () => {
    const consultados: string[] = []
    const vinculos: VinculosDoCanal = {
      porTelefone: async (phone) => {
        consultados.push(phone)
        if (phone === CHAVE_CANONICA) {
          return { companyId: EMPRESA, userId: USUARIA }
        }
        return undefined
      },
    }
    const peers: PeerDirectory = {
      resolve: async (peer) => {
        const resultado = await abrirCanal(
          { peers: vinculos },
          { telefone: peer, requestId: 'us3-webhook', agora: new Date(RECEBIDA_EM) },
        )
        if (resultado.status === 'silencio') return null
        return {
          companyId: resultado.ctx.companyId,
          userId: resultado.ctx.userId,
          role: 'owner',
        }
      },
    }

    const { deps, remetente, processMessage, sendText } = montar({ peers })
    app = await buildApp(deps)
    const corpo = corpoTexto('tem estoque?', 'wamid.US3', FROM_SEM_NONO)

    const resposta = await postar(app, corpo, assinar(remetente, corpo))

    expect(resposta.statusCode).toBe(200)
    expect(consultados[0]).toBe(CHAVE_CANONICA)
    expect(processMessage).toHaveBeenCalledOnce()
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({
      to: FROM_SEM_NONO,
      consent: { basis: 'service_reply', inboundAt: RECEBIDA_EM },
    })
  })
})

describe('POST /webhooks/whatsapp com Meta — US4 primeira empresa', () => {
  function corpoComIscaDeEmpresa(texto: string, id = 'wamid.US4'): string {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      companyId: EMPRESA_ISCA,
      entry: [
        {
          company_id: EMPRESA_ISCA,
          changes: [
            {
              value: {
                metadata: {
                  display_phone_number: '5541999990000',
                  company_id: EMPRESA_ISCA,
                },
                messages: [
                  {
                    id,
                    from: FROM,
                    timestamp: String(Math.floor(new Date(RECEBIDA_EM).getTime() / 1000)),
                    type: 'text',
                    text: { body: texto },
                    context: { companyId: EMPRESA_ISCA },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
  }

  it('processMessage usa ctx de abrirCanal e ignora company id no payload Meta', async () => {
    const vinculos: VinculosDoCanal = {
      porTelefone: async () => ({ companyId: EMPRESA, userId: USUARIA }),
    }
    const peers: PeerDirectory = {
      resolve: async (peer) => {
        const resultado = await abrirCanal(
          { peers: vinculos },
          { telefone: peer, requestId: 'us4-webhook', agora: new Date(RECEBIDA_EM) },
        )
        if (resultado.status === 'silencio') return null
        return {
          companyId: resultado.ctx.companyId,
          userId: resultado.ctx.userId,
          role: 'owner',
        }
      },
    }

    let ctxDoTurno: ExecutionContext | undefined
    const ferramentaCaptura: AgentTool = {
      id: 'capturaCtx',
      description: 'captura ctx do turno',
      inputSchema: z.object({}),
      mutatesValue: false,
      execute: async (_input, ctx) => {
        ctxDoTurno = ctx
        return {}
      },
      formatReply: () => 'ok',
      formatProposal: () => 'ok',
    }

    const { deps, remetente, sendText } = montar({
      peers,
      executarTurno: async (runtime, input) =>
        processMessage(
          {
            ...runtime,
            tools: [ferramentaCaptura],
            llm: {
              decide: async () => ({ type: 'tool', name: 'capturaCtx', args: {} }),
            },
          },
          input,
        ),
    })

    app = await buildApp(deps)
    const corpo = corpoComIscaDeEmpresa('vendas de hoje?')

    const resposta = await postar(app, corpo, assinar(remetente, corpo))

    expect(resposta.statusCode).toBe(200)
    expect(ctxDoTurno).toEqual({
      companyId: EMPRESA,
      userId: USUARIA,
      role: 'owner',
      channel: 'whatsapp',
      requestId: expect.any(String),
      now: expect.any(Date),
    })
    expect(ctxDoTurno?.companyId).not.toBe(EMPRESA_ISCA)
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({ companyId: EMPRESA })
  })
})
