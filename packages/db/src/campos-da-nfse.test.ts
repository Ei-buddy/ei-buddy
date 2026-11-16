import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createCompanyRepository, createProductRepository } from './registration-repositories.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'

/** Os tres campos da NFS-e, gravados e lidos de volta — DEC-031, NR-222. */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('campos da NFS-e — NR-222', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao

  beforeAll(async () => {
    admin = postgres(MIGRATION_URL!, { max: 1, onnotice: () => undefined })
    await migrate(MIGRATION_URL!)
    aplicacao = await conectarComoAplicacao(admin, MIGRATION_URL!)
    sql = aplicacao.sql
  })

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  async function empresaNova(extra: { nationalServiceCode?: string; issRatePercent?: number }) {
    const cnpj = cnpjDeTeste('4')
    return createCompanyRepository(sql).create({
      legalName: 'Servicos NFS-e LTDA',
      cnpj,
      email: `nfse-${randomUUID().slice(0, 6)}@x.local`,
      phone: '41999990000',
      createdAt: new Date(),
      ...extra,
    })
  }

  it('loja: codigo de tributacao nacional e aliquota do ISS, na criacao e na edicao', async () => {
    const empresas = createCompanyRepository(sql)
    const sem = await empresaNova({})
    expect(sem.nationalServiceCode).toBeNull()
    expect(sem.issRatePercent).toBeNull()

    const com = await empresas.update(sem.id, {
      nationalServiceCode: '010701',
      issRatePercent: 2.79,
    })
    expect(com).toMatchObject({ nationalServiceCode: '010701', issRatePercent: 2.79 })

    /* Mexer noutro campo nao apaga os da NFS-e. */
    const depois = await empresas.update(sem.id, { businessSegment: 'Oficina' })
    expect(depois).toMatchObject({ nationalServiceCode: '010701', issRatePercent: 2.79 })

    const criada = await empresaNova({ nationalServiceCode: '170101', issRatePercent: 5 })
    expect(criada).toMatchObject({ nationalServiceCode: '170101', issRatePercent: 5 })
  })

  it('o banco recusa codigo fora do formato e aliquota acima de 5%', async () => {
    const empresa = await empresaNova({})
    const empresas = createCompanyRepository(sql)
    await expect(empresas.update(empresa.id, { nationalServiceCode: '12345' })).rejects.toThrow()
    await expect(empresas.update(empresa.id, { issRatePercent: 7 })).rejects.toThrow()
  })

  it('produto: NBS gravado, mantido em outra edicao e tirado com null', async () => {
    const empresa = await empresaNova({})
    const [u] = await admin<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES ('Quem Cadastra', ${`p-${randomUUID()}@x.local`}) RETURNING id
    `
    const produtos = createProductRepository(sql)
    const criado = await produtos.create({
      companyId: empresa.id,
      description: 'Troca de oleo',
      internalCode: `SRV-${randomUUID().slice(0, 6)}`,
      unitOfMeasure: 'un',
      salePriceCents: 8000,
      costPriceCents: 3000,
      minStock: 0,
      ncm: null,
      cfop: null,
      taxSituationCode: null,
      nbsCode: '101011000',
      createdBy: u!.id,
      createdAt: new Date(),
    })
    expect(criado.nbsCode).toBe('101011000')

    const outra = await produtos.update(empresa.id, criado.id, { salePriceCents: 9000 }, u!.id)
    expect(outra?.nbsCode).toBe('101011000')

    const sem = await produtos.update(empresa.id, criado.id, { nbsCode: null }, u!.id)
    expect(sem?.nbsCode).toBeNull()
  })
})
