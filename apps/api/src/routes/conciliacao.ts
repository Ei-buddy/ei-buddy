import {
  confirmReconciliationsInputSchema,
  createEntryFromTransactionInputSchema,
  importStatementInputSchema,
  listBankTransactionsInputSchema,
  reconcileInputSchema,
  suggestMatchesInputSchema,
  undoReconciliationInputSchema,
} from '@na-regua/contracts'
import {
  autoMatch,
  confirmReconciliations,
  createEntryFromTransaction,
  type ImportStatementDeps,
  importStatement,
  listBankTransactions,
  type ListBankTransactionsDeps,
  reconcile,
  type ReconciliationDeps,
  suggestMatches,
  undoReconciliation,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'

/**
 * Extrato e conciliacao — NR-076, RF-076 a RF-080.
 *
 * Como as outras rotas: le o contexto, valida a forma, chama o caso de uso e
 * traduz. A janela de datas, o casamento por valor e a decisao de comparar com
 * o bruto ou com o liquido ficam em `core`.
 */

export type ConciliacaoDeps = ReconciliationDeps & {
  readonly import: ImportStatementDeps
  readonly listQueries: ListBankTransactionsDeps
}

/**
 * Teto do corpo desta rota, so dela.
 *
 * O padrao do Fastify e 1 MB, e base64 infla o arquivo em um terco — um extrato
 * de 900 KB passaria do teto e voltaria como erro generico de corpo grande, que
 * nao diz ao lojista o que fazer. 4 MB cobre extrato anual de conta movimentada
 * e continua longe de ser um vetor de abuso, com o limitador de escrita por
 * cima.
 */
const TETO_DO_EXTRATO = 4 * 1024 * 1024

export function registerConciliacaoRoutes(app: FastifyInstance, deps: ConciliacaoDeps): void {
  /**
   * Importar o extrato — RF-076, RF-077.
   *
   * `200` e nao `201`: reimportar o mesmo arquivo e caso NORMAL e nao cria nada
   * — a resposta diz "0 importadas, 45 ja existiam". Um `201` ali afirmaria uma
   * criacao que nao houve.
   */
  app.post(
    '/extratos',
    { bodyLimit: TETO_DO_EXTRATO, config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(importStatementInputSchema, request.body)

      const r = await importStatement(deps.import, ctx, {
        filename: input.filename,
        /* Bytes, nao texto: quem decide a codificacao e o parser. */
        content: new Uint8Array(Buffer.from(input.contentBase64, 'base64')),
      })

      return reply.code(200).send(r)
    },
  )

  /**
   * A fila — NR-076.
   *
   * O recorte vem na query e nao no caminho (`/transacoes/pendentes`) porque os
   * dois sao a MESMA lista vista de dois angulos: mesma forma de resposta, mesma
   * paginacao no dia em que houver. Caminhos separados convidariam a divergir.
   */
  app.get('/conciliacao/transacoes', async (request, reply) => {
    const ctx = requireContext(request)
    const input = validate(listBankTransactionsInputSchema, request.query ?? {})

    const r = await listBankTransactions(deps.listQueries, ctx, input)

    return reply.code(200).send(r)
  })

  /**
   * Sugestoes para uma transacao — RF-078.
   *
   * Lista vazia e resposta legitima, e nao 404: significa "nada casa com esta",
   * que e o que manda o lojista para o caminho de criar o lancamento (RF-079).
   */
  app.get('/conciliacao/transacoes/:id/sugestoes', async (request, reply) => {
    const ctx = requireContext(request)
    const { id } = request.params as { id: string }

    const input = validate(suggestMatchesInputSchema, { transactionId: id })
    const sugestoes = await suggestMatches(deps, ctx, input)

    return reply.code(200).send({ suggestions: sugestoes })
  })

  /**
   * A fila inteira casada, na ordem do extrato — DEC-026, passo 2.
   *
   * Leitura: o contador ve o casamento como todo mundo. Confirmar, nao.
   */
  app.get('/conciliacao/automatica', async (request, reply) => {
    const ctx = requireContext(request)
    return reply.code(200).send(await autoMatch(deps, ctx))
  })

  /**
   * Confirma os pares conferidos e da baixa, na ordem do extrato — DEC-026,
   * passos 4 e 5. Tudo ou nada.
   */
  app.post(
    '/conciliacao/confirmar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(confirmReconciliationsInputSchema, request.body ?? {})
      return reply.code(200).send(await confirmReconciliations(deps, ctx, input))
    },
  )

  /** Casar com um lancamento existente — RF-079. */
  app.post(
    '/conciliacao/transacoes/:id/conciliar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const corpo = (request.body ?? {}) as Record<string, unknown>

      const input = validate(reconcileInputSchema, { ...corpo, transactionId: id })
      await reconcile(deps, ctx, input)

      return reply.code(200).send({ reconciled: true })
    },
  )

  /**
   * Criar o lancamento a partir da transacao e conciliar — RF-079.
   *
   * `accountId` passou a ser ACEITO na NR-077, quando a tabela `accounts`
   * finalmente ganhou migration. Ate ali esta rota o recusava com mensagem
   * propria: aceitar e descartar daria ao lojista um lancamento que ele
   * acredita ter classificado, e o erro so apareceria no relatorio do contador
   * meses depois.
   */
  app.post(
    '/conciliacao/transacoes/:id/lancamento',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const corpo = (request.body ?? {}) as Record<string, unknown>

      const input = validate(createEntryFromTransactionInputSchema, {
        ...corpo,
        transactionId: id,
      })

      const r = await createEntryFromTransaction(deps, ctx, input)

      return reply.code(201).send(r)
    },
  )

  /**
   * Desfazer — RF-080.
   *
   * `POST .../desfazer` e nao `DELETE`: nada e apagado. A transacao e o
   * lancamento voltam para a fila, e o motivo escrito fica na trilha — sem ele
   * a auditoria registraria que alguem desfez e nao por que, que e a unica
   * pergunta que se faz depois.
   */
  app.post(
    '/conciliacao/transacoes/:id/desfazer',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const corpo = (request.body ?? {}) as Record<string, unknown>

      const input = validate(undoReconciliationInputSchema, { ...corpo, transactionId: id })
      await undoReconciliation(deps, ctx, input)

      return reply.code(200).send({ undone: true })
    },
  )
}
