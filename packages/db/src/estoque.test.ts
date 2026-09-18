import { randomUUID } from 'node:crypto'
import { adjustStock, InMemoryAuditTrail } from '@na-regua/core'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createInventoryHistory,
  createInventoryQueries,
  createInventoryUnitOfWork,
} from './inventory-repository.js'
import { createProductRepository } from './registration-repositories.js'
import { migrate } from './migrate.js'
import { cnpjDeTeste, conectarComoAplicacao, type ConexaoDeAplicacao } from './test-support.js'
import { withTenant } from './tenant.js'

/**
 * Ajuste de inventario no banco — NR-023, RF-022 a RF-024, RF-124.
 *
 * A regra do ajuste tem teste em `core`, contra falso. O que se prova AQUI e o
 * que so o banco prova: que saldo e movimento entram na MESMA transacao, que a
 * trilha recusa alteracao e remocao, que o saldo gravado e o contado e nao um
 * delta calculado antes, e que nada disso enxerga a loja do lado.
 *
 * O caso de uso de `core` roda de verdade contra este repositorio — nao ha
 * falso nenhum no meio. E o que faz este arquivo pegar fiacao errada, e nao
 * apenas SQL errado.
 */

const DATABASE_URL = process.env.DATABASE_URL
const MIGRATION_URL = process.env.DATABASE_MIGRATION_URL ?? DATABASE_URL

describe.skipIf(!DATABASE_URL)('estoque — NR-023', () => {
  let admin: Sql
  let sql: Sql
  let aplicacao: ConexaoDeAplicacao
  let empresaA: string
  let empresaB: string
  let usuario: string

  let uow: ReturnType<typeof createInventoryUnitOfWork>
  let queries: ReturnType<typeof createInventoryQueries>
  let historico: ReturnType<typeof createInventoryHistory>

  const AGORA = new Date('2026-09-06T12:00:00.000Z')

  const contexto = (companyId: string) => ({
    companyId,
    userId: usuario,
    role: 'owner' as const,
    channel: 'app' as const,
    requestId: 'req-estoque',
    now: AGORA,
  })

  let sequencia = 0

  async function criarEmpresa(cnpj: string, nome: string): Promise<string> {
    const id = randomUUID()
    await withTenant(
      sql,
      id,
      (tx) => tx`
        INSERT INTO companies (id, legal_name, cnpj, email, phone)
        VALUES (${id}, ${nome}, ${cnpj}, ${`e@${cnpj}.local`}, '41999990000')
      `,
    )
    return id
  }

  async function criarProduto(
    empresa: string,
    saldo: number,
    minimo = 5,
    opcoes: { tracksStock?: boolean; location?: string | null; description?: string } = {},
  ): Promise<string> {
    const id = randomUUID()
    sequencia += 1
    const tracksStock = opcoes.tracksStock ?? true
    const location = opcoes.location ?? null
    const description = opcoes.description ?? 'Cafe torrado'

    await withTenant(
      sql,
      empresa,
      (tx) => tx`
        INSERT INTO products
          (id, company_id, description, internal_code, unit_of_measure,
           sale_price_cents, cost_price_cents, stock, min_stock, tracks_stock, location)
        VALUES (${id}, ${empresa}, ${description}, ${`E-${sequencia}-${id.slice(0, 6)}`},
                'un', 1990, 1200, ${saldo}, ${minimo}, ${tracksStock}, ${location})
      `,
    )
    return id
  }

  const deps = () => ({ uow, products: queries.products, audit: new InMemoryAuditTrail() })

  beforeAll(async () => {
    const r = await migrate(MIGRATION_URL!)
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0002_dominio_0909')
    expect([...r.aplicadas, ...r.jaEstavam]).toContain('0022_produto_estoque_localizacao')

    admin = postgres(DATABASE_URL!, { max: 6, onnotice: () => {} })
    aplicacao = await conectarComoAplicacao(admin, DATABASE_URL!)
    sql = aplicacao.sql

    empresaA = await criarEmpresa(cnpjDeTeste('3'), 'Loja Estoque A')
    empresaB = await criarEmpresa(cnpjDeTeste('2'), 'Loja Estoque B')

    usuario = randomUUID()
    await admin`
      INSERT INTO users (id, name, email) VALUES (${usuario}, 'Dona', ${`e${usuario}@local`})
    `

    uow = createInventoryUnitOfWork(sql)
    queries = createInventoryQueries(sql)
    historico = createInventoryHistory(sql)
  }, 60_000)

  afterAll(async () => {
    if (!sql) {
      await admin?.end({ timeout: 5 })
      return
    }
    /*
     * `inventory_movements` NAO e limpa: o gatilho recusa DELETE (RF-124), e a
     * tabela e referenciada por `products`. Livro-razao que so cresce e assim
     * de proposito — o custo e uma empresa a mais por execucao no banco de
     * desenvolvimento, e na CI o banco morre com o job.
     */
    await admin`DELETE FROM users WHERE id = ${usuario}`
    await aplicacao.encerrar()
    await admin.end({ timeout: 5 })
  })

  describe('leitura do saldo — RF-022', () => {
    it('devolve saldo, minimo e descricao', async () => {
      const p = await criarProduto(empresaA, 12, 5)

      const achado = await queries.products.findById(empresaA, p)

      expect(achado).toMatchObject({ stockQuantity: 12, minStock: 5, description: 'Cafe torrado' })
    })

    it('produto de outra loja e o mesmo que inexistente', async () => {
      const p = await criarProduto(empresaA, 12)

      expect(await queries.products.findById(empresaB, p)).toBeUndefined()
    })

    it('devolve localizacao quando cadastrada', async () => {
      const p = await criarProduto(empresaA, 3, 5, { location: 'Corredor 2, prateleira A' })

      const achado = await queries.products.findById(empresaA, p)

      expect(achado?.location).toBe('Corredor 2, prateleira A')
    })

    it('saldo zero continua sendo zero quando controla estoque', async () => {
      const p = await criarProduto(empresaA, 0)

      const achado = await queries.products.findById(empresaA, p)

      expect(achado?.stockQuantity).toBe(0)
    })

    it('sem controle de estoque devolve nulo, nao zero — RF-022', async () => {
      const p = await criarProduto(empresaA, 0, 0, { tracksStock: false })

      const achado = await queries.products.findById(empresaA, p)

      expect(achado?.stockQuantity).toBeNull()
      expect(achado?.stockQuantity).not.toBe(0)
    })
  })

  describe('busca textual — NR-115 / T022', () => {
    let produtos: ReturnType<typeof createProductRepository>

    beforeAll(() => {
      produtos = createProductRepository(sql)
    })

    it('busca por nome so devolve produtos do tenant', async () => {
      await criarProduto(empresaA, 8, 5, { description: 'Camiseta exclusiva A' })
      await criarProduto(empresaB, 4, 5, { description: 'Camiseta exclusiva B' })

      const daA = await produtos.search(empresaA, { termo: 'Camiseta exclusiva', limite: 5 })
      const daB = await produtos.search(empresaB, { termo: 'Camiseta exclusiva', limite: 5 })

      expect(daA.map((p) => p.description)).toEqual(['Camiseta exclusiva A'])
      expect(daB.map((p) => p.description)).toEqual(['Camiseta exclusiva B'])
    })

    it('produto conhecido apenas da outra loja responde como ausente', async () => {
      const idB = await criarProduto(empresaB, 6, 5, { description: 'So da loja B' })

      expect(await queries.products.findById(empresaA, idB)).toBeUndefined()
      expect(await produtos.search(empresaA, { termo: 'So da loja B', limite: 5 })).toEqual([])
    })
  })

  describe('ajuste — RF-023', () => {
    it('grava o saldo CONTADO e a diferenca na trilha, juntos', async () => {
      const p = await criarProduto(empresaA, 20)

      const m = await adjustStock(deps(), contexto(empresaA), {
        productId: p,
        countedQuantity: 18,
        reason: 'Contagem do fim do mes',
      })

      expect(m.quantityDelta).toBe(-2)
      expect(m.balanceAfter).toBe(18)

      /* O saldo do produto mudou de fato, e nao so a trilha. */
      const depois = await queries.products.findById(empresaA, p)
      expect(depois?.stockQuantity).toBe(18)
    })

    it('a contagem e ABSOLUTA: contou 30 em cima de 18, o saldo vira 30', async () => {
      const p = await criarProduto(empresaA, 18)

      const m = await adjustStock(deps(), contexto(empresaA), {
        productId: p,
        countedQuantity: 30,
        reason: 'Chegou a reposicao',
      })

      /* +12, e nao 30: o delta e consequencia do que foi contado. Se a
         implementacao somasse, o saldo iria a 48. */
      expect(m.quantityDelta).toBe(12)
      expect(m.balanceAfter).toBe(30)
    })

    it('ajuste que nao muda nada nao vira linha na trilha', async () => {
      const p = await criarProduto(empresaA, 7)

      await expect(
        adjustStock(deps(), contexto(empresaA), {
          productId: p,
          countedQuantity: 7,
          reason: 'Confere',
        }),
      ).rejects.toThrow()

      /* O CHECK `quantity_delta <> 0` do schema diz a mesma coisa: movimento
         que nao move nada e ruido, e trilha com ruido e trilha que ninguem le. */
      const trilha = await historico.byProduct(empresaA, p, 10)
      expect(trilha).toHaveLength(0)
    })

    it('produto de outra loja nao se ajusta', async () => {
      const p = await criarProduto(empresaA, 10)

      await expect(
        adjustStock(deps(), contexto(empresaB), {
          productId: p,
          countedQuantity: 1,
          reason: 'Nao deveria funcionar',
        }),
      ).rejects.toThrow()
    })

    it('nao deixa o saldo mudar sem movimento quando a trilha recusa', async () => {
      const p = await criarProduto(empresaA, 10)

      /*
       * O motivo vazio passa pelo caso de uso (o contrato valida na borda) e
       * bate no CHECK `inventory_movements_origem_declarada`. A transacao
       * inteira volta atras: o saldo NAO pode ter mudado.
       */
      await expect(
        uow.transaction(empresaA, async (tx) => {
          await tx.setStock(p, 99)
          await tx.insertMovement({
            companyId: empresaA,
            productId: p,
            kind: 'adjustment',
            quantityDelta: 89,
            balanceAfter: 99,
            reason: null,
            saleId: null,
            createdBy: usuario,
            createdAt: AGORA,
          })
        }),
      ).rejects.toThrow()

      const depois = await queries.products.findById(empresaA, p)
      expect(depois?.stockQuantity).toBe(10)
    })
  })

  describe('a trilha — RF-124', () => {
    it('recusa UPDATE e DELETE', async () => {
      const p = await criarProduto(empresaA, 5)
      await adjustStock(deps(), contexto(empresaA), {
        productId: p,
        countedQuantity: 9,
        reason: 'Entrada',
      })

      await expect(
        withTenant(sql, empresaA, (tx) => tx`UPDATE inventory_movements SET reason = 'outro'`),
      ).rejects.toThrow()

      await expect(
        withTenant(
          sql,
          empresaA,
          (tx) => tx`DELETE FROM inventory_movements WHERE product_id = ${p}`,
        ),
      ).rejects.toThrow()
    })

    it('devolve os movimentos do mais recente para tras', async () => {
      const p = await criarProduto(empresaA, 0)

      for (const [contado, motivo] of [
        [10, 'Primeira entrada'],
        [8, 'Quebra'],
        [25, 'Reposicao'],
      ] as const) {
        await adjustStock(deps(), contexto(empresaA), {
          productId: p,
          countedQuantity: contado,
          reason: motivo,
        })
      }

      const trilha = await historico.byProduct(empresaA, p, 10)

      expect(trilha).toHaveLength(3)
      expect(trilha[0]?.reason).toBe('Reposicao')
      expect(trilha[0]?.balanceAfter).toBe(25)
      /* O saldo de cada linha explica o seguinte: 0 → 10 → 8 → 25. */
      expect(trilha.map((m) => m.balanceAfter)).toEqual([25, 8, 10])
    })

    it('nao mostra a trilha da outra loja', async () => {
      const p = await criarProduto(empresaB, 4)
      await adjustStock(deps(), contexto(empresaB), {
        productId: p,
        countedQuantity: 6,
        reason: 'Da loja B',
      })

      expect(await historico.byProduct(empresaA, p, 10)).toEqual([])
      expect(await historico.byProduct(empresaB, p, 10)).toHaveLength(1)
    })
  })
})
