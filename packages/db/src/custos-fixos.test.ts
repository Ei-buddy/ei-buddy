import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createFixedCostPayableGenerator,
  createFixedCostRepository,
} from './fixed-cost-repository.js'
import { createPayableQueries } from './payable-repository.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Custos fixos — NR-110.
 *
 * Tres coisas que so o banco prova: o isolamento entre lojas, a junta com o
 * plano de contas (nome, nao uuid), e a idempotencia ATOMICA de "gerar as
 * contas do mes" — o indice unico parcial e o `ON CONFLICT ... DO NOTHING`
 * sao garantia de servidor, nao de aplicacao, e so um Postgres de verdade
 * prova que o indice existe e funciona.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('custos fixos — NR-110', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuarioA: string
  let contaDespesaA: string

  let repo: ReturnType<typeof createFixedCostRepository>
  let gerador: ReturnType<typeof createFixedCostPayableGenerator>

  async function criarEmpresa(prefixo: string, nome: string): Promise<string> {
    const id = randomUUID()
    const cnpj = cnpjDeTeste(prefixo)
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`c@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarUsuario(empresa: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(sql, empresa, async (tx) => {
      await tx`INSERT INTO users (id, name, email) VALUES (${id}, ${nome}, ${`${id}@loja.local`})`
      await tx`
        INSERT INTO company_users (company_id, user_id, role) VALUES (${empresa}, ${id}, 'owner')
      `
    })
    return id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0012_custos_fixos')

    admin = postgres(DATABASE_URL!, { max: 6, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    repo = createFixedCostRepository(sql)
    gerador = createFixedCostPayableGenerator(sql)

    empresaA = await criarEmpresa('5', 'Loja Custos A')
    empresaB = await criarEmpresa('6', 'Loja Custos B')
    usuarioA = await criarUsuario(empresaA, 'Dono da A')

    const [conta] = await withTenant(
      sql,
      empresaA,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO ledger_accounts (company_id, name, type)
        VALUES (${empresaA}, 'Aluguel', 'expense')
        RETURNING id
      `,
    )
    contaDespesaA = conta!.id
  }, 60_000)

  afterAll(async () => {
    await aplicacao?.encerrar()
    await admin?.end({ timeout: 5 })
  })

  it('cadastra e le de volta, com o nome da conta junto', async () => {
    const criado = await repo.insert({
      companyId: empresaA,
      name: 'Aluguel do ponto',
      amountCents: 150_000,
      dueDay: 5,
      accountId: contaDespesaA,
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    expect(criado.name).toBe('Aluguel do ponto')
    expect(criado.accountName).toBe('Aluguel')
  })

  it('sem classificacao, o nome da conta fica nulo — nao quebra a leitura', async () => {
    const criado = await repo.insert({
      companyId: empresaA,
      name: 'Sem plano',
      amountCents: 10_000,
      dueDay: 10,
      accountId: null,
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    const achado = await repo.findById(empresaA, criado.id)

    expect(achado?.accountName).toBeNull()
  })

  it('edita e a leitura reflete', async () => {
    const criado = await repo.insert({
      companyId: empresaA,
      name: 'Internet',
      amountCents: 20_000,
      dueDay: 15,
      accountId: null,
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    const editado = await repo.update(empresaA, criado.id, {
      name: 'Internet fibra',
      amountCents: 25_000,
      dueDay: 20,
      accountId: contaDespesaA,
    })

    expect(editado.name).toBe('Internet fibra')
    expect(editado.amountCents).toBe(25_000)
    expect(editado.accountName).toBe('Aluguel')
  })

  it('exclui, e sai da listagem', async () => {
    const criado = await repo.insert({
      companyId: empresaA,
      name: 'Sera excluido',
      amountCents: 5_000,
      dueDay: 1,
      accountId: null,
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    await repo.remove(empresaA, criado.id)

    expect(await repo.findById(empresaA, criado.id)).toBeUndefined()
  })

  it('nao enxerga custo fixo de outra loja', async () => {
    const daOutra = await repo.insert({
      companyId: empresaB,
      name: 'So da B',
      amountCents: 1_000,
      dueDay: 1,
      accountId: null,
      createdBy: usuarioA,
      createdAt: new Date('2026-09-11T13:00:00.000Z'),
    })

    expect(await repo.findById(empresaA, daOutra.id)).toBeUndefined()
    expect((await repo.list(empresaA)).map((c) => c.id)).not.toContain(daOutra.id)
  })

  describe('listagem de contas a pagar — NR-115 / T022', () => {
    let payables: ReturnType<typeof createPayableQueries>

    beforeAll(() => {
      payables = createPayableQueries(sql)
    })

    async function inserirTitulo(
      empresa: string,
      fornecedor: string,
      valorCents: number,
      vencimento: string,
    ): Promise<string> {
      const id = randomUUID()
      await withTenant(
        sql,
        empresa,
        (tx) => tx`
          INSERT INTO payables
            (id, company_id, supplier, description, amount_cents, due_date, status)
          VALUES (${id}, ${empresa}, ${fornecedor}, ${fornecedor}, ${valorCents}, ${vencimento}, 'open')
        `,
      )
      return id
    }

    it('lista abertos so do tenant atual', async () => {
      await inserirTitulo(empresaA, 'Fornecedor A', 12_000, '2026-09-12')
      await inserirTitulo(empresaB, 'Fornecedor B', 99_000, '2026-09-12')

      const daA = await payables.list(empresaA, { status: ['open'] })
      const daB = await payables.list(empresaB, { status: ['open'] })

      expect(daA.map((p) => p.supplier)).toContain('Fornecedor A')
      expect(daA.map((p) => p.supplier)).not.toContain('Fornecedor B')
      expect(daB.map((p) => p.supplier)).toContain('Fornecedor B')
      expect(daB.map((p) => p.supplier)).not.toContain('Fornecedor A')
    })

    it('titulo conhecido apenas da outra loja responde como ausente', async () => {
      const idB = await inserirTitulo(empresaB, 'Titulo so da B', 5_000, '2026-09-15')

      const daA = await payables.list(empresaA, { status: ['open'] })

      expect(daA.map((p) => p.id)).not.toContain(idB)
    })
  })

  describe('gerar as contas do mes', () => {
    it('gera uma conta a pagar, com o vencimento no dia certo', async () => {
      const custo = await repo.insert({
        companyId: empresaA,
        name: 'Energia',
        amountCents: 30_000,
        dueDay: 12,
        accountId: contaDespesaA,
        createdBy: usuarioA,
        createdAt: new Date('2026-09-11T13:00:00.000Z'),
      })

      const geradas = await gerador.generate([
        {
          fixedCostId: custo.id,
          companyId: empresaA,
          supplier: custo.name,
          description: custo.name,
          amountCents: custo.amountCents,
          dueDate: '2026-11-12',
          accountId: custo.accountId,
          createdBy: usuarioA,
          createdAt: new Date('2026-11-01T13:00:00.000Z'),
        },
      ])

      expect(geradas).toHaveLength(1)
      /* O vencimento volta como TEXTO, no dia certo — sem o recuo de fuso que
         o driver daria lendo `date` como Date UTC. */
      expect(geradas[0]?.dueDate).toBe('2026-11-12')
      expect(geradas[0]?.supplier).toBe('Energia')
    })

    /*
     * O indice unico parcial `payables_um_por_custo_fixo_por_vencimento` e a
     * garantia de verdade: chamar `generate` duas vezes com o MESMO rascunho
     * so grava uma vez, e a SEGUNDA chamada nao lanca erro — o
     * `ON CONFLICT ... DO NOTHING` absorve a colisao.
     */
    it('gerar duas vezes para o mesmo mes nao duplica', async () => {
      const custo = await repo.insert({
        companyId: empresaA,
        name: 'Contabilidade',
        amountCents: 40_000,
        dueDay: 8,
        accountId: null,
        createdBy: usuarioA,
        createdAt: new Date('2026-09-11T13:00:00.000Z'),
      })

      const rascunho = {
        fixedCostId: custo.id,
        companyId: empresaA,
        supplier: custo.name,
        description: custo.name,
        amountCents: custo.amountCents,
        dueDate: '2026-12-08',
        accountId: custo.accountId,
        createdBy: usuarioA,
        createdAt: new Date('2026-12-01T13:00:00.000Z'),
      }

      const primeira = await gerador.generate([rascunho])
      const segunda = await gerador.generate([rascunho])

      expect(primeira).toHaveLength(1)
      expect(segunda).toHaveLength(0)
    })

    it('excluir o custo fixo NAO apaga a conta ja gerada', async () => {
      const custo = await repo.insert({
        companyId: empresaA,
        name: 'Sera excluido depois de gerar',
        amountCents: 15_000,
        dueDay: 3,
        accountId: null,
        createdBy: usuarioA,
        createdAt: new Date('2026-09-11T13:00:00.000Z'),
      })

      const [gerada] = await gerador.generate([
        {
          fixedCostId: custo.id,
          companyId: empresaA,
          supplier: custo.name,
          description: custo.name,
          amountCents: custo.amountCents,
          dueDate: '2027-01-03',
          accountId: null,
          createdBy: usuarioA,
          createdAt: new Date('2027-01-01T13:00:00.000Z'),
        },
      ])

      await repo.remove(empresaA, custo.id)

      const [aindaExiste] = await withTenant(
        sql,
        empresaA,
        (tx) => tx<{ id: string; fixed_cost_id: string | null }[]>`
          SELECT id, fixed_cost_id FROM payables WHERE id = ${gerada!.id}
        `,
      )
      /* A conta continua — so o vinculo com o molde some (ON DELETE SET NULL). */
      expect(aindaExiste).toBeDefined()
      expect(aindaExiste?.fixed_cost_id).toBeNull()
    })
  })
})
