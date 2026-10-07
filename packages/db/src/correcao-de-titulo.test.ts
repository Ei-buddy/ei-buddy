import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createPayableUnitOfWork } from './payable-repository.js'
import { createManualReceivableUnitOfWork } from './receivable-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Corrigir e cancelar titulo no banco — NR-150.
 *
 * O que so o banco decide: o CHECK `cancelled_at` x status das contas a pagar,
 * o liquido que acompanha o bruto no recebivel avulso, e a RLS escondendo o
 * titulo de outra loja.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('corrigir e cancelar titulo — NR-150', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuarioA: string

  let pagar: ReturnType<typeof createPayableUnitOfWork>
  let receber: ReturnType<typeof createManualReceivableUnitOfWork>

  async function criarEmpresa(cnpj: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, 'Loja Correcao', ${cnpj}, ${`c@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    pagar = createPayableUnitOfWork(sql)
    receber = createManualReceivableUnitOfWork(sql)

    empresaA = await criarEmpresa(cnpjDeTeste('7'))
    empresaB = await criarEmpresa(cnpjDeTeste('8'))

    usuarioA = randomUUID()
    await withTenant(sql, empresaA, async (tx) => {
      await tx`
        INSERT INTO users (id, name, email) VALUES (${usuarioA}, 'Dono', ${`d${usuarioA}@local`})
      `
      await tx`
        INSERT INTO company_users (company_id, user_id, role)
        VALUES (${empresaA}, ${usuarioA}, 'owner')
      `
    })
  }, 60_000)

  /* Sem limpeza: `audit_logs` e so-insercao — ver `contas-a-receber.test.ts`. */
  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  async function novaConta(): Promise<string> {
    const [conta] = await pagar.transaction(empresaA, (tx) =>
      tx.insertMany([
        {
          companyId: empresaA,
          supplier: 'Copel',
          description: 'Energia',
          amountCents: 48_000,
          dueDate: '2026-09-10',
          attachmentKey: null,
          accountId: null,
          recurrenceId: null,
          occurrenceNumber: null,
          occurrenceCount: null,
          createdBy: usuarioA,
          createdAt: new Date('2026-09-02T12:00:00.000Z'),
        },
      ]),
    )
    return conta!.id
  }

  async function novoRecebivel(): Promise<string> {
    const r = await receber.transaction(empresaA, (tx) =>
      tx.insert({
        companyId: empresaA,
        description: 'Aluguel',
        amountCents: 80_000,
        dueDate: '2026-09-15',
        customerId: null,
        accountId: null,
        isCustomerDebt: false,
        createdBy: usuarioA,
        createdAt: new Date('2026-09-02T12:00:00.000Z'),
      }),
    )
    return r.id
  }

  it('conta a pagar: corrige so o que veio', async () => {
    const id = await novaConta()

    const nova = await pagar.transaction(empresaA, (tx) =>
      tx.update(empresaA, id, { amountCents: 51_000, dueDate: '2026-09-12' }),
    )

    expect(nova.amountCents).toBe(51_000)
    expect(nova.dueDate).toBe('2026-09-12')
    expect(nova.supplier).toBe('Copel')
  })

  it('conta a pagar: cancelar grava quem e quando (CHECK do schema)', async () => {
    const id = await novaConta()

    const cancelada = await pagar.transaction(empresaA, (tx) =>
      tx.cancel(empresaA, id, usuarioA, new Date('2026-09-03T12:00:00.000Z')),
    )

    expect(cancelada.status).toBe('cancelled')
  })

  it('conta a pagar de outra loja e invisivel', async () => {
    const id = await novaConta()

    const achada = await pagar.transaction(empresaB, (tx) => tx.findById(empresaB, id))

    expect(achada).toBeNull()
  })

  it('recebivel avulso: liquido acompanha o bruto', async () => {
    const id = await novoRecebivel()

    const novo = await receber.transaction(empresaA, (tx) =>
      tx.update(empresaA, id, { amountCents: 90_000 }),
    )

    expect(novo.amountCents).toBe(90_000)
    expect(novo.netAmountCents).toBe(90_000)
    expect(novo.dueDate).toBe('2026-09-15')
  })

  it('recebivel avulso: acha para mudar e cancela', async () => {
    const id = await novoRecebivel()

    const achado = await receber.transaction(empresaA, (tx) => tx.findForChange(empresaA, id))
    const cancelado = await receber.transaction(empresaA, (tx) => tx.cancel(empresaA, id))

    expect(achado?.isCustomerDebt).toBe(false)
    expect(achado?.receivable.saleId).toBeNull()
    expect(cancelado.status).toBe('cancelled')
  })

  it('recebivel de outra loja e invisivel', async () => {
    const id = await novoRecebivel()

    const achado = await receber.transaction(empresaB, (tx) => tx.findForChange(empresaB, id))

    expect(achado).toBeNull()
  })
})
