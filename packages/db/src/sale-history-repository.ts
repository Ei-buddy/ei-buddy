import type { PaymentMethod } from '@na-regua/contracts'
import type { FiltroDoHistorico, SaleHistoryRepository, VendaDoHistorico } from '@na-regua/core'
import type { Sql, TransactionSql } from 'postgres'
import { withTenant } from './tenant.js'

/**
 * O historico de vendas — NR-027, US-021.
 *
 * Existia `POST /sales` e mais nada: a venda entrava no banco e nao havia por
 * onde le-la. A tela de vendas mostrava `lib/mock-data`, entao o lojista
 * fechava uma venda e o historico continuava sendo o de outra pessoa.
 *
 * ## Itens e pagamentos vem AGREGADOS, e nao em consulta separada
 *
 * Uma venda tem poucos itens e poucos pagamentos, mas uma pagina tem vinte
 * vendas. Buscar os filhos numa segunda consulta por venda daria quarenta e uma
 * idas ao banco para uma tela — o problema classico de N+1, que so aparece
 * quando a loja cresce. `json_agg` num `LATERAL` resolve numa consulta so.
 *
 * ## O fuso e argumento, como nos relatorios
 *
 * "Vendas de 15 de marco" e uma pergunta com fuso embutido: uma venda das 21h30
 * em Sao Paulo e 16 de marco em UTC. O mesmo motivo, a mesma solucao — o fuso
 * vem da `TZ`, que ja e a fonte unica do sistema.
 */

const numero = (v: unknown): number => Number(v)

type LinhaVenda = {
  id: string
  number: string
  created_at: Date
  customer_id: string | null
  customer_name: string | null
  status: string
  gross_amount_cents: string
  discount_cents: string
  net_amount_cents: string
  tax_amount_cents: string
  card_fee_amount_cents: string
  itens: { description: string; quantity: number; unit_price_cents: string; total_cents: string }[]
  pagamentos: { method: string; amount_cents: string; installments: number | null }[]
  invoice_number: number | null
  invoice_access_key: string | null
  total_geral?: string
  resumo_contagem?: string
  resumo_bruto?: string
  resumo_liquido?: string
  resumo_tarifa?: string
}

const paraVenda = (l: LinhaVenda): VendaDoHistorico => ({
  id: l.id,
  number: numero(l.number),
  soldAt: l.created_at.toISOString(),
  customerId: l.customer_id,
  customerName: l.customer_name,
  status: l.status as VendaDoHistorico['status'],
  grossAmountCents: numero(l.gross_amount_cents),
  discountCents: numero(l.discount_cents),
  netAmountCents: numero(l.net_amount_cents),
  taxAmountCents: numero(l.tax_amount_cents),
  cardFeeAmountCents: numero(l.card_fee_amount_cents),
  /* `json_agg` sobre conjunto vazio devolve NULL, e nao `[]`. Com o `LATERAL`
     em `LEFT JOIN`, a venda sem item chega aqui com `itens` nulo — o `?? []` e
     o que impede um `.map` de undefined na venda cancelada sem filhos. */
  items: (l.itens ?? []).map((i) => ({
    description: i.description,
    quantity: i.quantity,
    unitPriceCents: numero(i.unit_price_cents),
    totalCents: numero(i.total_cents),
  })),
  payments: (l.pagamentos ?? []).map((p) => ({
    method: p.method as PaymentMethod,
    amountCents: numero(p.amount_cents),
    installments: p.installments,
  })),
  invoiceNumber: l.invoice_number,
  invoiceAccessKey: l.invoice_access_key,
})

export function createSaleHistoryRepository(sql: Sql, timeZone: string): SaleHistoryRepository {
  /** O SELECT compartilhado pela lista e pela busca de uma venda so. */
  const colunas = (tx: TransactionSql) => tx`
    s.id, s.number, s.created_at, s.customer_id, c.name AS customer_name, s.status,
    s.gross_amount_cents, s.discount_cents, s.net_amount_cents,
    s.tax_amount_cents, s.card_fee_amount_cents,
    i.itens, p.pagamentos,
    nf.number AS invoice_number, nf.access_key AS invoice_access_key
  `

  /*
   * Os filhos por `LATERAL`, e nao por `JOIN` direto.
   *
   * Com `JOIN` a `sales` se multiplicaria por item e por pagamento — uma venda
   * de 3 itens e 2 pagamentos viraria 6 linhas, e `LIMIT 20` cortaria no meio
   * de uma venda. O `LATERAL` agrega antes de juntar, entao cada venda continua
   * sendo uma linha.
   */
  const filhos = (tx: TransactionSql) => tx`
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN LATERAL (
      SELECT json_agg(
               json_build_object(
                 'description', si.description,
                 'quantity', si.quantity,
                 'unit_price_cents', si.unit_price_cents,
                 'total_cents', si.total_cents
               ) ORDER BY si.created_at, si.id
             ) AS itens
      FROM sale_items si WHERE si.sale_id = s.id
    ) i ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(
               json_build_object(
                 'method', pg.method,
                 'amount_cents', pg.amount_cents,
                 'installments', pg.installments
               ) ORDER BY pg.created_at, pg.id
             ) AS pagamentos
      FROM payments pg WHERE pg.sale_id = s.id
    ) p ON true
    LEFT JOIN invoices nf ON nf.sale_id = s.id AND nf.status <> 'cancelled'
  `

  return {
    /**
     * A pagina, o total e o RESUMO, tudo na mesma varredura.
     *
     * As janelas (`OVER ()`) sao calculadas sobre o conjunto filtrado ANTES do
     * `LIMIT` — a mesma propriedade que faz `count(*) OVER ()` devolver 340
     * numa pagina de 20. E o que permite o topo da tela falar do periodo
     * inteiro enquanto a lista mostra vinte linhas.
     *
     * `FILTER` tira a venda cancelada de todos os totais: ela nao aconteceu, e
     * soma-la faria o faturamento contar dinheiro que voltou. Ela continua
     * APARECENDO na lista, porque o lojista precisa ver que cancelou.
     */
    list: async (companyId, filtro: FiltroDoHistorico) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaVenda[]>`
          SELECT ${colunas(tx)},
                 count(*) OVER () AS total_geral,
                 count(*) FILTER (WHERE s.status <> 'cancelled') OVER ()
                   AS resumo_contagem,
                 COALESCE(SUM(s.gross_amount_cents)
                   FILTER (WHERE s.status <> 'cancelled') OVER (), 0) AS resumo_bruto,
                 COALESCE(SUM(s.net_amount_cents)
                   FILTER (WHERE s.status <> 'cancelled') OVER (), 0) AS resumo_liquido,
                 COALESCE(SUM(s.card_fee_amount_cents)
                   FILTER (WHERE s.status <> 'cancelled') OVER (), 0) AS resumo_tarifa
          FROM sales s
          ${filhos(tx)}
          WHERE TRUE
          ${
            filtro.from === undefined
              ? tx``
              : tx`AND s.created_at >= (${filtro.from}::date)::timestamp AT TIME ZONE ${timeZone}`
          }
          ${
            filtro.to === undefined
              ? tx``
              : tx`AND s.created_at < (${filtro.to}::date + 1)::timestamp AT TIME ZONE ${timeZone}`
          }
          ${
            filtro.termo === undefined
              ? tx``
              : tx`AND (
                    c.name ILIKE ${'%' + filtro.termo + '%'}
                    OR s.number::text = ${filtro.termo}
                    OR EXISTS (
                      SELECT 1 FROM sale_items si2
                      WHERE si2.sale_id = s.id
                        AND si2.description ILIKE ${'%' + filtro.termo + '%'}
                    )
                  )`
          }
          ${filtro.customerId === undefined ? tx`` : tx`AND s.customer_id = ${filtro.customerId}`}
          ORDER BY s.created_at DESC, s.number DESC
          LIMIT ${filtro.limite} OFFSET ${filtro.offset}
        `,
      )

      return {
        vendas: linhas.map(paraVenda),
        total: numero(linhas[0]?.total_geral ?? 0),
        resumo: {
          salesCount: numero(linhas[0]?.resumo_contagem ?? 0),
          grossCents: numero(linhas[0]?.resumo_bruto ?? 0),
          netCents: numero(linhas[0]?.resumo_liquido ?? 0),
          cardFeeCents: numero(linhas[0]?.resumo_tarifa ?? 0),
        },
      }
    },

    findById: async (companyId, saleId) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<LinhaVenda[]>`
          SELECT ${colunas(tx)}
          FROM sales s
          ${filhos(tx)}
          WHERE s.id = ${saleId}
        `,
      )

      return linha === undefined ? undefined : paraVenda(linha)
    },
  }
}
