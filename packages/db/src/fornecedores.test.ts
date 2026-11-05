import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createSupplierRepository } from './supplier-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Cadastro de fornecedor no banco — NR-191. O que so o SQL garante: o mesmo
 * documento uma vez por loja (entre os nao excluidos), a busca sem acento e o
 * isolamento entre lojas.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

const ENDERECO_VAZIO = {
  zipCode: null,
  street: null,
  number: null,
  complement: null,
  district: null,
  city: null,
  state: null,
}

describe.skipIf(!DATABASE_URL)('fornecedores — NR-191', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let lojaA: string
  let lojaB: string

  async function loja(digito: string): Promise<string> {
    const id = randomUUID()
    const cnpj = cnpjDeTeste(digito)
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${'Loja ' + digito}, ${cnpj}, ${'f@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
    return id
  }

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql
    lojaA = await loja('3')
    lojaB = await loja('4')
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  const novo = (companyId: string, name: string, extra: object = {}) => ({
    companyId,
    name,
    tradeName: null,
    document: null,
    stateRegistration: null,
    email: null,
    phone: null,
    contactName: null,
    address: ENDERECO_VAZIO,
    notes: null,
    createdBy: null,
    createdAt: new Date(),
    ...extra,
  })

  it('grava, busca sem acento e por documento, edita e exclui', async () => {
    const repo = createSupplierRepository(sql)
    const f = await repo.insert(
      novo(lojaA, 'Laticínios São João', {
        document: '11222333000181',
        phone: '4133334444',
        address: { ...ENDERECO_VAZIO, city: 'Curitiba', state: 'PR' },
      }),
    )
    expect(f).toMatchObject({ name: 'Laticínios São João', isActive: true })
    expect(f.address.city).toBe('Curitiba')

    const nomes = async (termo: string) =>
      (await repo.list(lojaA, { termo, somenteAtivos: true, limite: 10 })).map((x) => x.name)
    expect(await nomes('sao joao laticinios')).toEqual(['Laticínios São João'])
    expect(await nomes('11.222.333')).toEqual(['Laticínios São João'])

    const editado = await repo.update(lojaA, f.id, { phone: null, contactName: 'Ana' })
    expect(editado).toMatchObject({ phone: null, contactName: 'Ana', document: '11222333000181' })

    await repo.remove(lojaA, f.id, new Date())
    expect(await repo.findById(lojaA, f.id)).toBeUndefined()
    /* Excluido libera o documento para um cadastro novo. */
    await expect(
      repo.insert(novo(lojaA, 'De novo', { document: '11222333000181' })),
    ).resolves.toBeDefined()
  })

  it('o mesmo documento duas vezes na loja e recusado pelo banco', async () => {
    const repo = createSupplierRepository(sql)
    await repo.insert(novo(lojaA, 'Unico', { document: '04252011000110' }))

    await expect(
      repo.insert(novo(lojaA, 'Repetido', { document: '04252011000110' })),
    ).rejects.toThrow()
    /* Em outra loja pode. */
    await expect(
      repo.insert(novo(lojaB, 'Outra loja', { document: '04252011000110' })),
    ).resolves.toBeDefined()
  })

  it('uma loja nao enxerga o fornecedor da outra', async () => {
    const repo = createSupplierRepository(sql)
    const f = await repo.insert(novo(lojaB, 'So da loja B'))

    expect(await repo.findById(lojaA, f.id)).toBeUndefined()
    expect(
      (await repo.list(lojaA, { termo: 'loja B', somenteAtivos: false, limite: 10 })).length,
    ).toBe(0)
  })
})
