import { createTool } from '@mastra/core/tools'
import {
  catalogInputSchema,
  checkCustomerWalletInputSchema,
  checkStockByQueryInputSchema,
  dreInputSchema,
  listDayAppointmentsInputSchema,
  listPayablesInputSchema,
  rankingInputSchema,
  revenueByMonthInputSchema,
  saleHistoryInputSchema,
} from '@na-regua/contracts'
import { z } from 'zod'
import type { AgentUseCases } from '../catalog.js'
import { reais, semVazios } from '../views.js'
import { emErroHumano, semNulos, turnoDe } from './shared.js'

const vazio = z.object({}).strict()

function entrada<T extends z.ZodType>(schema: T) {
  return z.preprocess(semNulos, schema)
}

function quantidadeEmEstoque(unidades: number | null): string {
  if (unidades === null) return 'sem controle de estoque'
  return unidades === 0 ? 'zerado' : `${unidades} un.`
}

const FAIXA: Record<string, string> = {
  overdue: 'vencidas',
  today: 'vencem hoje',
  week: 'próximos 7 dias',
  month: 'este mês',
  later: 'depois deste mês',
}

/**
 * Consultas — executam o caso de uso de `core` dentro do laço (RF-096).
 *
 * O retorno é uma visão humanizada: o modelo redige a resposta a partir dele,
 * então nada aqui sai em centavos ou com nome de campo do domínio.
 */
export function ferramentasDeLeitura(casos: AgentUseCases) {
  return {
    list_sales: createTool({
      id: 'list_sales',
      description:
        'Vendas de um período (from/to) ou o histórico de compras de um cliente (customerId: nome ou ref): quantidade, total e ticket médio.',
      inputSchema: entrada(saleHistoryInputSchema),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const customerId =
            input.customerId === undefined || casos.resolveCustomerId === undefined
              ? input.customerId
              : await casos.resolveCustomerId(turno.execucao, input.customerId)
          const out = await casos.listSales(turno.execucao, {
            ...input,
            ...(customerId === undefined ? {} : { customerId }),
          })
          const s = out.summary
          return semVazios({
            status: 'ok',
            vendas: s.salesCount,
            bruto: reais(s.grossCents),
            liquido: reais(s.netAfterFeesCents),
            ticketMedio: s.averageTicketCents === null ? undefined : reais(s.averageTicketCents),
            observacao:
              s.salesCount === 0 ? 'nenhuma venda no período; não há ticket médio' : undefined,
          })
        })
      },
    }),

    period_summary: createTool({
      id: 'period_summary',
      description:
        'Resumo do período (from/to) com faturamento, custo, despesas e resultado, iguais aos da tela.',
      inputSchema: entrada(dreInputSchema),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const out = await casos.buildDre(turno.execucao, input)
          return {
            status: 'ok',
            de: out.from,
            ate: out.to,
            faturamento: reais(out.netRevenueCents),
            custo: reais(out.costCents),
            despesas: reais(out.expensesCents),
            resultado: reais(out.resultCents),
          }
        })
      },
    }),

    revenue_by_month: createTool({
      id: 'revenue_by_month',
      description: 'Faturamento líquido por mês no período (from/to).',
      inputSchema: entrada(revenueByMonthInputSchema),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const out = await casos.revenueByMonth(turno.execucao, input)
          return {
            status: 'ok',
            de: out.from,
            ate: out.to,
            total: reais(out.totalNetCents),
            meses: out.months.map((m) => ({
              mes: m.month,
              liquido: reais(m.netCents),
              vendas: m.salesCount,
            })),
          }
        })
      },
    }),

    find_customer: createTool({
      id: 'find_customer',
      description:
        'Procura um cliente pelo nome ou telefone, para saber se existe antes de propor algo para ele.',
      inputSchema: entrada(z.object({ termo: z.string().trim().min(1) }).strict()),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const achados = await casos.searchCustomers(turno.execucao, {
            termo: input.termo,
            limite: 5,
          })
          if (achados.length === 0) return { status: 'nao_encontrado', procurado: input.termo }
          const opcoes = achados.map((c) =>
            semVazios({ ref: c.id, rotulo: c.name, detalhe: c.phone }),
          )
          if (achados.length > 1) return { status: 'varios', opcoes }
          const unico = achados[0]!
          turno.coletor.registrar({ tipo: 'cliente', ref: unico.id, rotulo: unico.name })
          return { status: 'ok', ...opcoes[0]! }
        })
      },
    }),

    find_product: createTool({
      id: 'find_product',
      description:
        'Procura um produto pelo nome ou código de barras, para saber se existe e o preço antes de propor.',
      inputSchema: entrada(z.object({ termo: z.string().trim().min(1) }).strict()),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const achados = await casos.searchProducts(turno.execucao, {
            q: input.termo,
            stock: 'todos',
            page: 1,
            pageSize: 5,
          })
          if (achados.length === 0) return { status: 'nao_encontrado', procurado: input.termo }
          const opcoes = achados.map((p) => ({
            ref: p.id,
            rotulo: p.description,
            detalhe: reais(p.salePriceCents),
            quantidade: quantidadeEmEstoque(p.stock),
          }))
          if (achados.length > 1) return { status: 'varios', opcoes }
          turno.coletor.registrar({
            tipo: 'produto',
            ref: opcoes[0]!.ref,
            rotulo: opcoes[0]!.rotulo,
          })
          return { status: 'ok', ...opcoes[0]! }
        })
      },
    }),

    check_stock: createTool({
      id: 'check_stock',
      description: 'Estoque e preço de um produto pelo nome.',
      inputSchema: entrada(checkStockByQueryInputSchema),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const out = await casos.checkStockByQuery(turno.execucao, input)
          if (out.status === 'not_found')
            return { status: 'nao_encontrado', procurado: input.query }
          if (out.status === 'ambiguous') {
            return {
              status: 'varios',
              opcoes: out.alternatives.slice(0, 5).map((p) => ({
                ref: p.id,
                rotulo: p.description,
                detalhe: reais(p.salePriceCents),
              })),
            }
          }
          const v = out.view
          turno.coletor.registrar({ tipo: 'produto', ref: v.productId, rotulo: v.description })
          return semVazios({
            status: 'ok',
            produto: v.description,
            ref: v.productId,
            quantidade: quantidadeEmEstoque(v.stockQuantity),
            preco: reais(v.salePriceCents),
            localizacao: v.location,
            abaixoDoMinimo: v.belowMinimum ? 'sim' : undefined,
          })
        })
      },
    }),

    search_products: createTool({
      id: 'search_products',
      description: 'Busca produtos do catálogo por nome ou código de barras.',
      inputSchema: entrada(catalogInputSchema),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const produtos = await casos.searchProducts(turno.execucao, input)
          if (produtos.length === 0) return { status: 'nao_encontrado', procurado: input.q ?? '' }
          const opcoes = produtos.slice(0, 5).map((p) => ({
            ref: p.id,
            rotulo: p.description,
            detalhe: reais(p.salePriceCents),
          }))
          if (produtos.length === 1) {
            turno.coletor.registrar({
              tipo: 'produto',
              ref: opcoes[0]!.ref,
              rotulo: opcoes[0]!.rotulo,
            })
            return { status: 'ok', ...opcoes[0]! }
          }
          return { status: 'varios', opcoes }
        })
      },
    }),

    check_customer_wallet: createTool({
      id: 'check_customer_wallet',
      description: 'Quanto um cliente deve no fiado, pelo nome.',
      inputSchema: entrada(checkCustomerWalletInputSchema),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const out = await casos.checkCustomerWalletByQuery(turno.execucao, input)
          if (out.status === 'not_found')
            return { status: 'nao_encontrado', procurado: input.query }
          if (out.status === 'ambiguous') {
            return {
              status: 'varios',
              opcoes: out.alternatives
                .slice(0, 5)
                .map((c) => semVazios({ ref: c.id, rotulo: c.name, detalhe: c.phone })),
            }
          }
          if (out.customerId !== undefined) {
            turno.coletor.registrar({
              tipo: 'cliente',
              ref: out.customerId,
              rotulo: out.customerName,
            })
          }
          return semVazios({
            status: 'ok',
            cliente: out.customerName,
            ref: out.customerId,
            deve: out.walletBalanceCents > 0 ? reais(out.walletBalanceCents) : 'nada',
          })
        })
      },
    }),

    list_payables: createTool({
      id: 'list_payables',
      description: 'Contas a pagar por vencimento: vencidas, hoje, semana e mês.',
      inputSchema: entrada(listPayablesInputSchema),
      execute: async (_input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const out = await casos.listPayables(turno.execucao)
          return {
            status: 'ok',
            totalEmAberto: reais(out.totalCents),
            temVencidas: out.temVencidas ? 'sim' : 'não',
            faixas: out.grupos
              .filter((g) => g.totalCents > 0)
              .map((g) => ({
                faixa: FAIXA[g.faixa] ?? g.faixa,
                total: reais(g.totalCents),
                contas: g.payables.slice(0, 5).map((p) => ({
                  ref: p.id,
                  fornecedor: p.supplier,
                  descricao: p.description,
                  valor: reais(p.amountCents - p.settledAmountCents),
                  vence: p.dueDate,
                })),
              })),
          }
        })
      },
    }),

    list_receivables: createTool({
      id: 'list_receivables',
      description: 'Quem está devendo, com valor e vencimento.',
      inputSchema: entrada(vazio),
      execute: async (_input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const out = await casos.listReceivables(turno.execucao)
          return {
            status: 'ok',
            totalEmAberto: reais(out.totalCents),
            temVencidas: out.temVencidas ? 'sim' : 'não',
            titulos: out.grupos
              .flatMap((g) => g.receivables)
              .slice(0, 8)
              .map((r) =>
                semVazios({
                  ref: r.id,
                  cliente: r.customerName ?? 'cliente não identificado',
                  descricao: r.description,
                  emAberto: reais(r.amountCents - r.settledAmountCents),
                  vence: r.dueDate,
                }),
              ),
          }
        })
      },
    }),

    day_agenda: createTool({
      id: 'day_agenda',
      description: 'Compromissos de um dia (day no formato AAAA-MM-DD).',
      inputSchema: entrada(listDayAppointmentsInputSchema),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const out = await casos.listDayAppointments(turno.execucao, input)
          return {
            status: 'ok',
            dia: out.day,
            livre: out.isEmpty ? 'sim' : 'não',
            compromissos: out.appointments
              .slice(0, 10)
              .map((a) =>
                semVazios({ ref: a.id, titulo: a.title, inicio: a.startsAt, local: a.location }),
              ),
          }
        })
      },
    }),

    rank_customers: createTool({
      id: 'rank_customers',
      description:
        'Ranking dos clientes que mais compraram no período (from/to obrigatórios). Sem período, pergunte.',
      inputSchema: entrada(rankingInputSchema),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const out = await casos.rankCustomers(turno.execucao, input)
          out.customers.forEach((c) =>
            turno.coletor.registrar({ tipo: 'cliente', ref: c.customerId, rotulo: c.customerName }),
          )
          return {
            status: 'ok',
            de: out.from,
            ate: out.to,
            clientes: out.customers.map((c, i) => ({
              posicao: i + 1,
              cliente: c.customerName,
              comprou: reais(c.netCents),
              vendas: c.salesCount,
            })),
          }
        })
      },
    }),

    rank_products: createTool({
      id: 'rank_products',
      description:
        'Ranking dos produtos que mais saíram no período (from/to obrigatórios). Sem período, pergunte.',
      inputSchema: entrada(rankingInputSchema),
      execute: async (input, context) => {
        const turno = turnoDe(context)
        return emErroHumano(async () => {
          const out = await casos.rankProducts(turno.execucao, input)
          out.products.forEach((p) =>
            turno.coletor.registrar({ tipo: 'produto', ref: p.productId, rotulo: p.productName }),
          )
          return {
            status: 'ok',
            de: out.from,
            ate: out.to,
            produtos: out.products.map((p, i) => ({
              posicao: i + 1,
              produto: p.productName,
              quantidade: `${p.quantity} un.`,
              liquido: reais(p.netCents),
            })),
          }
        })
      },
    }),
  }
}
