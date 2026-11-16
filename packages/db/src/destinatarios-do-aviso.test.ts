import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createSupportAlertDirectory } from './support-alert-directory.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Para quem vai o aviso de chamado novo — DEC-029, NR-220. O banco de teste e
 * compartilhado: as asserções olham so os usuarios criados aqui.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('destinatarios do aviso de chamado — NR-220', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  const marca = randomUUID().slice(0, 8)
  const email = (quem: string) => `${quem}-${marca}@aviso.local`

  async function usuario(nome: string, quem: string, ativo = true) {
    const [u] = await admin<{ id: string }[]>`
      INSERT INTO users (name, email, is_active) VALUES (${nome}, ${email(quem)}, ${ativo})
      RETURNING id
    `
    return u!.id
  }

  beforeAll(async () => {
    admin = postgres(MIGRATION_URL!, { max: 1, onnotice: () => undefined })
    await migrate(MIGRATION_URL!)
    aplicacao = await conectarComoAplicacao(admin, MIGRATION_URL!)
    sql = aplicacao.sql

    const ativo = await usuario('Ana Plataforma', 'ativo')
    const revogado = await usuario('Bruno Revogado', 'revogado')
    const inativo = await usuario('Carla Inativa', 'inativo', false)
    await usuario('Davi Comum', 'comum')
    for (const id of [ativo, revogado, inativo]) {
      await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${id}, ${ativo})`
    }
    await admin`
      UPDATE platform_admins SET revoked_at = now(), revoked_by = ${ativo} WHERE user_id = ${revogado}
    `
  })

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('so Super Admin ativo, com conta ativa — sem revogado, inativo ou usuario comum', async () => {
    const lista = await createSupportAlertDirectory(sql).destinatarios()
    const daqui = lista.filter((d) => d.email.endsWith(`-${marca}@aviso.local`))
    expect(daqui).toEqual([{ nome: 'Ana Plataforma', email: email('ativo') }])
  })

  it('o papel da aplicacao nao le platform_admins direto — so pela funcao', async () => {
    const direto = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM platform_admins`
    expect(direto[0]?.n).toBe(0)
  })

  it('nome da loja lido dentro do tenant dela', async () => {
    const loja = randomUUID()
    const cnpj = cnpjDeTeste('5')
    await withTenant(
      sql,
      loja,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, trade_name, cnpj, email, phone)
        VALUES (${loja}, 'Mercadinho Aviso LTDA', 'Mercadinho Aviso', ${cnpj}, ${`c@${cnpj}.local`}, '41999990000')
      `,
    )
    const diretorio = createSupportAlertDirectory(sql)
    expect(await diretorio.nomeDaLoja(loja)).toBe('Mercadinho Aviso')
    expect(await diretorio.nomeDaLoja(randomUUID())).toBeNull()
  })
})
