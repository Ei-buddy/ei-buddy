import {
  processMessage,
  type AgentRuntime,
  type IncomingMessage,
  type PeerDirectory,
} from '@na-regua/agent'
import type { AgentReply } from '@na-regua/contracts'
import type { WebhookInbox } from '@na-regua/core'
import type { SendTextRequest } from '@na-regua/contracts'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { criarRemetenteMeta } from '@na-regua/whatsapp'
import { responderVerificacao } from '@na-regua/whatsapp'

export type WhatsAppWebhookRouteDeps = {
  /**
   * Handshake GET da Meta — basta `WHATSAPP_VERIFY_TOKEN`. Ausente: GET 503.
   */
  readonly verificacao?: {
    readonly verifyToken: string
  }
  /**
   * POST inbound — exige `WHATSAPP_PROVIDER=meta`, token de envio, phone id e
   * App Secret (`WHATSAPP_WEBHOOK_SECRET`). Ausente: POST 503 ou 401 se só o
   * verify token estiver configurado.
   */
  readonly meta?:
    | {
        readonly remetente: ReturnType<typeof criarRemetenteMeta>
        readonly peers: PeerDirectory
        readonly inbox: WebhookInbox
        /** Ausente quando o assistente nao montou; texto vazio ainda recebe frase fixa. */
        readonly runtime?: AgentRuntime
        /**
         * Permite substituir em teste. Produção usa `processMessage` no runtime
         * com `peers` do webhook.
         */
        readonly executarTurno?: (
          runtime: AgentRuntime,
          input: IncomingMessage,
        ) => Promise<AgentReply>
      }
    | undefined
}

const INDISPONIVEL = { error: { code: 'UNAVAILABLE' as const } }
const PROVEDOR = 'meta'
const CABECALHO_ASSINATURA = 'x-hub-signature-256'

/** Mensagem fixa quando a dona manda mídia ou corpo vazio — sem modelo (RNF-073). */
export const FRASE_PEDIDO_DE_TEXTO_WHATSAPP =
  'Envie sua pergunta ou pedido por texto para eu poder ajudar.'

const RESPOSTAS_VISIVEIS = new Set<AgentReply['kind']>([
  'answer',
  'clarify',
  'unknown',
  'confirmation',
])

/**
 * Webhook do WhatsApp — NR-046, RNF-028.
 *
 * Mesmo desenho do Asaas: escopo com parser de corpo em string, sem sessao.
 * O HMAC da Meta e sobre os bytes que chegaram; reserializar depois de
 * `JSON.parse` muda a assinatura e nenhum POST legitimo passa.
 */
export function registerWhatsAppWebhookRoutes(
  app: FastifyInstance,
  deps: WhatsAppWebhookRouteDeps,
): void {
  void app.register(
    async (escopo) => {
      escopo.addContentTypeParser(
        'application/json',
        { parseAs: 'string' },
        (_request, body, done) => {
          done(null, body)
        },
      )

      escopo.get('/whatsapp', async (request, reply) => {
        const verifyToken = deps.verificacao?.verifyToken
        if (verifyToken === undefined) {
          return reply.code(503).send(INDISPONIVEL)
        }

        const consulta = request.query as Record<string, string | undefined>
        const challenge = responderVerificacao(
          {
            mode: consulta['hub.mode'] ?? '',
            token: consulta['hub.verify_token'] ?? '',
            challenge: consulta['hub.challenge'] ?? '',
          },
          verifyToken,
        )

        if (challenge === undefined) {
          return reply.code(403).send()
        }

        return reply.type('text/plain').code(200).send(challenge)
      })

      escopo.post('/whatsapp', async (request, reply) => {
        const meta = deps.meta
        if (meta === undefined) {
          if (deps.verificacao !== undefined) {
            return reply
              .code(401)
              .send({ error: { code: 'UNAUTHORIZED', message: 'Nao autorizado.' } })
          }
          return reply.code(503).send(INDISPONIVEL)
        }

        const corpoBruto = typeof request.body === 'string' ? request.body : ''
        const assinatura = cabecalhoAssinatura(request)
        const leitura = meta.remetente.readInbound(corpoBruto, assinatura)

        if (leitura.status === 'invalid_signature') {
          return reply
            .code(401)
            .send({ error: { code: 'UNAUTHORIZED', message: 'Nao autorizado.' } })
        }
        if (leitura.status === 'malformed') {
          return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: leitura.reason } })
        }
        if (leitura.status === 'ignored') {
          return reply.code(200).send()
        }

        const inbound = leitura.message
        const vinculo = await meta.peers.resolve(inbound.from)
        if (vinculo === null) {
          /* Número sem vínculo, inativo ou não-dona: não grava, não chama o
             assistente, não envia (data-model NR-046). */
          return reply.code(200).send()
        }

        const texto = inbound.text?.trim() ?? ''
        const kind = texto === '' ? 'empty' : 'text'
        const agora = new Date()
        const requestId = request.id

        const novo = await meta.inbox.registrar({
          provider: PROVEDOR,
          eventId: inbound.providerMessageId,
          companyId: vinculo.companyId,
          payload: { kind, id: inbound.providerMessageId },
          receivedAt: agora,
        })

        if (!novo) {
          return reply.code(200).send()
        }

        request.log.info(
          { requestId, companyId: vinculo.companyId, userId: vinculo.userId },
          'whatsapp webhook turno',
        )

        const turno = meta.executarTurno ?? ((runtime, input) => processMessage(runtime, input))

        let corpoResposta: string | undefined
        if (texto === '') {
          corpoResposta = FRASE_PEDIDO_DE_TEXTO_WHATSAPP
        } else if (meta.runtime !== undefined) {
          const entrada: IncomingMessage = {
            text: texto,
            requestId,
            now: agora,
            channel: 'whatsapp',
            peer: inbound.from,
          }
          const resposta = await turno(meta.runtime, entrada)
          if (RESPOSTAS_VISIVEIS.has(resposta.kind) && resposta.text.trim() !== '') {
            corpoResposta = resposta.text
          }
        }

        if (corpoResposta !== undefined) {
          const pedido: SendTextRequest = {
            companyId: vinculo.companyId,
            to: inbound.from,
            body: corpoResposta,
            consent: { basis: 'service_reply', inboundAt: inbound.receivedAt },
            idempotencyKey: inbound.providerMessageId,
            requestedAt: agora.toISOString(),
          }
          await meta.remetente.sendText(pedido)
        }

        await meta.inbox.marcarProcessado({
          provider: PROVEDOR,
          eventId: inbound.providerMessageId,
          companyId: vinculo.companyId,
          processedAt: new Date(),
        })

        return reply.code(200).send()
      })
    },
    { prefix: '/webhooks' },
  )
}

function cabecalhoAssinatura(request: FastifyRequest): string {
  const bruto = request.headers[CABECALHO_ASSINATURA]
  return typeof bruto === 'string' ? bruto : ''
}
