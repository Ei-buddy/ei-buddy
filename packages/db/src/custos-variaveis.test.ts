import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'
import { createVariableCostRepository } from './variable-cost-repository.js'

/**
 * Custos variaveis — o que so o banco prova: o percentual volta como foi
 * gravado (centesimos de ponto no banco, pontos no contrato), e uma loja nao
 * ve os custos da outra.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('custos variaveis', () => {
  let admin: Sql
  let aplicacao: ConexaoDeAplicacao
  let repo: ReturnType<typeof createVariableCostRepository>
  let empresaA: string
  let empresaB: string
  let usuarioA: string

  async function criarEmpresa(sql: Sql, prefixo: string): Promise<string> {
    const id = randomUUID()
    const cnpj = cnpjDeTeste(prefixo)
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, 'Loja Variavel', ${cnpj}, ${`c@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0031_custos_variaveis')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    repo = createVariableCostRepository(aplicacao.sql)

    empresaA = await criarEmpresa(aplicacao.sql, '7')
    empresaB = await criarEmpresa(aplicacao.sql, '8')

    usuarioA = randomUUID()
    await withTenant(aplicacao.sql, empresaA, async (tx) => {
      await tx`INSERT INTO users (id, name, email) VALUES (${usuarioA}, 'Dona', ${`${usuarioA}@loja.local`})`
      await tx`
        INSERT INTO company_users (company_id, user_id, role) VALUES (${empresaA}, ${usuarioA}, 'owner')
      `
    })
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('grava 3,5% e le de volta 3,5 — e so a propria loja enxerga', async () => {
    const criado = await repo.insert({
      companyId: empresaA,
      name: 'Tarifa do cartao',
      rateBps: 350,
      createdBy: usuarioA,
      createdAt: new Date('2026-09-24T13:00:00.000Z'),
    })

    expect(criado.ratePercent).toBe(3.5)
    expect((await repo.list(empresaA)).map((c) => c.id)).toContain(criado.id)
    expect(await repo.list(empresaB)).toEqual([])
    expect(await repo.findById(empresaB, criado.id)).toBeUndefined()

    await repo.remove(empresaA, criado.id)
    expect(await repo.findById(empresaA, criado.id)).toBeUndefined()
  })
})
