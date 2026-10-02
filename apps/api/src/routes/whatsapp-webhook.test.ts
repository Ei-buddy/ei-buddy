import {
  processMessage,
  type AgentRuntime,
  type AgentTool,
  type IncomingMessage,
  type PeerDirectory,
} from '@na-regua/agent'
import type { AgentReply, SendMediaRequest, SendTextRequest } from '@na-regua/contracts'
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
    marcados: string[]
  }
  processMessage: (input: IncomingMessage) => Promise<AgentReply>
  sendText: ReturnType<typeof vi.fn>
}

type RemetenteDoWebhook = NonNullable<WhatsAppWebhookRouteDeps['meta']>['remetente']

type RelogioManual = {
  esperar(ms: number): Promise<void>
  avancar(ms: number): Promise<void>
  pendentes(): number
  soltar(): Promise<void>
}

function inboxDeTeste(opcoes: { marcar?: boolean } = {}) {
  const vistos = new Set<string>()
  const processados = new Set<string>()
  const registros: Array<{ eventId: string; payload: unknown }> = []
  const marcados: string[] = []
  const inbox: WebhookInbox & { registros: typeof registros; marcados: string[] } = {
    registros,
    marcados,
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
      marcados.push(eventId)
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

/**
 * A suíte antiga termina o turno sem dormir. Abaixo de 20 s resolve na hora;
 * 20 s nunca resolve, senão o laço de digitando gira sem o assistente acabar.
 */
function schedulerImediato(): { esperar(ms: number): Promise<void> } {
  return {
    esperar(ms: number) {
      if (ms >= 20_000) return new Promise<void>(() => undefined)
      return Promise.resolve()
    },
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
    scheduler: { esperar(ms: number): Promise<void> }
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

  const processMessage = vi.fn(
    ajustes.processMessage ??
      (async () => ({ kind: 'answer', text: 'Resposta do assistente' }) satisfies AgentReply),
  )

  const sendText = vi.fn(async (pedido: SendTextRequest) => remetente.sendText(pedido))

  const remetentePorta = {
    readInbound: (corpo: string, assinatura: string) =>
      ajustes.reentrega === true
        ? new FakeMessageSender({ webhookSecret: SEGREDO }).readInbound(corpo, assinatura)
        : remetente.readInbound(corpo, assinatura),
    sendText: (pedido: SendTextRequest) => sendText(pedido),
    sendMedia: (pedido: SendMediaRequest) => remetente.sendMedia(pedido),
    markRead: (messageId: string) => remetente.markRead(messageId),
    showTyping: (messageId: string) => remetente.showTyping(messageId),
  } satisfies RemetenteDoWebhook

  const deps: WhatsAppWebhookRouteDeps = {
    verificacao: { verifyToken: VERIFY },
    scheduler: ajustes.scheduler ?? schedulerImediato(),
    meta: {
      remetente: remetentePorta,
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

function corpoTexto(texto: string, id = MSG_ID, from = FROM, recebidaEm = RECEBIDA_EM): string {
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
                  timestamp: String(Math.floor(new Date(recebidaEm).getTime() / 1000)),
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
let soltarRelogioAtivo: (() => Promise<void>) | undefined
afterEach(async () => {
  if (soltarRelogioAtivo !== undefined) {
    const soltar = soltarRelogioAtivo
    soltarRelogioAtivo = undefined
    await soltar()
  }
  await app?.close()
  app = undefined
})

const FRASE_DE_FALHA = 'Não consegui responder agora. Tente de novo em instantes.'
const LISTA_EM_ABERTO = 'Em aberto.\n- Ana: R$ 1,00\n- Bruno: R$ 2,00'

function assentar(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/**
 * Relógio dos testes que precisam ver 3 s, 800 ms ou 20 s.
 * `esperar` só termina quando `avancar` alcança o prazo. Sem `setTimeout`.
 */
function relogioManual(): RelogioManual {
  let agora = 0
  let solto = false
  const fila: Array<{ ms: number; ate: number; resolve: () => void }> = []

  function esperar(ms: number): Promise<void> {
    if (solto) {
      if (ms >= 20_000) return new Promise<void>(() => undefined)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      fila.push({ ms, ate: agora + ms, resolve })
    })
  }

  async function drenarCurtas(): Promise<void> {
    for (let volta = 0; volta < 40; volta += 1) {
      const curtas = fila.filter((item) => item.ms < 20_000)
      if (curtas.length === 0) {
        await assentar()
        if (fila.every((item) => item.ms >= 20_000)) return
        continue
      }
      for (const item of curtas) {
        const indice = fila.indexOf(item)
        if (indice >= 0) fila.splice(indice, 1)
        item.resolve()
      }
      await assentar()
    }
  }

  async function avancar(ms: number): Promise<void> {
    agora += ms
    for (;;) {
      const devidos = fila.filter((item) => item.ate <= agora).sort((a, b) => a.ate - b.ate)
      if (devidos.length === 0) return
      for (const item of devidos) {
        const indice = fila.indexOf(item)
        if (indice >= 0) fila.splice(indice, 1)
      }
      for (const item of devidos) {
        item.resolve()
        await assentar()
      }
    }
  }

  const relogio: RelogioManual = {
    esperar,
    avancar,
    pendentes: () => fila.length,
    soltar: async () => {
      solto = true
      await drenarCurtas()
    },
  }
  soltarRelogioAtivo = relogio.soltar
  return relogio
}

async function ateEstacionar(relogio: RelogioManual, quantidade = 1): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (relogio.pendentes() >= quantidade) return
    await assentar()
  }
  throw new Error(`esperado ${quantidade} espera(s), ha ${relogio.pendentes()}`)
}

async function ateCrescer(relogio: RelogioManual, antes: number): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (relogio.pendentes() > antes) return
    await assentar()
  }
  throw new Error(`a fila nao cresceu de ${antes}, ha ${relogio.pendentes()}`)
}

function postarMensagem(instancia: FastifyInstance, remetente: FakeMessageSender, corpo: string) {
  return postar(instancia, corpo, assinar(remetente, corpo))
}

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
      idempotencyKey: `${MSG_ID}:1`,
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
      idempotencyKey: `${MSG_ID}:1`,
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
    expect(remetente.sinais).toEqual([])
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
    expect(remetente.sinais).toEqual([])
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

describe('POST /webhooks/whatsapp — lido na chegada', () => {
  it('texto autorizado grava lido daquele id antes do sendText', async () => {
    const visto: { remetente?: FakeMessageSender; sendText?: ReturnType<typeof vi.fn> } = {}
    const montado = montar({
      processMessage: async () => {
        if (visto.remetente === undefined || visto.sendText === undefined) {
          throw new Error('turno antes da montagem')
        }
        expect(visto.remetente.sinais).toContainEqual({ kind: 'read', messageId: MSG_ID })
        expect(visto.sendText).not.toHaveBeenCalled()
        return { kind: 'answer', text: 'Resposta do assistente' }
      },
    })
    visto.remetente = montado.remetente
    visto.sendText = montado.sendText
    app = await buildApp(montado.deps)

    const resposta = await postarMensagem(app, montado.remetente, corpoTexto('quanto vendi hoje?'))

    expect(resposta.statusCode).toBe(200)
    expect(montado.sendText).toHaveBeenCalledOnce()
    expect(montado.remetente.sinais[0]).toEqual({ kind: 'read', messageId: MSG_ID })
  })

  it('tres textos com ids distintos marcam lido antes do proprio envio', async () => {
    const ids = ['wamid.t1', 'wamid.t2', 'wamid.t3']
    let indice = 0
    const visto: { remetente?: FakeMessageSender; sendText?: ReturnType<typeof vi.fn> } = {}
    const montado = montar({
      processMessage: async () => {
        const id = ids[indice]
        if (id === undefined || visto.remetente === undefined || visto.sendText === undefined) {
          throw new Error('turno antes da montagem')
        }
        expect(visto.remetente.sinais).toContainEqual({ kind: 'read', messageId: id })
        expect(visto.sendText).toHaveBeenCalledTimes(indice)
        indice += 1
        return { kind: 'answer', text: 'ok' }
      },
    })
    visto.remetente = montado.remetente
    visto.sendText = montado.sendText
    app = await buildApp(montado.deps)

    for (const id of ids) {
      const resposta = await postarMensagem(app, montado.remetente, corpoTexto('oi', id))
      expect(resposta.statusCode).toBe(200)
    }

    expect(indice).toBe(3)
    expect(montado.sendText).toHaveBeenCalledTimes(3)
    expect(montado.remetente.sinais.filter((sinal) => sinal.kind === 'read')).toEqual([
      { kind: 'read', messageId: 'wamid.t1' },
      { kind: 'read', messageId: 'wamid.t2' },
      { kind: 'read', messageId: 'wamid.t3' },
    ])
  })

  it('texto vazio ou nulo marca lido, manda a frase fixa e nao espera a rajada', async () => {
    const esperas: number[] = []
    const scheduler = {
      esperar(ms: number) {
        esperas.push(ms)
        if (ms >= 20_000) return new Promise<void>(() => undefined)
        return Promise.resolve()
      },
    }
    const { deps, remetente, processMessage, sendText } = montar({ scheduler })
    app = await buildApp(deps)

    const branco = await postarMensagem(app, remetente, corpoTexto('   \n  ', 'wamid.branco'))
    const semCorpo = await postarMensagem(app, remetente, corpoSemTexto('wamid.vazio'))

    expect(branco.statusCode).toBe(200)
    expect(semCorpo.statusCode).toBe(200)
    expect(processMessage).not.toHaveBeenCalled()
    expect(esperas).not.toContain(3_000)
    expect(sendText).toHaveBeenCalledTimes(2)
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({
      body: FRASE_PEDIDO_DE_TEXTO_WHATSAPP,
      idempotencyKey: 'wamid.branco:1',
    })
    expect(sendText.mock.calls[1]?.[0]).toMatchObject({
      body: FRASE_PEDIDO_DE_TEXTO_WHATSAPP,
      idempotencyKey: 'wamid.vazio:1',
    })
    expect(remetente.sinais).toEqual([
      { kind: 'read', messageId: 'wamid.branco' },
      { kind: 'typing', messageId: 'wamid.branco' },
      { kind: 'read', messageId: 'wamid.vazio' },
      { kind: 'typing', messageId: 'wamid.vazio' },
    ])
  })

  it('numero sem vinculo nao marca lido, nao envia e nao registra a caixa', async () => {
    const peers: PeerDirectory = { resolve: vi.fn().mockResolvedValue(null) }
    const { deps, remetente, processMessage, sendText, inbox } = montar({ peers })
    app = await buildApp(deps)

    const resposta = await postarMensagem(app, remetente, corpoTexto('quem sou eu?'))

    expect(resposta.statusCode).toBe(200)
    expect(remetente.sinais).toEqual([])
    expect(sendText).not.toHaveBeenCalled()
    expect(inbox.registros).toHaveLength(0)
    expect(processMessage).not.toHaveBeenCalled()
  })

  it('falha de presenca ainda envia a resposta', async () => {
    const { deps, remetente, sendText } = montar()
    remetente.configurar({ falhaDePresenca: true })
    app = await buildApp(deps)

    const resposta = await postarMensagem(app, remetente, corpoTexto('tem coca?'))

    expect(resposta.statusCode).toBe(200)
    expect(remetente.sinais).toContainEqual({ kind: 'read', messageId: MSG_ID })
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({ body: 'Resposta do assistente' })
  })
})

describe('POST /webhooks/whatsapp — digitando', () => {
  it('mostra digitando depois do lido e antes do sendText', async () => {
    const visto: { remetente?: FakeMessageSender; sendText?: ReturnType<typeof vi.fn> } = {}
    const montado = montar({
      processMessage: async () => {
        if (visto.remetente === undefined || visto.sendText === undefined) {
          throw new Error('turno antes da montagem')
        }
        expect(visto.remetente.sinais).toEqual([
          { kind: 'read', messageId: MSG_ID },
          { kind: 'typing', messageId: MSG_ID },
        ])
        expect(visto.sendText).not.toHaveBeenCalled()
        return { kind: 'answer', text: 'Resposta do assistente' }
      },
    })
    visto.remetente = montado.remetente
    visto.sendText = montado.sendText
    app = await buildApp(montado.deps)

    const resposta = await postarMensagem(app, montado.remetente, corpoTexto('oi'))

    expect(resposta.statusCode).toBe(200)
    expect(montado.sendText).toHaveBeenCalledOnce()
  })

  it('se o turno lanca, manda a frase de falha uma vez e marca processado', async () => {
    const processMessage = vi.fn(async () => {
      throw new Error('modelo fora')
    })
    const { deps, remetente, sendText, inbox } = montar({ processMessage })
    app = await buildApp(deps)

    const resposta = await postarMensagem(app, remetente, corpoTexto('oi'))

    expect(resposta.statusCode).toBe(200)
    expect(processMessage).toHaveBeenCalledOnce()
    expect(remetente.sinais).toContainEqual({ kind: 'typing', messageId: MSG_ID })
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText).toHaveBeenCalledWith({
      companyId: EMPRESA,
      to: FROM,
      body: FRASE_DE_FALHA,
      consent: { basis: 'service_reply', inboundAt: RECEBIDA_EM },
      idempotencyKey: `${MSG_ID}:1`,
      requestedAt: expect.any(String),
    })
    expect(inbox.marcados).toEqual([MSG_ID])
  })

  it('falha do digitando ainda envia a resposta de verdade', async () => {
    const { deps, remetente, sendText, processMessage } = montar()
    remetente.configurar({ falhaDePresenca: true })
    app = await buildApp(deps)

    const resposta = await postarMensagem(app, remetente, corpoTexto('oi'))

    expect(resposta.statusCode).toBe(200)
    expect(processMessage).toHaveBeenCalledOnce()
    expect(remetente.sinais).toContainEqual({ kind: 'typing', messageId: MSG_ID })
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({ body: 'Resposta do assistente' })
  })

  it('renova o digitando aos 20 s se o turno ainda nao enviou', async () => {
    const relogio = relogioManual()
    const portas: Array<(resposta: AgentReply) => void> = []
    const processMessage = vi.fn(
      () =>
        new Promise<AgentReply>((resolve) => {
          portas.push(resolve)
        }),
    )
    try {
      const { deps, remetente, sendText } = montar({ processMessage, scheduler: relogio })
      app = await buildApp(deps)
      const pendente = postarMensagem(app, remetente, corpoTexto('demora'))
      await ateEstacionar(relogio)

      await relogio.avancar(3_000)
      expect(processMessage).toHaveBeenCalledOnce()
      expect(remetente.sinais.filter((sinal) => sinal.kind === 'typing')).toEqual([
        { kind: 'typing', messageId: MSG_ID },
      ])
      expect(sendText).not.toHaveBeenCalled()

      await relogio.avancar(20_000)
      expect(remetente.sinais.filter((sinal) => sinal.kind === 'typing')).toEqual([
        { kind: 'typing', messageId: MSG_ID },
        { kind: 'typing', messageId: MSG_ID },
      ])
      expect(sendText).not.toHaveBeenCalled()

      const liberar = portas[0]
      if (liberar === undefined) throw new Error('turno nao segurou')
      liberar({ kind: 'answer', text: 'chegou' })
      const resposta = await pendente

      expect(resposta.statusCode).toBe(200)
      expect(sendText).toHaveBeenCalledOnce()
      expect(sendText.mock.calls[0]?.[0]).toMatchObject({ body: 'chegou' })
      expect(remetente.sinais.filter((sinal) => sinal.kind === 'typing')).toHaveLength(2)
    } finally {
      for (const liberar of portas) liberar({ kind: 'answer', text: 'ok' })
      await assentar()
    }
  })
})

describe('POST /webhooks/whatsapp — rajada', () => {
  it('dois textos com 1 s de intervalo viram um turno depois do segundo prazo', async () => {
    const relogio = relogioManual()
    const primeiroEm = RECEBIDA_EM
    const segundoEm = '2026-09-02T13:00:05.000Z'
    const visto: { remetente?: FakeMessageSender; sendText?: ReturnType<typeof vi.fn> } = {}
    let respostasProntas = 0
    const montado = montar({
      scheduler: relogio,
      processMessage: async (input) => {
        if (visto.remetente === undefined || visto.sendText === undefined) {
          throw new Error('turno antes da montagem')
        }
        expect(visto.remetente.sinais.filter((sinal) => sinal.kind === 'read')).toEqual([
          { kind: 'read', messageId: 'wamid.a' },
          { kind: 'read', messageId: 'wamid.b' },
        ])
        expect(visto.sendText).not.toHaveBeenCalled()
        return { kind: 'answer', text: input.text }
      },
    })
    visto.remetente = montado.remetente
    visto.sendText = montado.sendText
    app = await buildApp(montado.deps)

    const p1 = postarMensagem(
      app,
      montado.remetente,
      corpoTexto('  lança uma venda  ', 'wamid.a', FROM, primeiroEm),
    ).then((resposta) => {
      respostasProntas += 1
      return resposta
    })
    await ateEstacionar(relogio)
    expect(montado.remetente.sinais.filter((sinal) => sinal.kind === 'typing')).toEqual([])
    expect(montado.processMessage).not.toHaveBeenCalled()

    await relogio.avancar(1_000)
    const antes = relogio.pendentes()
    const p2 = postarMensagem(
      app,
      montado.remetente,
      corpoTexto('  2 coca  ', 'wamid.b', FROM, segundoEm),
    ).then((resposta) => {
      respostasProntas += 1
      return resposta
    })
    await ateCrescer(relogio, antes)

    expect(montado.processMessage).not.toHaveBeenCalled()
    expect(montado.remetente.sinais.filter((sinal) => sinal.kind === 'typing')).toEqual([])
    expect(montado.sendText).not.toHaveBeenCalled()
    expect(respostasProntas).toBe(0)

    await relogio.avancar(2_999)
    expect(montado.processMessage).not.toHaveBeenCalled()
    expect(montado.remetente.sinais.filter((sinal) => sinal.kind === 'typing')).toEqual([])
    expect(respostasProntas).toBe(0)

    await relogio.avancar(1)
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1.statusCode).toBe(200)
    expect(r2.statusCode).toBe(200)
    expect(respostasProntas).toBe(2)
    expect(montado.processMessage).toHaveBeenCalledOnce()
    expect(montado.processMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'whatsapp',
        peer: FROM,
        text: 'lança uma venda\n2 coca',
      }),
    )
    expect(montado.sendText).toHaveBeenCalledOnce()
    expect(montado.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: FROM,
        idempotencyKey: 'wamid.a:1',
        consent: { basis: 'service_reply', inboundAt: primeiroEm },
      }),
    )
  })

  it('texto que chega depois do turno iniciado nao mistura o corpo', async () => {
    const relogio = relogioManual()
    const portas: Array<(resposta: AgentReply) => void> = []
    const textos: string[] = []
    const processMessage = vi.fn((input: IncomingMessage) => {
      textos.push(input.text)
      return new Promise<AgentReply>((resolve) => {
        portas.push(resolve)
      })
    })
    try {
      const { deps, remetente, sendText } = montar({ processMessage, scheduler: relogio })
      app = await buildApp(deps)

      const p1 = postarMensagem(app, remetente, corpoTexto('primeira', 'wamid.p1'))
      await ateEstacionar(relogio)
      await relogio.avancar(3_000)
      expect(textos).toEqual(['primeira'])

      const antes = relogio.pendentes()
      const p2 = postarMensagem(app, remetente, corpoTexto('segunda', 'wamid.p2'))
      await ateCrescer(relogio, antes)
      await relogio.avancar(3_000)
      expect(textos).toEqual(['primeira'])
      expect(sendText).not.toHaveBeenCalled()

      const liberarPrimeiro = portas[0]
      if (liberarPrimeiro === undefined) throw new Error('primeiro turno nao segurou')
      liberarPrimeiro({ kind: 'answer', text: 'R1' })
      const r1 = await p1
      expect(r1.statusCode).toBe(200)
      expect(textos).toEqual(['primeira', 'segunda'])
      expect(sendText.mock.calls.map((chamada) => (chamada[0] as { body: string }).body)).toEqual([
        'R1',
      ])

      const liberarSegundo = portas[1]
      if (liberarSegundo === undefined) throw new Error('segundo turno nao segurou')
      liberarSegundo({ kind: 'answer', text: 'R2' })
      const r2 = await p2

      expect(r2.statusCode).toBe(200)
      expect(processMessage).toHaveBeenCalledTimes(2)
      expect(textos).toEqual(['primeira', 'segunda'])
      expect(sendText.mock.calls.map((chamada) => (chamada[0] as { body: string }).body)).toEqual([
        'R1',
        'R2',
      ])
    } finally {
      for (const liberar of portas) liberar({ kind: 'answer', text: 'ok' })
      await assentar()
    }
  })

  it('reentrega do mesmo id durante a pausa espera o mesmo turno', async () => {
    const relogio = relogioManual()
    const { deps, remetente, processMessage, sendText } = montar({
      reentrega: true,
      scheduler: relogio,
    })
    app = await buildApp(deps)
    const corpo = corpoTexto('linha unica', 'wamid.mesmo')
    let respostas = 0
    const p1 = postarMensagem(app, remetente, corpo).then((resposta) => {
      respostas += 1
      return resposta
    })
    await ateEstacionar(relogio)
    const antes = relogio.pendentes()
    const p2 = postarMensagem(app, remetente, corpo).then((resposta) => {
      respostas += 1
      return resposta
    })
    for (let i = 0; i < 10; i += 1) await assentar()

    expect(relogio.pendentes()).toBe(antes)
    expect(processMessage).not.toHaveBeenCalled()
    expect(respostas).toBe(0)

    await relogio.avancar(3_000)
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1.statusCode).toBe(200)
    expect(r2.statusCode).toBe(200)
    expect(respostas).toBe(2)
    expect(processMessage).toHaveBeenCalledOnce()
    expect(processMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'linha unica' }))
    expect(sendText).toHaveBeenCalledOnce()
  })

  it('texto que chega com o envio em andamento vira o pedido seguinte', async () => {
    const relogio = relogioManual()
    const textos: string[] = []
    const { deps, remetente, processMessage, sendText } = montar({
      scheduler: relogio,
      processMessage: async (input) => {
        textos.push(input.text)
        if (input.text === 'depois') return { kind: 'answer', text: 'so a segunda' }
        return { kind: 'answer', text: LISTA_EM_ABERTO }
      },
    })
    app = await buildApp(deps)

    const p1 = postarMensagem(app, remetente, corpoTexto('primeira', 'wamid.lista'))
    await ateEstacionar(relogio)
    await relogio.avancar(3_000)

    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({ body: 'Em aberto.' })
    expect(remetente.sinais.filter((sinal) => sinal.kind === 'typing').length).toBeGreaterThan(0)

    const antes = relogio.pendentes()
    const p2 = postarMensagem(app, remetente, corpoTexto('depois', 'wamid.depois'))
    await ateCrescer(relogio, antes)

    await relogio.avancar(799)
    expect(sendText).toHaveBeenCalledTimes(1)

    await relogio.avancar(1)
    expect(sendText).toHaveBeenCalledTimes(2)

    await relogio.avancar(800)
    expect(processMessage).toHaveBeenCalledTimes(1)
    expect(textos).toEqual(['primeira'])
    const partes = sendText.mock.calls.map((chamada) => (chamada[0] as { body: string }).body)
    expect(partes.length).toBeGreaterThanOrEqual(2)
    expect(partes.length).toBeLessThanOrEqual(5)
    expect(partes.some((parte) => parte.split('\n').includes('- Ana: R$ 1,00'))).toBe(true)
    expect(partes.some((parte) => parte.split('\n').includes('- Bruno: R$ 2,00'))).toBe(true)
    expect(partes).not.toContain('so a segunda')

    await relogio.avancar(1_400)
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1.statusCode).toBe(200)
    expect(r2.statusCode).toBe(200)
    expect(processMessage).toHaveBeenCalledTimes(2)
    expect(textos).toEqual(['primeira', 'depois'])
    const finais = sendText.mock.calls.map((chamada) => (chamada[0] as { body: string }).body)
    expect(finais.at(-1)).toBe('so a segunda')
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: 'wamid.lista:1',
      to: FROM,
      consent: { basis: 'service_reply', inboundAt: RECEBIDA_EM },
    })
  })

  it.each([
    ['text null', (id: string) => corpoSemTexto(id)],
    ['so espacos', (id: string) => corpoTexto('  \n ', id)],
  ])(
    '%s durante a pausa nao reinicia os 3 s e a frase sai na hora',
    async (_nome, corpoIntruso) => {
      const relogio = relogioManual()
      const { deps, remetente, processMessage, sendText } = montar({ scheduler: relogio })
      app = await buildApp(deps)
      let textoPronto = false
      const pTexto = postarMensagem(app, remetente, corpoTexto('abrir caixa', 'wamid.texto')).then(
        (resposta) => {
          textoPronto = true
          return resposta
        },
      )
      await ateEstacionar(relogio)
      await relogio.avancar(2_000)
      expect(textoPronto).toBe(false)
      expect(processMessage).not.toHaveBeenCalled()

      const intruso = await postarMensagem(app, remetente, corpoIntruso('wamid.intruso'))

      expect(intruso.statusCode).toBe(200)
      expect(textoPronto).toBe(false)
      expect(processMessage).not.toHaveBeenCalled()
      expect(sendText).toHaveBeenCalledOnce()
      expect(sendText.mock.calls[0]?.[0]).toMatchObject({
        body: FRASE_PEDIDO_DE_TEXTO_WHATSAPP,
        idempotencyKey: 'wamid.intruso:1',
      })
      expect(
        remetente.sinais.filter(
          (sinal) => sinal.kind === 'typing' && sinal.messageId === 'wamid.texto',
        ),
      ).toEqual([])

      await relogio.avancar(1_000)
      const texto = await pTexto
      expect(texto.statusCode).toBe(200)
      expect(processMessage).toHaveBeenCalledOnce()
      expect(processMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'abrir caixa' }))
    },
  )
})

describe('POST /webhooks/whatsapp — baloes e formato', () => {
  it('lista sai em mais de um balao, com digitando e 800 ms entre eles', async () => {
    const relogio = relogioManual()
    const { deps, remetente, sendText } = montar({
      scheduler: relogio,
      processMessage: async () => ({ kind: 'answer', text: LISTA_EM_ABERTO }),
    })
    app = await buildApp(deps)
    const pendente = postarMensagem(app, remetente, corpoTexto('dividas', 'wamid.lista'))
    await ateEstacionar(relogio)
    expect(remetente.sinais.filter((sinal) => sinal.kind === 'typing')).toEqual([])

    await relogio.avancar(3_000)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({
      body: 'Em aberto.',
      idempotencyKey: 'wamid.lista:1',
      to: FROM,
    })

    await relogio.avancar(799)
    expect(sendText).toHaveBeenCalledTimes(1)

    await relogio.avancar(1)
    expect(sendText).toHaveBeenCalledTimes(2)
    expect(
      remetente.sinais.filter((sinal) => sinal.kind === 'typing').length,
    ).toBeGreaterThanOrEqual(2)

    await relogio.avancar(800)
    const resposta = await pendente

    expect(resposta.statusCode).toBe(200)
    const corpos = sendText.mock.calls.map((chamada) => (chamada[0] as { body: string }).body)
    expect(corpos.length).toBeGreaterThanOrEqual(2)
    expect(corpos.length).toBeLessThanOrEqual(5)
    expect(corpos.some((corpo) => corpo.split('\n').includes('- Ana: R$ 1,00'))).toBe(true)
    expect(corpos.some((corpo) => corpo.split('\n').includes('- Bruno: R$ 2,00'))).toBe(true)
    expect(
      sendText.mock.calls.map(
        (chamada) => (chamada[0] as { idempotencyKey: string }).idempotencyKey,
      ),
    ).toEqual(corpos.map((_corpo, indice) => `wamid.lista:${indice + 1}`))
    const digitando = remetente.sinais.filter((sinal) => sinal.kind === 'typing')
    expect(digitando.length).toBe(corpos.length)
    expect(digitando.every((sinal) => sinal.messageId === 'wamid.lista')).toBe(true)
  })

  it('formata negrito de markdown antes de dividir', async () => {
    const { deps, remetente, sendText } = montar({
      processMessage: async () => ({ kind: 'answer', text: '**Total**' }),
    })
    app = await buildApp(deps)

    const resposta = await postarMensagem(app, remetente, corpoTexto('total'))

    expect(resposta.statusCode).toBe(200)
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({ body: '*Total*' })
  })

  it('ignored ou texto em branco nao envia', async () => {
    const fila: AgentReply[] = [
      { kind: 'ignored', text: 'segredo' },
      { kind: 'answer', text: '   ' },
    ]
    let indice = 0
    const processMessage = vi.fn(async () => {
      const resposta = fila[indice]
      indice += 1
      if (resposta === undefined) throw new Error('resposta ausente')
      return resposta
    })
    const { deps, remetente, sendText, inbox } = montar({ processMessage })
    app = await buildApp(deps)

    expect((await postarMensagem(app, remetente, corpoTexto('um', 'wamid.ig'))).statusCode).toBe(
      200,
    )
    expect((await postarMensagem(app, remetente, corpoTexto('dois', 'wamid.br'))).statusCode).toBe(
      200,
    )

    expect(processMessage).toHaveBeenCalledTimes(2)
    expect(sendText).not.toHaveBeenCalled()
    expect(inbox.marcados).toEqual(['wamid.ig', 'wamid.br'])
  })
})
