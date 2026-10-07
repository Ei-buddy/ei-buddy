import {
  exportPeriodInputSchema,
  LIMITE_MAXIMO_DO_RANKING,
  rankingInputSchema,
  revenueByMonthInputSchema,
} from '@na-regua/contracts'
import {
  buildRevenueByMonth,
  rankCustomers,
  rankProducts,
  type RankingDeps,
  type RevenueReportDeps,
} from '@na-regua/core'
import type { FastifyInstance } from 'fastify'
import { requireContext } from '../plugins/execution-context.js'
import { validate } from '../plugins/validate.js'
import { dataBr, enviarTabela, reais } from './exportar-tabela.js'

/**
 * Faturamento e rankings — NR-077, US-041.
 *
 * Separadas de `contabilidade.ts`, onde vive o DRE, porque respondem a outra
 * pergunta: o DRE soma LANCAMENTOS classificados por competencia, e estas somam
 * VENDAS. Junta-las no mesmo arquivo faria parecer que compartilham fonte, e um
 * dia alguem "unificaria" as duas somas e os numeros passariam a discordar.
 *
 * Periodo obrigatorio na query, sem padrao de "mes atual" — pela mesma razao
 * que no DRE: um padrao escondido faz a tela, o assistente e a exportacao
 * discordarem no dia 1 de cada mes.
 */

export type RelatoriosDeps = RevenueReportDeps & RankingDeps

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesBr = (aaaaMm: string) => `${MESES[Number(aaaaMm.slice(5, 7)) - 1]}/${aaaaMm.slice(0, 4)}`

export function registerRelatoriosRoutes(app: FastifyInstance, deps: RelatoriosDeps): void {
  /* Exportar os relatorios — NR-155. O mesmo periodo da tela. */
  app.get('/relatorios/faturamento/exportar', async (request, reply) => {
    const ctx = requireContext(request)
    const { formato, from, to } = validate(exportPeriodInputSchema, request.query ?? {})
    const r = await buildRevenueByMonth(deps, ctx, { from, to })

    return enviarTabela(
      reply,
      formato,
      'faturamento',
      {
        titulo: `Faturamento de ${dataBr(from)} a ${dataBr(to)}`,
        colunas: [
          { titulo: 'Mês', valor: (m) => mesBr(m.month), largura: 75 },
          { titulo: 'Vendas', valor: (m) => String(m.salesCount), largura: 60, alinhar: 'direita' },
          { titulo: 'Bruto', valor: (m) => reais(m.grossCents), largura: 95, alinhar: 'direita' },
          {
            titulo: 'Descontos',
            valor: (m) => reais(m.discountsCents),
            largura: 90,
            alinhar: 'direita',
          },
          { titulo: 'Líquido', valor: (m) => reais(m.netCents), largura: 95, alinhar: 'direita' },
          {
            titulo: 'Ticket médio',
            valor: (m) => (m.averageTicketCents === null ? '—' : reais(m.averageTicketCents)),
            largura: 100,
            alinhar: 'direita',
          },
        ],
        linhas: r.months,
        rodape: ['Total', '', '', '', reais(r.totalNetCents), ''],
      },
      ctx.now,
    )
  })

  app.get('/relatorios/ranking/clientes/exportar', async (request, reply) => {
    const ctx = requireContext(request)
    const { formato, from, to } = validate(exportPeriodInputSchema, request.query ?? {})
    const r = await rankCustomers(deps, ctx, { from, to, limit: LIMITE_MAXIMO_DO_RANKING })

    return enviarTabela(
      reply,
      formato,
      'ranking-clientes',
      {
        titulo: `Clientes que mais compraram — ${dataBr(from)} a ${dataBr(to)}`,
        colunas: [
          { titulo: '#', valor: (c) => String(r.customers.indexOf(c) + 1), largura: 30 },
          { titulo: 'Cliente', valor: (c) => c.customerName, largura: 220 },
          {
            titulo: 'Compras',
            valor: (c) => String(c.salesCount),
            largura: 65,
            alinhar: 'direita',
          },
          { titulo: 'Líquido', valor: (c) => reais(c.netCents), largura: 110, alinhar: 'direita' },
          { titulo: 'Última compra', valor: (c) => dataBr(c.lastSaleOn), largura: 90 },
        ],
        linhas: r.customers,
        rodape: ['', 'Vendas sem cliente', '', reais(r.unidentifiedCents), ''],
      },
      ctx.now,
    )
  })

  app.get('/relatorios/ranking/produtos/exportar', async (request, reply) => {
    const ctx = requireContext(request)
    const { formato, from, to } = validate(exportPeriodInputSchema, request.query ?? {})
    const r = await rankProducts(deps, ctx, { from, to, limit: LIMITE_MAXIMO_DO_RANKING })

    return enviarTabela(
      reply,
      formato,
      'ranking-produtos',
      {
        titulo: `Produtos mais vendidos — ${dataBr(from)} a ${dataBr(to)}`,
        colunas: [
          { titulo: '#', valor: (p) => String(r.products.indexOf(p) + 1), largura: 30 },
          { titulo: 'Produto', valor: (p) => p.productName, largura: 270 },
          {
            titulo: 'Quantidade',
            valor: (p) => String(p.quantity),
            largura: 90,
            alinhar: 'direita',
          },
          { titulo: 'Líquido', valor: (p) => reais(p.netCents), largura: 125, alinhar: 'direita' },
        ],
        linhas: r.products,
        rodape: ['', 'Itens avulsos (sem produto)', '', reais(r.unlinkedCents)],
      },
      ctx.now,
    )
  })

  app.get('/relatorios/faturamento', async (request, reply) => {
    const ctx = requireContext(request)

    const input = validate(revenueByMonthInputSchema, request.query ?? {})
    const faturamento = await buildRevenueByMonth(deps, ctx, input)

    return reply.code(200).send(faturamento)
  })

  app.get('/relatorios/ranking/clientes', async (request, reply) => {
    const ctx = requireContext(request)

    const input = validate(rankingInputSchema, request.query ?? {})
    const ranking = await rankCustomers(deps, ctx, input)

    return reply.code(200).send(ranking)
  })

  app.get('/relatorios/ranking/produtos', async (request, reply) => {
    const ctx = requireContext(request)

    const input = validate(rankingInputSchema, request.query ?? {})
    const ranking = await rankProducts(deps, ctx, input)

    return reply.code(200).send(ranking)
  })
}
