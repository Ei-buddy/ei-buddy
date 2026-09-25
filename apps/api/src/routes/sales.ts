import {
  cancelSaleInputSchema,
  createSaleInputSchema,
  returnSaleItemsInputSchema,
  saleHistoryInputSchema,
} from '@na-regua/contracts'
import {
  AppError,
  cancelSale,
  type CancelSaleDeps,
  getSale,
  listSales,
  type ListSalesDeps,
  type RegisterSaleDeps,
  registerSale,
  returnSaleItems,
  type ReturnSaleItemsDeps,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { IDEMPOTENCY_HEADER, requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Rota de venda — NR-027, RF-036, RNF-043.
 *
 * A rota faz quatro coisas e nenhuma delas e regra: le o contexto, valida a
 * forma, chama o caso de uso e traduz o resultado em HTTP. Desconto, alcada,
 * calculo de liquido e idempotencia moram em `core` — se morassem aqui, o canal
 * WhatsApp (NR-060) fecharia venda por outro caminho, com outras regras.
 *
 * Recebe `deps` em vez de importar a composicao: e o que permite testar a rota
 * com repositorio em memoria, sem Postgres.
 */
export type SaleRouteDeps = RegisterSaleDeps & ListSalesDeps & CancelSaleDeps & ReturnSaleItemsDeps

export function registerSaleRoutes(app: FastifyInstance, deps: SaleRouteDeps): void {
  /**
   * O historico de vendas — NR-027, US-021.
   *
   * Esta rota faltava: existia `POST /sales` e mais nada, entao a venda entrava
   * no banco e nao havia por onde le-la. A tela mostrava dados de exemplo.
   *
   * Periodo OPCIONAL, ao contrario do DRE e dos relatorios. La o periodo e a
   * propria pergunta ("como fechou marco"); aqui a pergunta e "o que eu vendi",
   * e a resposta natural comeca pelas mais recentes. Abrir a tela exigindo duas
   * datas antes de mostrar qualquer coisa seria trabalho antes da resposta.
   */
  app.get('/sales', async (request, reply) => {
    const ctx = requireContext(request)

    const input = validate(saleHistoryInputSchema, request.query ?? {})
    const pagina = await listSales(deps, ctx, input)

    return reply.code(200).send(pagina)
  })

  /**
   * Uma venda inteira — US-021.
   *
   * Venda de outra empresa cai em 404, e nao 403: um 403 confirmaria que ela
   * existe em algum lugar, e o numero e sequencial por empresa.
   */
  app.get('/sales/:id', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    const venda = await getSale(deps, ctx, id)

    return reply.code(200).send(venda)
  })

  app.post('/sales', { config: { rateLimit: LIMITE_DE_ESCRITA } }, async (request, reply) => {
    /* Sem sessao valida isto lanca UNAUTHORIZED. Enquanto a NR-014 nao existe,
       toda chamada cai aqui — 401 e melhor que um contexto inventado. */
    const ctx = requireContext(request)

    /*
     * A chave de idempotencia e OBRIGATORIA nesta rota — RNF-043.
     *
     * Ela e opcional no `ExecutionContext` porque a maioria das operacoes nao
     * precisa. Venda precisa: o PDV com internet ruim reenvia, e sem a chave o
     * segundo envio vira uma segunda venda, com segundo estoque baixado e
     * segundo recebivel. Exigir aqui e o que torna o reenvio seguro.
     *
     * 400 e nao 422: o cliente pode corrigir sozinho reenviando com o
     * cabecalho.
     */
    if (ctx.idempotencyKey === undefined) {
      throw AppError.validation(`Envie o cabecalho ${IDEMPOTENCY_HEADER} para registrar a venda.`)
    }

    const input = validate(createSaleInputSchema, request.body)

    const resultado = await registerSale(deps, ctx, input)

    /*
     * 200 no reenvio, 201 na venda nova.
     *
     * A distincao importa para quem integra: 201 diz "criei agora", 200 diz
     * "isto ja existia e e a mesma coisa". Responder 201 sempre faria um
     * integrador contar vendas pelo numero de 201 e contar duas onde houve uma.
     */
    return reply.code(resultado.replayed ? 200 : 201).send({
      sale: resultado.sale,
      /* Item vendido sem saldo e AVISO, nao erro (RF-028): a venda foi
         registrada e o operador precisa saber, mas nada foi recusado. */
      stockWarnings: resultado.stockWarnings,
      replayed: resultado.replayed,
    })
  })

  /**
   * Cancela a venda inteira — RF-043, US-021.
   *
   * POST, e nao DELETE: a venda NAO e apagada (RNF-040). Ela fica no
   * historico, cancelada, com o motivo — que e o que permite responder depois
   * por que o caixa daquele dia nao fecha.
   */
  app.post(
    '/sales/:id/cancelar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const input = validate(cancelSaleInputSchema, {
        saleId: id,
        ...(request.body as Record<string, unknown>),
      })

      await cancelSale(deps, ctx, input)

      return reply.code(204).send()
    },
  )
  /**
   * Devolve parte da venda — RF-044, NR-122.
   *
   * O corpo diz os produtos e quantidades; o valor quem calcula e o servidor.
   * A resposta diz quanto sai do caixa (`paidBackCents`) e quanto so deixa de
   * ser recebido (`uncollectedCents`) — o operador precisa saber o que entregar.
   */
  app.post(
    '/sales/:id/devolucao',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const input = validate(returnSaleItemsInputSchema, {
        saleId: id,
        ...(request.body as Record<string, unknown>),
      })

      return reply.code(200).send(await returnSaleItems(deps, ctx, input))
    },
  )
}
