import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createProductRepository } from './registration-repositories.js'
import { createSaleUnitOfWork } from './sale-unit-of-work.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Produto inativo no banco — NR-151.
 *
 * O que so o SQL garante: o inativo fora da busca do balcao, do resumo e da
 * leitura da VENDA (a ultima barreira: um carrinho montado antes de inativar
 * nao vende o produto depois).
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('produto inativo — NR-151', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let usuario: string
  let repo: ReturnType<typeof createProductRepository>
  let produtoId: string
  const codigo = `789${Date.now()}`.slice(0, 13)

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql
    repo = createProductRepository(sql)

    empresa = randomUUID()
    const cnpj = cnpjDeTeste('6')
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${empresa}, 'Loja Inativo', ${cnpj}, ${`i@${cnpj}.local`}, '41999990000')
      `,
    )
    usuario = randomUUID()
    await withTenant(sql, empresa, async (tx) => {
      await tx`INSERT INTO users (id, name, email) VALUES (${usuario}, 'Dono', ${`d${usuario}@local`})`
      await tx`
        INSERT INTO company_users (company_id, user_id, role)
        VALUES (${empresa}, ${usuario}, 'owner')
      `
    })

    const p = await repo.create({
      companyId: empresa,
      description: 'Cafe inativavel',
      barcode: codigo,
      internalCode: 'PROD-0001',
      unitOfMeasure: 'un',
      salePriceCents: 1890,
      costPriceCents: 1200,
      minStock: 0,
      createdBy: usuario,
      createdAt: new Date(),
      ncm: null,
      cfop: null,
      taxSituationCode: null,
    })
    produtoId = p.id
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('nasce ativo', async () => {
    expect((await repo.findById(empresa, produtoId))?.isActive).toBe(true)
  })

  it('inativo some da busca, do catalogo e do resumo — e a ficha continua', async () => {
    await repo.setActive(empresa, produtoId, false, usuario)

    const busca = await repo.search(empresa, { termo: 'inativavel', limite: 10 })
    const ativos = await repo.listCatalog(empresa, {
      stock: 'todos',
      situacao: 'ativos',
      offset: 0,
      limite: 10,
    })
    const inativos = await repo.listCatalog(empresa, {
      stock: 'todos',
      situacao: 'inativos',
      offset: 0,
      limite: 10,
    })

    expect(busca).toHaveLength(0)
    expect(ativos.total).toBe(0)
    expect(inativos.produtos.map((p) => p.id)).toEqual([produtoId])
    expect((await repo.catalogSummary(empresa)).total).toBe(0)
    expect((await repo.findById(empresa, produtoId))?.isActive).toBe(false)
    /* O leitor ainda acha a linha: quem decide o que dizer ao balcao e a rota. */
    expect((await repo.findByBarcode(empresa, codigo))?.isActive).toBe(false)
  })

  it('a venda nao le o produto inativo', async () => {
    await repo.setActive(empresa, produtoId, false, usuario)

    const lidos = await createSaleUnitOfWork(sql).transaction(empresa, (tx) =>
      tx.products.findManyByIds([produtoId]),
    )

    expect(lidos).toHaveLength(0)
  })

  it('reativar devolve ao balcao e a venda', async () => {
    await repo.setActive(empresa, produtoId, true, usuario)

    const busca = await repo.search(empresa, { termo: 'inativavel', limite: 10 })
    const lidos = await createSaleUnitOfWork(sql).transaction(empresa, (tx) =>
      tx.products.findManyByIds([produtoId]),
    )

    expect(busca).toHaveLength(1)
    expect(lidos).toHaveLength(1)
  })
})
