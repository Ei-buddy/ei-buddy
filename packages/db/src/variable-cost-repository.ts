import type { VariableCostOutput } from '@na-regua/contracts'
import type { NewVariableCost, VariableCostRepository } from '@na-regua/core'
import type { Sql } from 'postgres'
import { withTenant } from './tenant.js'

type Linha = {
  id: string
  name: string
  rate_bps: number
  created_at: Date
}

/* O banco guarda centesimos de ponto (350); o contrato fala em pontos (3.5). */
const paraSaida = (l: Linha): VariableCostOutput => ({
  id: l.id,
  name: l.name,
  ratePercent: l.rate_bps / 100,
  createdAt: l.created_at.toISOString(),
})

export function createVariableCostRepository(sql: Sql): VariableCostRepository {
  return {
    list: async (companyId) => {
      const linhas = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT id, name, rate_bps, created_at FROM variable_costs ORDER BY created_at
        `,
      )
      return linhas.map(paraSaida)
    },

    findById: async (companyId, id) => {
      const [linha] = await withTenant(
        sql,
        companyId,
        (tx) => tx<Linha[]>`
          SELECT id, name, rate_bps, created_at FROM variable_costs WHERE id = ${id}
        `,
      )
      return linha === undefined ? undefined : paraSaida(linha)
    },

    insert: async (novo: NewVariableCost) => {
      const [linha] = await withTenant(
        sql,
        novo.companyId,
        (tx) => tx<Linha[]>`
          INSERT INTO variable_costs (company_id, name, rate_bps, created_by, created_at)
          VALUES (${novo.companyId}, ${novo.name}, ${novo.rateBps}, ${novo.createdBy},
                  ${novo.createdAt})
          RETURNING id, name, rate_bps, created_at
        `,
      )
      return paraSaida(linha!)
    },

    remove: async (companyId, id) => {
      await withTenant(sql, companyId, (tx) => tx`DELETE FROM variable_costs WHERE id = ${id}`)
    },
  }
}
