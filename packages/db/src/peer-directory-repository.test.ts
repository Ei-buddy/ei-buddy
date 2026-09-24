import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createPeerDirectory } from './peer-directory-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Peer directory — NR-046 US2.
 *
 * `channel_owner_by_phone` / `createPeerDirectory().porTelefone` so devolvem
 * dona ativa. Inativo, vinculo revogado ou papel que nao e owner: nenhuma linha.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('peer-directory-repository — NR-046 US2', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let loja: string

  async function criarEmpresa(nome: string, prefixo: string): Promise<string> {
    const id = randomUUID()
    const cnpj = cnpjDeTeste(prefixo)
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${'contato@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
    return id
  }

  async function criarUsuario(telefone: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      randomUUID(),
      (tx) => tx`
        INSERT INTO users (id, name, email, phone)
        VALUES (${id}, ${nome}, ${`${id}@teste.local`}, ${telefone})
      `,
    )
    return id
  }

  async function vincular(
    empresa: string,
    usuario: string,
    papel: string,
    criadoEm: string,
  ): Promise<void> {
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO company_users (company_id, user_id, role, created_at)
        VALUES (${empresa}, ${usuario}, ${papel}, ${criadoEm})
      `,
    )
  }

  const peers = () => createPeerDirectory(sql)

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0028_vinculo_do_canal')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    loja = await criarEmpresa('Loja US2', '2')
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  it('users.is_active false: channel_owner_by_phone e porTelefone nao devolvem linha', async () => {
    const telefone = `4196${String(Date.now()).slice(-7)}`
    const usuario = await criarUsuario(telefone, 'Dona inativa')
    await vincular(loja, usuario, 'owner', '2026-04-01T10:00:00.000Z')
    await withTenant(
      sql,
      loja,
      (tx) => tx`
        UPDATE users SET is_active = false WHERE id = ${usuario}
      `,
    )

    expect(await sql`SELECT * FROM channel_owner_by_phone(${telefone})`).toHaveLength(0)
    expect(await peers().porTelefone(telefone)).toBeUndefined()
  })

  it('company_users.is_active false: nenhuma linha', async () => {
    const telefone = `4195${String(Date.now()).slice(-7)}`
    const usuario = await criarUsuario(telefone, 'Vinculo revogado')
    await vincular(loja, usuario, 'owner', '2026-04-02T10:00:00.000Z')
    await withTenant(
      sql,
      loja,
      (tx) => tx`
        UPDATE company_users SET is_active = false
         WHERE company_id = ${loja} AND user_id = ${usuario}
      `,
    )

    expect(await sql`SELECT * FROM channel_owner_by_phone(${telefone})`).toHaveLength(0)
    expect(await peers().porTelefone(telefone)).toBeUndefined()
  })

  it('company_users.role diferente de owner: nenhuma linha', async () => {
    const telefone = `4194${String(Date.now()).slice(-7)}`
    const usuario = await criarUsuario(telefone, 'Contador')
    await vincular(loja, usuario, 'accountant', '2026-04-03T10:00:00.000Z')

    expect(await sql`SELECT * FROM channel_owner_by_phone(${telefone})`).toHaveLength(0)
    expect(await peers().porTelefone(telefone)).toBeUndefined()
  })
})

describe.skipIf(!DATABASE_URL)('peer-directory-repository — NR-046 US4', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao

  async function criarEmpresaComId(id: string, nome: string, prefixo: string): Promise<string> {
    const cnpj = cnpjDeTeste(prefixo)
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${'contato@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
    return id
  }

  async function criarEmpresa(nome: string, prefixo: string): Promise<string> {
    return criarEmpresaComId(randomUUID(), nome, prefixo)
  }

  async function criarUsuario(telefone: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      randomUUID(),
      (tx) => tx`
        INSERT INTO users (id, name, email, phone)
        VALUES (${id}, ${nome}, ${`${id}@teste.local`}, ${telefone})
      `,
    )
    return id
  }

  async function vincular(
    empresa: string,
    usuario: string,
    papel: string,
    criadoEm: string,
  ): Promise<void> {
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO company_users (company_id, user_id, role, created_at)
        VALUES (${empresa}, ${usuario}, ${papel}, ${criadoEm})
      `,
    )
  }

  const peers = () => createPeerDirectory(sql)

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0028_vinculo_do_canal')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar?.()
    await admin?.end({ timeout: 5 })
  })

  it('duas empresas owner ativas: devolve o vinculo com created_at mais antigo', async () => {
    const telefone = `4193${String(Date.now()).slice(-7)}`
    const dona = await criarUsuario(telefone, 'Dona duas lojas')
    const lojaAntiga = await criarEmpresa('Loja US4 antiga', '5')
    const lojaNova = await criarEmpresa('Loja US4 nova', '6')

    await vincular(lojaAntiga, dona, 'owner', '2026-05-01T10:00:00.000Z')
    await vincular(lojaNova, dona, 'owner', '2026-08-01T10:00:00.000Z')

    const sqlRow = await sql`SELECT * FROM channel_owner_by_phone(${telefone})`
    expect(sqlRow).toHaveLength(1)
    expect(sqlRow[0]?.company_id).toBe(lojaAntiga)

    const v = await peers().porTelefone(telefone)
    expect(v).toEqual({ companyId: lojaAntiga, userId: dona })
  })

  it('empate em created_at: devolve o menor company_id', async () => {
    const telefone = `4192${String(Date.now()).slice(-7)}`
    const dona = await criarUsuario(telefone, 'Dona empate')
    /*
     * Dois ids SORTEADOS e ordenados, e nao dois fixos.
     *
     * Eram `aaaa…` e `bbbb…`. O teste nao os apaga no fim, entao numa
     * rodada abortada eles ficam para tras — e a rodada seguinte contra o mesmo
     * banco morre com "duplicate key value violates unique constraint
     * companies_pkey", num teste que nao tem nada a ver com chave duplicada.
     * Na CI isso nao aparece (contêiner novo a cada job); localmente, contra um
     * Postgres persistente, aparece sempre.
     *
     * O que o teste precisa e de dois ids com ordem CONHECIDA, nao de dois ids
     * conhecidos.
     */
    const um = randomUUID()
    const outro = randomUUID()
    const empresaMenor = um < outro ? um : outro
    const empresaMaior = um < outro ? outro : um
    const instante = '2026-07-15T12:00:00.000Z'

    await criarEmpresaComId(empresaMenor, 'US4 menor id', '7')
    await criarEmpresaComId(empresaMaior, 'US4 maior id', '8')
    await vincular(empresaMaior, dona, 'owner', instante)
    await vincular(empresaMenor, dona, 'owner', instante)

    const sqlRow = await sql`SELECT * FROM channel_owner_by_phone(${telefone})`
    expect(sqlRow).toHaveLength(1)
    expect(sqlRow[0]?.company_id).toBe(empresaMenor)

    const v = await peers().porTelefone(telefone)
    expect(v?.companyId).toBe(empresaMenor)
    expect(v?.userId).toBe(dona)
  })
})
