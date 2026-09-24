import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCustomerContactRepository } from './customer-contacts-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Contatos do cliente — RF-011, NR-072.
 *
 * So o que o banco prova e o falso nao: que inserir contato para cliente de
 * OUTRA loja e recusado (a RLS nao pega — a linha nova levaria o `company_id`
 * do contexto apontando para um cliente do vizinho, e a chave estrangeira nao
 * sabe de tenant), que `happened_on` nao escorrega de fuso, e que a leitura
 * nao atravessa loja. Ordem e limite tem cobertura em `core`.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('contatos do cliente — NR-072', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuario: string
  let clienteA: string
  let clienteB: string

  let repo: ReturnType<typeof createCustomerContactRepository>

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`ct@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarCliente(empresa: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO customers (id, company_id, name)
        VALUES (${id}, ${empresa}, ${nome})
      `,
    )
    return id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0030_contatos_do_cliente')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('7'), 'Loja Contatos A')
    empresaB = await criarEmpresa(cnpjDeTeste('9'), 'Loja Contatos B')

    usuario = randomUUID()
    await admin`
      INSERT INTO users (id, name, email, phone)
      VALUES (${usuario}, 'Operador', ${`op-${usuario}@local`}, '41999990001')
    `

    clienteA = await criarCliente(empresaA, 'Joao do Bar')
    clienteB = await criarCliente(empresaB, 'Cliente da outra loja')

    repo = createCustomerContactRepository(sql)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM customer_contacts`
        await tx`DELETE FROM customers`
        await tx`DELETE FROM companies`
      })
    }
    await admin`DELETE FROM users WHERE id = ${usuario}`
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  const contato = (
    customerId: string,
    companyId: string,
    extras: Record<string, unknown> = {},
  ) => ({
    companyId,
    customerId,
    kind: 'call' as const,
    description: 'Confirmou o pedido 8891.',
    happenedOn: '2026-09-20',
    createdBy: usuario,
    ...extras,
  })

  /* `date` sem fuso vira `Date` a meia-noite UTC no driver; sem o `::text`, o
     dia 20 apareceria como 19 para quem esta a oeste de Greenwich. */
  it('grava e a data volta sem escorregar de fuso', async () => {
    const gravado = await repo.create(contato(clienteA, empresaA))

    expect(gravado?.description).toBe('Confirmou o pedido 8891.')
    expect(gravado?.happenedOn).toBe('2026-09-20')
  })

  it('recusa contato para cliente de outra loja', async () => {
    expect(await repo.create(contato(clienteB, empresaA))).toBeUndefined()
  })

  it('nao enxerga contato da loja do lado', async () => {
    await repo.create(contato(clienteB, empresaB, { description: 'So da B.' }))

    /* Mesmo id de cliente, outro tenant: a RLS esconde a linha, e o resultado
       e uma lista vazia — nao um erro que confirmaria que ela existe. */
    expect(await repo.listByCustomer(empresaA, clienteB, 50)).toHaveLength(0)
  })
})
