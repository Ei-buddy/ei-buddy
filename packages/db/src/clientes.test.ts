import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createCustomerRepository } from './registration-repositories.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * A lista de clientes com historico — NR-072, RF-011, US-036.
 *
 * O que se prova aqui e o que so o banco prova: que o `LATERAL` nao multiplica
 * a linha do cliente por venda, que o total conta antes do `LIMIT`, que
 * "inativo" inclui quem nunca comprou, que venda cancelada nao entra na conta,
 * e que nada disso enxerga a loja do lado.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('lista de clientes — NR-072', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string

  let repo: ReturnType<typeof createCustomerRepository>

  const HOJE = new Date('2026-09-07T12:00:00.000Z')
  let sequencia = 0

  const pedido = {
    filtro: 'todos' as const,
    diasParaInativo: 60,
    hoje: HOJE,
    offset: 0,
    limite: 24,
  }

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`cl@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarCliente(
    empresa: string,
    nome: string,
    extras: { saldoCents?: number } = {},
  ): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO customers (id, company_id, name, wallet_balance_cents)
        VALUES (${id}, ${empresa}, ${nome}, ${extras.saldoCents ?? 0})
      `,
    )
    return id
  }

  async function criarVenda(
    empresa: string,
    clienteId: string,
    quando: string,
    valorCents: number,
    cancelada = false,
  ): Promise<void> {
    sequencia += 1
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO sales
          (company_id, number, customer_id, status, gross_amount_cents, discount_cents,
           net_amount_cents, created_at, cancelled_at)
        VALUES (${empresa}, ${sequencia}, ${clienteId},
                ${cancelada ? 'cancelled' : 'open'}, ${valorCents}, 0, ${valorCents},
                ${quando}, ${cancelada ? quando : null})
      `,
    )
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('3'), 'Loja Clientes A')
    empresaB = await criarEmpresa(cnpjDeTeste('5'), 'Loja Clientes B')

    repo = createCustomerRepository(sql)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM sales`
        await tx`DELETE FROM customers`
        await tx`DELETE FROM companies`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  it('o LATERAL nao multiplica a linha do cliente por venda', async () => {
    const maria = await criarCliente(empresaA, 'Maria Compradora')
    await criarVenda(empresaA, maria, '2026-09-01T10:00:00.000Z', 10_000)
    await criarVenda(empresaA, maria, '2026-09-03T10:00:00.000Z', 20_000)
    await criarVenda(empresaA, maria, '2026-09-05T10:00:00.000Z', 30_000)

    const r = await repo.list(empresaA, pedido)
    const dela = r.clientes.filter((c) => c.id === maria)

    /*
     * UMA linha, com tres vendas agregadas. Com `JOIN` seriam tres linhas, e o
     * `LIMIT 24` cortaria no meio de um cliente — a tela repetiria a mesma
     * pessoa e perderia outra.
     */
    expect(dela).toHaveLength(1)
    expect(dela[0]?.salesCount).toBe(3)
    expect(dela[0]?.totalSpentCents).toBe(60_000)
    expect(dela[0]?.lastSaleOn).toBe('2026-09-05')
  })

  it('venda cancelada nao entra na conta', async () => {
    const joao = await criarCliente(empresaA, 'Joao Cancelou')
    await criarVenda(empresaA, joao, '2026-09-02T10:00:00.000Z', 5_000)
    await criarVenda(empresaA, joao, '2026-09-04T10:00:00.000Z', 90_000, true)

    const r = await repo.list(empresaA, { ...pedido, termo: 'Joao Cancelou' })

    expect(r.clientes[0]?.salesCount).toBe(1)
    expect(r.clientes[0]?.totalSpentCents).toBe(5_000)
  })

  it('quem nunca comprou volta com nulo, e nao com zero disfarcado', async () => {
    await criarCliente(empresaA, 'Zulmira Nunca Veio')

    const r = await repo.list(empresaA, { ...pedido, termo: 'Zulmira' })

    /* Nulo e "nunca comprou"; uma data antiga seria "comprou ha muito tempo".
       Sao coisas diferentes, e a tela diz cada uma do seu jeito. */
    expect(r.clientes[0]?.lastSaleOn).toBeNull()
    expect(r.clientes[0]?.salesCount).toBe(0)
  })

  it('conta o total ANTES do limite', async () => {
    const r = await repo.list(empresaA, { ...pedido, limite: 2 })

    expect(r.clientes).toHaveLength(2)
    /* Sem isto, pagina cheia e indistinguivel de fim da lista e o lojista para
       de procurar achando que acabou. */
    expect(r.total).toBeGreaterThan(2)
  })

  it('a busca estreita o total, e nao so a pagina', async () => {
    const r = await repo.list(empresaA, { ...pedido, termo: 'Zulmira' })

    expect(r.total).toBe(1)
  })

  describe('filtros', () => {
    it('inativos inclui quem NUNCA comprou', async () => {
      const r = await repo.list(empresaA, { ...pedido, filtro: 'inativos' })

      /* Quem nunca veio e o caso mais extremo do que o filtro procura: alguem
         que precisa de um contato. Deixa-lo de fora esconderia justamente quem
         mais precisa aparecer. */
      expect(r.clientes.map((c) => c.name)).toContain('Zulmira Nunca Veio')
    })

    it('inativos NAO inclui quem comprou dentro da janela', async () => {
      const r = await repo.list(empresaA, { ...pedido, filtro: 'inativos' })

      /* Maria comprou em 5 de setembro, e hoje e dia 7: dois dias, nao sessenta. */
      expect(r.clientes.map((c) => c.name)).not.toContain('Maria Compradora')
    })

    it('inativos inclui quem comprou antes da janela', async () => {
      const antigo = await criarCliente(empresaA, 'Antonio Sumido')
      await criarVenda(empresaA, antigo, '2026-01-10T10:00:00.000Z', 4_000)

      const r = await repo.list(empresaA, { ...pedido, filtro: 'inativos' })

      expect(r.clientes.map((c) => c.name)).toContain('Antonio Sumido')
    })

    it('fiado traz so quem tem saldo devedor', async () => {
      await criarCliente(empresaA, 'Devedora Dina', { saldoCents: 3_500 })

      const r = await repo.list(empresaA, { ...pedido, filtro: 'fiado' })

      expect(r.clientes.map((c) => c.name)).toEqual(['Devedora Dina'])
    })
  })

  it('nao enxerga o cliente da outra loja', async () => {
    await criarCliente(empresaB, 'Cliente da loja B')

    const r = await repo.list(empresaA, pedido)

    expect(r.clientes.map((c) => c.name)).not.toContain('Cliente da loja B')
  })
})

describe.skipIf(!DATABASE_URL)('busca de cliente para fiado — NR-115 US3', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let repo: ReturnType<typeof createCustomerRepository>

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`fiado@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarCliente(
    empresa: string,
    nome: string,
    extras: { saldoCents?: number; phone?: string } = {},
  ): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO customers (id, company_id, name, phone, wallet_balance_cents)
        VALUES (${id}, ${empresa}, ${nome}, ${extras.phone ?? null}, ${extras.saldoCents ?? 0})
      `,
    )
    return id
  }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('7'), 'Loja Fiado A')
    empresaB = await criarEmpresa(cnpjDeTeste('9'), 'Loja Fiado B')

    repo = createCustomerRepository(sql)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM customers`
        await tx`DELETE FROM companies`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  beforeEach(async () => {
    for (const empresa of [empresaA, empresaB]) {
      await withTenant(sql, empresa, (tx) => tx`DELETE FROM customers`)
    }
  })

  it('acha um cliente pelo nome', async () => {
    await criarCliente(empresaA, 'Maria Devedora', { saldoCents: 4_500, phone: '41999991111' })

    const achados = await repo.search(empresaA, { termo: 'Maria', limite: 5 })

    expect(achados).toHaveLength(1)
    expect(achados[0]?.name).toBe('Maria Devedora')
    expect(achados[0]?.walletBalanceCents).toBe(4_500)
  })

  it('devolve saldo zero sem confundir com ausencia', async () => {
    await criarCliente(empresaA, 'Joao Quitado')

    const achados = await repo.search(empresaA, { termo: 'Joao', limite: 5 })

    expect(achados).toHaveLength(1)
    expect(achados[0]?.walletBalanceCents).toBe(0)
  })

  it('limita candidatos para desambiguacao', async () => {
    await criarCliente(empresaA, 'Maria Silva', { phone: '41999992222' })
    await criarCliente(empresaA, 'Maria Souza', { phone: '41999993333' })

    const achados = await repo.search(empresaA, { termo: 'Maria', limite: 5 })

    expect(achados.map((c) => c.name).sort()).toEqual(['Maria Silva', 'Maria Souza'])
  })

  it('nao enxerga cliente de outra loja', async () => {
    await criarCliente(empresaB, 'Maria da loja B', { saldoCents: 9_000 })

    const achados = await repo.search(empresaA, { termo: 'da loja B', limite: 5 })

    expect(achados).toEqual([])
  })
})
