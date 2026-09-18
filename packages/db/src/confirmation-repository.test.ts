import { randomUUID } from 'node:crypto'
import type { PendingConfirmation } from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConfirmationStore } from './confirmation-repository.js'
import { migrate } from './migrate.js'
import { checkRlsEnforcement } from './rls-guard.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Store Postgres da pendencia de acao sensivel — NR-061, US2 + US3 + US5.
 *
 * O que so o banco prova: round-trip, "reinicio" (segunda instancia do store),
 * getOpen devolve a expirada ainda aberta, replace sem DELETE, chaves
 * `app:` / `wa:` isoladas, resolve que persiste `decision`/`resolved_at`
 * (segundo resolve e no-op), e isolamento A vs B (ausencia, nunca o payload).
 * Sem `DATABASE_URL` a suite e pulada; com ela, as assercoes rodam no papel
 * comum — superusuario ignoraria RLS.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

const agora = new Date('2026-09-17T18:00:00.000Z')

describe.skipIf(!DATABASE_URL)('store de confirmacao — NR-061 US2', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let empresaB: string

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) =>
        tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${'contato@' + cnpj + '.local'}, ${'41999990000'})
      `,
    )
    return id
  }

  function proposta(
    over: Partial<PendingConfirmation> & Pick<PendingConfirmation, 'companyId' | 'conversationKey'>,
  ): PendingConfirmation {
    return {
      id: randomUUID(),
      toolId: 'create_customer',
      args: { name: 'Joao', phone: '11988887777' },
      summary: 'Cadastrar Joao, 11 98888-7777',
      expiresAt: new Date(agora.getTime() + 5 * 60_000),
      ...over,
    }
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0021_confirmations_open_unique')

    admin = postgres(DATABASE_URL!, { max: 3, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    /* Prefixo 7–8: 1–2 schema, 3–4 agenda, 5–6 auditoria. */
    empresa = await criarEmpresa(cnpjDeTeste('7'), 'Barbearia Confirmacao')
    empresaB = await criarEmpresa(cnpjDeTeste('8'), 'Barbearia Isolamento B')
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const loja of [empresa, empresaB].filter(Boolean)) {
      await withTenant(sql, loja, async (tx) => {
        await tx`DELETE FROM confirmations`
        await tx`DELETE FROM conversations`
        await tx`DELETE FROM companies`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  }, 60_000)

  it('put sobrevive a uma nova instancia do store (reinicio)', async () => {
    const conversationKey = `app:${empresa}:${randomUUID()}`
    const pending = proposta({
      companyId: empresa,
      conversationKey,
      args: { name: 'Maria', phone: '11977776666' },
      summary: 'Cadastrar Maria, 11 97777-6666',
    })

    const primeiro = createConfirmationStore(sql)
    await primeiro.put(pending)

    const depoisDoReinicio = createConfirmationStore(sql)
    const achada = await depoisDoReinicio.getOpen(empresa, conversationKey, agora)

    expect(achada).toEqual({
      id: pending.id,
      companyId: empresa,
      conversationKey,
      toolId: 'create_customer',
      args: { name: 'Maria', phone: '11977776666' },
      summary: 'Cadastrar Maria, 11 97777-6666',
      expiresAt: pending.expiresAt,
    })

    await depoisDoReinicio.resolve(empresa, pending.id, 'accepted')
    expect(await depoisDoReinicio.getOpen(empresa, conversationKey, agora)).toBeUndefined()

    const [mensagens] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ n: number }[]>`SELECT count(*)::int AS n FROM messages`,
    )
    expect(mensagens?.n).toBe(0)
  })

  it('getOpen devolve pendencia expirada ainda aberta — nao filtra expires_at', async () => {
    const conversationKey = `app:${empresa}:${randomUUID()}`
    const expiresAt = new Date('2026-09-17T17:50:00.000Z')
    expect(expiresAt.getTime()).toBeLessThanOrEqual(agora.getTime())

    const store = createConfirmationStore(sql)
    const pending = proposta({ companyId: empresa, conversationKey, expiresAt })
    await store.put(pending)

    const achada = await store.getOpen(empresa, conversationKey, agora)
    expect(achada).toBeDefined()
    expect(achada?.id).toBe(pending.id)
    expect(achada?.expiresAt.getTime()).toBe(expiresAt.getTime())
    expect(achada?.expiresAt.getTime()).toBeLessThanOrEqual(agora.getTime())
  })

  it('put na mesma chave encerra a anterior como rejected, sem DELETE', async () => {
    const conversationKey = `app:${empresa}:${randomUUID()}`
    const store = createConfirmationStore(sql)

    const primeira = proposta({
      companyId: empresa,
      conversationKey,
      summary: 'Cadastrar o primeiro',
    })
    const segunda = proposta({
      companyId: empresa,
      conversationKey,
      summary: 'Cadastrar o segundo',
    })

    await store.put(primeira)
    await store.put(segunda)

    const aberta = await store.getOpen(empresa, conversationKey, agora)
    expect(aberta?.id).toBe(segunda.id)
    expect(aberta?.summary).toBe('Cadastrar o segundo')

    const linhas = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ id: string; decision: string | null; resolved_at: Date | null }[]>`
        SELECT c.id, c.decision, c.resolved_at
          FROM confirmations c
          JOIN conversations v ON v.id = c.conversation_id
         WHERE v.channel = 'app'
           AND v.number_from = ${conversationKey.split(':')[2]!}
         ORDER BY c.resolved_at NULLS LAST
      `,
    )

    expect(linhas).toHaveLength(2)
    const encerrada = linhas.find((l) => l.id === primeira.id)
    expect(encerrada?.decision).toBe('rejected')
    expect(encerrada?.resolved_at).toBeInstanceOf(Date)
    const vigente = linhas.find((l) => l.id === segunda.id)
    expect(vigente?.decision).toBeNull()
    expect(vigente?.resolved_at).toBeNull()
  })

  it('chaves app: e wa: sao identidades distintas — duas abertas ao mesmo tempo', async () => {
    const userId = randomUUID()
    const peer = '5511999000001'
    const chaveApp = `app:${empresa}:${userId}`
    const chaveWa = `wa:${empresa}:${peer}`

    const store = createConfirmationStore(sql)
    const viaHttp = proposta({
      companyId: empresa,
      conversationKey: chaveApp,
      summary: 'Proposta do harness HTTP',
    })
    const viaStudio = proposta({
      companyId: empresa,
      conversationKey: chaveWa,
      summary: 'Proposta do Studio',
      toolId: 'create_sale',
    })

    await store.put(viaHttp)
    await store.put(viaStudio)

    const abertaApp = await store.getOpen(empresa, chaveApp, agora)
    const abertaWa = await store.getOpen(empresa, chaveWa, agora)

    expect(abertaApp?.id).toBe(viaHttp.id)
    expect(abertaApp?.summary).toBe('Proposta do harness HTTP')
    expect(abertaWa?.id).toBe(viaStudio.id)
    expect(abertaWa?.summary).toBe('Proposta do Studio')
    expect(abertaApp?.id).not.toBe(abertaWa?.id)

    const [contagem] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM confirmations WHERE resolved_at IS NULL
      `,
    )
    expect(contagem?.n).toBeGreaterThanOrEqual(2)
  })

  it('put com number_from vazio recusa e nao cria conversa', async () => {
    const store = createConfirmationStore(sql)
    const semUser = proposta({
      companyId: empresa,
      conversationKey: `app:${empresa}:`,
    })
    const semPeer = proposta({
      companyId: empresa,
      conversationKey: `wa:${empresa}:`,
    })

    await expect(store.put(semUser)).rejects.toThrow(/interlocutor|number_from|vazio/i)
    await expect(store.put(semPeer)).rejects.toThrow(/interlocutor|number_from|vazio/i)

    const [conversas] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ n: number }[]>`
        SELECT count(*)::int AS n
          FROM conversations
         WHERE number_from IS NULL OR number_from = ''
      `,
    )
    expect(conversas?.n).toBe(0)
  })

  it.each(['expired', 'rejected'] as const)(
    'resolve(%s) deixa a linha com decision e resolved_at; segundo resolve e no-op',
    async (decision) => {
      const conversationKey = `app:${empresa}:${randomUUID()}`
      const store = createConfirmationStore(sql)
      const pending = proposta({ companyId: empresa, conversationKey })
      await store.put(pending)

      await store.resolve(empresa, pending.id, decision)

      const depoisDoPrimeiro = await withTenant(
        sql,
        empresa,
        (tx) => tx<{ id: string; decision: string | null; resolved_at: Date | null }[]>`
          SELECT id, decision, resolved_at FROM confirmations WHERE id = ${pending.id}
        `,
      )
      expect(depoisDoPrimeiro).toHaveLength(1)
      expect(depoisDoPrimeiro[0]?.decision).toBe(decision)
      expect(depoisDoPrimeiro[0]?.resolved_at).toBeInstanceOf(Date)
      expect(await store.getOpen(empresa, conversationKey, agora)).toBeUndefined()

      const resolvedAt = depoisDoPrimeiro[0]!.resolved_at!

      await store.resolve(empresa, pending.id, 'accepted')

      const depoisDoSegundo = await withTenant(
        sql,
        empresa,
        (tx) => tx<{ id: string; decision: string | null; resolved_at: Date | null }[]>`
          SELECT id, decision, resolved_at FROM confirmations WHERE id = ${pending.id}
        `,
      )
      expect(depoisDoSegundo).toHaveLength(1)
      expect(depoisDoSegundo[0]?.decision).toBe(decision)
      expect(depoisDoSegundo[0]?.resolved_at?.getTime()).toBe(resolvedAt.getTime())
    },
  )

  it('a conexao sob teste nao escapa da RLS (US5 / T033)', async () => {
    const status = await checkRlsEnforcement(sql)
    expect(status.isSuperuser).toBe(false)
    expect(status.bypassesRls).toBe(false)

    const tabelas = await sql<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('confirmations', 'conversations')
       ORDER BY c.relname
    `
    expect(tabelas.map((t) => [t.relname, t.relrowsecurity, t.relforcerowsecurity])).toEqual([
      ['confirmations', true, true],
      ['conversations', true, true],
    ])
  })

  it('loja B nao le nem resolve a pendencia da loja A (US5 / T030)', async () => {
    const chaveDaA = `app:${empresa}:${randomUUID()}`
    const store = createConfirmationStore(sql)
    const pending = proposta({
      companyId: empresa,
      conversationKey: chaveDaA,
      summary: 'Cadastrar cliente secreto da loja A',
      args: { name: 'Segredo', phone: '11911112222' },
    })
    await store.put(pending)

    const cruzado = await store.getOpen(empresaB, chaveDaA, agora)
    expect(cruzado).toBeUndefined()

    const vazou = await withTenant(
      sql,
      empresaB,
      (tx) => tx<{ payload: unknown }[]>`
        SELECT payload FROM confirmations WHERE id = ${pending.id}
      `,
    )
    expect(vazou).toEqual([])

    await store.resolve(empresaB, pending.id, 'accepted')

    const aindaDaA = await store.getOpen(empresa, chaveDaA, agora)
    expect(aindaDaA).toEqual({
      id: pending.id,
      companyId: empresa,
      conversationKey: chaveDaA,
      toolId: 'create_customer',
      args: { name: 'Segredo', phone: '11911112222' },
      summary: 'Cadastrar cliente secreto da loja A',
      expiresAt: pending.expiresAt,
    })

    const [linhaDaA] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ decision: string | null; resolved_at: Date | null }[]>`
        SELECT decision, resolved_at FROM confirmations WHERE id = ${pending.id}
      `,
    )
    expect(linhaDaA?.decision).toBeNull()
    expect(linhaDaA?.resolved_at).toBeNull()
  })

  it('companyId da assinatura e o tenant mesmo se a chave embute outro UUID (US5 / T032)', async () => {
    const userId = randomUUID()
    const chaveMentindo = `app:${empresaB}:${userId}`
    const store = createConfirmationStore(sql)
    const pending = proposta({
      companyId: empresa,
      conversationKey: chaveMentindo,
      summary: 'Proposta da A com UUID da B na chave',
    })
    await store.put(pending)

    const daA = await store.getOpen(empresa, chaveMentindo, agora)
    expect(daA?.id).toBe(pending.id)
    expect(daA?.companyId).toBe(empresa)
    expect(daA?.summary).toBe('Proposta da A com UUID da B na chave')

    expect(await store.getOpen(empresaB, chaveMentindo, agora)).toBeUndefined()

    const daB = await withTenant(
      sql,
      empresaB,
      (tx) => tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM confirmations WHERE id = ${pending.id}
      `,
    )
    expect(daB[0]?.n).toBe(0)
  })
})
