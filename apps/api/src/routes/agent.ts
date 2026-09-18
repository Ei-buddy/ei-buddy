import { processMessage, type AgentRuntime, type IncomingMessage } from '@na-regua/agent'
import { agentMessageInputSchema, type AgentReply } from '@na-regua/contracts'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Canal HTTP do assistente — NR-060, FR-001b, sem WhatsApp.
 *
 * Harness de engenharia: a mesma `processMessage` do webhook futuro. O
 * contexto vem da sessao autenticada da fixture (`channel: 'app'`), nunca de
 * `companyId` no body (schema strict so aceita `text` e `image`). Nao e canal de
 * produto do lojista nesta fatia — producao fica 503 ate NR-113 / NR-121,
 * salvo `AGENT_HARNESS=1` em staging.
 */

export type AgentRouteDeps = {
  readonly runtime: AgentRuntime
}

const MENSAGEM_HARNESS_DESLIGADO =
  'Assistente indisponivel: harness de engenharia desligado (FR-001b). ' +
  'Use sessao de fixture em nao-producao, ou AGENT_HARNESS=1 em staging. ' +
  'Nenhum usuario final do produto usa este canal.'

export function registerAgentRoutes(
  app: FastifyInstance,
  deps: AgentRouteDeps | null,
  motivo?: string,
): void {
  /*
   * Sem runtime configurado, a rota recusa e o resto da api continua servindo
   * — mesmo desfecho da emissao fiscal sem `SECRETS_KEY`. O caminho fica
   * registrado de proposito: 503 com motivo e uma resposta, e 404 seria a tela
   * concluindo que o assistente nunca existiu.
   */
  if (deps === null) {
    app.post(
      '/agent/messages',
      { config: { rateLimit: LIMITE_DE_ESCRITA } },
      async (_request, reply) =>
        reply.code(503).send({
          error: {
            code: 'UNAVAILABLE',
            message: motivo ?? MENSAGEM_HARNESS_DESLIGADO,
          },
        }),
    )
    return
  }

  app.post(
    '/agent/messages',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(agentMessageInputSchema, request.body)

      const mensagem: IncomingMessage = {
        text: input.text ?? '',
        requestId: ctx.requestId,
        now: ctx.now,
        channel: 'app',
        ctx,
        ...(input.image === undefined
          ? {}
          : {
              image: {
                mimeType: input.image.mimeType,
                bytes: Uint8Array.from(Buffer.from(input.image.dataBase64, 'base64')),
              },
            }),
      }

      const resposta: AgentReply = await processMessage(deps.runtime, mensagem)
      return reply.code(200).send(resposta)
    },
  )
}
