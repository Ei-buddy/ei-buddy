import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuditQueries } from './audit-repository.js'
import { migrate } from './migrate.js'
import { conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Leitura da trilha — US-061, "quando consulto".
 *
 * A metade que faltava: dezesseis pontos gravavam e nada lia. Roda pelo papel
 * COMUM da aplicacao, porque o isolamento entre lojas aqui e do RLS — provar
 * isso com superusuario nao provaria nada.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

const FILTRO = { page: 1, pageSize: 50 }

/*
 * CNPJ proprio, e nao `cnpjDeTeste`: aquele monta prefixo + `Date.now()`, e
 * esta suite cria varias empresas no mesmo milissegundo — colidiriam na
 * unicidade. O contador garante uma por chamada.
 */
let sequencia = 0
const cnpjUnico = () =>
  `${String(Date.now()).slice(-9)}${String((sequencia += 1)).padStart(5, '0')}`

describe.skipIf(!DATABASE_URL)('consulta da trilha — US-061', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string

  async function criarEmpresa(nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpjUnico()}, ${`c-${id}@teste.local`}, ${'41999990000'})
      `,
    )
    return id
  }

  async function criarUsuario(nome: string): Promise<string> {
    const [linha] = await admin<{ id: string }[]>`
      INSERT INTO users (name, email) VALUES (${nome}, ${`u-${randomUUID()}@teste.local`})
      RETURNING id
    `
    return linha!.id
  }

  async function registrar(
    empresa: string,
    over: { entity?: string; actorId?: string; action?: string; occurredAt?: string } = {},
  ): Promise<void> {
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO audit_logs
          (company_id, entity, entity_id, action, actor_id, channel, occurred_at, before, after)
        VALUES (
          ${empresa}, ${over.entity ?? 'Product'}, ${randomUUID()},
          ${over.action ?? 'updated'}, ${over.actorId ?? randomUUID()}, ${'app'},
          ${over.occurredAt ?? '2026-09-02T12:00:00Z'},
          ${(over.action ?? 'updated') === 'created' ? null : tx.json({ stockQuantity: 20 })},
          ${tx.json({ stockQuantity: 18 })}
        )
      `,
    )
  }

  beforeAll(async () => {
    await migrate(MIGRATION_URL!)
    admin = postgres(MIGRATION_URL!, { max: 2, onnotice: () => undefined })
    aplicacao = await conectarComoAplicacao(admin, MIGRATION_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa('Loja A da Trilha')
    empresaB = await criarEmpresa('Loja B da Trilha')
  }, 40_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('devolve o que a loja registrou', async () => {
    const empresa = await criarEmpresa('Loja com registro')
    await registrar(empresa)

    const r = await createAuditQueries(sql).list(empresa, FILTRO)

    expect(r.total).toBe(1)
    expect(r.entries[0]?.entity).toBe('Product')
  })

  it('a trilha de uma loja nao aparece para a outra — quem barra e o RLS', async () => {
    await registrar(empresaA)

    const daOutra = await createAuditQueries(sql).list(empresaB, FILTRO)

    expect(daOutra.entries).toEqual([])
    expect(daOutra.total).toBe(0)
  })

  it('traz o NOME de quem fez, e nao so o identificador', async () => {
    const empresa = await criarEmpresa('Loja com autor')
    const autor = await criarUsuario('Marta do Caixa')
    await registrar(empresa, { actorId: autor })

    const r = await createAuditQueries(sql).list(empresa, FILTRO)

    /* O terceiro criterio da US-061 — "vejo o usuario humano que confirmou". */
    expect(r.entries[0]?.actorName).toBe('Marta do Caixa')
  })

  it('nomeia quem agiu SEM vinculo com a loja — o Super Admin e quem saiu', async () => {
    const empresa = await criarEmpresa('Loja visitada pelo Super Admin')
    /* `criarUsuario` nao cria vinculo em `company_users`: e exatamente a
       situacao do Super Admin dentro da loja, e do funcionario desligado. */
    const semVinculo = await criarUsuario('Super Admin Visitante')
    await registrar(empresa, { actorId: semVinculo })

    const r = await createAuditQueries(sql).list(empresa, FILTRO)

    /*
     * Com `JOIN` em `users`, a politica de RLS esconderia esta pessoa e o
     * nome viria nulo — a trilha registraria a acao sem dizer quem foi,
     * justamente no caso de quem entrou de fora.
     */
    expect(r.entries[0]?.actorName).toBe('Super Admin Visitante')
  })

  it('autor que nao existe mais NAO some da trilha', async () => {
    const empresa = await criarEmpresa('Loja com autor desligado')
    await registrar(empresa, { actorId: randomUUID() })

    const r = await createAuditQueries(sql).list(empresa, FILTRO)

    /*
     * `actor_id` nao tem chave estrangeira de proposito: o autor pode ser
     * desligado sem que o que ele fez deixe de valer. Com `JOIN` comum, a
     * linha sumiria — e "o que o funcionario que saiu andou fazendo" e
     * exatamente uma das perguntas da US-061.
     */
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0]?.actorName).toBeNull()
  })

  it('filtra por entidade, por autor e por acao', async () => {
    const empresa = await criarEmpresa('Loja para filtrar')
    const autor = await criarUsuario('Quem Mexeu')
    await registrar(empresa, { entity: 'Product', action: 'updated' })
    await registrar(empresa, { entity: 'Sale', action: 'created', actorId: autor })

    const queries = createAuditQueries(sql)

    expect((await queries.list(empresa, { ...FILTRO, entity: 'Sale' })).total).toBe(1)
    expect((await queries.list(empresa, { ...FILTRO, action: 'created' })).total).toBe(1)
    expect((await queries.list(empresa, { ...FILTRO, actorId: autor })).total).toBe(1)
  })

  it('filtra por periodo', async () => {
    const empresa = await criarEmpresa('Loja por periodo')
    await registrar(empresa, { occurredAt: '2026-01-10T12:00:00Z' })
    await registrar(empresa, { occurredAt: '2026-06-10T12:00:00Z' })

    const r = await createAuditQueries(sql).list(empresa, {
      ...FILTRO,
      from: '2026-05-01T00:00:00Z',
    })

    expect(r.total).toBe(1)
  })

  it('mais recente primeiro, e o total ignora a pagina', async () => {
    const empresa = await criarEmpresa('Loja paginada')
    await registrar(empresa, { occurredAt: '2026-03-01T12:00:00Z' })
    await registrar(empresa, { occurredAt: '2026-03-02T12:00:00Z' })
    await registrar(empresa, { occurredAt: '2026-03-03T12:00:00Z' })

    const r = await createAuditQueries(sql).list(empresa, { page: 1, pageSize: 2 })

    expect(r.entries).toHaveLength(2)
    /* Quem abre a trilha quer o que acabou de acontecer. */
    expect(r.entries[0]?.occurredAt.startsWith('2026-03-03')).toBe(true)
    /* Sem o total real a tela nao sabe que existe pagina 2. */
    expect(r.total).toBe(3)
  })
})
