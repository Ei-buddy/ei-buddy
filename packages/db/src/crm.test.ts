import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCrmRepository } from './crm-repository.js'
import { migrate } from './migrate.js'
import { createTeamRepository } from './team-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * O quadro de CRM e a equipe — NR-109.
 *
 * Criar card, mover coluna e comentar tem teste de caso de uso contra o falso
 * (`crm.test.ts` de `core`). O que so o banco prova: que os comentarios de um
 * card vem AGREGADOS numa unica linha (o `LATERAL`, e nao um `JOIN` que
 * multiplicaria a linha do card por comentario), que `due_on` sai como texto
 * `YYYY-MM-DD` sem recuo de fuso, e que nada disso enxerga a loja do lado.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('CRM — NR-109', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuarioA: string

  let crm: ReturnType<typeof createCrmRepository>
  let team: ReturnType<typeof createTeamRepository>

  async function criarEmpresa(prefixo: string, nome: string): Promise<string> {
    const id = randomUUID()
    const cnpj = cnpjDeTeste(prefixo)
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`h@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarUsuario(empresa: string, nome: string, papel = 'owner'): Promise<string> {
    const id = randomUUID()
    await withTenant(sql, empresa, async (tx) => {
      await tx`INSERT INTO users (id, name, email) VALUES (${id}, ${nome}, ${`${id}@loja.local`})`
      await tx`
        INSERT INTO company_users (company_id, user_id, role) VALUES (${empresa}, ${id}, ${papel})
      `
    })
    return id
  }

  async function criarCliente(empresa: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`INSERT INTO customers (id, company_id, name) VALUES (${id}, ${empresa}, ${nome})`,
    )
    return id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0011_crm')

    admin = postgres(DATABASE_URL!, { max: 6, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa('1', 'Loja CRM A')
    empresaB = await criarEmpresa('0', 'Loja CRM B')
    usuarioA = await criarUsuario(empresaA, 'Dono da A')

    crm = createCrmRepository(sql)
    team = createTeamRepository(sql)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM crm_card_comments`
        await tx`DELETE FROM crm_cards`
        await tx`DELETE FROM company_users`
        await tx`DELETE FROM customers`
        await tx`DELETE FROM users`
        await tx`DELETE FROM companies`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  it('cria um card minimo e o le de volta', async () => {
    const card = await crm.create({
      companyId: empresaA,
      title: 'Ligar para quem sumiu',
      kind: 'contact',
      dueOn: '2026-09-20',
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    expect(card.column).toBe('todo')
    expect(card.customerId).toBeNull()
    expect(card.dueOn).toBe('2026-09-20')
    expect(card.comments).toEqual([])
  })

  it('junta o nome do cliente e do responsavel na criacao', async () => {
    const cliente = await criarCliente(empresaA, 'Joana Ribeiro')

    const card = await crm.create({
      companyId: empresaA,
      title: 'Retomar contato',
      kind: 'contact',
      dueOn: '2026-09-22',
      customerId: cliente,
      assigneeUserId: usuarioA,
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    expect(card.customerName).toBe('Joana Ribeiro')
    expect(card.assigneeName).toBe('Dono da A')
  })

  it('varios comentarios continuam sendo UMA linha de card', async () => {
    /*
     * O caso que o `LATERAL` existe para resolver: com `JOIN` direto, um card
     * com 2 comentarios viraria 2 linhas na leitura do quadro.
     */
    const card = await crm.create({
      companyId: empresaA,
      title: 'Card com historico',
      kind: 'task',
      dueOn: '2026-09-25',
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    await crm.addComment({
      companyId: empresaA,
      cardId: card.id,
      authorId: usuarioA,
      text: 'Primeiro contato feito.',
      createdAt: new Date('2026-09-11T14:00:00.000Z'),
    })
    await crm.addComment({
      companyId: empresaA,
      cardId: card.id,
      authorId: usuarioA,
      text: 'Retorno agendado.',
      createdAt: new Date('2026-09-11T15:00:00.000Z'),
    })

    const lido = await crm.findById(empresaA, card.id)

    expect(lido?.comments).toHaveLength(2)
    expect(lido?.comments.map((c) => c.text)).toEqual([
      'Primeiro contato feito.',
      'Retorno agendado.',
    ])
    expect(lido?.comments[0]?.authorName).toBe('Dono da A')
  })

  it('excluir apaga o card e os comentarios; de outra loja ou id torto, nada — NR-213', async () => {
    const card = await crm.create({
      companyId: empresaA,
      title: 'Lancado por engano',
      kind: 'task',
      dueOn: '2026-09-25',
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })
    await crm.addComment({
      companyId: empresaA,
      cardId: card.id,
      authorId: usuarioA,
      text: 'Vai sumir junto.',
      createdAt: new Date('2026-09-11T14:00:00.000Z'),
    })

    /* A outra loja nao apaga, nem enxerga. */
    expect(await crm.delete(empresaB, card.id)).toBe(false)
    expect(await crm.findById(empresaA, card.id)).toBeDefined()
    /* Id que nao e uuid: "nao existe", sem erro do Postgres. */
    expect(await crm.delete(empresaA, 'nao-e-uuid')).toBe(false)
    expect(await crm.findById(empresaA, 'nao-e-uuid')).toBeUndefined()

    expect(await crm.delete(empresaA, card.id)).toBe(true)
    expect(await crm.findById(empresaA, card.id)).toBeUndefined()
    expect(await crm.delete(empresaA, card.id)).toBe(false)

    const sobra = await withTenant(
      sql,
      empresaA,
      (tx) => tx`SELECT count(*)::int AS n FROM crm_card_comments WHERE card_id = ${card.id}`,
    )
    expect(sobra[0]?.n).toBe(0)
  })

  it('card sem comentario nenhum nao quebra a leitura', async () => {
    /* `json_agg` sobre conjunto vazio devolve NULL, e nao `[]`. */
    const card = await crm.create({
      companyId: empresaA,
      title: 'Card sem comentario',
      kind: 'task',
      dueOn: '2026-09-26',
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    const lido = await crm.findById(empresaA, card.id)

    expect(lido?.comments).toEqual([])
  })

  it('move o card para outra coluna', async () => {
    const card = await crm.create({
      companyId: empresaA,
      title: 'Card a mover',
      kind: 'task',
      dueOn: '2026-09-27',
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    const movido = await crm.move(empresaA, card.id, 'doing')

    expect(movido.column).toBe('doing')
  })

  it('lista do mais recente para o mais antigo', async () => {
    const linhas = await crm.list(empresaA)

    const datas = linhas.map((c) => c.createdAt)
    expect([...datas].sort().reverse()).toEqual(datas)
  })

  it('nao enxerga card da outra loja', async () => {
    const daOutra = await crm.create({
      companyId: empresaB,
      title: 'Card da B',
      kind: 'task',
      dueOn: '2026-09-28',
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    expect(await crm.findById(empresaA, daOutra.id)).toBeUndefined()
    expect((await crm.list(empresaA)).map((c) => c.id)).not.toContain(daOutra.id)
  })

  it('equipe lista so quem esta ativo na propria loja', async () => {
    const inativo = await criarUsuario(empresaA, 'Ex-funcionario')
    await withTenant(
      sql,
      empresaA,
      (tx) => tx`UPDATE company_users SET is_active = false WHERE user_id = ${inativo}`,
    )
    await criarUsuario(empresaB, 'Gente de outra loja')

    const membros = await team.list(empresaA)

    expect(membros.map((m) => m.name)).toContain('Dono da A')
    expect(membros.map((m) => m.name)).not.toContain('Ex-funcionario')
    expect(membros.map((m) => m.name)).not.toContain('Gente de outra loja')
  })
})
