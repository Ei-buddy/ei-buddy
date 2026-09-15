import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLegalConsentRepository } from './legal-consent-repository.js'
import { migrate } from './migrate.js'
import { conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'

/**
 * Consentimento dos documentos legais — RF-02, RF-03, migration 0015.
 *
 * Roda com a conexao da APLICACAO (papel sem `BYPASSRLS`), e nao com o
 * superusuario: `user_consents` nega tudo por RLS e so as funcoes
 * `SECURITY DEFINER` entram. Provar isso com superusuario nao provaria nada.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('consentimento legal — RF-02/RF-03', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao

  beforeAll(async () => {
    admin = postgres(MIGRATION_URL!, { max: 1, onnotice: () => undefined })
    await migrate(MIGRATION_URL!)
    aplicacao = await conectarComoAplicacao(admin, MIGRATION_URL!)
    sql = aplicacao.sql
  }, 30_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  async function criarUsuario(): Promise<string> {
    const [linha] = await admin<{ id: string }[]>`
      INSERT INTO users (name, email)
      VALUES ('Titular de Teste', ${`consent-${randomUUID()}@teste.local`})
      RETURNING id
    `
    return linha!.id
  }

  it('a tabela nega leitura direta — so as funcoes entram', async () => {
    /*
     * A garantia que sustenta o resto: se `SELECT` direto funcionasse, o
     * aceite de uma pessoa seria legivel por qualquer conexao da aplicacao,
     * de qualquer loja.
     */
    const linhas = await sql`SELECT * FROM user_consents`
    expect(linhas).toHaveLength(0)
  })

  it('grava o aceite e le de volta pela funcao', async () => {
    const repo = createLegalConsentRepository(sql)
    const userId = await criarUsuario()

    await repo.record({ userId, type: 'terms', version: '2026-09-09' })

    const ultimos = await repo.latestFor(userId)
    expect(ultimos).toHaveLength(1)
    expect(ultimos[0]?.type).toBe('terms')
    expect(ultimos[0]?.version).toBe('2026-09-09')
    expect(ultimos[0]?.acceptedAt).toBeInstanceOf(Date)
  })

  it('guarda IP e user agent como prova', async () => {
    const repo = createLegalConsentRepository(sql)
    const userId = await criarUsuario()

    await repo.record({
      userId,
      type: 'privacy',
      version: '2026-09-09',
      ip: '200.0.0.1',
      userAgent: 'Mozilla/5.0 (teste)',
    })

    const [linha] = await admin<{ ip: string; user_agent: string }[]>`
      SELECT ip, user_agent FROM user_consents WHERE user_id = ${userId}::uuid
    `
    expect(linha?.ip).toBe('200.0.0.1')
    expect(linha?.user_agent).toBe('Mozilla/5.0 (teste)')
  })

  it('sem IP e sem user agent grava nulo, e nao string vazia', async () => {
    const repo = createLegalConsentRepository(sql)
    const userId = await criarUsuario()

    await repo.record({ userId, type: 'privacy', version: '2026-09-09' })

    const [linha] = await admin<{ ip: string | null }[]>`
      SELECT ip FROM user_consents WHERE user_id = ${userId}::uuid
    `
    /* String vazia diria "veio de lugar nenhum"; nulo diz "nao foi coletado". */
    expect(linha?.ip).toBeNull()
  })

  it('versao nova nao apaga a anterior — o historico e a prova (RF-03)', async () => {
    const repo = createLegalConsentRepository(sql)
    const userId = await criarUsuario()

    await repo.record({ userId, type: 'terms', version: '2026-09-09' })
    await repo.record({ userId, type: 'terms', version: '2026-12-01' })

    const [{ n }] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM user_consents
       WHERE user_id = ${userId}::uuid AND document_type = 'terms'
    `
    expect(n).toBe(2)

    /* E a leitura de "o que vale hoje" devolve so a mais recente. */
    const ultimos = await repo.latestFor(userId)
    expect(ultimos.filter((u) => u.type === 'terms')).toHaveLength(1)
    expect(ultimos.find((u) => u.type === 'terms')?.version).toBe('2026-12-01')
  })

  it('o aceite de uma pessoa nao aparece para outra', async () => {
    const repo = createLegalConsentRepository(sql)
    const umaPessoa = await criarUsuario()
    const outraPessoa = await criarUsuario()

    await repo.record({ userId: umaPessoa, type: 'terms', version: '2026-09-09' })

    expect(await repo.latestFor(outraPessoa)).toEqual([])
  })

  it('cada documento tem o proprio aceite mais recente', async () => {
    const repo = createLegalConsentRepository(sql)
    const userId = await criarUsuario()

    await repo.record({ userId, type: 'terms', version: '2026-09-09' })
    await repo.record({ userId, type: 'privacy', version: '2026-09-09' })
    await repo.record({ userId, type: 'terms', version: '2026-12-01' })

    const ultimos = await repo.latestFor(userId)
    expect(Object.fromEntries(ultimos.map((u) => [u.type, u.version]))).toEqual({
      terms: '2026-12-01',
      privacy: '2026-09-09',
    })
  })
})
