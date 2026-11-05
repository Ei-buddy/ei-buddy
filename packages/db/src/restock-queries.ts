import type { CandidatoAReposicao, RestockQueries } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

type Linha = {
  id: string
  description: string
  internal_code: string
  unit_of_measure: string
  stock: number
  min_stock: number
  vendido: string
}

/**
 * Os candidatos a reposicao — ver `suggestRestock` em `core`.
 *
 * O vendido e por produto, em vendas que nao foram canceladas nem devolvidas
 * inteiras, menos o que voltou na devolucao parcial: o que voltou para a
 * prateleira nao precisa ser recomprado.
 */
export function createRestockQueries(sql: Sql): RestockQueries {
  return {
    candidates: async (companyId, since): Promise<readonly CandidatoAReposicao[]> => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT p.id, p.description, p.internal_code, p.unit_of_measure, p.stock, p.min_stock,
                 COALESCE(v.vendido, 0)::text AS vendido
            FROM products p
            LEFT JOIN LATERAL (
              SELECT SUM(si.quantity - si.returned_quantity) AS vendido
                FROM sale_items si
                JOIN sales s ON s.id = si.sale_id
               WHERE si.product_id = p.id
                 AND s.status NOT IN ('cancelled', 'returned')
                 AND s.created_at >= ${since}::date
            ) v ON true
           WHERE p.deleted_at IS NULL
             AND p.is_active
             AND (COALESCE(v.vendido, 0) > 0
                  OR p.stock < 0
                  OR (p.min_stock > 0 AND p.stock < p.min_stock))
        `,
      )
      return linhas.map((l) => ({
        productId: l.id,
        description: l.description,
        internalCode: l.internal_code,
        unitOfMeasure: l.unit_of_measure,
        stock: Number(l.stock),
        minStock: Number(l.min_stock),
        vendido: Number(l.vendido),
      }))
    },
  }
}
