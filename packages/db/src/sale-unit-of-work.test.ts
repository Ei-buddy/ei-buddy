import { randomUUID } from 'node:crypto'
import { registerSale } from '@na-regua/core'
import type { ExecutionContext, SaleSettings } from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './migrate.js'
import { createSaleUnitOfWork } from './sale-unit-of-work.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * A venda de ponta a ponta: caso de uso de `core` sobre o banco de verdade.
 *
 * As outras suites de `db` verificam o isolamento e as invariantes das tabelas.
 * Esta verifica a costura — que `registerSale` grava venda, itens, pagamentos,
 * recebiveis, saldo e trilha numa transacao so, contra Postgres, com RLS em
 * vigor e papel comum.
 *
 * E o unico lugar onde a implementacao da porta e exercitada. O falso em
 * memoria de `core` prova a regra; este prova o SQL.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

const CONFIGURACAO: SaleSettings = {
  taxRules: { regime: 'simples_nacional', defaultRate: 6 },
  cardFees: {
    rates: [
      { brand: 'visa', installments: 1, feeRatePercent: 2 },
      { brand: 'visa', installments: 3, feeRatePercent: 5 },
    ],
    settlementDays: 30,
  },
  discountPolicy: { maxDiscountRate: 10 },
}

describe.skipIf(!DATABASE_URL)('registerSale sobre o banco — NR-022, NR-027', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresa: string
  let outraEmpresa: string
  let produto: string
  let usuario: string

  const contexto = (sobrescreve: Partial<ExecutionContext> = {}): ExecutionContext => ({
    companyId: empresa,
    userId: usuario,
    role: 'owner',
    channel: 'app',
    requestId: 'req-teste',
    now: new Date('2026-09-02T13:00:00.000Z'),
    ...sobrescreve,
  })

  const deps = () => ({
    unitOfWork: createSaleUnitOfWork(sql),
    settings: { forSale: async () => CONFIGURACAO },
  })

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

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')

    admin = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresa = await criarEmpresa('7', 'Mercearia da Venda')
    outraEmpresa = await criarEmpresa('8', 'Loja Vizinha')

    usuario = randomUUID()
    await withTenant(sql, empresa, async (tx) => {
      await tx`
        INSERT INTO users (id, name, email)
        VALUES (${usuario}, 'Operadora', ${`op-${Date.now()}@loja.local`})
      `
      await tx`
        INSERT INTO company_users (company_id, user_id, role)
        VALUES (${empresa}, ${usuario}, 'owner')
      `
    })

    produto = randomUUID()
    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO products (id, company_id, description, internal_code, unit_of_measure,
                              sale_price_cents, cost_price_cents, stock)
        VALUES (${produto}, ${empresa}, 'Cafe torrado 500g', 'PROD-0001', 'un', 1990, 1200, 10)
      `,
    )
  }, 90_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    for (const emp of [empresa, outraEmpresa].filter(Boolean)) {
      await withTenant(sql, emp, async (tx) => {
        /* `inventory_movements` e somente-insercao — o gatilho recusa DELETE.
           Limpar exige o papel de administrador, que pode desabilitar gatilho;
           aqui basta apagar o resto e deixar a trilha, que e o comportamento
           correto de uma trilha. */
        await tx`DELETE FROM receivables`
        await tx`DELETE FROM payments`
        await tx`DELETE FROM sale_items`
      })
    }
    await admin.unsafe(`ALTER TABLE inventory_movements DISABLE TRIGGER USER`)
    await admin.unsafe(`DELETE FROM inventory_movements`)
    await admin.unsafe(`ALTER TABLE inventory_movements ENABLE TRIGGER USER`)
    for (const emp of [empresa, outraEmpresa].filter(Boolean)) {
      await withTenant(sql, emp, async (tx) => {
        await tx`DELETE FROM sales`
        await tx`DELETE FROM company_counters`
        await tx`DELETE FROM products`
        await tx`DELETE FROM company_users`
        await tx`DELETE FROM companies`
      })
    }
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  it('grava venda, item, pagamento, recebivel, saldo e trilha numa transacao', async () => {
    const r = await registerSale(deps(), contexto(), {
      items: [{ productId: produto, quantity: 2, unitPriceCents: 1990 }],
      payments: [{ method: 'cash', amountCents: 3980 }],
    })

    expect(r.sale.number).toBe(1)
    expect(r.sale.grossAmountCents).toBe(3980)

    const linhas = await withTenant(sql, empresa, async (tx) => ({
      itens: await tx<{ quantity: number; description: string }[]>`
        SELECT quantity, description FROM sale_items WHERE sale_id = ${r.sale.id}
      `,
      pagamentos: await tx<{ method: string; amount_cents: string }[]>`
        SELECT method, amount_cents FROM payments WHERE sale_id = ${r.sale.id}
      `,
      recebiveis: await tx<{ status: string; net_amount_cents: string }[]>`
        SELECT status, net_amount_cents FROM receivables WHERE sale_id = ${r.sale.id}
      `,
      produto: await tx<{ stock: number }[]>`
        SELECT stock FROM products WHERE id = ${produto}
      `,
      movimentos: await tx<
        { kind: string; quantity_delta: number; balance_after: number; sale_id: string }[]
      >`
        SELECT kind, quantity_delta, balance_after, sale_id
          FROM inventory_movements WHERE sale_id = ${r.sale.id}
      `,
    }))

    expect(linhas.itens).toHaveLength(1)
    /* Copia da descricao no momento da venda, nao referencia viva. */
    expect(linhas.itens[0]?.description).toBe('Cafe torrado 500g')
    expect(linhas.pagamentos).toHaveLength(1)
    /* `cash` nasce liquidado — RF-064. */
    expect(linhas.recebiveis[0]?.status).toBe('settled')
    expect(linhas.produto[0]?.stock).toBe(8)

    /* A baixa da venda tambem e movimento de estoque — RF-024. */
    expect(linhas.movimentos).toHaveLength(1)
    expect(linhas.movimentos[0]?.kind).toBe('sale')
    expect(linhas.movimentos[0]?.quantity_delta).toBe(-2)
    /* Saldo DEPOIS, vindo do proprio UPDATE: ler antes e subtrair na aplicacao
       daria o valor errado com duas vendas simultaneas. */
    expect(linhas.movimentos[0]?.balance_after).toBe(8)
  })

  it('reenvio com a mesma chave devolve a venda original e nao baixa estoque de novo', async () => {
    const ctx = contexto({ idempotencyKey: `pdv-${Date.now()}` })
    const entrada = {
      items: [{ productId: produto, quantity: 1, unitPriceCents: 1990 }],
      payments: [{ method: 'cash' as const, amountCents: 1990 }],
    }

    const antes = await saldo()
    const primeira = await registerSale(deps(), ctx, entrada)
    const segunda = await registerSale(deps(), ctx, entrada)

    expect(segunda.sale.id).toBe(primeira.sale.id)
    expect(segunda.replayed).toBe(true)
    /* Uma unidade, nao duas: reenvio nao move estoque. */
    expect(await saldo()).toBe(antes - 1)
  })

  it('desfaz tudo quando a transacao falha — RNF-046', async () => {
    const antes = await saldo()
    const contagemAntes = await vendasDaEmpresa()

    await expect(
      createSaleUnitOfWork(sql).transaction(empresa, async (tx) => {
        const parcial = await tx.insertSale({
          channel: 'app',
          grossAmountCents: 1990,
          discountCents: 0,
          taxAmountCents: 0,
          cardFeeAmountCents: 0,
          costAmountCents: 0,
          netAmountCents: 1990,
          changeCents: 0,
          items: [],
          payments: [],
          receivables: [],
          createdBy: usuario,
          createdAt: new Date(),
        })
        /*
         * O saleId tem de ser o da venda que acabou de ser gravada:
         * `inventory_movements.sale_id` tem chave estrangeira para `sales`, e
         * um uuid aleatorio viola a FK — o teste falharia pelo motivo errado e
         * diria que a transacao desfez quando ela nem chegou ao ponto.
         */
        await tx.decreaseStock([{ productId: produto, quantity: 1 }], {
          saleId: parcial.id,
          createdBy: usuario,
          createdAt: new Date(),
        })
        throw new Error('falha depois de gravar')
      }),
    ).rejects.toThrow('falha depois de gravar')

    /* O banco desfez: nem venda, nem saldo alterado, nem movimento. */
    expect(await vendasDaEmpresa()).toBe(contagemAntes)
    expect(await saldo()).toBe(antes)
  })

  it('a trilha de estoque e somente-insercao — RF-124', async () => {
    /*
     * Cria o proprio movimento em vez de pegar o que outro teste deixou.
     * Depender de sobra torna o resultado funcao da ORDEM — e quando os
     * primeiros testes falharam na CI, este falhou com "expected undefined to
     * be truthy", escondendo que a protecao nunca foi exercitada.
     */
    const venda = await registerSale(deps(), contexto(), {
      items: [{ productId: produto, quantity: 1, unitPriceCents: 1990 }],
      payments: [{ method: 'cash', amountCents: 1990 }],
    })

    const [mov] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ id: string }[]>`
        SELECT id FROM inventory_movements WHERE sale_id = ${venda.sale.id}
      `,
    )
    expect(mov?.id).toBeTruthy()

    /* Corrigir estoque e um movimento NOVO, nunca alterar o antigo. */
    await expect(
      withTenant(
        sql,
        empresa,
        (tx) => tx`UPDATE inventory_movements SET quantity_delta = 0 WHERE id = ${mov!.id}`,
      ),
    ).rejects.toThrow(/somente-insercao/)

    await expect(
      withTenant(sql, empresa, (tx) => tx`DELETE FROM inventory_movements WHERE id = ${mov!.id}`),
    ).rejects.toThrow(/somente-insercao/)
  })

  it('a venda de uma loja nao aparece na outra', async () => {
    const r = await registerSale(deps(), contexto(), {
      items: [{ productId: produto, quantity: 1, unitPriceCents: 1990 }],
      payments: [{ method: 'pix', amountCents: 1990 }],
    })

    const naOutra = await withTenant(
      sql,
      outraEmpresa,
      (tx) => tx<{ id: string }[]>`SELECT id FROM sales WHERE id = ${r.sale.id}`,
    )
    expect(naOutra).toEqual([])
  })

  it('recusa vender produto de outra empresa', async () => {
    const alheio = randomUUID()
    await withTenant(
      sql,
      outraEmpresa,
      (tx) => tx`
        INSERT INTO products (id, company_id, description, internal_code, unit_of_measure,
                              sale_price_cents, stock)
        VALUES (${alheio}, ${outraEmpresa}, 'Produto da vizinha', 'PROD-9999', 'un', 500, 5)
      `,
    )

    await expect(
      registerSale(deps(), contexto(), {
        items: [{ productId: alheio, quantity: 1, unitPriceCents: 500 }],
        payments: [{ method: 'cash', amountCents: 500 }],
      }),
    ).rejects.toThrow(/não foi encontrado/i)
  })

  async function saldo(): Promise<number> {
    const [p] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ stock: number }[]>`
        SELECT stock FROM products WHERE id = ${produto}
      `,
    )
    return p!.stock
  }

  async function vendasDaEmpresa(): Promise<number> {
    const [r] = await withTenant(
      sql,
      empresa,
      (tx) => tx<{ total: string }[]>`SELECT count(*) AS total FROM sales`,
    )
    return Number(r!.total)
  }
})
