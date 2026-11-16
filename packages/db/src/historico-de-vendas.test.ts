import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createSaleHistoryRepository } from './sale-history-repository.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * O historico de vendas — NR-027, US-021.
 *
 * A paginacao e os filtros tem teste de rota contra falso. O que se prova AQUI
 * e o que so o banco prova: que uma venda com varios itens continua sendo UMA
 * linha (o `LATERAL`, e nao um `JOIN` que multiplicaria), que o `count(*) OVER`
 * conta antes do `LIMIT`, que o periodo respeita o fuso de exibicao, e que nada
 * disso enxerga a loja do lado.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

const SP = 'America/Sao_Paulo'

describe.skipIf(!DATABASE_URL)('historico de vendas — NR-027', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string

  let repo: ReturnType<typeof createSaleHistoryRepository>

  let proximoNumero = 1

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
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

  async function criarCliente(empresa: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`INSERT INTO customers (id, company_id, name) VALUES (${id}, ${empresa}, ${nome})`,
    )
    return id
  }

  async function criarVenda(
    empresa: string,
    opcoes: {
      createdAt: string
      netCents: number
      customerId?: string | null
      itens?: { descricao: string; quantidade: number; totalCents: number }[]
      pagamentos?: { metodo: string; valorCents: number; parcelas?: number }[]
    },
  ): Promise<string> {
    const id = randomUUID()
    const numero = proximoNumero++

    await withTenant(sql, empresa, async (tx) => {
      await tx`
        INSERT INTO sales
          (id, company_id, number, customer_id, gross_amount_cents, discount_cents,
           net_amount_cents, created_at)
        VALUES (${id}, ${empresa}, ${numero}, ${opcoes.customerId ?? null},
                ${opcoes.netCents}, 0, ${opcoes.netCents}, ${opcoes.createdAt})
      `

      for (const item of opcoes.itens ?? []) {
        await tx`
          INSERT INTO sale_items
            (company_id, sale_id, description, unit_of_measure, quantity,
             unit_price_cents, total_cents)
          VALUES (${empresa}, ${id}, ${item.descricao}, 'un', ${item.quantidade},
                  ${Math.round(item.totalCents / item.quantidade)}, ${item.totalCents})
        `
      }

      for (const p of opcoes.pagamentos ?? []) {
        await tx`
          INSERT INTO payments (company_id, sale_id, method, amount_cents, installments)
          VALUES (${empresa}, ${id}, ${p.metodo}, ${p.valorCents}, ${p.parcelas ?? null})
        `
      }
    })

    return id
  }

  const pagina = { offset: 0, limite: 20 }

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')

    admin = postgres(DATABASE_URL!, { max: 6, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('1'), 'Loja Historico A')
    empresaB = await criarEmpresa(cnpjDeTeste('0'), 'Loja Historico B')

    repo = createSaleHistoryRepository(sql, SP)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const empresa of [empresaA, empresaB].filter(Boolean)) {
      await withTenant(sql, empresa, async (tx) => {
        await tx`DELETE FROM payments`
        await tx`DELETE FROM invoices`
        await tx`DELETE FROM sale_items`
        await tx`DELETE FROM sales`
        await tx`DELETE FROM customers`
        await tx`DELETE FROM companies`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  it('venda com varios itens continua sendo UMA linha', async () => {
    /*
     * O caso que o `LATERAL` existe para resolver. Com `JOIN` direto, esta
     * venda de 3 itens e 2 pagamentos viraria 6 linhas — e `LIMIT 20` cortaria
     * no meio de uma venda, com a tela mostrando a mesma compra repetida.
     */
    await criarVenda(empresaA, {
      createdAt: '2026-05-10T15:00:00.000Z',
      netCents: 6_000,
      itens: [
        { descricao: 'Cafe', quantidade: 2, totalCents: 3_000 },
        { descricao: 'Acucar', quantidade: 1, totalCents: 1_000 },
        { descricao: 'Sal', quantidade: 1, totalCents: 2_000 },
      ],
      pagamentos: [
        { metodo: 'cash', valorCents: 2_000 },
        { metodo: 'credit', valorCents: 4_000, parcelas: 3 },
      ],
    })

    const r = await repo.list(empresaA, pagina)

    expect(r.vendas).toHaveLength(1)
    expect(r.total).toBe(1)
    expect(r.vendas[0]?.items).toHaveLength(3)
    expect(r.vendas[0]?.payments).toHaveLength(2)
    expect(r.vendas[0]?.payments.find((p) => p.method === 'credit')?.installments).toBe(3)
  })

  it('venda sem item nenhum nao quebra a leitura', async () => {
    const id = await criarVenda(empresaB, { createdAt: '2026-05-11T15:00:00.000Z', netCents: 500 })

    /* `json_agg` sobre conjunto vazio devolve NULL, e nao `[]` — sem o
       tratamento, isto seria um `.map` de undefined. */
    const achada = await repo.findById(empresaB, id)

    expect(achada?.items).toEqual([])
    expect(achada?.payments).toEqual([])
  })

  it('conta ANTES do LIMIT, para a tela poder dizer "2 de 5"', async () => {
    for (let i = 0; i < 4; i++) {
      await criarVenda(empresaA, {
        createdAt: `2026-06-0${i + 1}T15:00:00.000Z`,
        netCents: 1_000,
        itens: [{ descricao: 'Item', quantidade: 1, totalCents: 1_000 }],
      })
    }

    const r = await repo.list(empresaA, { offset: 0, limite: 2 })

    expect(r.vendas).toHaveLength(2)
    /* Cinco: as quatro daqui mais a do primeiro teste. */
    expect(r.total).toBe(5)
  })

  it('ordena da mais recente para a mais antiga', async () => {
    const r = await repo.list(empresaA, pagina)

    const datas = r.vendas.map((v) => v.soldAt)
    expect([...datas].sort().reverse()).toEqual(datas)
  })

  it('filtra pelo periodo no FUSO DE EXIBICAO', async () => {
    /* 31/07 as 21h30 em Sao Paulo e 01/08 as 00h30 em UTC. Para o lojista a
       venda e de julho — foi ele quem fechou o caixa naquela noite. */
    await criarVenda(empresaA, { createdAt: '2026-08-01T00:30:00.000Z', netCents: 7_000 })

    const julho = await repo.list(empresaA, { ...pagina, from: '2026-07-01', to: '2026-07-31' })
    const agosto = await repo.list(empresaA, { ...pagina, from: '2026-08-01', to: '2026-08-31' })

    expect(julho.total).toBe(1)
    expect(agosto.total).toBe(0)
  })

  it('busca pelo nome do cliente, pelo numero e pela descricao do item', async () => {
    const maria = await criarCliente(empresaA, 'Maria Aparecida')
    await criarVenda(empresaA, {
      createdAt: '2026-09-01T15:00:00.000Z',
      netCents: 9_000,
      customerId: maria,
      itens: [{ descricao: 'Detergente neutro', quantidade: 1, totalCents: 9_000 }],
    })

    const porNome = await repo.list(empresaA, { ...pagina, termo: 'aparecida' })
    const porItem = await repo.list(empresaA, { ...pagina, termo: 'detergente' })

    expect(porNome.total).toBe(1)
    expect(porNome.vendas[0]?.customerName).toBe('Maria Aparecida')
    expect(porItem.total).toBe(1)
  })

  it('venda de balcao vem com cliente nulo, e nao com nome inventado', async () => {
    const r = await repo.list(empresaA, { ...pagina, termo: 'Sal' })

    /* RF-033: a maioria das vendas nao tem cliente. `null` diz isso; um
       "Consumidor" inventado faria o ranking de clientes ter um lider falso. */
    expect(r.vendas[0]?.customerId).toBeNull()
    expect(r.vendas[0]?.customerName).toBeNull()
  })

  it('o resumo fala do FILTRO inteiro, e nao da pagina', async () => {
    const r = await repo.list(empresaA, { offset: 0, limite: 2 })

    /*
     * A pagina traz 2 vendas; o resumo conta todas as que casam com o filtro.
     * Somado no navegador a partir da pagina, o faturamento sairia varias
     * vezes menor — e um numero que parece certo e o pior tipo de errado.
     */
    expect(r.vendas).toHaveLength(2)
    expect(r.resumo.salesCount).toBe(r.total)
    expect(r.resumo.netCents).toBeGreaterThan(
      r.vendas.reduce((acc, v) => acc + v.netAmountCents, 0),
    )
  })

  it('venda cancelada some dos totais e continua na lista', async () => {
    const id = await criarVenda(empresaA, {
      createdAt: '2026-10-01T15:00:00.000Z',
      netCents: 500_000,
    })
    await withTenant(
      sql,
      empresaA,
      (tx) => tx`
        UPDATE sales SET status = 'cancelled', cancelled_at = now() WHERE id = ${id}
      `,
    )

    const r = await repo.list(empresaA, { ...pagina, from: '2026-10-01', to: '2026-10-31' })

    /* Aparece — o lojista precisa ver que cancelou. */
    expect(r.vendas.map((v) => v.id)).toContain(id)
    expect(r.total).toBe(1)
    /* E nao entra no faturamento: ela nao aconteceu. */
    expect(r.resumo.salesCount).toBe(0)
    expect(r.resumo.netCents).toBe(0)
  })

  it('o imposto previsto so sai do liquido quando a venda tem nota', async () => {
    /* R$ 100 cobrados, R$ 6 de imposto previsto: gravado 9.400 de liquido. */
    const venda = async (dia: string) => {
      const id = randomUUID()
      await withTenant(
        sql,
        empresaA,
        (tx) => tx`
          INSERT INTO sales
            (id, company_id, number, gross_amount_cents, discount_cents,
             tax_amount_cents, net_amount_cents, created_at)
          VALUES (${id}, ${empresaA}, ${proximoNumero++}, 10000, 0, 600, 9400, ${dia})
        `,
      )
      return id
    }
    const semNota = await venda('2026-11-03T15:00:00.000Z')
    const comNota = await venda('2026-11-04T15:00:00.000Z')
    await withTenant(
      sql,
      empresaA,
      (tx) => tx`
        INSERT INTO invoices (company_id, sale_id, access_key, number, series, status)
        VALUES (${empresaA}, ${comNota}, ${'3'.repeat(44)}, 1, 1, 'authorized')
      `,
    )

    const r = await repo.list(empresaA, { ...pagina, from: '2026-11-01', to: '2026-11-30' })
    const porId = new Map(r.vendas.map((v) => [v.id, v]))

    /* Sem nota nao ha imposto: o liquido e o que foi cobrado. */
    expect(porId.get(semNota)).toMatchObject({ taxAmountCents: 0, netAmountCents: 10000 })
    expect(porId.get(comNota)).toMatchObject({ taxAmountCents: 600, netAmountCents: 9400 })
    expect(r.resumo).toMatchObject({ salesCount: 2, grossCents: 20000, netCents: 19400 })
    /* So o imposto da venda COM nota entra no total — achado do QA, o
       assistente mostra cada parcela. */
    expect(r.resumo.taxCents).toBe(600)
  })

  it('o resumo traz o desconto e a parte que nao foi devolvida', async () => {
    /* R$ 100 com R$ 10 de desconto, metade devolvida: sobram R$ 5 de desconto. */
    await withTenant(
      sql,
      empresaA,
      (tx) => tx`
        INSERT INTO sales
          (company_id, number, status, gross_amount_cents, discount_cents,
           net_amount_cents, returned_amount_cents, created_at)
        VALUES (${empresaA}, ${proximoNumero++}, 'settled', 10000, 1000, 9000, 5000,
                '2027-01-05T15:00:00.000Z')
      `,
    )

    const r = await repo.list(empresaA, { ...pagina, from: '2027-01-01', to: '2027-01-31' })

    expect(r.resumo).toMatchObject({ grossCents: 5000, discountCents: 500, taxCents: 0 })
  })

  it('a venda devolvida inteira sai dos totais; a parcial abate o devolvido', async () => {
    const venda = async (dia: string, status: string, devolvido: number) => {
      await withTenant(
        sql,
        empresaA,
        (tx) => tx`
          INSERT INTO sales
            (company_id, number, status, gross_amount_cents, discount_cents,
             net_amount_cents, returned_amount_cents, created_at)
          VALUES (${empresaA}, ${proximoNumero++}, ${status}, 10000, 0, 10000, ${devolvido}, ${dia})
        `,
      )
    }
    await venda('2026-12-02T15:00:00.000Z', 'returned', 10000)
    await venda('2026-12-03T15:00:00.000Z', 'settled', 2500)

    const r = await repo.list(empresaA, { ...pagina, from: '2026-12-01', to: '2026-12-31' })

    expect(r.total).toBe(2)
    expect(r.resumo).toMatchObject({ salesCount: 1, grossCents: 7500, netCents: 7500 })
  })

  it('periodo sem venda devolve resumo zerado, e nao erro', async () => {
    const r = await repo.list(empresaA, { ...pagina, from: '2030-01-01', to: '2030-01-31' })

    expect(r.vendas).toEqual([])
    expect(r.resumo).toEqual({
      salesCount: 0,
      grossCents: 0,
      netCents: 0,
      cardFeeCents: 0,
      discountCents: 0,
      taxCents: 0,
    })
  })

  it('nao enxerga a venda da outra loja', async () => {
    const daOutra = await repo.list(empresaB, pagina)
    const daminha = await repo.list(empresaA, pagina)

    expect(daOutra.total).toBe(1)
    expect(daminha.vendas.map((v) => v.id)).not.toContain(daOutra.vendas[0]?.id)
  })

  it('venda de outra loja nao e encontrada pelo id', async () => {
    const daOutra = await repo.list(empresaB, pagina)

    expect(await repo.findById(empresaA, daOutra.vendas[0]!.id)).toBeUndefined()
  })
})
