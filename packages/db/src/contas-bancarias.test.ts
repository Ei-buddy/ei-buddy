import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBankAccountRepository } from './bank-account-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Contas bancarias — RF-073, migration 0036.
 *
 * O que so o banco prova: o saldo sai das baixas que citam a conta, desde a
 * data do saldo inicial, e o nome e unico na loja sem diferenca de caixa.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('contas bancarias — RF-073', () => {
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
    const cnpj = cnpjDeTeste('5')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, ${'Loja das Contas'}, ${cnpj}, ${'c@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  /** Uma baixa de recebimento (+) ou de pagamento (−) citando a conta. */
  async function baixa(tipo: 'receber' | 'pagar', valor: number, conta: string, dia: string) {
    await withTenant(sql, empresa, async (tx) => {
      if (tipo === 'receber') {
        const [r] = await tx<{ id: string }[]>`
          INSERT INTO receivables (company_id, description, amount_cents, net_amount_cents, due_date)
          VALUES (${empresa}, 'Venda', ${valor}, ${valor}, ${dia}) RETURNING id
        `
        await tx`
          INSERT INTO settlements (company_id, receivable_id, amount_cents, method, bank_account, settled_on)
          VALUES (${empresa}, ${r!.id}, ${valor}, 'pix', ${conta}, ${dia})
        `
      } else {
        const [p] = await tx<{ id: string }[]>`
          INSERT INTO payables (company_id, supplier, description, amount_cents, due_date)
          VALUES (${empresa}, 'Fornecedor', 'Compra', ${valor}, ${dia}) RETURNING id
        `
        await tx`
          INSERT INTO settlements (company_id, payable_id, amount_cents, method, bank_account, settled_on)
          VALUES (${empresa}, ${p!.id}, ${valor}, 'transfer', ${conta}, ${dia})
        `
      }
    })
  }

  it('o saldo e o inicial mais o que entrou menos o que saiu, desde a data inicial', async () => {
    const contas = createBankAccountRepository(sql)
    const conta = await contas.insert({
      companyId: empresa,
      name: 'Nubank PJ',
      bank: 'Nubank',
      agency: null,
      accountNumber: null,
      openingBalanceCents: 100_00,
      openingDate: '2026-09-01',
      createdBy: null as never,
      createdAt: new Date(),
    })
    expect(conta?.balanceCents).toBe(100_00)

    await baixa('receber', 50_00, 'nubank pj', '2026-09-10')
    await baixa('pagar', 30_00, 'Nubank PJ', '2026-09-11')
    /* Antes do saldo inicial: ja esta dentro dos R$ 100,00 informados. */
    await baixa('receber', 999_00, 'Nubank PJ', '2026-08-31')
    /* De outra conta: nao entra. */
    await baixa('receber', 7_00, 'Caixa da loja', '2026-09-12')

    expect((await contas.findById(empresa, conta!.id))?.balanceCents).toBe(120_00)
  })

  it('nome repetido, sem diferenca de caixa, e recusado com resposta e nao erro', async () => {
    const contas = createBankAccountRepository(sql)
    const nova = {
      companyId: empresa,
      name: 'CAIXA DA LOJA',
      bank: null,
      agency: null,
      accountNumber: null,
      openingBalanceCents: 0,
      openingDate: '2026-09-01',
      createdBy: null as never,
      createdAt: new Date(),
    }
    expect(await contas.insert(nova)).toBeDefined()
    expect(await contas.insert({ ...nova, name: 'caixa da loja' })).toBeUndefined()
  })
})
