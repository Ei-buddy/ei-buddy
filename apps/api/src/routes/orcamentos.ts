import {
  convertQuoteInputSchema,
  createQuoteInputSchema,
  quoteListInputSchema,
  updateQuoteInputSchema,
} from '@na-regua/contracts'
import {
  cancelQuote,
  convertQuote,
  createQuote,
  getQuote,
  listQuotes,
  type QuoteDeps,
  updateQuote,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Orcamento — NR-159.
 *
 * Nao baixa estoque nem gera financeiro. A conversao NAO cria a venda: a venda
 * nasce no PDV, pelo caminho de sempre, e esta rota so registra de qual
 * orcamento ela veio.
 */
export type OrcamentosDeps = QuoteDeps

type ComId = { Params: { id: string } }

export function registerOrcamentosRoutes(app: FastifyInstance, deps: OrcamentosDeps): void {
  app.get('/orcamentos', async (request, reply) => {
    const ctx = requireContext(request)
    /* Busca, periodo, situacao e pagina — NR-210. Sem nada, a primeira pagina. */
    const input = validate(quoteListInputSchema, request.query ?? {})
    return reply.code(200).send(await listQuotes(deps, ctx, input))
  })

  app.get<ComId>('/orcamentos/:id', async (request, reply) => {
    const ctx = requireContext(request)
    return reply.code(200).send(await getQuote(deps, ctx, request.params.id))
  })

  app.post('/orcamentos', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(createQuoteInputSchema, request.body)
    return reply.code(201).send(await createQuote(deps, ctx, input))
  })

  /* Edicao do orcamento aberto: troca tudo — cliente, itens, validade e desconto. */
  app.put<ComId>(
    '/orcamentos/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(updateQuoteInputSchema, request.body)
      return reply.code(200).send(await updateQuote(deps, ctx, request.params.id, input))
    },
  )

  app.post<ComId>(
    '/orcamentos/:id/cancelar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      return reply.code(200).send(await cancelQuote(deps, ctx, request.params.id))
    },
  )

  app.post<ComId>(
    '/orcamentos/:id/converter',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(convertQuoteInputSchema, request.body)
      return reply.code(200).send(await convertQuote(deps, ctx, request.params.id, input))
    },
  )
}
