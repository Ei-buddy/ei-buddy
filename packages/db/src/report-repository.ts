import type { CustomerRank, ProductRank } from '@na-regua/contracts'
import type { MesFaturado, Ranking, ReportRepository } from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * Faturamento e rankings — NR-077, US-041.
 *
 * ## Por que o fuso e um argumento, e nao uma constante
 *
 * "Faturamento de janeiro" e uma pergunta com fuso embutido. Uma venda feita as
 * 21h30 de 31 de janeiro em Sao Paulo e 1 de fevereiro em UTC, e agrupar por
 * `date_trunc('month', created_at)` a jogaria no mes seguinte — o lojista
 * fecharia o mes com uma venda a menos do que fez, sem nunca descobrir por que.
 *
 * Armazenar em UTC continua certo (ver o glossario); agregar em UTC nao e. Por
 * isso o fuso entra por parametro, vindo da `TZ` que ja e a fonte unica do
 * sistema, em vez de ficar escrito aqui: no dia em que a empresa tiver fuso
 * proprio, muda-se quem passa o argumento e nao esta consulta.
 *
 * ## As datas voltam como TEXTO
 *
 * `to_char(... , 'YYYY-MM')` e nao um `date`. O driver devolve `date` como
 * meia-noite UTC, e ler os campos locais desse `Date` em maquina no fuso de
 * Sao Paulo recua um dia — foi assim que todo vencimento apareceu um dia antes.
 * Formatando no banco, ja no fuso certo, nao ha `Date` intermediario para
 * errar.
 *
 * ## Venda cancelada ou devolvida inteira nao entra; a parcial e abatida
 *
 * Devolucao parcial (RF-044): o bruto perde `returned_amount_cents`, o liquido
 * perde a mesma PROPORCAO (o imposto e a tarifa da parte devolvida tambem nao
 * ficam), e o ranking de produto conta `quantity - returned_quantity`. Os tres
 * saem da mesma devolucao, entao fecham entre si.
 */

/**
 * O liquido da venda sem a parte devolvida, na mesma proporcao do bruto.
 * Fragmento aninhado do postgres.js (e nao texto interpolado, que viraria
 * parametro). Bruto zero nao divide: devolve o liquido inteiro.
 */
const liquidoSemDevolucao = (tx: TransactionSql) =>
  tx`(s.net_amount_cents - COALESCE(ROUND(s.net_amount_cents * s.returned_amount_cents::numeric / NULLIF(s.gross_amount_cents, 0)), 0))`

/** bigint volta como texto no driver; `count` tambem. */
const numero = (v: unknown): number => Number(v)

type LinhaDeMes = {
  month: string
  gross_cents: string
  discounts_cents: string
  net_cents: string
  sales_count: string
}

type LinhaDeCliente = {
  sobra_cents: string
  customer_id: string | null
  customer_name: string | null
  net_cents: string | null
  sales_count: string | null
  last_sale_on: string | null
}

type LinhaDeProduto = {
  sobra_cents: string
  product_id: string | null
  product_name: string | null
  quantity: string | null
  net_cents: string | null
}

/**
 * O ranking e a sobra saem da MESMA varredura.
 *
 * A sobra e o complemento do que a lista mostra, e pedi-la em outra consulta
 * varreria as mesmas vendas de novo para responder o que a primeira ja sabia.
 * Como a lista pode vir vazia e a sobra nao, quem manda na quantidade de linhas
 * e a sobra: ela e o lado esquerdo do `LEFT JOIN`, e um periodo sem ranking
 * ainda devolve uma linha — com `customer_id` nulo, que quem le descarta.
 */
function semRanking(id: string | null): boolean {
  return id === null
}

export function createReportRepository(sql: Sql, timeZone: string): ReportRepository {
  return {
    revenueByMonth: async (companyId, from, to): Promise<readonly MesFaturado[]> => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaDeMes[]>`
          SELECT to_char(s.created_at AT TIME ZONE ${timeZone}, 'YYYY-MM') AS month,
                 SUM(s.gross_amount_cents - s.returned_amount_cents) AS gross_cents,
                 SUM(s.discount_cents)     AS discounts_cents,
                 SUM(${liquidoSemDevolucao(tx)}) AS net_cents,
                 COUNT(*)                  AS sales_count
          FROM sales s
          WHERE s.status NOT IN ('cancelled', 'returned')
            AND s.created_at >= (${from}::date)::timestamp AT TIME ZONE ${timeZone}
            AND s.created_at <  (${to}::date + 1)::timestamp AT TIME ZONE ${timeZone}
          GROUP BY 1
          ORDER BY 1
        `,
      )

      return linhas.map((l) => ({
        month: l.month,
        grossCents: numero(l.gross_cents),
        discountsCents: numero(l.discounts_cents),
        netCents: numero(l.net_cents),
        salesCount: numero(l.sales_count),
      }))
    },

    topCustomers: async (companyId, from, to, limit): Promise<Ranking<CustomerRank>> => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaDeCliente[]>`
          WITH vendas AS (
            SELECT s.customer_id, ${liquidoSemDevolucao(tx)} AS net_amount_cents, s.created_at
            FROM sales s
            WHERE s.status NOT IN ('cancelled', 'returned')
              AND s.created_at >= (${from}::date)::timestamp AT TIME ZONE ${timeZone}
              AND s.created_at <  (${to}::date + 1)::timestamp AT TIME ZONE ${timeZone}
          ),
          sobra AS (
            SELECT COALESCE(SUM(v.net_amount_cents), 0) AS cents
            FROM vendas v WHERE v.customer_id IS NULL
          ),
          ranking AS (
            SELECT v.customer_id,
                   SUM(v.net_amount_cents) AS net_cents,
                   COUNT(*)                AS sales_count,
                   to_char(MAX(v.created_at) AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS last_sale_on
            FROM vendas v WHERE v.customer_id IS NOT NULL
            GROUP BY v.customer_id
            ORDER BY net_cents DESC, v.customer_id
            LIMIT ${limit}
          )
          SELECT sb.cents AS sobra_cents,
                 r.customer_id, c.name AS customer_name,
                 r.net_cents, r.sales_count, r.last_sale_on
          FROM sobra sb
          LEFT JOIN ranking r ON true
          LEFT JOIN customers c ON c.id = r.customer_id
          ORDER BY r.net_cents DESC NULLS LAST, r.customer_id
        `,
      )

      return {
        sobraCents: numero(linhas[0]?.sobra_cents ?? 0),
        posicoes: linhas
          .filter((l) => !semRanking(l.customer_id))
          .map((l) => ({
            customerId: l.customer_id!,
            customerName: l.customer_name ?? '',
            netCents: numero(l.net_cents),
            salesCount: numero(l.sales_count),
            lastSaleOn: l.last_sale_on!,
          })),
      }
    },

    topProducts: async (companyId, from, to, limit): Promise<Ranking<ProductRank>> => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaDeProduto[]>`
          WITH itens AS (
            SELECT i.product_id,
                   i.quantity - i.returned_quantity AS quantity,
                   i.total_cents - ROUND(i.total_cents * i.returned_quantity::numeric / i.quantity) AS total_cents
            FROM sale_items i
            JOIN sales s ON s.id = i.sale_id
            WHERE s.status NOT IN ('cancelled', 'returned')
              AND s.created_at >= (${from}::date)::timestamp AT TIME ZONE ${timeZone}
              AND s.created_at <  (${to}::date + 1)::timestamp AT TIME ZONE ${timeZone}
          ),
          sobra AS (
            SELECT COALESCE(SUM(i.total_cents), 0) AS cents
            FROM itens i WHERE i.product_id IS NULL
          ),
          ranking AS (
            SELECT i.product_id,
                   SUM(i.quantity)    AS quantity,
                   SUM(i.total_cents) AS net_cents
            FROM itens i WHERE i.product_id IS NOT NULL
            GROUP BY i.product_id
            ORDER BY quantity DESC, net_cents DESC, i.product_id
            LIMIT ${limit}
          )
          SELECT sb.cents AS sobra_cents,
                 r.product_id, p.description AS product_name,
                 r.quantity, r.net_cents
          FROM sobra sb
          LEFT JOIN ranking r ON true
          LEFT JOIN products p ON p.id = r.product_id
          ORDER BY r.quantity DESC NULLS LAST, r.net_cents DESC, r.product_id
        `,
      )

      return {
        sobraCents: numero(linhas[0]?.sobra_cents ?? 0),
        posicoes: linhas
          .filter((l) => !semRanking(l.product_id))
          .map((l) => ({
            productId: l.product_id!,
            productName: l.product_name ?? '',
            quantity: numero(l.quantity),
            netCents: numero(l.net_cents),
          })),
      }
    },
  }
}
