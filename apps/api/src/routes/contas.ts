import {
  createPayableInputSchema,
  createReceivableInputSchema,
  endRecurrenceInputSchema,
  exportarTitulosQuerySchema,
  receivablesFilterSchema,
} from '@na-regua/contracts'
import {
  type ChartOfAccountsRepository,
  createPayable,
  type CreatePayableDeps,
  createReceivable,
  endRecurrence,
  type EndRecurrenceDeps,
  listPayables,
  type ListPayablesDeps,
  listReceivables,
  type ListReceivablesDeps,
  type ManualReceivableUnitOfWork,
} from '@na-regua/core'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'
import { type LinhaExportavel, paraCsv, paraPdf } from './exportar-titulos.js'

/**
 * Contas a pagar e a receber — NR-074, RF-055 a RF-066.
 *
 * Como as outras rotas: le o contexto, valida a forma, chama o caso de uso e
 * traduz. Recorrencia, faixa de vencimento e o total por grupo ficam em `core`
 * e em `domain`.
 *
 * As duas listas convivem no mesmo arquivo porque respondem perguntas
 * simetricas — "o que sai" e "o que entra" — e a tela e a mesma estrutura com a
 * contraparte trocada. Separa-las faria a faixa de vencimento ser explicada
 * duas vezes, e e assim que as duas passam a discordar.
 */

export type ContasDeps = CreatePayableDeps &
  EndRecurrenceDeps &
  ListReceivablesDeps & {
    readonly queries: ListPayablesDeps
    /*
     * Nome proprio, e nao `uow`: `CreatePayableDeps` ja usa essa chave para a
     * unidade de trabalho de PAGAR. As duas sao tipos incompativeis — uma
     * intersecao com o mesmo nome viraria `never`, e o TypeScript recusaria
     * qualquer objeto que tentasse satisfazer `ContasDeps`.
     */
    readonly receivablesUow: ManualReceivableUnitOfWork
    /** So para resolver o NOME do plano de conta na exportacao de pagar. */
    readonly accounts: ChartOfAccountsRepository
  }

/** CSV ou PDF, com os cabecalhos de download — o resto das duas rotas e igual. */
async function enviarExportacao(
  reply: FastifyReply,
  formato: 'csv' | 'pdf',
  nomeArquivo: string,
  titulo: string,
  rotuloClassificacao: string,
  geradoEm: Date,
  linhas: readonly LinhaExportavel[],
): Promise<FastifyReply> {
  reply.header('Content-Disposition', `attachment; filename="${nomeArquivo}.${formato}"`)

  if (formato === 'csv') {
    return reply.type('text/csv; charset=utf-8').send(paraCsv(rotuloClassificacao, linhas))
  }

  return reply.type('application/pdf').send(Buffer.from(await paraPdf(titulo, geradoEm, linhas)))
}

export function registerContasRoutes(app: FastifyInstance, deps: ContasDeps): void {
  /**
   * Lancar — RF-055, RF-057.
   *
   * Devolve a LISTA de ocorrencias, e nao uma so: uma conta recorrente vira N
   * linhas de verdade, e quem lancou precisa ver quantas entraram. `201` porque
   * criou, mesmo quando criou doze.
   */
  app.post(
    '/contas-a-pagar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(createPayableInputSchema, request.body)

      const contas = await createPayable(deps, ctx, input)

      return reply.code(201).send({ payables: contas, count: contas.length })
    },
  )

  /**
   * A lista agrupada por vencimento — RF-061, RF-062.
   *
   * Sem parametro de filtro: o agrupamento e o recorte. Quem quiser "so as
   * vencidas" le o grupo `overdue` da resposta — e assim a tela nao precisa
   * pedir de novo para trocar de aba.
   *
   * `temVencidas` vem no corpo em vez de a tela procurar o grupo e contar: a
   * abertura do sistema pergunta uma coisa so (RF-062), e obriga-la a percorrer
   * a estrutura convida cada tela a responder de um jeito.
   */
  app.get('/contas-a-pagar', async (request, reply) => {
    const ctx = requireContext(request)

    const agrupadas = await listPayables(deps.queries, ctx)

    return reply.code(200).send(agrupadas)
  })

  /**
   * Exportar em CSV ou PDF — o botao "Exportar" que a tela ja tinha, e que ate
   * aqui so respondia com erro.
   *
   * Mesma lista de `GET /contas-a-pagar`, so serializada em outro formato — e
   * por isso nao passa por `assertCanWrite`: e leitura, como a listagem que a
   * origina.
   */
  app.get('/contas-a-pagar/exportar', async (request, reply) => {
    const ctx = requireContext(request)
    const { formato } = validate(exportarTitulosQuerySchema, request.query ?? {})

    const [agrupadas, contas] = await Promise.all([
      listPayables(deps.queries, ctx),
      deps.accounts.list(ctx.companyId),
    ])
    const nomeDaConta = new Map(contas.map((c) => [c.id, c.name]))

    const linhas: LinhaExportavel[] = agrupadas.grupos.flatMap((g) =>
      g.payables.map((p) => ({
        contraparte: p.supplier,
        descricao: p.description,
        classificacao: p.accountId === null ? '' : (nomeDaConta.get(p.accountId) ?? ''),
        vencimento: p.dueDate,
        valorCents: p.amountCents,
        baixadoCents: p.settledAmountCents,
        status: p.status,
      })),
    )

    return enviarExportacao(
      reply,
      formato,
      'contas-a-pagar',
      'Contas a pagar',
      'Plano de conta',
      ctx.now,
      linhas,
    )
  })

  /**
   * O que a loja tem a receber — RF-064, RF-066.
   *
   * Mesma forma da lista a pagar, e de proposito: as duas telas sao a mesma
   * estrutura com a contraparte trocada, e formas diferentes fariam o total
   * significar uma coisa numa e outra na outra.
   *
   * So o que esta em aberto. Recebivel ja recebido nao pertence a "o que entra
   * esta semana", e cancelado nao pertence a lugar nenhum.
   *
   * A rota faltava. A baixa de recebivel existe desde a NR-029
   * (`POST /contas-a-receber/:id/baixas`), mas nao havia como LISTAR o que
   * baixar — a tela do mobile e a do web mostravam recebiveis de exemplo, e o
   * botao de baixa apontava para ids que nao existiam no banco.
   */
  app.get('/contas-a-receber', async (request, reply) => {
    const ctx = requireContext(request)
    /* `?cliente=` — so as pendencias de um cliente, para a ficha dele. */
    const { cliente } = validate(receivablesFilterSchema, request.query ?? {})

    return reply
      .code(200)
      .send(await listReceivables(deps, ctx, cliente === undefined ? {} : { customerId: cliente }))
  })

  /** Exportar em CSV ou PDF — mesma ideia de `/contas-a-pagar/exportar`. */
  app.get('/contas-a-receber/exportar', async (request, reply) => {
    const ctx = requireContext(request)
    const { formato } = validate(exportarTitulosQuerySchema, request.query ?? {})

    const agrupadas = await listReceivables(deps, ctx)

    const linhas: LinhaExportavel[] = agrupadas.grupos.flatMap((g) =>
      g.receivables.map((r) => ({
        contraparte: r.customerName ?? 'Cliente não identificado',
        descricao: r.description,
        classificacao: r.installmentCount > 1 ? `${r.installmentNumber}/${r.installmentCount}` : '',
        vencimento: r.dueDate,
        valorCents: r.amountCents,
        baixadoCents: r.settledAmountCents,
        status: r.status,
      })),
    )

    return enviarExportacao(
      reply,
      formato,
      'contas-a-receber',
      'Contas a receber',
      'Parcela',
      ctx.now,
      linhas,
    )
  })

  /**
   * Lancar recebivel avulso, que nao vem de venda — RF-065.
   *
   * So uma linha, e nao uma lista como em `/contas-a-pagar`: RF-065 nao pede
   * recorrencia para o avulso.
   */
  app.post(
    '/contas-a-receber',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(createReceivableInputSchema, request.body)

      const receivable = await createReceivable({ uow: deps.receivablesUow }, ctx, input)

      return reply.code(201).send(receivable)
    },
  )

  /**
   * Encerrar a recorrencia — RF-058.
   *
   * `POST .../encerrar` e nao `DELETE`: o passado nao e apagado. As ocorrencias
   * ja vencidas continuam devidas, e a resposta diz quantas foram canceladas e
   * quantas ficaram — dizer so "pronto" faria o lojista achar que a serie
   * inteira sumiu.
   */
  app.post(
    '/contas-a-pagar/recorrencias/:id/encerrar',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }

      const input = validate(endRecurrenceInputSchema, { recurrenceId: id })

      const r = await endRecurrence(deps, ctx, input)

      return reply.code(200).send(r)
    },
  )
}
