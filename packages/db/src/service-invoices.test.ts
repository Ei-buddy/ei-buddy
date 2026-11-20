import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createServiceInvoiceRepository } from './service-invoice-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * A NFS-e da venda — NR-241.
 *
 * O que so o banco prova: uma NFS-e por venda, o segundo clique que perde, a
 * rejeitada que volta a processar, a resposta atrasada que nao desfaz uma
 * autorizacao, e o isolamento entre empresas.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('NFS-e da venda — NR-241', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let repo: ReturnType<typeof createServiceInvoiceRepository>

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone, city, state, national_service_code)
        VALUES (${id}, ${nome}, ${cnpj}, ${`c@${cnpj}.local`}, '41999990000', 'Curitiba', 'PR', '060101')
      `,
    )
    return id
  }

  /** Venda com um corte (servico, com NBS) e uma pomada (mercadoria). */
  async function criarVenda(empresa: string): Promise<string> {
    const id = randomUUID()
    await withTenant(sql, empresa, async (tx) => {
      const [contador] = await tx<{ next_counter: string }[]>`SELECT next_counter('sale')`
      const corte = randomUUID()
      const pomada = randomUUID()
      await tx`
        INSERT INTO products (id, company_id, description, internal_code, unit_of_measure,
                              sale_price_cents, nbs_code)
        VALUES (${corte}, ${empresa}, 'Corte', ${`C-${corte.slice(0, 8)}`}, 'un', 6000, '101011000'),
               (${pomada}, ${empresa}, 'Pomada', ${`P-${pomada.slice(0, 8)}`}, 'un', 4000, NULL)
      `
      await tx`
        INSERT INTO sales (id, company_id, number, gross_amount_cents, discount_cents, net_amount_cents)
        VALUES (${id}, ${empresa}, ${contador!.next_counter}, 10000, 1000, 9000)
      `
      await tx`
        INSERT INTO sale_items (company_id, sale_id, product_id, description, unit_of_measure,
                                quantity, unit_price_cents, total_cents)
        VALUES (${empresa}, ${id}, ${corte}, 'Corte', 'un', 1, 6000, 6000),
               (${empresa}, ${id}, ${pomada}, 'Pomada', 'un', 1, 4000, 4000)
      `
    })
    return id
  }

  const pedido = {
    amountCents: 6000,
    discountCents: 600,
    description: '1x Corte',
    requestedAt: new Date('2026-11-20T23:30:00Z'),
  }
  const AUTORIZADA = {
    status: 'authorized' as const,
    number: '74798',
    accessKey: '4'.repeat(50),
    danfseUrl: 'https://nfse.invalid/x.pdf',
    xmlPath: '/x.xml',
    issuedAt: '2026-11-20T20:31:00-03:00',
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0054_notas_de_servico')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('6'), 'Barbearia A')
    empresaB = await criarEmpresa(cnpjDeTeste('7'), 'Barbearia B')
    repo = createServiceInvoiceRepository(sql)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM service_invoices WHERE company_id = ${empresa}`
        await tx`DELETE FROM sale_items WHERE company_id = ${empresa}`
        await tx`DELETE FROM sales WHERE company_id = ${empresa}`
        await tx`DELETE FROM products WHERE company_id = ${empresa}`
        await tx`DELETE FROM company_counters WHERE company_id = ${empresa}`
        await tx`DELETE FROM companies WHERE id = ${empresa}`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  it('le a venda com o NBS de cada item, e a empresa com os dados da NFS-e', async () => {
    const venda = await criarVenda(empresaA)
    const v = await repo.saleForNfse(empresaA, venda)
    expect(v).toMatchObject({ grossAmountCents: 10000, discountCents: 1000 })
    expect(v?.items.map((i) => [i.description, i.nbsCode]).sort()).toEqual([
      ['Corte', '101011000'],
      ['Pomada', null],
    ])

    const e = await repo.companyForNfse(empresaA)
    expect(e).toMatchObject({
      city: 'Curitiba',
      state: 'PR',
      cityIbgeCode: null,
      nationalServiceCode: '060101',
    })
    await repo.saveCityCode(empresaA, '4106902')
    expect((await repo.companyForNfse(empresaA))?.cityIbgeCode).toBe('4106902')
  })

  it('uma por venda: o segundo pedido perde, e a rejeitada volta a processar', async () => {
    const venda = await criarVenda(empresaA)
    expect(await repo.open(empresaA, venda, pedido)).toBe(true)
    expect(await repo.open(empresaA, venda, pedido)).toBe(false)

    await repo.record(
      empresaA,
      venda,
      { status: 'rejected', rejection: { code: 'E1', message: 'Aliquota invalida.' } },
      new Date(),
    )
    expect(await repo.find(empresaA, venda)).toMatchObject({
      status: 'rejected',
      rejection: { code: 'E1', message: 'Aliquota invalida.' },
      checks: 1,
    })

    expect(await repo.open(empresaA, venda, pedido)).toBe(true)
    expect(await repo.find(empresaA, venda)).toMatchObject({
      status: 'processing',
      rejection: null,
      checks: 0,
    })
  })

  it('autorizada guarda numero, chave e PDF; resposta atrasada nao a desfaz', async () => {
    const venda = await criarVenda(empresaA)
    await repo.open(empresaA, venda, pedido)
    await repo.record(empresaA, venda, { status: 'processing' }, new Date())
    await repo.record(empresaA, venda, AUTORIZADA, new Date())
    await repo.record(
      empresaA,
      venda,
      { status: 'rejected', rejection: { code: 'X', message: 'tarde' } },
      new Date(),
    )

    expect(await repo.find(empresaA, venda)).toMatchObject({
      status: 'authorized',
      number: '74798',
      accessKey: '4'.repeat(50),
      danfseUrl: 'https://nfse.invalid/x.pdf',
      checks: 2,
    })
    expect(await repo.open(empresaA, venda, pedido)).toBe(false)
  })

  it('cancela so a autorizada, com o motivo', async () => {
    const venda = await criarVenda(empresaA)
    await repo.open(empresaA, venda, pedido)
    await repo.markCancelled(empresaA, venda, 'cedo demais', new Date())
    expect((await repo.find(empresaA, venda))?.status).toBe('processing')

    await repo.record(empresaA, venda, AUTORIZADA, new Date())
    await repo.markCancelled(empresaA, venda, 'Servico lancado em duplicidade', new Date())
    const n = await repo.find(empresaA, venda)
    expect(n?.status).toBe('cancelled')
    expect(n?.cancelledAt).not.toBeNull()
  })

  it('outra empresa nao ve a venda nem a nota', async () => {
    const venda = await criarVenda(empresaA)
    await repo.open(empresaA, venda, pedido)
    expect(await repo.saleForNfse(empresaB, venda)).toBeUndefined()
    expect(await repo.find(empresaB, venda)).toBeUndefined()
  })

  it('autorizada sem numero e recusada pelo banco', async () => {
    const venda = await criarVenda(empresaA)
    await repo.open(empresaA, venda, pedido)
    await expect(
      withTenant(
        sql,
        empresaA,
        (tx) => tx`UPDATE service_invoices SET status = 'authorized' WHERE sale_id = ${venda}`,
      ),
    ).rejects.toThrow(/service_invoices_autorizada_completa/)
  })
})
