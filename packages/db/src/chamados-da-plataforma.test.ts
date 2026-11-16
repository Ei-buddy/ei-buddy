import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createSupportInboxRepository } from './support-inbox-repository.js'
import { createSupportRepository } from './support-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Chamados vistos pela plataforma — NR-215. O que so o banco garante: a
 * funcao atravessa empresas SO para Super Admin, a situacao sai de quem falou
 * por ultimo, e a resposta do suporte aparece para a loja como nao lida.
 *
 * O banco de teste e compartilhado: contagens sao comparadas antes e depois.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('chamados da plataforma — NR-215', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let lojaA: string
  let lojaB: string
  let superAdmin: string
  let comum: string
  let chamadoA: string
  let chamadoB: string
  let inbox: ReturnType<typeof createSupportInboxRepository>

  async function chamado(loja: string, assunto: string, autores: ('cliente' | 'suporte')[]) {
    const id = randomUUID()
    await withTenant(sql, loja, async (tx) => {
      await tx`
        INSERT INTO support_tickets (id, company_id, protocol, subject, category, status, created_by)
        VALUES (${id}, ${loja}, ${`T-${id.slice(0, 8)}`}, ${assunto}, 'tecnico', 'open', ${comum})
      `
      let n = 0
      for (const autor of autores) {
        n += 1
        await tx`
          INSERT INTO ticket_messages (company_id, ticket_id, author, author_name, body, created_at)
          VALUES (${loja}, ${id}, ${autor}, ${autor === 'cliente' ? 'Dona Maria' : 'Suporte'},
                  ${`mensagem ${n}`}, ${new Date(Date.UTC(2026, 10, 10, 10, n))})
        `
      }
    })
    return id
  }

  beforeAll(async () => {
    admin = postgres(MIGRATION_URL!, { max: 1, onnotice: () => undefined })
    await migrate(MIGRATION_URL!)
    aplicacao = await conectarComoAplicacao(admin, MIGRATION_URL!)
    sql = aplicacao.sql
    inbox = createSupportInboxRepository(sql)

    lojaA = randomUUID()
    lojaB = randomUUID()
    for (const [id, nome, sufixo] of [
      [lojaA, 'Loja Chamado A', '6'],
      [lojaB, 'Loja Chamado B', '7'],
    ] as const) {
      const cnpj = cnpjDeTeste(sufixo)
      await withTenant(
        sql,
        id,
        (tx) => tx`
          INSERT INTO companies (id, legal_name, trade_name, cnpj, email, phone)
          VALUES (${id}, ${nome}, ${nome + ' Fantasia'}, ${cnpj}, ${`c@${cnpj}.local`}, '41999990000')
        `,
      )
    }
    const [u1] = await admin<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES ('Gustavo Suporte', ${`su-${randomUUID()}@local`}) RETURNING id
    `
    const [u2] = await admin<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES ('Fulano Comum', ${`co-${randomUUID()}@local`}) RETURNING id
    `
    superAdmin = u1!.id
    comum = u2!.id
    await admin`INSERT INTO platform_admins (user_id, granted_by) VALUES (${superAdmin}, ${superAdmin})`
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('so Super Admin atravessa empresas', async () => {
    await expect(inbox.counts(comum)).rejects.toThrow(/Somente Super Admin/)
    await expect(inbox.list(comum, { situacao: 'todos', limite: 10, offset: 0 })).rejects.toThrow(
      /Somente Super Admin/,
    )
    await expect(inbox.reply(comum, randomUUID(), 'oi')).rejects.toThrow(/Somente Super Admin/)
  })

  it('ve chamados de lojas diferentes, com o nome fantasia e quem falou por ultimo', async () => {
    const antes = await inbox.counts(superAdmin)
    chamadoA = await chamado(lojaA, 'Nota nao sai da loja A', ['cliente'])
    chamadoB = await chamado(lojaB, 'Duvida no caixa da loja B', ['cliente', 'suporte'])
    const depois = await inbox.counts(superAdmin)
    expect(depois.toAnswer - antes.toAnswer).toBe(1)
    expect(depois.awaitingCustomer - antes.awaitingCustomer).toBe(1)

    const responder = await inbox.list(superAdmin, {
      situacao: 'responder',
      limite: 100,
      offset: 0,
    })
    const a = responder.tickets.find((t) => t.id === chamadoA)
    expect(a).toMatchObject({
      companyName: 'Loja Chamado A Fantasia',
      lastAuthor: 'cliente',
      messagesCount: 1,
    })
    expect(responder.tickets.some((t) => t.id === chamadoB)).toBe(false)

    const aguardando = await inbox.list(superAdmin, {
      situacao: 'aguardando',
      limite: 100,
      offset: 0,
    })
    expect(aguardando.tickets.some((t) => t.id === chamadoB)).toBe(true)
  })

  it('a resposta do suporte entra na conversa, muda a situacao e chega para a loja como nao lida', async () => {
    expect(await inbox.reply(superAdmin, chamadoA, '  Vamos olhar agora.  ')).toBe(true)

    const detalhe = await inbox.find(superAdmin, chamadoA)
    expect(detalhe?.messages.at(-1)).toMatchObject({
      author: 'suporte',
      authorName: 'Suporte EiBuddy · Gustavo',
      body: 'Vamos olhar agora.',
    })
    expect(detalhe).toMatchObject({ status: 'open', lastAuthor: 'suporte', messagesCount: 2 })

    const daLoja = await createSupportRepository(sql).list(lojaA)
    expect(daLoja.find((t) => t.id === chamadoA)?.unread).toBe(1)
  })

  it('encerrar; responder um encerrado reabre', async () => {
    expect(await inbox.close(superAdmin, chamadoB)).toBe(true)
    expect((await inbox.find(superAdmin, chamadoB))?.status).toBe('closed')
    const encerrados = await inbox.list(superAdmin, {
      situacao: 'encerrados',
      limite: 100,
      offset: 0,
    })
    expect(encerrados.tickets.some((t) => t.id === chamadoB)).toBe(true)

    expect(await inbox.reply(superAdmin, chamadoB, 'Voltando ao assunto')).toBe(true)
    expect((await inbox.find(superAdmin, chamadoB))?.status).toBe('open')
  })

  it('chamado inexistente ou id torto: nada, sem erro do banco', async () => {
    expect(await inbox.find(superAdmin, randomUUID())).toBeUndefined()
    expect(await inbox.find(superAdmin, 'nao-e-uuid')).toBeUndefined()
    expect(await inbox.reply(superAdmin, randomUUID(), 'oi')).toBe(false)
    expect(await inbox.close(superAdmin, 'x')).toBe(false)
  })
})
