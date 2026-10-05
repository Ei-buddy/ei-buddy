import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDelinquencyQueries } from './delinquency-queries.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/** Inadimplentes — RF-071. O que so o banco prova: o filtro e a soma. */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('inadimplentes — RF-071', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql
    empresa = randomUUID()
    const cnpj = cnpjDeTeste('4')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, ${'Loja Cobranca'}, ${cnpj}, ${'c@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  const dias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

  async function cliente(nome: string): Promise<string> {
    const [c] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO customers (company_id, name) VALUES (${empresa}, ${nome}) RETURNING id
      `,
    )
    return c!.id
  }

  async function titulo(
    clienteId: string,
    valor: number,
    vence: string,
    extra: { descricao?: string; pago?: number } = {},
  ) {
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO receivables
          (company_id, customer_id, description, amount_cents, net_amount_cents,
           settled_amount_cents, due_date, status)
        VALUES (${empresa}, ${clienteId}, ${extra.descricao ?? 'Fiado'}, ${valor}, ${valor},
                ${extra.pago ?? 0}, ${vence},
                ${extra.pago ? 'partially_settled' : 'open'})
      `,
    )
  }

  it('soma so o vencido do cliente, do maior para o menor, com os dias de atraso', async () => {
    const ana = await cliente('Ana Devedora')
    const beto = await cliente('Beto Devedor')
    const carla = await cliente('Carla Em Dia')

    await titulo(ana, 100_00, dias(-10), { pago: 30_00 }) // deve 70
    await titulo(ana, 50_00, dias(-3)) // deve 50
    await titulo(ana, 999_00, dias(-5), { descricao: 'Cartao de credito 1/3' }) // da adquirente
    await titulo(ana, 40_00, dias(5)) // ainda nao venceu
    await titulo(beto, 500_00, dias(-1))
    await titulo(carla, 80_00, dias(2))

    const lista = await createDelinquencyQueries(sql, 'America/Sao_Paulo').list(empresa)

    expect(lista.map((l) => [l.name, l.overdueCents, l.receivablesCount])).toEqual([
      ['Beto Devedor', 500_00, 1],
      ['Ana Devedora', 120_00, 2],
    ])
    expect(lista[1]?.daysOverdue).toBeGreaterThanOrEqual(9)
  })
})
