import {
  classifyEntryInputSchema,
  createAccountInputSchema,
  deleteAccountInputSchema,
  dreInputSchema,
  exportPeriodInputSchema,
  renameAccountInputSchema,
  suggestAccountInputSchema,
} from '@na-regua/contracts'
import {
  buildDre,
  type BuildDreDeps,
  type ChartDeps,
  classifyEntry,
  createAccount,
  deleteAccount,
  renameAccount,
  suggestAccount,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { LIMITE_DE_ESCRITA } from '../plugins/rate-limit.js'
import { validate } from '../plugins/validate.js'
import { dataBr, enviarTabela, reais } from './exportar-tabela.js'

/**
 * Plano de contas, classificacao e DRE — NR-077, RF-081 a RF-086.
 *
 * Como as outras rotas: le o contexto, valida a forma, chama o caso de uso e
 * traduz. A ordem das subtracoes do DRE fica em `domain`, e e justamente a
 * parte que nao pode variar entre esta rota, o assistente e a exportacao.
 */

export type ContabilidadeDeps = ChartDeps & BuildDreDeps

export function registerContabilidadeRoutes(app: FastifyInstance, deps: ContabilidadeDeps): void {
  /** O plano — RF-081, RF-082. */
  app.get('/contas-contabeis', async (request, reply) => {
    const ctx = requireContext(request)

    const contas = await deps.accounts.list(ctx.companyId)

    return reply.code(200).send({ accounts: contas })
  })

  app.post(
    '/contas-contabeis',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const input = validate(createAccountInputSchema, request.body)

      const conta = await createAccount(deps, ctx, input)

      return reply.code(201).send(conta)
    },
  )

  app.patch(
    '/contas-contabeis/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }
      const corpo = (request.body ?? {}) as Record<string, unknown>

      const input = validate(renameAccountInputSchema, { ...corpo, accountId: id })
      const conta = await renameAccount(deps, ctx, input)

      return reply.code(200).send(conta)
    },
  )

  /**
   * Apagar — RF-082.
   *
   * `DELETE` de verdade, e nao cancelamento: conta do plano nao e movimento, e
   * a RNF-040 fala de dado do negocio. O que a regra protege e o lancamento —
   * conta COM lancamento nao pode ser apagada, e o caso de uso recusa com o
   * numero deles na mensagem.
   */
  app.delete(
    '/contas-contabeis/:id',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { id } = request.params as { id: string }

      const input = validate(deleteAccountInputSchema, { accountId: id })
      await deleteAccount(deps, ctx, input)

      return reply.code(204).send()
    },
  )

  /** Classificar um lancamento — RF-083. */
  app.put(
    '/lancamentos/:kind/:id/conta',
    { config: { rateLimit: LIMITE_DE_ESCRITA } },
    async (request, reply) => {
      const ctx = requireContext(request)
      const { kind, id } = request.params as { kind: string; id: string }
      const corpo = (request.body ?? {}) as Record<string, unknown>

      const input = validate(classifyEntryInputSchema, {
        ...corpo,
        entryKind: kind,
        entryId: id,
      })

      await classifyEntry(deps, ctx, input)

      return reply.code(200).send({ classified: true })
    },
  )

  /**
   * Sugestao pelo historico — RF-084.
   *
   * `GET` com a contraparte na query: e leitura, e o mesmo fornecedor
   * consultado duas vezes tem de dar a mesma resposta. Lista vazia significa
   * "nunca classifiquei nada deste fornecedor", que e uma resposta e nao um
   * erro — a tela entao mostra o plano inteiro.
   */
  app.get('/lancamentos/:kind/sugestao-de-conta', async (request, reply) => {
    const ctx = requireContext(request)
    const { kind } = request.params as { kind: string }
    const { counterparty } = (request.query ?? {}) as { counterparty?: string }

    const input = validate(suggestAccountInputSchema, {
      entryKind: kind,
      counterparty: counterparty ?? '',
    })

    const sugestoes = await suggestAccount(deps, ctx, input)

    return reply.code(200).send({ suggestions: sugestoes })
  })

  /**
   * DRE do periodo — RF-085, RF-086.
   *
   * Periodo obrigatorio na query, sem padrao de "mes atual" aqui. Um padrao
   * escondido na rota faria a tela, o assistente e a exportacao discordarem no
   * dia 1 de cada mes — cada um com a sua ideia de qual e o mes corrente. Quem
   * escolhe o periodo e quem pergunta.
   */
  /**
   * Exportar o DRE — NR-155. O resumo em cima, a conta a conta embaixo: e o
   * papel que vai para o contador.
   */
  app.get('/relatorios/dre/exportar', async (request, reply) => {
    const ctx = requireContext(request)
    const { formato, from, to } = validate(exportPeriodInputSchema, request.query ?? {})
    const d = await buildDre(deps, ctx, { from, to })

    const ROTULO_TIPO: Record<string, string> = {
      revenue: 'Receita',
      deduction: 'Dedução',
      cost: 'Custo',
      expense: 'Despesa',
    }
    const linhas: { rotulo: string; valor: string }[] = [
      { rotulo: 'Receita bruta', valor: reais(d.grossRevenueCents) },
      { rotulo: '(-) Deduções', valor: reais(d.deductionsCents) },
      { rotulo: '= Receita líquida', valor: reais(d.netRevenueCents) },
      { rotulo: '(-) Custos', valor: reais(d.costCents) },
      { rotulo: '= Lucro bruto', valor: reais(d.grossProfitCents) },
      { rotulo: '(-) Despesas', valor: reais(d.expensesCents) },
      { rotulo: '= Resultado', valor: reais(d.resultCents) },
      { rotulo: '', valor: '' },
      { rotulo: 'Por conta', valor: '' },
      ...d.lines.map((l) => ({
        rotulo: `${ROTULO_TIPO[l.type] ?? l.type} · ${l.accountName}`,
        valor: reais(l.amountCents),
      })),
    ]

    return enviarTabela(
      reply,
      formato,
      'dre',
      {
        titulo: `DRE de ${dataBr(from)} a ${dataBr(to)}`,
        colunas: [
          { titulo: 'Linha', valor: (l) => l.rotulo, largura: 375 },
          { titulo: 'Valor', valor: (l) => l.valor, largura: 140, alinhar: 'direita' },
        ],
        linhas,
      },
      ctx.now,
    )
  })

  app.get('/relatorios/dre', async (request, reply) => {
    const ctx = requireContext(request)

    const input = validate(dreInputSchema, request.query ?? {})
    const dre = await buildDre(deps, ctx, input)

    return reply.code(200).send(dre)
  })
}
