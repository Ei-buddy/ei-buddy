import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createPasswordResetTokens } from './password-reset-repository.js'
import { createSessionIssuer } from './session-repository.js'

/**
 * Links de redefinicao de senha — NR-014, migration 0033.
 *
 * Pulada sem `DATABASE_URL`, executada na CI, como as outras suites de `db`.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('recuperar senha — NR-014', () => {
  let sql: Sql
  let userId: string

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    sql = postgres(DATABASE_URL!, { max: 2, onnotice: () => {} })

    userId = randomUUID()
    await sql`
      INSERT INTO users (id, name, email)
      VALUES (${userId}, ${'Ana'}, ${`ana-${userId}@loja.local`})
    `
  }, 60_000)

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  const daqui = (min: number) => new Date(Date.now() + min * 60_000)

  it('o link vale uma vez, e so o ultimo pedido vale', async () => {
    const links = createPasswordResetTokens(sql)

    const velho = await links.issue(userId, 'ana@loja.local', daqui(60))
    const novo = await links.issue(userId, 'ana@loja.local', daqui(60))

    expect(await links.consume(velho)).toBeUndefined()
    expect(await links.consume(novo)).toEqual({ userId, email: 'ana@loja.local' })
    expect(await links.consume(novo)).toBeUndefined()
  })

  it('link vencido nao vale', async () => {
    const links = createPasswordResetTokens(sql)
    const vencido = await links.issue(userId, 'ana@loja.local', daqui(-1))

    expect(await links.consume(vencido)).toBeUndefined()
  })

  it('usar o link encerra as sessoes abertas da pessoa', async () => {
    const sessoes = createSessionIssuer(sql)
    const aberta = await sessoes.issue({ userId, companyId: null }, daqui(60))
    expect(await sessoes.read(aberta)).toBeDefined()

    const links = createPasswordResetTokens(sql)
    await links.consume(await links.issue(userId, 'ana@loja.local', daqui(60)))

    expect(await sessoes.read(aberta)).toBeUndefined()
  })

  it('a tabela guarda o hash, nunca o token', async () => {
    const links = createPasswordResetTokens(sql)
    const token = await links.issue(userId, 'ana@loja.local', daqui(60))

    const linhas = await sql<{ token_hash: string }[]>`
      SELECT token_hash FROM password_reset_tokens WHERE user_id = ${userId}
    `
    expect(linhas.map((l) => l.token_hash)).not.toContain(token)
  })
})
